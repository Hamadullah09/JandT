using Dapper;
using Warehouse.Api.Data;
using Warehouse.Api.Services;

namespace Warehouse.Api.Endpoints;

/// <summary>
/// Individual garments: the tag register, and everything that has happened to
/// one of them.
/// </summary>
public static class ItemEndpoints
{
    /// <summary>
    /// Everything you would want shown next to a tag code, in one place, because
    /// every screen that shows a garment shows the same eight things about it.
    /// </summary>
    private const string ItemSelect = """
        SELECT i.id, i.epc, i.tid, i.status, i.cost_price, i.notes,
               i.enrolled_at, i.last_seen_at,
               i.room_id, r.code AS room_code, r.name AS room_name,
               i.variant_id, v.sku,
               p.id AS product_id, p.name AS product_name, p.description, p.stock_type,
               COALESCE(v.sale_price, p.sale_price) AS sale_price,
               cat.name AS category_name,
               col.name AS color_name, col.hex AS color_hex,
               sz.name  AS size_name,  sz.code AS size_code,
               b.batch_no,
               u.full_name AS enrolled_by_name,
               oi.order_id, o.order_no, o.customer_name, o.status AS order_status
          FROM items i
          JOIN variants v   ON v.id = i.variant_id
          JOIN products p   ON p.id = v.product_id
          JOIN categories cat ON cat.id = p.category_id
          JOIN colors col   ON col.id = v.color_id
          JOIN sizes  sz    ON sz.id  = v.size_id
          LEFT JOIN rooms r ON r.id = i.room_id
          LEFT JOIN batch_lines bl ON bl.id = i.batch_line_id
          LEFT JOIN batches b ON b.id = bl.batch_id
          LEFT JOIN users u ON u.id = i.enrolled_by
          -- The order it is on now, which is the latest one that has not been
          -- returned. A garment sold, returned and sold again has two rows here
          -- and only the current one belongs on the screen.
          LEFT JOIN order_items oi ON oi.id = (
                SELECT x.id FROM order_items x
                 WHERE x.item_id = i.id AND x.status <> 'returned'
                 ORDER BY x.id DESC LIMIT 1)
          LEFT JOIN orders o ON o.id = oi.order_id
        """;

    public static void MapItems(this IEndpointRouteBuilder app, Db db)
    {
        var g = app.MapGroup("/api/items").RequireAuthorization();

        g.MapGet("/", async (HttpContext ctx) =>
        {
            var search = ctx.Request.Query["search"].ToString().Trim();
            var status = ctx.Request.Query["status"].ToString();
            var roomId = int.TryParse(ctx.Request.Query["roomId"], out var r) ? r : (int?)null;
            var variantId = int.TryParse(ctx.Request.Query["variantId"], out var v) ? v : (int?)null;
            var categoryId = int.TryParse(ctx.Request.Query["categoryId"], out var c) ? c : (int?)null;
            var limit = int.TryParse(ctx.Request.Query["limit"], out var l) ? Math.Clamp(l, 1, 1000) : 200;
            // Where a page starts, for a list read ten at a time.
            var offset = int.TryParse(ctx.Request.Query["offset"], out var skip) ? Math.Max(0, skip) : 0;

            await using var conn = await db.OpenAsync();

            var items = await conn.QueryAsync($"""
                {ItemSelect}
                 WHERE (@search = '' OR i.epc ILIKE @like OR v.sku ILIKE @like
                        OR p.name ILIKE @like OR o.order_no ILIKE @like)
                   AND (@status = '' OR i.status = @status)
                   AND (@roomId::int IS NULL OR i.room_id = @roomId)
                   AND (@variantId::int IS NULL OR i.variant_id = @variantId)
                   AND (@categoryId::int IS NULL OR p.category_id = @categoryId)
                 ORDER BY i.enrolled_at DESC, i.id DESC
                 LIMIT @limit OFFSET @offset
                """,
                new { search, like = $"%{search}%", status, roomId, variantId, categoryId, limit, offset });

            // The total is separate so the page can say "showing 200 of 3,412"
            // rather than implying the list is everything.
            var total = await conn.ExecuteScalarAsync<int>("""
                SELECT COUNT(*)
                  FROM items i
                  JOIN variants v ON v.id = i.variant_id
                  JOIN products p ON p.id = v.product_id
                  LEFT JOIN order_items oi ON oi.item_id = i.id
                  LEFT JOIN orders o ON o.id = oi.order_id
                 WHERE (@search = '' OR i.epc ILIKE @like OR v.sku ILIKE @like
                        OR p.name ILIKE @like OR o.order_no ILIKE @like)
                   AND (@status = '' OR i.status = @status)
                   AND (@roomId::int IS NULL OR i.room_id = @roomId)
                   AND (@variantId::int IS NULL OR i.variant_id = @variantId)
                   AND (@categoryId::int IS NULL OR p.category_id = @categoryId)
                """,
                new { search, like = $"%{search}%", status, roomId, variantId, categoryId });

            return Results.Ok(new { items, total, shown = items.Count() });
        });

        g.MapGet("/{id:int}", async (int id) =>
        {
            await using var conn = await db.OpenAsync();

            var item = await conn.QueryFirstOrDefaultAsync($"{ItemSelect} WHERE i.id = @id", new { id })
                ?? throw ApiException.NotFound($"Garment {id} was not found.");

            var history = await conn.QueryAsync("""
                SELECT m.id, m.type, m.from_status, m.to_status, m.note, m.occurred_at,
                       fr.code AS from_room, tr.code AS to_room,
                       o.order_no, rt.return_no, u.full_name AS user_name
                  FROM movements m
                  LEFT JOIN rooms fr ON fr.id = m.from_room_id
                  LEFT JOIN rooms tr ON tr.id = m.to_room_id
                  LEFT JOIN orders o  ON o.id = m.order_id
                  LEFT JOIN returns rt ON rt.id = m.return_id
                  LEFT JOIN users u   ON u.id = m.user_id
                 WHERE m.item_id = @id
                 ORDER BY m.occurred_at DESC, m.id DESC
                """, new { id });

            return Results.Ok(new { item, history });
        });

        // What the handheld calls the instant a tag is read, so the operator
        // sees what he is holding before deciding anything about it.
        g.MapGet("/by-epc/{epc}", async (string epc) =>
        {
            var normalised = Epc.Normalise(epc);
            await using var conn = await db.OpenAsync();

            var item = await conn.QueryFirstOrDefaultAsync(
                $"{ItemSelect} WHERE i.epc = @epc", new { epc = normalised });

            if (item is not null)
                return Results.Ok(new { found = true, kind = "item", epc = normalised, item });

            // Not a garment. Saying "that is the door of B2" is a far better
            // answer than "unknown tag" when somebody has scanned a doorframe.
            var room = await conn.QueryFirstOrDefaultAsync("""
                SELECT r.id, r.code, r.name, r.kind
                  FROM room_tags t JOIN rooms r ON r.id = t.room_id
                 WHERE t.epc = @epc AND t.active = 1
                """, new { epc = normalised });

            return room is not null
                ? Results.Ok(new { found = true, kind = "room", epc = normalised, room })
                : Results.Ok(new { found = false, kind = "unknown", epc = normalised });
        });

        g.MapPatch("/{id:int}", async (HttpContext ctx, int id, ItemUpdateRequest req) =>
        {
            var me = ctx.RequireRole("admin", "operator");

            string[] settable = ["in_stock", "damaged", "lost", "written_off"];
            if (req.Status is not null && !settable.Contains(req.Status))
                throw ApiException.BadRequest(
                    "A garment can only be set to in stock, damaged, lost or written off by hand. " +
                    "The rest follow orders and returns.");

            await using var conn = await db.OpenAsync();
            await using var tx = await conn.BeginTransactionAsync();

            var current = await conn.QueryFirstOrDefaultAsync<string?>(
                "SELECT status FROM items WHERE id = @id", new { id }, tx)
                ?? throw ApiException.NotFound($"Garment {id} was not found.");

            if (current is "allocated" or "shipped" && req.Status is not null)
                throw ApiException.Conflict(
                    "That garment is on an order. Cancel or return the order first.");

            await conn.ExecuteAsync(
                "UPDATE items SET notes = COALESCE(@notes, notes) WHERE id = @id",
                new { id, notes = req.Notes }, tx);

            if (req.RoomId is not null || req.Status is not null)
            {
                await Ledger.RecordAsync(conn, tx, id,
                    type: req.Status is not null && req.Status != current ? "adjust" : "move",
                    toRoomId: req.RoomId, toStatus: req.Status, userId: me.Id,
                    note: "Changed by hand from the admin panel");
            }

            await tx.CommitAsync();
            return Results.Ok(new { ok = true });
        });

        // Bulk move: the operator scans a shelf into the handheld and drops the
        // lot into a room in one call. Unknown tags come back listed rather
        // than failing the whole move, because one stray tag in a trolley of
        // eighty should not mean re-scanning eighty.
        g.MapPost("/move", async (HttpContext ctx, MoveItemsRequest req) =>
        {
            var me = ctx.RequireRole("admin", "operator");

            if (req.Epcs is not { Length: > 0 })
                throw ApiException.BadRequest("No tags were sent.");

            await using var conn = await db.OpenAsync();

            if (await conn.ExecuteScalarAsync<long>(
                    "SELECT COUNT(*) FROM rooms WHERE id = @id AND active = 1", new { id = req.RoomId }) == 0)
                throw ApiException.NotFound($"Room {req.RoomId} was not found, or is closed.");

            await using var tx = await conn.BeginTransactionAsync();

            var moved = new List<string>();
            var skipped = new List<object>();

            foreach (var raw in req.Epcs.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                var epc = Epc.TryNormalise(raw);
                if (epc is null) { skipped.Add(new { epc = raw, reason = "not a tag code" }); continue; }

                var item = await conn.QueryFirstOrDefaultAsync(
                    "SELECT id, status FROM items WHERE epc = @epc", new { epc }, tx);

                if (item is null) { skipped.Add(new { epc, reason = "not a garment we know" }); continue; }

                if ((string)item.status is "shipped" or "written_off")
                {
                    skipped.Add(new { epc, reason = $"is {(string)item.status}" });
                    continue;
                }

                await Ledger.RecordAsync(conn, tx, (int)item.id, "move",
                    toRoomId: req.RoomId, userId: me.Id, note: req.Note ?? "Moved from the handheld");

                moved.Add(epc);
            }

            await tx.CommitAsync();
            return Results.Ok(new { ok = true, moved = moved.Count, skipped, movedEpcs = moved });
        });
    }
}
