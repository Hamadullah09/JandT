using Dapper;
using Warehouse.Api.Data;

namespace Warehouse.Api.Endpoints;

/// <summary>
/// The numbers: what is in the building, what it is worth, and what has been
/// sold.
///
/// Money here is deliberately two separate figures rather than one. Stock value
/// is what the garments on the shelves cost us and it goes up when a return
/// comes back into stock. Revenue is what customers paid and it goes down by
/// the refund on that same return. Both move on one event, in opposite
/// directions, and collapsing them into a single number would hide that.
/// </summary>
public static class ReportEndpoints
{
    /// <summary>
    /// Every colour and size with fewer garments on the shelves than its alert
    /// level. "Fewer than 10" is how the warehouse asked for it, so a level of
    /// 10 warns at 9 and below, and exactly 10 on the shelves is fine.
    ///
    /// Only where a level is set - 0 switches the warning off - and only for
    /// stock held here: a dropship product's stock is at the supplier, so it
    /// cannot run low on these shelves.
    /// </summary>
    private const string LowStockSql = """
        SELECT v.id, v.sku, v.reorder_level, v.product_id,
               p.name AS product_name, p.stock_type, cat.name AS category_name,
               (SELECT '/uploads/products/' || ph.file_name
                  FROM product_photos ph
                 WHERE ph.product_id = p.id
                 ORDER BY ph.sort_order, ph.id
                 LIMIT 1) AS photo_url,
               col.name AS color_name, col.hex AS color_hex, sz.code AS size_code,
               COALESCE(st.in_stock, 0) AS in_stock
          FROM variants v
          JOIN products p     ON p.id = v.product_id
          JOIN categories cat ON cat.id = p.category_id
          JOIN colors col     ON col.id = v.color_id
          JOIN sizes  sz      ON sz.id  = v.size_id
          LEFT JOIN (SELECT variant_id, COUNT(*) FILTER (WHERE status = 'in_stock') AS in_stock
                       FROM items GROUP BY variant_id) st ON st.variant_id = v.id
         WHERE v.active = 1 AND p.active = 1 AND p.stock_type = 'stock'
           AND v.reorder_level > 0
           AND COALESCE(st.in_stock, 0) < v.reorder_level
         ORDER BY COALESCE(st.in_stock, 0) - v.reorder_level, lower(p.name), sz.sort_order, lower(col.name)
        """;

    public static void MapReports(this IEndpointRouteBuilder app, Db db)
    {
        var g = app.MapGroup("/api").RequireAuthorization();

        g.MapGet("/overview", async () =>
        {
            await using var conn = await db.OpenAsync();

            var stock = await conn.QueryFirstOrDefaultAsync("""
                SELECT COUNT(*)                                           AS tagged,
                       COUNT(*) FILTER (WHERE status = 'in_stock')        AS in_stock,
                       COUNT(*) FILTER (WHERE status = 'allocated')       AS allocated,
                       COUNT(*) FILTER (WHERE status = 'shipped')         AS shipped,
                       COUNT(*) FILTER (WHERE status = 'damaged')         AS damaged,
                       COUNT(*) FILTER (WHERE status = 'lost')            AS lost,
                       COALESCE(SUM(CASE WHEN status IN ('in_stock','allocated')
                                         THEN cost_price ELSE 0 END), 0) AS stock_value
                  FROM items
                """);

            // Still to do is everything that has not gone out. "allocated" is
            // only an order an older build left fully picked at "ready to
            // ship"; the last scan ships an order now.
            var orders = await conn.QueryFirstOrDefaultAsync("""
                SELECT COUNT(*)                                                        AS total,
                       COUNT(*) FILTER (WHERE status IN ('pending','allocated'))       AS pending,
                       COUNT(*) FILTER (WHERE status = 'shipped')                      AS shipped,
                       COUNT(*) FILTER (WHERE status IN ('returned','partly_returned')) AS returned,
                       COALESCE(SUM(CASE WHEN status IN ('shipped','delivered','partly_returned','returned')
                                         THEN total ELSE 0 END), 0) AS revenue,
                       COALESCE(SUM(refunded_total), 0) AS refunded
                  FROM orders
                """);

            var counts = await conn.QueryFirstOrDefaultAsync("""
                SELECT (SELECT COUNT(*) FROM find_requests WHERE status = 'open')         AS open_finds,
                       (SELECT COUNT(*) FROM returns WHERE status IN ('requested','received')) AS open_returns,
                       (SELECT COUNT(*) FROM batches WHERE status = 'open')               AS open_batches,
                       (SELECT COUNT(*) FROM products WHERE active = 1)                   AS products,
                       (SELECT COUNT(*) FROM variants WHERE active = 1)                   AS variants,
                       (SELECT COUNT(*) FROM rooms WHERE active = 1)                      AS rooms
                """);

            // The courier side of the same orders: parcels booked with J&T and
            // where they are, as the courier sync last saw them.
            var shipping = await conn.QueryFirstOrDefaultAsync("""
                SELECT (SELECT COUNT(*) FROM orders o
                         WHERE o.status IN ('shipped','delivered')
                           AND NOT EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id)) AS to_book,
                       COUNT(*)                                                               AS booked,
                       COUNT(*) FILTER (WHERE status = 'CREATED')                             AS awaiting_pickup,
                       COUNT(*) FILTER (WHERE status IN ('PICKED_UP','IN_TRANSIT','ON_DELIVERY')) AS in_transit,
                       COUNT(*) FILTER (WHERE status = 'DELIVERED')                           AS delivered,
                       COUNT(*) FILTER (WHERE status = 'RETURNED')                            AS returned,
                       COALESCE(SUM(cod_amount) FILTER (WHERE status NOT IN ('DELIVERED','RETURNED')), 0) AS cod_outstanding,
                       COALESCE(SUM(freight_fee), 0)                                          AS freight
                  FROM shipments
                """);

            // Low stock is only meaningful where somebody set a level. All of
            // it is read, for the count on the Notifications tab; the overview
            // itself only has room for the lowest few.
            var lowStock = (await conn.QueryAsync(LowStockSql)).ToList();

            var byRoom = await conn.QueryAsync("""
                SELECT r.id, r.code, r.name, r.kind,
                       COUNT(i.id) FILTER (WHERE i.status = 'in_stock') AS in_stock,
                       COALESCE(SUM(CASE WHEN i.status IN ('in_stock','allocated')
                                         THEN i.cost_price ELSE 0 END), 0) AS stock_value
                  FROM rooms r
                  LEFT JOIN items i ON i.room_id = r.id
                 WHERE r.active = 1
                 GROUP BY r.id
                 ORDER BY r.code
                """);

            // The last fifty, which the overview shows ten at a time.
            var recent = await conn.QueryAsync("""
                SELECT m.id, m.type, m.to_status, m.note, m.occurred_at,
                       i.epc, p.name AS product_name,
                       col.name AS color_name, sz.code AS size_code,
                       tr.code AS to_room, u.full_name AS user_name, o.order_no
                  FROM movements m
                  JOIN items i     ON i.id = m.item_id
                  JOIN variants v  ON v.id = i.variant_id
                  JOIN products p  ON p.id = v.product_id
                  JOIN colors col  ON col.id = v.color_id
                  JOIN sizes  sz   ON sz.id  = v.size_id
                  LEFT JOIN rooms tr ON tr.id = m.to_room_id
                  LEFT JOIN users u  ON u.id = m.user_id
                  LEFT JOIN orders o ON o.id = m.order_id
                 ORDER BY m.occurred_at DESC, m.id DESC
                 LIMIT 50
                """);

            return Results.Ok(new
            {
                stock, orders, counts, shipping,
                lowStock = lowStock.Take(20),
                lowStockCount = lowStock.Count,
                byRoom, recent,
            });
        });

        // Notifications: everything running low, where the overview only has
        // room for the lowest few.
        g.MapGet("/low-stock", async () =>
        {
            await using var conn = await db.OpenAsync();
            var variants = await conn.QueryAsync(LowStockSql);
            return Results.Ok(new { variants });
        });

        // The stock question asked the way the warehouse asks it: how many navy
        // mediums have we got, across everything.
        g.MapGet("/stock", async (HttpContext ctx) =>
        {
            var by = ctx.Request.Query["by"].ToString() is var b && b != "" ? b : "variant";

            await using var conn = await db.OpenAsync();

            const string counted = """
                COUNT(i.id) FILTER (WHERE i.status = 'in_stock')  AS in_stock,
                COUNT(i.id) FILTER (WHERE i.status = 'allocated') AS allocated,
                COUNT(i.id) FILTER (WHERE i.status = 'shipped')   AS shipped,
                COALESCE(SUM(CASE WHEN i.status IN ('in_stock','allocated')
                                  THEN i.cost_price ELSE 0 END), 0) AS stock_value
                """;

            var rows = by switch
            {
                "category" => await conn.QueryAsync($"""
                    SELECT cat.id, cat.name AS label, NULL::text AS sub_label, NULL::text AS hex,
                           {counted}
                      FROM categories cat
                      LEFT JOIN products p ON p.category_id = cat.id
                      LEFT JOIN variants v ON v.product_id = p.id
                      LEFT JOIN items i    ON i.variant_id = v.id
                     WHERE cat.active = 1
                     GROUP BY cat.id
                     ORDER BY lower(cat.name)
                    """),

                "color" => await conn.QueryAsync($"""
                    SELECT col.id, col.name AS label, NULL::text AS sub_label, col.hex,
                           {counted}
                      FROM colors col
                      LEFT JOIN variants v ON v.color_id = col.id
                      LEFT JOIN items i    ON i.variant_id = v.id
                     WHERE col.active = 1
                     GROUP BY col.id
                     ORDER BY lower(col.name)
                    """),

                "size" => await conn.QueryAsync($"""
                    SELECT sz.id, sz.name AS label, sz.code AS sub_label, NULL::text AS hex,
                           {counted}
                      FROM sizes sz
                      LEFT JOIN variants v ON v.size_id = sz.id
                      LEFT JOIN items i    ON i.variant_id = v.id
                     WHERE sz.active = 1
                     GROUP BY sz.id
                     ORDER BY sz.sort_order
                    """),

                "room" => await conn.QueryAsync($"""
                    SELECT r.id, r.code AS label, r.name AS sub_label, NULL::text AS hex,
                           {counted}
                      FROM rooms r
                      LEFT JOIN items i ON i.room_id = r.id
                     WHERE r.active = 1
                     GROUP BY r.id
                     ORDER BY r.code
                    """),

                _ => await conn.QueryAsync($"""
                    SELECT v.id, CONCAT(p.name, ' — ', col.name, ' ', sz.code) AS label,
                           v.sku AS sub_label, col.hex,
                           {counted}
                      FROM variants v
                      JOIN products p ON p.id = v.product_id
                      JOIN colors col ON col.id = v.color_id
                      JOIN sizes  sz  ON sz.id  = v.size_id
                      LEFT JOIN items i ON i.variant_id = v.id
                     WHERE v.active = 1 AND p.active = 1
                     GROUP BY v.id, p.id, col.id, sz.id
                     ORDER BY lower(p.name), lower(col.name), sz.sort_order
                     LIMIT 500
                    """),
            };

            return Results.Ok(new { by, rows });
        });

        g.MapGet("/money", async (HttpContext ctx) =>
        {
            var days = int.TryParse(ctx.Request.Query["days"], out var d) ? Math.Clamp(d, 1, 3650) : 30;
            // Days are the shop's days: an order placed at 7am in Kuala Lumpur
            // belongs to that date, not to yesterday in UTC.
            var tz = BusinessClock.IanaId;

            await using var conn = await db.OpenAsync();

            var totals = await conn.QueryFirstOrDefaultAsync("""
                SELECT COALESCE(SUM(CASE WHEN o.status IN ('shipped','delivered','partly_returned','returned')
                                         THEN o.total ELSE 0 END), 0)   AS gross_revenue,
                       COALESCE(SUM(o.refunded_total), 0)               AS refunds,
                       COUNT(*)                                         AS orders,
                       COUNT(*) FILTER (WHERE o.status IN ('shipped','delivered')) AS fulfilled
                  FROM orders o
                 WHERE o.placed_at >= now() - make_interval(days => @days)
                """, new { days });

            var stockValue = await conn.ExecuteScalarAsync<decimal>("""
                SELECT COALESCE(SUM(cost_price), 0) FROM items
                 WHERE status IN ('in_stock','allocated')
                """);

            var writtenOff = await conn.ExecuteScalarAsync<decimal>("""
                SELECT COALESCE(SUM(cost_price), 0) FROM items
                 WHERE status IN ('damaged','lost','written_off')
                """);

            var daily = await conn.QueryAsync("""
                SELECT (o.placed_at AT TIME ZONE @tz)::date AS day,
                       COUNT(*) AS orders,
                       COALESCE(SUM(o.total), 0) AS total,
                       COALESCE(SUM(o.refunded_total), 0) AS refunded
                  FROM orders o
                 WHERE o.placed_at >= now() - make_interval(days => @days)
                   AND o.status <> 'cancelled'
                 GROUP BY 1
                 ORDER BY day
                """, new { days, tz });

            var topSellers = await conn.QueryAsync("""
                SELECT v.id, v.sku, p.name AS product_name,
                       col.name AS color_name, col.hex AS color_hex, sz.code AS size_code,
                       SUM(ol.quantity) AS units,
                       SUM(ol.quantity * ol.unit_price) AS revenue
                  FROM order_lines ol
                  JOIN orders o    ON o.id = ol.order_id
                  JOIN variants v  ON v.id = ol.variant_id
                  JOIN products p  ON p.id = v.product_id
                  JOIN colors col  ON col.id = v.color_id
                  JOIN sizes  sz   ON sz.id  = v.size_id
                 WHERE o.status <> 'cancelled'
                   AND o.placed_at >= now() - make_interval(days => @days)
                 GROUP BY v.id, p.id, col.id, sz.id
                 ORDER BY units DESC
                 LIMIT 10
                """, new { days });

            return Results.Ok(new { days, totals, stockValue, writtenOff, daily, topSellers });
        });
    }
}
