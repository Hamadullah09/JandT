using Dapper;
using Microsoft.Extensions.Options;
using Npgsql;
using Warehouse.Api.Data;

namespace Warehouse.Api.Services;

/// <summary>
/// Reads the courier's tracking back into the warehouse.
///
/// The warehouse used to stop at "shipped" because nobody here learned when a
/// parcel arrived. The courier module records every scan - picked up, at the
/// hub, delivered, returned - in the same database, so this closes the loop:
///
///   DELIVERED  the order becomes delivered, stamped with the courier's time
///   RETURNED   a return is opened for the order, so the returns desk is
///              expecting the parcel before it is on the counter
///
/// It reads the courier's table (a grant the platform gives this role) and
/// writes only warehouse tables, so each module still owns its own data. Every
/// step is idempotent, and several copies of the API take turns on an advisory
/// lock, so it is safe to run anywhere and as often as configured.
/// </summary>
public sealed class CourierSyncService(Db db, IOptions<CourierOptions> options, ILogger<CourierSyncService> logger)
    : BackgroundService
{
    private bool _courierMissingLogged;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var interval = TimeSpan.FromSeconds(Math.Clamp(options.Value.SyncSeconds, 5, 3600));

        // Let the application finish starting before the first pass.
        try { await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken); }
        catch (OperationCanceledException) { return; }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await SyncOnceAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Courier sync failed; retrying in {Seconds}s", interval.TotalSeconds);
            }

            try { await Task.Delay(interval, stoppingToken); }
            catch (OperationCanceledException) { return; }
        }
    }

    /// <summary>One pass. Public so an integration test can run it without waiting.</summary>
    public async Task<SyncResult> SyncOnceAsync(CancellationToken ct = default)
    {
        await using var conn = await db.OpenAsync(ct);

        if (!await conn.ExecuteScalarAsync<bool>("SELECT pg_try_advisory_lock(hashtext('warehouse.courier-sync'))"))
            return new SyncResult(0, 0, 0);

        try
        {
            if (!await conn.ExecuteScalarAsync<bool>("SELECT to_regclass('courier.orders') IS NOT NULL"))
            {
                if (!_courierMissingLogged)
                {
                    logger.LogInformation("Courier sync idle: the courier module's tables are not in this database yet");
                    _courierMissingLogged = true;
                }
                return new SyncResult(0, 0, 0);
            }

            await using var tx = await conn.BeginTransactionAsync(ct);

            // 1. The latest tracking status of every parcel whose status moved.
            var changed = (await conn.QueryAsync("""
                UPDATE shipments s
                   SET status    = co.tracking_status,
                       status_at = co.tracking_updated_at,
                       synced_at = now()
                  FROM courier.orders co
                 WHERE co.tracking_no = s.tracking_no
                   AND co.tracking_status IS DISTINCT FROM s.status
                RETURNING s.order_id, s.tracking_no, s.status
                """, transaction: tx)).ToList();

            // 2. Delivered by the courier: the order is delivered. Only from
            //    shipped - an order still being picked when its parcel was booked
            //    moves on the next pass after it ships.
            var delivered = await conn.ExecuteAsync("""
                UPDATE orders o
                   SET status = 'delivered',
                       delivered_at = COALESCE(s.status_at, now())
                  FROM shipments s
                 WHERE s.order_id = o.id
                   AND s.status = 'DELIVERED'
                   AND o.status = 'shipped'
                """, transaction: tx);

            // 3. Returned by the courier: open a return, once, so the desk is
            //    expecting the parcel. The garments are still checked by tag at
            //    the counter; nothing is restocked or refunded here.
            var toOpen = (await conn.QueryAsync("""
                SELECT o.id, o.order_no, s.tracking_no
                  FROM shipments s
                  JOIN orders o ON o.id = s.order_id
                 WHERE s.status = 'RETURNED'
                   AND o.status IN ('shipped','delivered')
                   AND NOT EXISTS (SELECT 1 FROM returns r WHERE r.order_id = o.id)
                 FOR UPDATE OF o
                """, transaction: tx)).ToList();

            foreach (var order in toOpen)
            {
                var returnNo = await Ref.NextAsync(conn, tx, "returns", "return_no", "RET");
                await conn.ExecuteAsync("""
                    INSERT INTO returns (return_no, order_id, status, reason)
                    VALUES (@returnNo, @orderId, 'requested', @reason)
                    """,
                    new
                    {
                        returnNo,
                        orderId = (int)order.id,
                        reason = $"Parcel {(string)order.tracking_no} returned by J&T - scan the garments when it arrives.",
                    }, tx);
            }

            await tx.CommitAsync(ct);

            if (changed.Count > 0 || delivered > 0 || toOpen.Count > 0)
            {
                logger.LogInformation(
                    "Courier sync: {Changed} parcel status change(s), {Delivered} order(s) delivered, {Returns} return(s) opened",
                    changed.Count, delivered, toOpen.Count);

                foreach (var change in changed)
                {
                    await Audit.WriteAsync(conn, "courier.status_synced", entity: "order",
                        entityId: ((int)change.order_id).ToString(),
                        detail: new { trackingNo = (string)change.tracking_no, status = (string)change.status });
                }
            }

            return new SyncResult(changed.Count, delivered, toOpen.Count);
        }
        catch (PostgresException ex) when (ex.SqlState == PostgresErrorCodes.InsufficientPrivilege)
        {
            if (!_courierMissingLogged)
            {
                logger.LogWarning("Courier sync idle: this database role may not read courier.orders ({Message})", ex.MessageText);
                _courierMissingLogged = true;
            }
            return new SyncResult(0, 0, 0);
        }
        finally
        {
            await conn.ExecuteAsync("SELECT pg_advisory_unlock(hashtext('warehouse.courier-sync'))");
        }
    }

    public sealed record SyncResult(int StatusChanges, int Delivered, int ReturnsOpened);
}
