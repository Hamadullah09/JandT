using Dapper;
using Npgsql;
using Warehouse.Api.Data;
using Warehouse.Api.Services;

namespace Warehouse.Api.Endpoints;

/// <summary>
/// Orders, and the picking that turns an order line into particular garments.
///
/// An order line says "two navy mediums". Picking says "these two navy
/// mediums", by tag. That distinction is the whole reason the returns desk can
/// later tell a customer that the garment they sent back is not the one that
/// was sent to them.
///
/// Dropship lines are never picked. They have no tags to pick, and the pick
/// screen leaves them alone rather than showing an outstanding count nobody can
/// ever satisfy.
///
/// An order waits ("pending", to pick) until its last garment is scanned, and
/// that scan sends it out. Only an order with nothing to scan (every line
/// dropship) is sent out by hand. "Delivered" is no longer pressed by anybody:
/// it arrives from the courier's tracking once the parcel is booked with J&T
/// (see CourierEndpoints and CourierSyncService).
/// </summary>
public static class OrderEndpoints
{
    public static void MapOrders(this IEndpointRouteBuilder app, Db db)
    {
        var g = app.MapGroup("/api/orders").RequireAuthorization();

        g.MapGet("/", async (HttpContext ctx) =>
        {
            var status = ctx.Request.Query["status"].ToString();
            var search = ctx.Request.Query["search"].ToString().Trim();

            await using var conn = await db.OpenAsync();

            // "pending" also finds an order an older build left fully picked at
            // "ready to ship": it has still not gone out, so it is still to do.
            var orders = await conn.QueryAsync("""
                SELECT o.id, o.order_no, o.tracking_id, o.customer_name, o.customer_phone, o.city,
                       o.postal_code, o.payment_type,
                       o.status, o.channel, o.subtotal, o.shipping_fee, o.discount,
                       o.total, o.refunded_total, o.placed_at, o.shipped_at, o.delivered_at,
                       COALESCE(l.units, 0)       AS units,
                       COALESCE(l.stock_units, 0) AS stock_units,
                       COALESCE(pk.picked, 0)     AS picked,
                       (SELECT COUNT(*) FROM returns rt WHERE rt.order_id = o.id) AS return_count,
                       s.tracking_no AS courier_tracking_no,
                       s.status      AS courier_status
                  FROM orders o
                  LEFT JOIN (SELECT order_id,
                                    SUM(quantity)                                           AS units,
                                    SUM(CASE WHEN route = 'stock' THEN quantity ELSE 0 END) AS stock_units
                               FROM order_lines GROUP BY order_id) l ON l.order_id = o.id
                  LEFT JOIN (SELECT order_id, COUNT(*) AS picked
                               FROM order_items WHERE status <> 'returned'
                              GROUP BY order_id) pk ON pk.order_id = o.id
                  LEFT JOIN shipments s ON s.order_id = o.id
                 WHERE (@status = '' OR o.status = @status
                        OR (@status = 'pending' AND o.status = 'allocated'))
                   AND (@search = '' OR o.order_no ILIKE @like OR o.customer_name ILIKE @like
                        OR o.tracking_id::text = @search
                        OR o.customer_phone ILIKE @like
                        OR s.tracking_no = @search)
                 ORDER BY o.placed_at DESC
                 LIMIT 300
                """, new { status, search, like = $"%{search}%" });

            return Results.Ok(new { orders });
        });

        // What the returns desk calls when it has a parcel in front of it: the
        // number the customer was given, not the id this system happens to use.
        g.MapGet("/by-tracking/{trackingId:int}", async (int trackingId) =>
        {
            await using var conn = await db.OpenAsync();

            var order = await conn.QueryFirstOrDefaultAsync("""
                SELECT o.id, o.order_no, o.tracking_id, o.customer_name, o.customer_phone,
                       o.address, o.city, o.postal_code, o.payment_type, o.status,
                       o.total, o.refunded_total, o.placed_at, o.shipped_at
                  FROM orders o WHERE o.tracking_id = @trackingId
                """, new { trackingId })
                ?? throw ApiException.NotFound($"No order has tracking number {trackingId}.");

            return Results.Ok(new { found = true, order });
        });

        g.MapGet("/{id:int}", async (int id) =>
        {
            await using var conn = await db.OpenAsync();

            var order = await conn.QueryFirstOrDefaultAsync("""
                SELECT o.id, o.order_no, o.tracking_id, o.customer_name, o.customer_phone, o.customer_email,
                       o.address, o.city, o.postal_code, o.payment_type,
                       o.status, o.channel, o.notes,
                       o.subtotal, o.shipping_fee, o.discount, o.total, o.refunded_total,
                       o.placed_at, o.shipped_at, o.delivered_at,
                       u.full_name AS created_by_name
                  FROM orders o LEFT JOIN users u ON u.id = o.created_by
                 WHERE o.id = @id
                """, new { id })
                ?? throw ApiException.NotFound($"Order {id} was not found.");

            var lines = await conn.QueryAsync("""
                SELECT ol.id, ol.variant_id, ol.quantity, ol.unit_price, ol.route,
                       ol.quantity * ol.unit_price AS line_total,
                       v.sku, p.name AS product_name, p.stock_type, p.supplier,
                       cat.name AS category_name,
                       col.name AS color_name, col.hex AS color_hex,
                       sz.name AS size_name, sz.code AS size_code,
                       COALESCE(pk.picked, 0) AS picked,
                       CASE WHEN ol.route = 'dropship' THEN 0
                            ELSE ol.quantity - COALESCE(pk.picked, 0) END AS outstanding,
                       COALESCE(av.in_stock, 0) AS available
                  FROM order_lines ol
                  JOIN variants v   ON v.id = ol.variant_id
                  JOIN products p   ON p.id = v.product_id
                  JOIN categories cat ON cat.id = p.category_id
                  JOIN colors col   ON col.id = v.color_id
                  JOIN sizes  sz    ON sz.id  = v.size_id
                  LEFT JOIN (SELECT order_line_id, COUNT(*) AS picked
                               FROM order_items WHERE status <> 'returned'
                              GROUP BY order_line_id) pk ON pk.order_line_id = ol.id
                  LEFT JOIN (SELECT variant_id, COUNT(*) FILTER (WHERE status = 'in_stock') AS in_stock
                               FROM items GROUP BY variant_id) av ON av.variant_id = ol.variant_id
                 WHERE ol.order_id = @id
                 ORDER BY ol.id
                """, new { id });

            var picked = await conn.QueryAsync("""
                SELECT oi.id, oi.epc, oi.status, oi.picked_at, oi.order_line_id, oi.item_id,
                       v.sku, p.name AS product_name,
                       col.name AS color_name, sz.code AS size_code,
                       r.code AS room_code, u.full_name AS picked_by_name
                  FROM order_items oi
                  JOIN items i     ON i.id = oi.item_id
                  JOIN variants v  ON v.id = i.variant_id
                  JOIN products p  ON p.id = v.product_id
                  JOIN colors col  ON col.id = v.color_id
                  JOIN sizes  sz   ON sz.id  = v.size_id
                  LEFT JOIN rooms r ON r.id = i.room_id
                  LEFT JOIN users u ON u.id = oi.picked_by
                 WHERE oi.order_id = @id
                 ORDER BY oi.picked_at DESC
                """, new { id });

            var returns = await conn.QueryAsync("""
                SELECT id, return_no, status, reason, refund_amount, requested_at, received_at
                  FROM returns WHERE order_id = @id ORDER BY requested_at DESC
                """, new { id });

            var shipment = await CourierEndpoints.ShipmentOfAsync(conn, id);

            return Results.Ok(new { order, lines, picked, returns, shipment });
        });

        g.MapPost("/", async (HttpContext ctx, OrderRequest req) =>
        {
            var me = ctx.RequireRole("admin", "operator");

            if (string.IsNullOrWhiteSpace(req.CustomerName))
                throw ApiException.BadRequest("An order needs a customer name.");
            if (req.Lines is not { Length: > 0 })
                throw ApiException.BadRequest("An order needs at least one garment on it.");

            await using var conn = await db.OpenAsync();
            await using var tx = await conn.BeginTransactionAsync();

            var orderNo = await Ref.NextAsync(conn, tx, "orders", "order_no", "SO");
            var trackingId = await Ref.NextTrackingAsync(conn, tx);

            var id = await conn.ExecuteScalarAsync<int>("""
                INSERT INTO orders (order_no, tracking_id, customer_name, customer_phone, customer_email,
                                    address, city, postal_code, payment_type, notes,
                                    shipping_fee, discount, created_by)
                VALUES (@orderNo, @trackingId, @name, @phone, @email, @address, @city, @postalCode,
                        @paymentType, @notes, @shipping, @discount, @userId)
                RETURNING id
                """,
                new
                {
                    orderNo,
                    trackingId,
                    name = req.CustomerName.Trim(),
                    phone = req.CustomerPhone,
                    email = req.CustomerEmail,
                    address = req.Address,
                    city = req.City,
                    postalCode = req.PostalCode,
                    paymentType = Payment.Normalise(req.PaymentType),
                    notes = req.Notes,
                    shipping = req.ShippingFee ?? 0m,
                    discount = req.Discount ?? 0m,
                    userId = me.Id,
                }, tx);

            foreach (var line in req.Lines)
            {
                if (line.Quantity <= 0)
                    throw ApiException.BadRequest("Every line needs a quantity of at least 1.");

                var variant = await conn.QueryFirstOrDefaultAsync("""
                    SELECT v.id, p.stock_type, p.name,
                           COALESCE(v.sale_price, p.sale_price) AS sale_price,
                           col.name AS color_name, sz.code AS size_code
                      FROM variants v
                      JOIN products p ON p.id = v.product_id
                      JOIN colors col ON col.id = v.color_id
                      JOIN sizes  sz  ON sz.id  = v.size_id
                     WHERE v.id = @id
                    """, new { id = line.VariantId }, tx)
                    ?? throw ApiException.NotFound($"Garment {line.VariantId} was not found.");

                await conn.ExecuteAsync("""
                    INSERT INTO order_lines (order_id, variant_id, quantity, unit_price, route)
                    VALUES (@id, @variantId, @quantity, @price, @route)
                    """,
                    new
                    {
                        id,
                        variantId = line.VariantId,
                        quantity = line.Quantity,
                        price = line.UnitPrice ?? (decimal)variant.sale_price,
                        // Frozen at this moment. A product moved to dropship
                        // next month must not rewrite how this order was filled.
                        route = (string)variant.stock_type,
                    }, tx);
            }

            await RecalculateTotalsAsync(conn, tx, id);

            await tx.CommitAsync();

            return Results.Json(new { ok = true, id, orderNo }, statusCode: 201);
        });

        // Picking. One tag at a time, which is how the handheld works and also
        // how a person at a bench works.
        g.MapPost("/{id:int}/pick", async (HttpContext ctx, int id, PickRequest req) =>
        {
            var me = ctx.RequireRole("admin", "operator");
            var epc = Epc.Normalise(req.Epc);

            await using var conn = await db.OpenAsync();
            await using var tx = await conn.BeginTransactionAsync();

            // FOR UPDATE on the order as well as the garment: the scan that
            // completes an order ships it, and two handhelds scanning its last
            // two garments at once must not each count one short and leave it
            // fully picked but never sent.
            var order = await conn.QueryFirstOrDefaultAsync(
                "SELECT id, order_no, status FROM orders WHERE id = @id FOR UPDATE", new { id }, tx)
                ?? throw ApiException.NotFound($"Order {id} was not found.");

            if ((string)order.status is not ("pending" or "allocated"))
                throw ApiException.Conflict(
                    $"Order {(string)order.order_no} is {(string)order.status}, so nothing more can be picked for it.");

            // FOR UPDATE OF the garment only: two benches picking the same order
            // must not both claim the same garment, but picking two different
            // navy mediums at once must not queue on the catalogue rows.
            var item = await conn.QueryFirstOrDefaultAsync("""
                SELECT i.id, i.status, i.variant_id, i.room_id,
                       p.name AS product_name, col.name AS color_name, sz.code AS size_code
                  FROM items i
                  JOIN variants v  ON v.id = i.variant_id
                  JOIN products p  ON p.id = v.product_id
                  JOIN colors col  ON col.id = v.color_id
                  JOIN sizes  sz   ON sz.id  = v.size_id
                 WHERE i.epc = @epc
                 FOR UPDATE OF i
                """, new { epc }, tx)
                ?? throw ApiException.NotFound($"No garment is tagged {epc}.");

            if ((string)item.status != "in_stock")
            {
                // Say where it went, not just that it is unavailable: "already
                // on SO-20260914-0003" is actionable, "not in stock" is not.
                var on = await conn.ExecuteScalarAsync<string?>("""
                    SELECT o.order_no FROM order_items oi JOIN orders o ON o.id = oi.order_id
                     WHERE oi.item_id = @itemId AND oi.status <> 'returned'
                     ORDER BY oi.id DESC LIMIT 1
                    """, new { itemId = (int)item.id }, tx);

                throw ApiException.Conflict(on is not null
                    ? $"That garment is already on order {on}."
                    : $"That garment is {(string)item.status}, so it cannot be picked.");
            }

            // Which line it satisfies. Told, or worked out from what it is.
            var line = req.OrderLineId is not null
                ? await conn.QueryFirstOrDefaultAsync("""
                    SELECT ol.id, ol.variant_id, ol.quantity, ol.route,
                           COALESCE(pk.picked, 0) AS picked
                      FROM order_lines ol
                      LEFT JOIN (SELECT order_line_id, COUNT(*) AS picked FROM order_items
                                  WHERE status <> 'returned' GROUP BY order_line_id) pk
                             ON pk.order_line_id = ol.id
                     WHERE ol.id = @lineId AND ol.order_id = @id
                    """, new { lineId = req.OrderLineId, id }, tx)
                    ?? throw ApiException.NotFound("That line is not on this order.")
                : await conn.QueryFirstOrDefaultAsync("""
                    SELECT ol.id, ol.variant_id, ol.quantity, ol.route,
                           COALESCE(pk.picked, 0) AS picked
                      FROM order_lines ol
                      LEFT JOIN (SELECT order_line_id, COUNT(*) AS picked FROM order_items
                                  WHERE status <> 'returned' GROUP BY order_line_id) pk
                             ON pk.order_line_id = ol.id
                     WHERE ol.order_id = @id AND ol.variant_id = @variantId
                       AND ol.route = 'stock' AND COALESCE(pk.picked, 0) < ol.quantity
                     ORDER BY ol.id LIMIT 1
                    """, new { id, variantId = (int)item.variant_id }, tx)
                    ?? throw ApiException.Conflict(
                        $"{(string)item.product_name}, {(string)item.color_name} {(string)item.size_code} " +
                        "is not wanted on this order, or every one of them has already been picked.");

            if ((int)line.variant_id != (int)item.variant_id)
                throw ApiException.Conflict(
                    $"That line wants a different garment: this tag is {(string)item.product_name}, " +
                    $"{(string)item.color_name} {(string)item.size_code}.");

            if ((string)line.route == "dropship")
                throw ApiException.Conflict("That line is dropshipped by the supplier, so nothing is picked for it.");

            if ((long)line.picked >= (int)line.quantity)
                throw ApiException.Conflict($"All {(int)line.quantity} for that line have already been picked.");

            await conn.ExecuteAsync("""
                INSERT INTO order_items (order_id, order_line_id, item_id, epc, picked_by)
                VALUES (@id, @lineId, @itemId, @epc, @userId)
                """,
                new { id, lineId = (int)line.id, itemId = (int)item.id, epc, userId = me.Id }, tx);

            await Ledger.RecordAsync(conn, tx, (int)item.id, "allocate",
                toStatus: "allocated", orderId: id, userId: me.Id,
                note: $"Picked for {(string)order.order_no}");

            // The last garment sends the order out, in the same transaction.
            // There is no stop between "everything is scanned" and "it has
            // gone": a second press for the same moment only ever got
            // forgotten, and left orders sitting at "ready to ship".
            var state = await CountAsync(conn, tx, id);
            var orderStatus = "pending";
            if (state.Picked >= state.Required)
            {
                await ShipAsync(conn, tx, id, (string)order.order_no, me.Id);
                orderStatus = "shipped";
            }

            await tx.CommitAsync();

            return Results.Json(new
            {
                ok = true,
                epc,
                orderLineId = (int)line.id,
                product = $"{(string)item.product_name}, {(string)item.color_name} {(string)item.size_code}",
                picked = state.Picked,
                required = state.Required,
                outstanding = state.Required - state.Picked,
                orderStatus,
            }, statusCode: 201);
        });

        g.MapDelete("/{id:int}/pick/{orderItemId:int}", async (HttpContext ctx, int id, int orderItemId) =>
        {
            var me = ctx.RequireRole("admin", "operator");

            await using var conn = await db.OpenAsync();
            await using var tx = await conn.BeginTransactionAsync();

            var row = await conn.QueryFirstOrDefaultAsync("""
                SELECT oi.id, oi.item_id, oi.epc, oi.status, o.status AS order_status, o.order_no
                  FROM order_items oi JOIN orders o ON o.id = oi.order_id
                 WHERE oi.id = @orderItemId AND oi.order_id = @id
                 FOR UPDATE OF oi, o
                """, new { orderItemId, id }, tx)
                ?? throw ApiException.NotFound("That garment is not on this order.");

            if ((string)row.status != "allocated")
                throw ApiException.Conflict("That garment has already shipped, so it cannot be taken off by hand.");

            await conn.ExecuteAsync("DELETE FROM order_items WHERE id = @orderItemId", new { orderItemId }, tx);

            await Ledger.RecordAsync(conn, tx, (int)row.item_id, "adjust",
                toStatus: "in_stock", orderId: id, userId: me.Id,
                note: $"Taken off {(string)row.order_no}");

            // Still waiting, then. Only an order an older build left at "ready
            // to ship" needs moving back; anything picked since is either still
            // pending or has gone out, and a shipped garment cannot come off.
            await conn.ExecuteAsync(
                "UPDATE orders SET status = 'pending' WHERE id = @id AND status = 'allocated'", new { id }, tx);
            await tx.CommitAsync();

            return Results.Ok(new { ok = true, epc = (string)row.epc });
        });

        // Sending out by hand. Scanning the last garment does this by itself,
        // so this is for an order with nothing to scan - every line dropship -
        // and for one an older build left fully picked at "ready to ship".
        g.MapPost("/{id:int}/ship", async (HttpContext ctx, int id) =>
        {
            var me = ctx.RequireRole("admin", "operator");

            await using var conn = await db.OpenAsync();
            await using var tx = await conn.BeginTransactionAsync();

            var order = await conn.QueryFirstOrDefaultAsync(
                "SELECT id, order_no, status FROM orders WHERE id = @id FOR UPDATE", new { id }, tx)
                ?? throw ApiException.NotFound($"Order {id} was not found.");

            if ((string)order.status is not ("pending" or "allocated"))
                throw ApiException.Conflict($"Order {(string)order.order_no} has already been {(string)order.status}.");

            var state = await CountAsync(conn, tx, id);
            if (state.Picked < state.Required)
                throw ApiException.Conflict(
                    $"{state.Required - state.Picked} garment(s) still to scan. The order goes out by itself when the last one is scanned.");

            var shipped = await ShipAsync(conn, tx, id, (string)order.order_no, me.Id);

            await tx.CommitAsync();
            return Results.Ok(new { ok = true, shipped });
        });

        // Cancelling puts every picked garment back on the shelf. An order that
        // has shipped cannot be cancelled — that is a return, and it has its own
        // desk because the garment has to physically come back first.
        g.MapPost("/{id:int}/cancel", async (HttpContext ctx, int id) =>
        {
            var me = ctx.RequireRole("admin", "operator");

            await using var conn = await db.OpenAsync();
            await using var tx = await conn.BeginTransactionAsync();

            var order = await conn.QueryFirstOrDefaultAsync(
                "SELECT id, order_no, status FROM orders WHERE id = @id FOR UPDATE", new { id }, tx)
                ?? throw ApiException.NotFound($"Order {id} was not found.");

            if ((string)order.status is not ("pending" or "allocated"))
                throw ApiException.Conflict(
                    $"Order {(string)order.order_no} is {(string)order.status}. " +
                    "Once it has shipped, use a return instead.");

            var items = (await conn.QueryAsync<int>(
                "SELECT item_id FROM order_items WHERE order_id = @id", new { id }, tx)).ToList();

            foreach (var itemId in items)
            {
                await Ledger.RecordAsync(conn, tx, itemId, "adjust",
                    toStatus: "in_stock", orderId: id, userId: me.Id,
                    note: $"{(string)order.order_no} cancelled");
            }

            await conn.ExecuteAsync("DELETE FROM order_items WHERE order_id = @id", new { id }, tx);
            await conn.ExecuteAsync("UPDATE orders SET status = 'cancelled' WHERE id = @id", new { id }, tx);

            await tx.CommitAsync();
            return Results.Ok(new { ok = true, released = items.Count });
        });
    }

    private sealed record Counts(int Required, int Picked);

    /// <summary>
    /// How many tags this order needs and how many it has. Dropship lines are
    /// excluded from both: nothing is ever scanned for them, so counting them
    /// would leave every mixed order permanently one short of shippable.
    /// </summary>
    private static async Task<Counts> CountAsync(NpgsqlConnection conn, NpgsqlTransaction tx, int orderId)
    {
        var required = await conn.ExecuteScalarAsync<int>(
            "SELECT COALESCE(SUM(quantity), 0) FROM order_lines WHERE order_id = @orderId AND route = 'stock'",
            new { orderId }, tx);

        var picked = await conn.ExecuteScalarAsync<int>("""
            SELECT COUNT(*) FROM order_items WHERE order_id = @orderId AND status <> 'returned'
            """, new { orderId }, tx);

        return new Counts(required, picked);
    }

    /// <summary>
    /// Sends an order out: every garment picked for it leaves the stock count as
    /// shipped, with a line in its history saying which order took it, and the
    /// order is stamped with the time it went. Returns how many garments went.
    /// </summary>
    private static async Task<int> ShipAsync(
        NpgsqlConnection conn, NpgsqlTransaction tx, int orderId, string orderNo, int userId)
    {
        var items = (await conn.QueryAsync<int>(
            "SELECT item_id FROM order_items WHERE order_id = @orderId AND status = 'allocated'",
            new { orderId }, tx)).ToList();

        foreach (var itemId in items)
        {
            await Ledger.RecordAsync(conn, tx, itemId, "ship",
                toStatus: "shipped", orderId: orderId, userId: userId,
                note: $"Shipped on {orderNo}");
        }

        await conn.ExecuteAsync(
            "UPDATE order_items SET status = 'shipped' WHERE order_id = @orderId AND status = 'allocated'",
            new { orderId }, tx);

        await conn.ExecuteAsync(
            "UPDATE orders SET status = 'shipped', shipped_at = now() WHERE id = @orderId",
            new { orderId }, tx);

        return items.Count;
    }

    internal static async Task RecalculateTotalsAsync(NpgsqlConnection conn, NpgsqlTransaction tx, int orderId)
    {
        await conn.ExecuteAsync("""
            UPDATE orders o
               SET subtotal = COALESCE((SELECT SUM(ol.quantity * ol.unit_price)
                                          FROM order_lines ol WHERE ol.order_id = o.id), 0),
                   total    = COALESCE((SELECT SUM(ol.quantity * ol.unit_price)
                                          FROM order_lines ol WHERE ol.order_id = o.id), 0)
                              + o.shipping_fee - o.discount
             WHERE o.id = @orderId
            """, new { orderId }, tx);
    }
}
