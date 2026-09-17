using Dapper;
using Npgsql;
using Warehouse.Api.Data;
using Warehouse.Api.Services;

namespace Warehouse.Api.Endpoints;

/// <summary>
/// The returns desk.
///
/// A customer asks to send something back, and the courier brings a garment to
/// the counter. The question that matters is whether this garment is one of the
/// ones that actually went out on that order, and it is answered by the tag
/// rather than by the label, the box or the customer.
///
/// Every scan gets a verdict and every scan is kept, including the ones that
/// fail. A tag from a different order is a fact somebody will want to look at
/// later; throwing it away at the counter loses the only evidence there was.
///
/// Nothing is restocked and no money moves until the return is closed. Up to
/// that point the desk is gathering, and a half-finished return has changed
/// nothing.
/// </summary>
public static class ReturnEndpoints
{
    /// <summary>
    /// How much use is left in a returned garment, as the counter grades it:
    /// 1 no defects, 2 defective but still usable, 3 defective beyond use.
    /// </summary>
    private static int Grade(int? reusability, string? condition)
    {
        // An explicit grade wins. Without one, fall back to the older
        // resellable/damaged pair so a caller that predates this - the
        // handheld somebody has not updated yet, a saved script - keeps
        // behaving exactly as it did.
        if (reusability is 1 or 2 or 3) return reusability.Value;
        return condition == "damaged" ? 2 : 1;
    }

    /// <summary>
    /// The same judgement as <see cref="Grade"/> in the two terms the rest of
    /// the system already speaks. Grade 2 and 3 are both "not fit to sell";
    /// what separates them is whether the garment is kept, and that is decided
    /// when the return is closed.
    /// </summary>
    private static string ConditionFor(int grade) => grade == 1 ? "resellable" : "damaged";

    /// <summary>
    /// Moves one returned garment according to its grade and writes the ledger.
    /// The desk's close and the returns room share this, so the two can never
    /// disagree about what a grade means.
    /// </summary>
    private static Task ApplyGradeAsync(
        NpgsqlConnection conn, NpgsqlTransaction tx, int itemId, int grade,
        int? toRoomId, int orderId, int returnId, string returnNo, int userId)
    {
        var (type, toStatus, note) = grade switch
        {
            1 => ("restock", "in_stock", $"Returned on {returnNo} and back into stock"),
            2 => ("return", "damaged", $"Returned on {returnNo}, defective but usable"),
            _ => ("return", "written_off", $"Returned on {returnNo}, defective and written off"),
        };

        return Ledger.RecordAsync(conn, tx, itemId,
            type: type, toRoomId: toRoomId, toStatus: toStatus,
            orderId: orderId, returnId: returnId, userId: userId, note: note);
    }

    /// <summary>What one tag read in the returns room turned out to be.</summary>
    private sealed record Checked(
        string Epc, string State, string Message,
        int? ItemId = null, string? Sku = null, string? ProductName = null,
        string? ColorName = null, string? ColorHex = null, string? SizeCode = null,
        int? OrderItemId = null, int? OrderId = null, string? OrderNo = null,
        int? TrackingId = null, string? CustomerName = null, decimal Refund = 0m)
    {
        public bool Returnable => State == "returnable";

        /// <summary>The shape the dashboard and the handheld read: snake_case, like every other row.</summary>
        public object ToJson() => new
        {
            epc = Epc, state = State, message = Message,
            item_id = ItemId, sku = Sku, product_name = ProductName,
            color_name = ColorName, color_hex = ColorHex, size_code = SizeCode,
            order_id = OrderId, order_no = OrderNo, tracking_id = TrackingId,
            customer_name = CustomerName, refund = Refund,
        };
    }

    /// <summary>
    /// What a tag read in the returns room is.
    ///
    /// A garment is a return when the last order it went out on still counts it
    /// as shipped - the same test the desk used. A room sweep reads everything
    /// in range, so most of what is not a return is a garment that was simply
    /// never sent anywhere, and that has to be said plainly rather than added.
    /// </summary>
    private static async Task<Checked> CheckOneAsync(NpgsqlConnection conn, NpgsqlTransaction? tx, string epc, bool forUpdate)
    {
        var item = await conn.QueryFirstOrDefaultAsync("""
            SELECT i.id, i.status, v.sku, p.name AS product_name,
                   col.name AS color_name, col.hex AS color_hex, sz.code AS size_code
              FROM items i
              JOIN variants v  ON v.id = i.variant_id
              JOIN products p  ON p.id = v.product_id
              JOIN colors col  ON col.id = v.color_id
              JOIN sizes  sz   ON sz.id  = v.size_id
             WHERE i.epc = @epc
            """, new { epc }, tx);

        if (item is null)
            return new Checked(epc, "not_ours", "Not one of our tags.");

        var shipped = await conn.QueryFirstOrDefaultAsync($"""
            SELECT oi.id AS order_item_id, oi.order_id, ol.unit_price,
                   o.order_no, o.tracking_id, o.customer_name, o.status AS order_status
              FROM order_items oi
              JOIN order_lines ol ON ol.id = oi.order_line_id
              JOIN orders o       ON o.id  = oi.order_id
             WHERE oi.epc = @epc AND oi.status = 'shipped'
             ORDER BY oi.id DESC LIMIT 1
             {(forUpdate ? "FOR UPDATE OF oi, o" : "")}
            """, new { epc }, tx);

        int itemId = (int)item.id;
        string itemStatus = (string)item.status;
        string sku = (string)item.sku, productName = (string)item.product_name;
        string colorName = (string)item.color_name, sizeCode = (string)item.size_code;
        string? colorHex = (string?)item.color_hex;

        if (shipped is not null && (string)shipped.order_status is "shipped" or "delivered" or "partly_returned")
        {
            return new Checked(epc, "returnable", $"Went out on {(string)shipped.order_no}.",
                itemId, sku, productName, colorName, colorHex, sizeCode,
                OrderItemId: (int)shipped.order_item_id,
                OrderId: (int)shipped.order_id,
                OrderNo: (string)shipped.order_no,
                TrackingId: (int?)shipped.tracking_id,
                CustomerName: (string)shipped.customer_name,
                Refund: (decimal)shipped.unit_price);
        }

        var returnedOn = await conn.ExecuteScalarAsync<string?>("""
            SELECT rt.return_no FROM return_lines rl JOIN returns rt ON rt.id = rl.return_id
             WHERE rl.epc = @epc AND rl.verdict = 'matched' AND rt.status = 'closed'
             ORDER BY rl.id DESC LIMIT 1
            """, new { epc }, tx);

        // Already returned wins over "in stock": a garment that came back and
        // was restocked is in stock, and "it never went out" would be untrue.
        var (state, message) =
            returnedOn is not null && itemStatus is not ("allocated" or "shipped")
                ? ("already_returned", $"Already returned on {returnedOn}.")
                : itemStatus switch
                {
                    "in_stock" => ("not_shipped", "In stock - it never went out, so it is not a return."),
                    "allocated" => ("not_shipped", "Picked for an order that has not shipped yet."),
                    "damaged" => ("not_shipped", "Already marked damaged in the warehouse."),
                    "written_off" => ("not_shipped", "Written off - it is not in stock to return."),
                    _ => ("not_returnable", $"Not on a shipped order (it is {itemStatus})."),
                };

        return new Checked(epc, state, message, itemId, sku, productName, colorName, colorHex, sizeCode);
    }

    public static void MapReturns(this IEndpointRouteBuilder app, Db db)
    {
        var g = app.MapGroup("/api/returns").RequireAuthorization();

        g.MapGet("/", async (HttpContext ctx) =>
        {
            var status = ctx.Request.Query["status"].ToString();
            var search = ctx.Request.Query["search"].ToString().Trim();

            await using var conn = await db.OpenAsync();
            var returns = await conn.QueryAsync("""
                SELECT rt.id, rt.return_no, rt.status, rt.reason, rt.refund_amount,
                       rt.requested_at, rt.received_at,
                       o.id AS order_id, o.order_no, o.tracking_id, o.customer_name, o.customer_phone, o.total AS order_total,
                       u.full_name AS received_by_name,
                       COALESCE(l.scanned, 0) AS scanned,
                       COALESCE(l.matched, 0) AS matched,
                       COALESCE(l.failed, 0)  AS failed
                  FROM returns rt
                  JOIN orders o ON o.id = rt.order_id
                  LEFT JOIN users u ON u.id = rt.received_by
                  LEFT JOIN (SELECT return_id,
                                    COUNT(*)                                     AS scanned,
                                    COUNT(*) FILTER (WHERE verdict = 'matched')  AS matched,
                                    COUNT(*) FILTER (WHERE verdict <> 'matched') AS failed
                               FROM return_lines GROUP BY return_id) l ON l.return_id = rt.id
                 WHERE (@status = '' OR rt.status = @status)
                   AND (@search = '' OR rt.return_no ILIKE @like OR o.order_no ILIKE @like
                        OR o.customer_name ILIKE @like)
                 ORDER BY rt.requested_at DESC
                 LIMIT 300
                """, new { status, search, like = $"%{search}%" });

            return Results.Ok(new { returns });
        });

        g.MapGet("/{id:int}", async (int id) =>
        {
            await using var conn = await db.OpenAsync();

            var ret = await conn.QueryFirstOrDefaultAsync("""
                SELECT rt.id, rt.return_no, rt.status, rt.reason, rt.notes, rt.refund_amount,
                       rt.requested_at, rt.received_at,
                       o.id AS order_id, o.order_no, o.tracking_id, o.customer_name, o.customer_phone,
                       o.customer_email, o.address, o.city, o.total AS order_total,
                       o.refunded_total, o.status AS order_status, o.shipped_at,
                       u.full_name AS received_by_name
                  FROM returns rt
                  JOIN orders o ON o.id = rt.order_id
                  LEFT JOIN users u ON u.id = rt.received_by
                 WHERE rt.id = @id
                """, new { id })
                ?? throw ApiException.NotFound($"Return {id} was not found.");

            var lines = await conn.QueryAsync("""
                SELECT rl.id, rl.epc, rl.verdict, rl.item_condition, rl.reusability, rl.refund_amount,
                       rl.received_at, rl.restock_room_id, rl.item_id,
                       rm.code AS restock_room_code,
                       v.sku, p.name AS product_name,
                       col.name AS color_name, col.hex AS color_hex,
                       sz.code AS size_code,
                       ol.unit_price,
                       -- Which order the tag really belongs to. Only interesting
                       -- when the verdict says it is not this one, and that is
                       -- exactly when the desk needs it most.
                       other.order_no AS belongs_to_order
                  FROM return_lines rl
                  LEFT JOIN items i    ON i.id = rl.item_id
                  LEFT JOIN variants v ON v.id = i.variant_id
                  LEFT JOIN products p ON p.id = v.product_id
                  LEFT JOIN colors col ON col.id = v.color_id
                  LEFT JOIN sizes  sz  ON sz.id  = v.size_id
                  LEFT JOIN rooms rm   ON rm.id = rl.restock_room_id
                  LEFT JOIN order_items oi ON oi.id = rl.order_item_id
                  LEFT JOIN order_lines ol ON ol.id = oi.order_line_id
                  LEFT JOIN orders other ON other.id = (
                        SELECT x.order_id FROM order_items x
                         WHERE x.epc = rl.epc ORDER BY x.id DESC LIMIT 1)
                 WHERE rl.return_id = @id
                 ORDER BY rl.received_at DESC
                """, new { id });

            // What went out on the order, so the desk can see what is still
            // expected rather than only what has turned up.
            var shipped = await conn.QueryAsync("""
                SELECT oi.id, oi.epc, oi.status,
                       v.sku, p.name AS product_name,
                       col.name AS color_name, sz.code AS size_code, ol.unit_price,
                       EXISTS (SELECT 1 FROM return_lines rl
                                WHERE rl.return_id = @id AND rl.order_item_id = oi.id)::int AS returned_here
                  FROM order_items oi
                  JOIN order_lines ol ON ol.id = oi.order_line_id
                  JOIN items i     ON i.id = oi.item_id
                  JOIN variants v  ON v.id = i.variant_id
                  JOIN products p  ON p.id = v.product_id
                  JOIN colors col  ON col.id = v.color_id
                  JOIN sizes  sz   ON sz.id  = v.size_id
                 WHERE oi.order_id = (SELECT order_id FROM returns WHERE id = @id)
                 ORDER BY oi.id
                """, new { id });

            return Results.Ok(new { ret, lines, shipped });
        });

        g.MapPost("/", async (HttpContext ctx, ReturnRequest req) =>
        {
            ctx.RequireRole("admin", "operator");

            await using var conn = await db.OpenAsync();
            await using var tx = await conn.BeginTransactionAsync();

            // The counter is holding a parcel with a tracking number on it, so
            // that is accepted in place of the order id. One or the other, and
            // the tracking number wins if somebody sends both.
            if (req.TrackingId is null && req.OrderId is null)
                throw ApiException.BadRequest("Say which order is coming back: an order id or a tracking number.");

            var order = req.TrackingId is not null
                ? await conn.QueryFirstOrDefaultAsync(
                      "SELECT id, order_no, status FROM orders WHERE tracking_id = @t",
                      new { t = req.TrackingId }, tx)
                  ?? throw ApiException.NotFound($"No order has tracking number {req.TrackingId}.")
                : await conn.QueryFirstOrDefaultAsync(
                      "SELECT id, order_no, status FROM orders WHERE id = @id",
                      new { id = req.OrderId }, tx)
                  ?? throw ApiException.NotFound($"Order {req.OrderId} was not found.");

            var orderId = (int)order.id;

            // Nothing can come back that never went out.
            if ((string)order.status is "pending" or "allocated" or "cancelled")
                throw ApiException.Conflict(
                    $"Order {(string)order.order_no} has not shipped, so there is nothing to return.");

            var returnNo = await Ref.NextAsync(conn, tx, "returns", "return_no", "RET");

            var id = await conn.ExecuteScalarAsync<int>("""
                INSERT INTO returns (return_no, order_id, reason, notes)
                VALUES (@returnNo, @orderId, @reason, @notes)
                RETURNING id
                """,
                new { returnNo, orderId, reason = req.Reason, notes = req.Notes }, tx);

            await tx.CommitAsync();
            return Results.Json(new { ok = true, id, returnNo, orderId }, statusCode: 201);
        });

        // The cross-check. One tag at a time, from the counter or the handheld.
        g.MapPost("/{id:int}/scan", async (HttpContext ctx, int id, ReturnScanRequest req) =>
        {
            ctx.RequireRole("admin", "operator");
            var epc = Epc.Normalise(req.Epc);

            await using var conn = await db.OpenAsync();
            await using var tx = await conn.BeginTransactionAsync();

            var ret = await conn.QueryFirstOrDefaultAsync("""
                SELECT rt.id, rt.return_no, rt.status, rt.order_id, o.order_no
                  FROM returns rt JOIN orders o ON o.id = rt.order_id WHERE rt.id = @id
                """, new { id }, tx)
                ?? throw ApiException.NotFound($"Return {id} was not found.");

            if ((string)ret.status is not ("requested" or "received"))
                throw ApiException.Conflict($"Return {(string)ret.return_no} is closed.");

            if (await conn.ExecuteScalarAsync<long>(
                    "SELECT COUNT(*) FROM return_lines WHERE return_id = @id AND epc = @epc",
                    new { id, epc }, tx) > 0)
                throw ApiException.Conflict("That tag has already been scanned onto this return.");

            // Four possible answers, in the order they need deciding.
            var item = await conn.QueryFirstOrDefaultAsync("""
                SELECT i.id, i.status, p.name AS product_name,
                       col.name AS color_name, sz.code AS size_code
                  FROM items i
                  JOIN variants v  ON v.id = i.variant_id
                  JOIN products p  ON p.id = v.product_id
                  JOIN colors col  ON col.id = v.color_id
                  JOIN sizes  sz   ON sz.id  = v.size_id
                 WHERE i.epc = @epc
                """, new { epc }, tx);

            var onThisOrder = await conn.QueryFirstOrDefaultAsync("""
                SELECT oi.id, ol.unit_price
                  FROM order_items oi JOIN order_lines ol ON ol.id = oi.order_line_id
                 WHERE oi.order_id = @orderId AND oi.epc = @epc AND oi.status = 'shipped'
                 ORDER BY oi.id DESC LIMIT 1
                """, new { orderId = (int)ret.order_id, epc }, tx);

            var elsewhere = await conn.ExecuteScalarAsync<string?>("""
                SELECT o.order_no FROM order_items oi JOIN orders o ON o.id = oi.order_id
                 WHERE oi.epc = @epc AND oi.order_id <> @orderId
                 ORDER BY oi.id DESC LIMIT 1
                """, new { epc, orderId = (int)ret.order_id }, tx);

            var (verdict, message) = (item, onThisOrder, elsewhere) switch
            {
                (null, _, _) => ("unknown_tag",
                    "We have never seen that tag. It is not one of ours."),

                (_, not null, _) => ("matched",
                    $"Correct: {(string)item!.product_name}, {(string)item.color_name} {(string)item.size_code} " +
                    $"went out on {(string)ret.order_no}."),

                (_, null, not null) => ("wrong_order",
                    $"That garment went out on order {elsewhere}, not {(string)ret.order_no}."),

                _ => ("not_shipped",
                    $"That garment is one of ours but has never been sent to anybody. It is {(string)item!.status}."),
            };

            var refund = onThisOrder is not null ? (decimal)onThisOrder.unit_price : 0m;
            var grade = Grade(req.Reusability, req.Condition);

            var lineId = await conn.ExecuteScalarAsync<int>("""
                INSERT INTO return_lines (return_id, order_item_id, item_id, epc, verdict,
                                          item_condition, reusability, restock_room_id, refund_amount)
                VALUES (@id, @orderItemId, @itemId, @epc, @verdict, @condition, @reusability, @roomId, @refund)
                RETURNING id
                """,
                new
                {
                    id,
                    orderItemId = onThisOrder is not null ? (int?)onThisOrder.id : null,
                    itemId = item is not null ? (int?)item.id : null,
                    epc,
                    verdict,
                    condition = ConditionFor(grade),
                    reusability = (short)grade,
                    roomId = req.RestockRoomId,
                    refund,
                }, tx);

            await conn.ExecuteAsync(
                "UPDATE returns SET status = 'received' WHERE id = @id AND status = 'requested'",
                new { id }, tx);

            await tx.CommitAsync();

            return Results.Json(new
            {
                ok = true,
                lineId,
                epc,
                verdict,
                message,
                accepted = verdict == "matched",
                refund,
            }, statusCode: 201);
        });

        g.MapDelete("/{id:int}/scan/{lineId:int}", async (HttpContext ctx, int id, int lineId) =>
        {
            ctx.RequireRole("admin", "operator");

            await using var conn = await db.OpenAsync();

            var status = await conn.ExecuteScalarAsync<string?>(
                "SELECT status FROM returns WHERE id = @id", new { id })
                ?? throw ApiException.NotFound($"Return {id} was not found.");

            if (status is not ("requested" or "received"))
                throw ApiException.Conflict("That return is closed, so its scans cannot be changed.");

            var n = await conn.ExecuteAsync(
                "DELETE FROM return_lines WHERE id = @lineId AND return_id = @id", new { lineId, id });

            if (n == 0) throw ApiException.NotFound("That scan was not found on this return.");
            return Results.Ok(new { ok = true });
        });

        g.MapPatch("/{id:int}/scan/{lineId:int}", async (HttpContext ctx, int id, int lineId, ReturnScanRequest req) =>
        {
            ctx.RequireRole("admin", "operator");

            // Null leaves the grade alone - this endpoint is also how a room is
            // set on its own, and that must not silently re-grade the garment.
            int? regrade = req.Reusability is 1 or 2 or 3 ? req.Reusability
                : req.Condition is "damaged" or "resellable" ? Grade(null, req.Condition)
                : null;

            await using var conn = await db.OpenAsync();
            var n = await conn.ExecuteAsync("""
                UPDATE return_lines rl
                   SET reusability     = COALESCE(@reusability, rl.reusability),
                       item_condition  = COALESCE(@condition, rl.item_condition),
                       restock_room_id = COALESCE(@roomId, rl.restock_room_id)
                  FROM returns rt
                 WHERE rt.id = rl.return_id
                   AND rl.id = @lineId AND rl.return_id = @id
                   AND rt.status IN ('requested','received')
                """,
                new
                {
                    lineId, id,
                    // Both move together or neither does: a line whose grade
                    // says "write off" and whose condition still says
                    // "resellable" would restock a garment somebody threw away.
                    reusability = (short?)regrade,
                    condition = regrade is null ? null : ConditionFor(regrade.Value),
                    roomId = req.RestockRoomId,
                });

            if (n == 0) throw ApiException.NotFound("That scan was not found, or the return is closed.");
            return Results.Ok(new { ok = true });
        });

        // Closing is where everything actually happens: stock goes back up,
        // and the sale is reversed by the refund.
        g.MapPost("/{id:int}/close", async (HttpContext ctx, int id, CloseReturnRequest req) =>
        {
            var me = ctx.RequireRole("admin", "operator");

            await using var conn = await db.OpenAsync();
            await using var tx = await conn.BeginTransactionAsync();

            var ret = await conn.QueryFirstOrDefaultAsync("""
                SELECT rt.id, rt.return_no, rt.status, rt.order_id, o.order_no
                  FROM returns rt JOIN orders o ON o.id = rt.order_id WHERE rt.id = @id
                   FOR UPDATE OF rt
                """, new { id }, tx)
                ?? throw ApiException.NotFound($"Return {id} was not found.");

            if ((string)ret.status is not ("requested" or "received"))
                throw ApiException.Conflict($"Return {(string)ret.return_no} is already closed.");

            var lines = (await conn.QueryAsync("""
                SELECT rl.id, rl.item_id, rl.order_item_id, rl.epc, rl.verdict,
                       rl.item_condition, rl.reusability, rl.restock_room_id, rl.refund_amount
                  FROM return_lines rl WHERE rl.return_id = @id AND rl.verdict = 'matched'
                """, new { id }, tx)).ToList();

            if (lines.Count == 0 && req.RefundAmount is null or 0)
                throw ApiException.BadRequest(
                    "Nothing on this return matched the order. Scan the garments, or reject the return instead.");

            // The default is to put it back where the restock room says, then
            // the return's own default, then the returns bench.
            var fallbackRoom = req.RestockRoomId ?? await conn.ExecuteScalarAsync<int?>(
                "SELECT id FROM rooms WHERE kind = 'returns' AND active = 1 ORDER BY id LIMIT 1", null, tx);

            var restocked = 0;
            var damaged = 0;
            var writtenOff = 0;
            decimal refunded = 0m;

            foreach (var line in lines)
            {
                // What the grade means for the garment:
                //
                //   1  no defects            back into stock, worth full value
                //   2  defective but usable  kept and marked damaged, so it is
                //                            out of the sellable count until
                //                            somebody mends it and re-marks it
                //   3  defective beyond use  written off
                //
                // Written off is deliberately not deletion. A garment that was
                // thrown away is still a garment the warehouse once had, and
                // the argument about whether it was ever sent is settled from
                // the ledger months later.
                var grade = (int)line.reusability;
                var room = (int?)line.restock_room_id ?? fallbackRoom;

                await ApplyGradeAsync(conn, tx, (int)line.item_id, grade,
                    toRoomId: grade == 3 ? null : room,
                    orderId: (int)ret.order_id, returnId: id,
                    returnNo: (string)ret.return_no, userId: me.Id);

                if (grade == 1) restocked++;
                else if (grade == 2) damaged++;
                else writtenOff++;

                await conn.ExecuteAsync(
                    "UPDATE order_items SET status = 'returned' WHERE id = @orderItemId",
                    new { orderItemId = (int?)line.order_item_id }, tx);

                refunded += (decimal)line.refund_amount;
            }

            // An explicit figure wins: the desk may be refunding postage too, or
            // withholding for a garment that came back marked.
            var refund = req.RefundAmount ?? refunded;

            await conn.ExecuteAsync("""
                UPDATE returns
                   SET status = 'closed', refund_amount = @refund, received_at = now(),
                       received_by = @userId, notes = COALESCE(@notes, notes)
                 WHERE id = @id
                """, new { id, refund, userId = me.Id, notes = req.Notes }, tx);

            await conn.ExecuteAsync(
                "UPDATE orders SET refunded_total = refunded_total + @refund WHERE id = @orderId",
                new { refund, orderId = (int)ret.order_id }, tx);

            // Fully returned or only partly: decided by counting what is left
            // out, not by whether this was the last return on the order.
            var stillOut = await conn.ExecuteScalarAsync<long>("""
                SELECT COUNT(*) FROM order_items WHERE order_id = @orderId AND status <> 'returned'
                """, new { orderId = (int)ret.order_id }, tx);

            await conn.ExecuteAsync(
                "UPDATE orders SET status = @status WHERE id = @orderId",
                new { orderId = (int)ret.order_id, status = stillOut == 0 ? "returned" : "partly_returned" }, tx);

            await tx.CommitAsync();

            return Results.Ok(new
            {
                ok = true,
                restocked,
                damaged,
                writtenOff,
                refund,
                orderFullyReturned = stillOut == 0,
            });
        });

        g.MapPost("/{id:int}/reject", async (HttpContext ctx, int id, CloseReturnRequest req) =>
        {
            ctx.RequireRole("admin", "operator");

            await using var conn = await db.OpenAsync();
            var n = await conn.ExecuteAsync("""
                UPDATE returns SET status = 'rejected', notes = COALESCE(@notes, notes), received_at = now()
                 WHERE id = @id AND status IN ('requested','received')
                """, new { id, notes = req.Notes });

            if (n == 0) throw ApiException.Conflict("That return is already closed.");
            return Results.Ok(new { ok = true });
        });

        // ------------------------------------------------------------ the returns room
        //
        // Returns are taken on the handheld, in one room kept for them. The
        // operator stands in it, sweeps everything with the trigger, and adds
        // what came back in one go. There is no order to choose first: the tag
        // says which order each garment went out on, so the returns - one per
        // order - are opened and closed by the system as it adds them.

        // Asked while the sweep is running, for the tags read since the last ask,
        // so each garment shows as a return or not the moment it is heard.
        g.MapPost("/check", async (HttpContext ctx, ReturnCheckRequest req) =>
        {
            ctx.RequireRole("admin", "operator");

            if (req.Epcs is not { Length: > 0 })
                return Results.Ok(new { results = Array.Empty<object>() });
            if (req.Epcs.Length > 500)
                throw ApiException.BadRequest("Up to 500 tags at a time.");

            await using var conn = await db.OpenAsync();

            var results = new List<object>();
            var seen = new HashSet<string>(StringComparer.Ordinal);

            foreach (var raw in req.Epcs)
            {
                var epc = Epc.TryNormalise(raw);
                if (epc is null || !seen.Add(epc)) continue;
                results.Add((await CheckOneAsync(conn, null, epc, forUpdate: false)).ToJson());
            }

            return Results.Ok(new { results });
        });

        // "Add to inventory". Every garment that is really a return is taken
        // back in one transaction, graded as the operator left it - 1 unless
        // they changed it - and put in the returns room.
        //
        // Each one is checked again here rather than trusted from the sweep: a
        // minute can pass between the two, and in that minute another handheld
        // may have added the same garment.
        g.MapPost("/intake", async (HttpContext ctx, ReturnIntakeRequest req) =>
        {
            var me = ctx.RequireRole("admin", "operator");

            if (req.Items is not { Length: > 0 })
                throw ApiException.BadRequest("Scan the returns first - there is nothing to add.");
            if (req.Items.Length > 500)
                throw ApiException.BadRequest("Up to 500 garments at a time.");

            // Last grade wins for a tag sent twice, which is what a list the
            // operator edited would mean.
            var wanted = new Dictionary<string, int>(StringComparer.Ordinal);
            foreach (var entry in req.Items)
            {
                var epc = Epc.TryNormalise(entry.Epc);
                if (epc is null) continue;
                if (entry.Reusability is not (null or 1 or 2 or 3))
                    throw ApiException.BadRequest("A grade is 1, 2 or 3.");
                wanted[epc] = entry.Reusability ?? 1;
            }

            if (wanted.Count == 0)
                throw ApiException.BadRequest("None of those is a tag code.");

            await using var conn = await db.OpenAsync();
            await using var tx = await conn.BeginTransactionAsync();

            int roomId;
            string roomCode;
            if (req.RoomId is not null)
            {
                var room = await conn.QueryFirstOrDefaultAsync(
                    "SELECT id, code FROM rooms WHERE id = @id AND active = 1", new { id = req.RoomId }, tx)
                    ?? throw ApiException.NotFound("That room was not found, or is closed.");
                (roomId, roomCode) = ((int)room.id, (string)room.code);
            }
            else
            {
                var room = await conn.QueryFirstOrDefaultAsync(
                    "SELECT id, code FROM rooms WHERE kind = 'returns' AND active = 1 ORDER BY id LIMIT 1", null, tx)
                    ?? throw ApiException.BadRequest(
                        "There is no returns room. Add a room of kind Returns on the dashboard first.");
                (roomId, roomCode) = ((int)room.id, (string)room.code);
            }

            var accepted = new List<(Checked Check, int Grade)>();
            var skipped = new List<object>();

            foreach (var (epc, grade) in wanted)
            {
                var check = await CheckOneAsync(conn, tx, epc, forUpdate: true);
                if (check.Returnable) accepted.Add((check, grade));
                else skipped.Add(check.ToJson());
            }

            if (accepted.Count == 0)
            {
                await tx.RollbackAsync();
                throw ApiException.Conflict(
                    "None of those garments is a return any more - they may already have been added.");
            }

            var restocked = 0;
            var damaged = 0;
            var writtenOff = 0;
            var opened = new List<object>();

            foreach (var order in accepted.GroupBy(a => a.Check.OrderId!.Value))
            {
                var orderId = order.Key;
                var first = order.First().Check;
                var returnNo = await Ref.NextAsync(conn, tx, "returns", "return_no", "RET");
                var refund = order.Sum(a => a.Check.Refund);

                var returnId = await conn.ExecuteScalarAsync<int>("""
                    INSERT INTO returns (return_no, order_id, status, reason, refund_amount,
                                         received_at, received_by)
                    VALUES (@returnNo, @orderId, 'closed', @reason, @refund, now(), @userId)
                    RETURNING id
                    """,
                    new { returnNo, orderId, reason = $"Returns room {roomCode}", refund, userId = me.Id }, tx);

                foreach (var (check, grade) in order)
                {
                    await conn.ExecuteAsync("""
                        INSERT INTO return_lines (return_id, order_item_id, item_id, epc, verdict,
                                                  item_condition, reusability, restock_room_id, refund_amount)
                        VALUES (@returnId, @orderItemId, @itemId, @epc, 'matched',
                                @condition, @grade, @roomId, @refund)
                        """,
                        new
                        {
                            returnId,
                            orderItemId = check.OrderItemId,
                            itemId = check.ItemId,
                            epc = check.Epc,
                            condition = ConditionFor(grade),
                            grade = (short)grade,
                            roomId,
                            refund = check.Refund,
                        }, tx);

                    // Every grade goes into the returns room: that is where the
                    // garment physically is. What the grade decides is whether
                    // it can be sold again.
                    await ApplyGradeAsync(conn, tx, check.ItemId!.Value, grade, roomId,
                        orderId, returnId, returnNo, me.Id);

                    await conn.ExecuteAsync(
                        "UPDATE order_items SET status = 'returned' WHERE id = @id",
                        new { id = check.OrderItemId }, tx);

                    if (grade == 1) restocked++;
                    else if (grade == 2) damaged++;
                    else writtenOff++;
                }

                await conn.ExecuteAsync(
                    "UPDATE orders SET refunded_total = refunded_total + @refund WHERE id = @orderId",
                    new { refund, orderId }, tx);

                var stillOut = await conn.ExecuteScalarAsync<long>(
                    "SELECT COUNT(*) FROM order_items WHERE order_id = @orderId AND status <> 'returned'",
                    new { orderId }, tx);

                await conn.ExecuteAsync(
                    "UPDATE orders SET status = @status WHERE id = @orderId",
                    new { orderId, status = stillOut == 0 ? "returned" : "partly_returned" }, tx);

                opened.Add(new
                {
                    id = returnId,
                    return_no = returnNo,
                    order_id = orderId,
                    order_no = first.OrderNo,
                    tracking_id = first.TrackingId,
                    customer_name = first.CustomerName,
                    garments = order.Count(),
                    refund,
                });
            }

            await tx.CommitAsync();

            return Results.Ok(new
            {
                ok = true,
                room = roomCode,
                added = accepted.Count,
                restocked,
                damaged,
                writtenOff,
                returns = opened,
                skipped,
            });
        });
    }
}
