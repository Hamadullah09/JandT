using Dapper;
using Npgsql;
using Warehouse.Api.Data;

namespace Warehouse.Api.Endpoints;

/// <summary>
/// Find a garment.
///
/// Somebody needs one particular thing and the shelf it should be on is wrong.
/// Before this the answer was to look up where the system last saw it and then
/// walk the rooms hoping. Putting it on this list pushes it to every handheld,
/// where the reader becomes a hot-and-cold finder that gets louder as the
/// operator closes in, and the radar screen turns several of them at once into
/// dots with a direction.
///
/// Either identifier will do. The office has the SKU or the order number; the
/// handheld needs the tag code. Whichever is given, the rest is filled in from
/// the register, so nobody has to look up a hex string to report a missing
/// garment.
/// </summary>
public static class FindEndpoints
{
    public static void MapFind(this IEndpointRouteBuilder app, Db db)
    {
        var g = app.MapGroup("/api/find").RequireAuthorization();

        // The handheld polls this. Open by default, because that is the only
        // list a device has any use for.
        g.MapGet("/", async (HttpContext ctx) =>
        {
            var status = ctx.Request.Query["status"].ToString();
            if (status is "") status = "open";

            await using var conn = await db.OpenAsync();
            var requests = await conn.QueryAsync("""
                SELECT f.id, f.epc, f.status, f.note, f.created_at, f.found_at, f.item_id, f.group_key,
                       v.sku, p.name AS product_name, p.description,
                       cat.name AS category_name,
                       col.name AS color_name, col.hex AS color_hex,
                       sz.code AS size_code, sz.name AS size_name,
                       i.status AS item_status,
                       lr.code AS last_room_code, lr.name AS last_room_name,
                       fr.code AS found_room_code,
                       cu.full_name AS created_by_name,
                       fu.full_name AS found_by_name
                  FROM find_requests f
                  LEFT JOIN items i    ON i.id = f.item_id
                  LEFT JOIN variants v ON v.id = i.variant_id
                  LEFT JOIN products p ON p.id = v.product_id
                  LEFT JOIN categories cat ON cat.id = p.category_id
                  LEFT JOIN colors col ON col.id = v.color_id
                  LEFT JOIN sizes  sz  ON sz.id  = v.size_id
                  LEFT JOIN rooms lr   ON lr.id = i.room_id
                  LEFT JOIN rooms fr   ON fr.id = f.found_room_id
                  LEFT JOIN users cu   ON cu.id = f.created_by
                  LEFT JOIN users fu   ON fu.id = f.found_by
                 WHERE (@status = 'all' OR f.status = @status)
                 ORDER BY f.status = 'open' DESC, f.created_at DESC
                 LIMIT 300
                """, new { status });

            return Results.Ok(new { requests });
        });

        // One box, many entries. Pasting ten codes and silently getting eight
        // is how two garments stay lost with everybody sure they are listed, so
        // whatever was skipped comes back saying why.
        g.MapPost("/", async (HttpContext ctx, FindRequestBody req) =>
        {
            var me = ctx.RequireRole("admin", "operator");

            await using var conn = await db.OpenAsync();

            var added = new List<object>();
            var skipped = new List<object>();

            // Distinct across both boxes, not just within each. A caller that
            // does not know whether it is holding a tag code or a product code
            // sends the same text as both; offering every entry twice made the
            // second pass refuse it as already on the list, and "Added 8.
            // Skipped 10" for eight garments and one typo is a report that has
            // to be ignored to be used.
            var entries = Split(req.Epc)
                .Concat(Split(req.Search))
                .Distinct(StringComparer.OrdinalIgnoreCase);

            foreach (var entry in entries)
                await AddOneAsync(conn, entry, req.Note, me.Id, added, skipped);

            if (added.Count == 0 && skipped.Count == 0)
                throw ApiException.BadRequest("Give a tag code, a product code or an order number to look for.");

            return Results.Ok(new
            {
                ok = true,
                addedCount = added.Count,
                skippedCount = skipped.Count,
                added,
                skipped,
            });
        });

        // Called by the handheld the moment the operator presses GOT IT, so the
        // garment drops off every other device's list rather than being hunted
        // twice.
        g.MapPost("/{id:int}/found", async (HttpContext ctx, int id, FoundRequest req) =>
        {
            var me = ctx.RequireRole("admin", "operator");

            await using var conn = await db.OpenAsync();
            var n = await conn.ExecuteAsync("""
                UPDATE find_requests
                   SET status = 'found', found_at = now(), found_by = @userId, found_room_id = @roomId
                 WHERE id = @id AND status = 'open'
                """, new { id, userId = me.Id, roomId = req.RoomId });

            if (n == 0) throw ApiException.NotFound("That find was not found, or is already closed.");

            // "Find any navy medium" was one request for one garment, put on the
            // list as every navy medium on a shelf. This one answered it, so the
            // rest come off every handheld.
            var siblingsCleared = await CancelSiblingsAsync(conn, id);

            // Where it turned up is worth recording even when nothing else about
            // it changed: that is how a shelf that keeps swallowing things gets
            // noticed.
            if (req.RoomId is not null)
            {
                await conn.ExecuteAsync("""
                    UPDATE items i
                       SET room_id = @roomId, last_seen_at = now()
                      FROM find_requests f
                     WHERE f.item_id = i.id AND f.id = @id
                    """, new { id, roomId = req.RoomId });
            }

            return Results.Ok(new { ok = true, siblingsCleared });
        });

        // Any one garment of a colour and size - the "Find" button beside it in
        // the product search, on the dashboard and on the handheld.
        //
        // Only garments that are on a shelf: in stock. A shipped garment is at a
        // customer's house and one allocated to an order is already somebody's;
        // sending a reader after either would be a hunt that cannot end.
        g.MapPost("/variant/{variantId:int}", async (HttpContext ctx, int variantId, FindVariantRequest? req) =>
        {
            var me = ctx.RequireRole("admin", "operator");

            await using var conn = await db.OpenAsync();

            var variant = await conn.QueryFirstOrDefaultAsync("""
                SELECT v.id, v.sku, p.name AS product_name, p.stock_type,
                       col.name AS color_name, sz.code AS size_code
                  FROM variants v
                  JOIN products p ON p.id = v.product_id
                  JOIN colors col ON col.id = v.color_id
                  JOIN sizes  sz  ON sz.id  = v.size_id
                 WHERE v.id = @variantId
                """, new { variantId })
                ?? throw ApiException.NotFound("That colour and size was not found.");

            var label = $"{(string)variant.product_name}, {(string)variant.color_name} {(string)variant.size_code}";

            if ((string)variant.stock_type == "dropship")
                throw ApiException.Conflict($"{label} is dropship - the supplier holds it, so there is nothing here to find.");

            // The ones most recently seen first, so a hunt starts with the
            // garments most likely to still be where the system thinks.
            var items = (await conn.QueryAsync("""
                SELECT i.id, i.epc FROM items i
                 WHERE i.variant_id = @variantId AND i.status = 'in_stock'
                 ORDER BY i.last_seen_at DESC NULLS LAST, i.id DESC
                 LIMIT 20
                """, new { variantId })).ToList();

            if (items.Count == 0)
                throw ApiException.Conflict($"No {label} is in stock, so there is nothing on a shelf to find.");

            var groupKey = Guid.NewGuid().ToString("N");
            var note = string.IsNullOrWhiteSpace(req?.Note) ? $"Find any: {label}" : req!.Note!.Trim();

            await using var tx = await conn.BeginTransactionAsync();

            var added = 0;
            var already = 0;
            foreach (var item in items)
            {
                // A garment already being hunted for something else is left on
                // that hunt - finding it answers both.
                var open = await conn.ExecuteScalarAsync<long>(
                    "SELECT COUNT(*) FROM find_requests WHERE epc = @epc AND status = 'open'",
                    new { epc = (string)item.epc }, tx);
                if (open > 0) { already++; continue; }

                await conn.ExecuteAsync("""
                    INSERT INTO find_requests (epc, item_id, note, created_by, group_key)
                    VALUES (@epc, @itemId, @note, @userId, @groupKey)
                    """,
                    new { epc = (string)item.epc, itemId = (int)item.id, note, userId = me.Id, groupKey }, tx);
                added++;
            }

            await tx.CommitAsync();

            return Results.Json(new
            {
                ok = true,
                groupKey = added > 0 ? groupKey : null,
                label,
                addedCount = added,
                alreadyCount = already,
                inStock = items.Count,
            }, statusCode: 201);
        });

        g.MapDelete("/{id:int}", async (HttpContext ctx, int id) =>
        {
            ctx.RequireRole("admin", "operator");
            await using var conn = await db.OpenAsync();
            var n = await conn.ExecuteAsync(
                "UPDATE find_requests SET status = 'cancelled' WHERE id = @id AND status = 'open'",
                new { id });
            if (n == 0) throw ApiException.NotFound("That find was not found, or is already closed.");

            // A "find any navy medium" hunt is one hunt however many garments it
            // was put on the list as, so stopping it on one row stops all of
            // them - the same as finding one does.
            var siblingsCleared = await CancelSiblingsAsync(conn, id);

            return Results.Ok(new { ok = true, siblingsCleared });
        });
    }

    /// <summary>The other open garments of the same "find any" request as this one.</summary>
    private static Task<int> CancelSiblingsAsync(NpgsqlConnection conn, int id) =>
        conn.ExecuteAsync("""
            UPDATE find_requests s
               SET status = 'cancelled'
              FROM find_requests f
             WHERE f.id = @id
               AND s.group_key = f.group_key
               AND f.group_key IS NOT NULL
               AND s.id <> f.id
               AND s.status = 'open'
            """, new { id });

    /// <summary>
    /// Splits one box into entries.
    ///
    /// Only a comma, semicolon or new line separates two of them. A space does
    /// not: readers print tag codes in pairs — "E2 80 11 70 ..." — so splitting
    /// on spaces turns one tag into twelve fragments, none of which is a tag.
    /// </summary>
    private static List<string> Split(string? raw) =>
        string.IsNullOrWhiteSpace(raw)
            ? []
            : raw.Split([',', ';', '\n', '\r'], StringSplitOptions.RemoveEmptyEntries)
                 .Select(x => x.Trim())
                 .Where(x => x.Length > 0)
                 .Distinct(StringComparer.OrdinalIgnoreCase)
                 .ToList();

    /// <summary>
    /// Adds one entry, or records why it could not be added.
    ///
    /// The entry may be a tag code, a variant SKU or an order number, and which
    /// it is does not have to be said. A SKU or an order can name several
    /// garments, and all of them go on the list — "find order SO-...-0007" is
    /// the request somebody actually has.
    /// </summary>
    private static async Task AddOneAsync(
        NpgsqlConnection conn, string entry, string? note, int userId,
        List<object> added, List<object> skipped)
    {
        var epc = Epc.TryNormalise(entry);

        // A tag code we know is the unambiguous case and is tried first, but
        // "1234" is both valid hex and a plausible product code, so a miss here
        // falls through to the searches rather than failing.
        if (epc is not null)
        {
            var item = await conn.QueryFirstOrDefaultAsync(
                "SELECT id, status FROM items WHERE epc = @epc", new { epc });

            if (item is not null)
            {
                await InsertAsync(conn, epc, (int)item.id, note, userId, entry, added, skipped);
                return;
            }
        }

        var matches = (await conn.QueryAsync("""
            SELECT i.id, i.epc FROM items i
              JOIN variants v ON v.id = i.variant_id
              LEFT JOIN order_items oi ON oi.item_id = i.id
              LEFT JOIN orders o ON o.id = oi.order_id
             WHERE (lower(v.sku) = lower(@entry) OR lower(o.order_no) = lower(@entry))
               AND i.status NOT IN ('written_off','lost')
             GROUP BY i.id
             ORDER BY i.id
             LIMIT 25
            """, new { entry })).ToList();

        if (matches.Count > 0)
        {
            foreach (var m in matches)
                await InsertAsync(conn, (string)m.epc, (int)m.id, note, userId, entry, added, skipped);
            return;
        }

        // Nothing known. A raw tag code still goes on the list — a tag that is
        // not in the register is exactly the sort of thing worth walking the
        // floor with a reader to find.
        if (epc is not null)
        {
            await InsertAsync(conn, epc, null, note, userId, entry, added, skipped);
            return;
        }

        skipped.Add(new { value = entry, reason = $"{entry}: no tag, product or order by that name." });
    }

    private static async Task InsertAsync(
        NpgsqlConnection conn, string epc, int? itemId, string? note, int userId,
        string shown, List<object> added, List<object> skipped)
    {
        var already = await conn.ExecuteScalarAsync<long>(
            "SELECT COUNT(*) FROM find_requests WHERE epc = @epc AND status = 'open'", new { epc });

        if (already > 0)
        {
            skipped.Add(new { value = shown, epc, reason = $"{shown}: already on the list." });
            return;
        }

        var id = await conn.ExecuteScalarAsync<int>("""
            INSERT INTO find_requests (epc, item_id, note, created_by)
            VALUES (@epc, @itemId, @note, @userId)
            RETURNING id
            """, new { epc, itemId, note, userId });

        added.Add(new { id, epc, itemId });
    }
}
