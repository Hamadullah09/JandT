using Dapper;
using Warehouse.Api.Data;

namespace Warehouse.Api.Endpoints;

/// <summary>
/// The things everything else is described in terms of: rooms, and the three
/// lookups a garment is classified by.
/// </summary>
public static class CatalogEndpoints
{
    // ------------------------------------------------------------------ rooms

    public static void MapRooms(this IEndpointRouteBuilder app, Db db)
    {
        var g = app.MapGroup("/api/rooms").RequireAuthorization();

        // Counts come with the list because the only question anybody asks
        // about a room is how much is in it, and a second request per row to
        // answer it would make the page slow for no reason.
        g.MapGet("/", async () =>
        {
            await using var conn = await db.OpenAsync();
            var rooms = await conn.QueryAsync("""
                SELECT r.id, r.code, r.name, r.kind, r.capacity, r.notes, r.active, r.created_at,
                       COALESCE(s.in_stock, 0)    AS in_stock,
                       COALESCE(s.total, 0)       AS total_items,
                       COALESCE(s.stock_value, 0) AS stock_value,
                       (SELECT COUNT(*) FROM room_tags t WHERE t.room_id = r.id AND t.active = 1) AS tag_count
                  FROM rooms r
                  LEFT JOIN (
                        SELECT room_id,
                               COUNT(*)                                             AS total,
                               COUNT(*) FILTER (WHERE status = 'in_stock')          AS in_stock,
                               SUM(CASE WHEN status IN ('in_stock','allocated')
                                        THEN cost_price ELSE 0 END)                 AS stock_value
                          FROM items
                         GROUP BY room_id
                  ) s ON s.room_id = r.id
                 ORDER BY r.active DESC, r.code
                """);
            return Results.Ok(new { rooms });
        });

        g.MapPost("/", async (HttpContext ctx, RoomRequest req) =>
        {
            ctx.RequireRole("admin");
            var code = Clean(req.Code, "A room needs a code, such as A1.").ToUpperInvariant();

            await using var conn = await db.OpenAsync();
            if (await conn.ExecuteScalarAsync<long>(
                    "SELECT COUNT(*) FROM rooms WHERE upper(code) = @code", new { code }) > 0)
                throw ApiException.Conflict($"There is already a room called {code}.");

            var id = await conn.ExecuteScalarAsync<int>("""
                INSERT INTO rooms (code, name, kind, capacity, notes)
                VALUES (@code, @name, @kind, @capacity, @notes)
                RETURNING id
                """,
                new
                {
                    code,
                    name = string.IsNullOrWhiteSpace(req.Name) ? $"Room {code}" : req.Name.Trim(),
                    kind = req.Kind ?? "storage",
                    capacity = req.Capacity,
                    notes = req.Notes,
                });

            return Results.Json(new { ok = true, id, code }, statusCode: 201);
        });

        g.MapPatch("/{id:int}", async (HttpContext ctx, int id, RoomRequest req) =>
        {
            ctx.RequireRole("admin");
            await using var conn = await db.OpenAsync();

            var n = await conn.ExecuteAsync("""
                UPDATE rooms
                   SET name     = COALESCE(@name, name),
                       kind     = COALESCE(@kind, kind),
                       capacity = @capacity,
                       notes    = @notes
                 WHERE id = @id
                """,
                new
                {
                    id,
                    name = string.IsNullOrWhiteSpace(req.Name) ? null : req.Name.Trim(),
                    kind = req.Kind,
                    capacity = req.Capacity,
                    notes = req.Notes,
                });

            if (n == 0) throw ApiException.NotFound($"Room {id} was not found.");
            return Results.Ok(new { ok = true });
        });

        // Rooms are switched off rather than deleted: the ledger points at them,
        // and a room that held stock last year has to stay nameable.
        g.MapPatch("/{id:int}/active", async (HttpContext ctx, int id, ActiveRequest req) =>
        {
            ctx.RequireRole("admin");
            await using var conn = await db.OpenAsync();

            if (req.Active == 0)
            {
                var holding = await conn.ExecuteScalarAsync<long>(
                    "SELECT COUNT(*) FROM items WHERE room_id = @id AND status IN ('in_stock','allocated')",
                    new { id });
                if (holding > 0)
                    throw ApiException.Conflict(
                        $"That room still holds {holding} garment(s). Move them out before closing it.");
            }

            var n = await conn.ExecuteAsync(
                "UPDATE rooms SET active = @active WHERE id = @id", new { id, active = (short)req.Active });

            if (n == 0) throw ApiException.NotFound($"Room {id} was not found.");
            return Results.Ok(new { ok = true });
        });
    }

    // -------------------------------------------------------------- room tags

    public static void MapRoomTags(this IEndpointRouteBuilder app, Db db)
    {
        var g = app.MapGroup("/api/room-tags").RequireAuthorization();

        g.MapGet("/", async () =>
        {
            await using var conn = await db.OpenAsync();
            var tags = await conn.QueryAsync("""
                SELECT t.id, t.epc, t.label, t.active, t.created_at,
                       t.room_id, r.code AS room_code, r.name AS room_name
                  FROM room_tags t
                  JOIN rooms r ON r.id = t.room_id
                 ORDER BY r.code, t.id
                """);
            return Results.Ok(new { tags });
        });

        g.MapPost("/", async (HttpContext ctx, RoomTagRequest req) =>
        {
            ctx.RequireRole("admin");
            var epc = Epc.Normalise(req.Epc);

            await using var conn = await db.OpenAsync();

            if (await conn.ExecuteScalarAsync<long>(
                    "SELECT COUNT(*) FROM rooms WHERE id = @id AND active = 1", new { id = req.RoomId }) == 0)
                throw ApiException.NotFound($"Room {req.RoomId} was not found, or is closed.");

            // A tag that already names a different door is a mistake worth
            // naming, not an update to make quietly.
            var taken = await conn.ExecuteScalarAsync<string?>("""
                SELECT r.code FROM room_tags t JOIN rooms r ON r.id = t.room_id WHERE t.epc = @epc
                """, new { epc });
            if (taken is not null)
                throw ApiException.Conflict($"That tag is already the door tag for {taken}.");

            if (await conn.ExecuteScalarAsync<long>(
                    "SELECT COUNT(*) FROM items WHERE epc = @epc", new { epc }) > 0)
                throw ApiException.Conflict("That tag is on a garment, so it cannot also be a door.");

            var id = await conn.ExecuteScalarAsync<int>("""
                INSERT INTO room_tags (room_id, epc, label) VALUES (@roomId, @epc, @label)
                RETURNING id
                """, new { roomId = req.RoomId, epc, label = req.Label });

            return Results.Json(new { ok = true, id, epc }, statusCode: 201);
        });

        // What the handheld calls after scanning a door, so the operator does
        // not have to pick a room off a list and pick the wrong one.
        g.MapGet("/resolve/{epc}", async (string epc) =>
        {
            var normalised = Epc.Normalise(epc);
            await using var conn = await db.OpenAsync();

            var room = await conn.QueryFirstOrDefaultAsync("""
                SELECT r.id, r.code, r.name, r.kind
                  FROM room_tags t JOIN rooms r ON r.id = t.room_id
                 WHERE t.epc = @epc AND t.active = 1 AND r.active = 1
                """, new { epc = normalised });

            return room is null
                ? Results.Ok(new { found = false, epc = normalised })
                : Results.Ok(new { found = true, epc = normalised, room });
        });

        g.MapDelete("/{id:int}", async (HttpContext ctx, int id) =>
        {
            ctx.RequireRole("admin");
            await using var conn = await db.OpenAsync();
            var n = await conn.ExecuteAsync("DELETE FROM room_tags WHERE id = @id", new { id });
            if (n == 0) throw ApiException.NotFound($"Door tag {id} was not found.");
            return Results.Ok(new { ok = true });
        });
    }

    // ---------------------------------------------------------------- lookups

    /// <summary>
    /// Categories, colours and sizes are the same CRUD three times over, so
    /// they are registered from one place rather than copied three times. The
    /// differences — a colour has a swatch, a size has an order — are the two
    /// nullable columns.
    /// </summary>
    public static void MapLookups(this IEndpointRouteBuilder app, Db db)
    {
        foreach (var (route, table, label) in new[]
                 {
                     ("categories", "categories", "category"),
                     ("colors", "colors", "colour"),
                     ("sizes", "sizes", "size"),
                 })
        {
            var g = app.MapGroup($"/api/{route}").RequireAuthorization();
            var hasHex = table == "colors";
            var hasOrder = table == "sizes";

            var columns = "id, code, name, active, created_at"
                + (hasHex ? ", hex" : "")
                + (hasOrder ? ", sort_order" : "");
            var order = hasOrder ? "sort_order, code" : "lower(name)";

            g.MapGet("/", async (HttpContext ctx) =>
            {
                var all = ctx.Request.Query["all"] == "1";
                await using var conn = await db.OpenAsync();
                var rows = await conn.QueryAsync(
                    $"SELECT {columns} FROM {table} {(all ? "" : "WHERE active = 1")} ORDER BY {order}");
                return Results.Ok(new { rows });
            });

            g.MapPost("/", async (HttpContext ctx, LookupRequest req) =>
            {
                ctx.RequireRole("admin");
                var code = Clean(req.Code, $"A {label} needs a short code.").ToUpperInvariant();
                var name = string.IsNullOrWhiteSpace(req.Name) ? code : req.Name.Trim();

                await using var conn = await db.OpenAsync();
                if (await conn.ExecuteScalarAsync<long>(
                        $"SELECT COUNT(*) FROM {table} WHERE upper(code) = @code", new { code }) > 0)
                    throw ApiException.Conflict($"There is already a {label} coded {code}.");

                var cols = "code, name" + (hasHex ? ", hex" : "") + (hasOrder ? ", sort_order" : "");
                var vals = "@code, @name" + (hasHex ? ", @hex" : "") + (hasOrder ? ", @sortOrder" : "");

                var id = await conn.ExecuteScalarAsync<int>(
                    $"INSERT INTO {table} ({cols}) VALUES ({vals}) RETURNING id",
                    new { code, name, hex = req.Hex, sortOrder = req.SortOrder ?? 0 });

                return Results.Json(new { ok = true, id, code }, statusCode: 201);
            });

            g.MapPatch("/{id:int}", async (HttpContext ctx, int id, LookupRequest req) =>
            {
                ctx.RequireRole("admin");
                await using var conn = await db.OpenAsync();

                var sets = new List<string> { "name = COALESCE(@name, name)" };
                if (hasHex) sets.Add("hex = COALESCE(@hex, hex)");
                if (hasOrder) sets.Add("sort_order = COALESCE(@sortOrder, sort_order)");

                var n = await conn.ExecuteAsync(
                    $"UPDATE {table} SET {string.Join(", ", sets)} WHERE id = @id",
                    new
                    {
                        id,
                        name = string.IsNullOrWhiteSpace(req.Name) ? null : req.Name.Trim(),
                        hex = req.Hex,
                        sortOrder = req.SortOrder,
                    });

                if (n == 0) throw ApiException.NotFound($"That {label} was not found.");
                return Results.Ok(new { ok = true });
            });

            g.MapPatch("/{id:int}/active", async (HttpContext ctx, int id, ActiveRequest req) =>
            {
                ctx.RequireRole("admin");
                await using var conn = await db.OpenAsync();
                var n = await conn.ExecuteAsync(
                    $"UPDATE {table} SET active = @active WHERE id = @id", new { id, active = (short)req.Active });
                if (n == 0) throw ApiException.NotFound($"That {label} was not found.");
                return Results.Ok(new { ok = true });
            });
        }
    }

    private static string Clean(string? value, string complaint) =>
        string.IsNullOrWhiteSpace(value) ? throw ApiException.BadRequest(complaint) : value.Trim();
}
