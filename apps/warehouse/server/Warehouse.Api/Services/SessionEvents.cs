using Npgsql;
using Warehouse.Api.Data;

namespace Warehouse.Api.Services;

/// <summary>
/// Forgets a sign-in the moment it ends, whichever module ended it.
///
/// SessionStore remembers a live session for a few seconds so a handheld's scans
/// are not each a trip to the database. Signing out on the courier portal, or
/// blocking an account there, deletes the session rows in core.user_sessions;
/// the database announces each one on a channel (core.announce_session_end, see
/// database/init/10-core.sql) and this drops what was remembered, so the
/// dashboard is signed out at once instead of when the memory runs out.
///
/// Losing the connection is not an error anybody has to act on: sessions end on
/// the short timer until it is back, and everything remembered is forgotten when
/// it is, in case an announcement was missed in between.
/// </summary>
public sealed class SessionEvents(Db db, SessionStore sessions, ILogger<SessionEvents> logger) : BackgroundService
{
    /// <summary>The channel core.announce_session_end() notifies, with the session id as payload.</summary>
    public const string Channel = "core_session_ended";

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var retry = TimeSpan.FromSeconds(2);
        var warned = false;

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var conn = await db.OpenAsync(stoppingToken);
                conn.Notification += (_, e) =>
                {
                    if (Guid.TryParse(e.Payload, out var sessionId)) sessions.Forget(sessionId);
                };

                await using (var listen = new NpgsqlCommand($"LISTEN {Channel}", conn))
                {
                    await listen.ExecuteNonQueryAsync(stoppingToken);
                }

                sessions.ForgetAll();
                retry = TimeSpan.FromSeconds(2);
                if (warned) logger.LogInformation("Listening for ended sign-ins again");
                warned = false;

                while (!stoppingToken.IsCancellationRequested)
                {
                    // A quiet minute is followed by a ping, so a connection that
                    // died silently is noticed and replaced.
                    if (!await conn.WaitAsync(TimeSpan.FromMinutes(1), stoppingToken))
                    {
                        await using var ping = new NpgsqlCommand("SELECT 1", conn);
                        await ping.ExecuteScalarAsync(stoppingToken);
                    }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception ex)
            {
                if (!warned)
                {
                    logger.LogWarning("Not listening for ended sign-ins ({Message}); a sign-out elsewhere takes up to 15s to reach this API until it is back",
                        ex.Message);
                    warned = true;
                }

                try { await Task.Delay(retry, stoppingToken); }
                catch (OperationCanceledException) { return; }
                retry = TimeSpan.FromSeconds(Math.Min(retry.TotalSeconds * 2, 60));
            }
        }
    }
}
