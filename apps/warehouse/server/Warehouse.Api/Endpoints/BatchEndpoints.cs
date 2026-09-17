using Dapper;
using Npgsql;
using Warehouse.Api.Data;
using Warehouse.Api.Services;

namespace Warehouse.Api.Endpoints;

/// <summary>
/// Intake.
///
/// The admin says what arrived — 50 shalwar kameez, in these colours and sizes.
/// That creates a batch with a line per colour and size, each with a quantity.
/// The operator then walks the pile with the handheld and pulls the trigger
/// once per garment, and each tag is bound to one unit of one line.
///
/// The quantity is a limit, not a suggestion. When a line is full the next scan
/// is refused, because the alternative is that a tag read twice from the next
/// shelf quietly invents stock that nobody ever bought.
/// </summary>
public static class BatchEndpoints
{
    /// <summary>What an intake asked for against what actually got tagged.</summary>
    private sealed record Tally(long expected, long assigned);

    public static void MapBatches(this IEndpointRouteBuilder app, Db db)
    {
        var g = app.MapGroup("/api/batches").RequireAuthorization();

        g.MapGet("/", async (HttpContext ctx) =>
        {
            var status = ctx.Request.Query["status"].ToString();

            await using var conn = await db.OpenAsync();
            var batches = await conn.QueryAsync("""
                SELECT b.id, b.batch_no, b.supplier, b.status, b.notes, b.created_at, b.completed_at,
                       b.room_id, r.code AS room_code, r.name AS room_name,
                       u.full_name AS created_by_name,
                       COALESCE(q.expected, 0) AS expected,
                       COALESCE(a.assigned, 0) AS assigned
                  FROM batches b
                  LEFT JOIN rooms r ON r.id = b.room_id
                  LEFT JOIN users u ON u.id = b.created_by
                  LEFT JOIN (SELECT batch_id, SUM(quantity) AS expected
                               FROM batch_lines GROUP BY batch_id) q ON q.batch_id = b.id
                  LEFT JOIN (SELECT bl.batch_id, COUNT(i.id) AS assigned
                               FROM batch_lines bl
                               JOIN items i ON i.batch_line_id = bl.id
                              GROUP BY bl.batch_id) a ON a.batch_id = b.id
                 WHERE (@status = '' OR b.status = @status)
                 ORDER BY b.created_at DESC
                 LIMIT 300
                """, new { status });

            return Results.Ok(new { batches });
        });

        // The handheld's working screen. Lines carry `assigned` and `remaining`
        // so the operator sees a countdown rather than a target.
        g.MapGet("/{id:int}", async (int id) =>
        {
            await using var conn = await db.OpenAsync();

            var batch = await conn.QueryFirstOrDefaultAsync("""
                SELECT b.id, b.batch_no, b.supplier, b.status, b.notes, b.created_at, b.completed_at,
                       b.room_id, r.code AS room_code, r.name AS room_name,
                       u.full_name AS created_by_name
                  FROM batches b
                  LEFT JOIN rooms r ON r.id = b.room_id
                  LEFT JOIN users u ON u.id = b.created_by
                 WHERE b.id = @id
                """, new { id })
                ?? throw ApiException.NotFound($"Intake {id} was not found.");

            // Grouped by every joined table's key, which is what lets the
            // descriptive columns of each ride along without being aggregated.
            var lines = await conn.QueryAsync("""
                SELECT bl.id, bl.variant_id, bl.quantity, bl.unit_cost,
                       v.sku, p.name AS product_name, p.stock_type,
                       cat.name AS category_name,
                       col.name AS color_name, col.hex AS color_hex,
                       sz.name AS size_name, sz.code AS size_code,
                       COUNT(i.id) AS assigned,
                       bl.quantity - COUNT(i.id) AS remaining
                  FROM batch_lines bl
                  JOIN variants v   ON v.id = bl.variant_id
                  JOIN products p   ON p.id = v.product_id
                  JOIN categories cat ON cat.id = p.category_id
                  JOIN colors col   ON col.id = v.color_id
                  JOIN sizes  sz    ON sz.id  = v.size_id
                  LEFT JOIN items i ON i.batch_line_id = bl.id
                 WHERE bl.batch_id = @id
                 GROUP BY bl.id, v.id, p.id, cat.id, col.id, sz.id
                 ORDER BY lower(p.name), lower(col.name), sz.sort_order
                """, new { id });

            var items = await conn.QueryAsync("""
                SELECT i.id, i.epc, i.enrolled_at, i.status, i.batch_line_id,
                       v.sku, col.name AS color_name, sz.code AS size_code,
                       p.name AS product_name, u.full_name AS enrolled_by_name
                  FROM items i
                  JOIN batch_lines bl ON bl.id = i.batch_line_id
                  JOIN variants v  ON v.id = i.variant_id
                  JOIN products p  ON p.id = v.product_id
                  JOIN colors col  ON col.id = v.color_id
                  JOIN sizes  sz   ON sz.id  = v.size_id
                  LEFT JOIN users u ON u.id = i.enrolled_by
                 WHERE bl.batch_id = @id
                 ORDER BY i.enrolled_at DESC
                """, new { id });

            return Results.Ok(new { batch, lines, items });
        });

        g.MapPost("/", async (HttpContext ctx, BatchRequest req) =>
        {
            var me = ctx.RequireRole("admin", "operator");

            if (req.Lines is not { Length: > 0 })
                throw ApiException.BadRequest("Say what arrived: at least one garment and a quantity.");

            foreach (var line in req.Lines)
            {
                if (line.Quantity <= 0)
                    throw ApiException.BadRequest("Every line needs a quantity of at least 1.");

                // Adding to the catalogue is an admin's job everywhere else, so
                // it is here too.
                if (line.NewGarment is not null && me.Role != "admin")
                    throw ApiException.Forbidden("Only an admin can add a garment that is not in the catalogue yet.");
            }

            await using var conn = await db.OpenAsync();
            await using var tx = await conn.BeginTransactionAsync();

            // A garment that is not in the catalogue yet becomes one here, in the
            // same transaction as the intake: a delivery that fails part way
            // leaves no half-made product behind.
            var catalogue = new NewGarments(conn, tx, req.Supplier);
            var variantIds = new int[req.Lines.Length];
            for (var i = 0; i < req.Lines.Length; i++)
            {
                variantIds[i] = req.Lines[i].NewGarment is { } garment
                    ? await catalogue.VariantAsync(garment)
                    : req.Lines[i].VariantId;
            }

            // Dropship products never physically arrive, so they can never be
            // part of an intake. Caught here rather than at scanning time,
            // where the operator would be standing at the shelf holding a tag
            // with nothing to put it on.
            foreach (var variantId in variantIds)
            {
                var stockType = await conn.ExecuteScalarAsync<string?>("""
                    SELECT p.stock_type FROM variants v JOIN products p ON p.id = v.product_id
                     WHERE v.id = @id
                    """, new { id = variantId }, tx)
                    ?? throw ApiException.NotFound($"Garment {variantId} was not found.");

                if (stockType == "dropship")
                    throw ApiException.BadRequest(
                        "That is a dropship product — it never comes into the warehouse, so it cannot be booked in.");
            }

            var batchNo = await Ref.NextAsync(conn, tx, "batches", "batch_no", "BAT");

            var id = await conn.ExecuteScalarAsync<int>("""
                INSERT INTO batches (batch_no, supplier, room_id, notes, created_by)
                VALUES (@batchNo, @supplier, @roomId, @notes, @userId)
                RETURNING id
                """,
                new { batchNo, supplier = req.Supplier, roomId = req.RoomId, notes = req.Notes, userId = me.Id },
                tx);

            for (var i = 0; i < req.Lines.Length; i++)
            {
                var line = req.Lines[i];

                // Falls back to the variant's own cost, so the common case is
                // one number typed once on the product rather than per intake.
                var cost = line.UnitCost ?? await conn.ExecuteScalarAsync<decimal>("""
                    SELECT COALESCE(v.cost_price, p.cost_price)
                      FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id = @id
                    """, new { id = variantIds[i] }, tx);

                await conn.ExecuteAsync("""
                    INSERT INTO batch_lines (batch_id, variant_id, quantity, unit_cost)
                    VALUES (@id, @variantId, @quantity, @cost)
                    """,
                    new { id, variantId = variantIds[i], quantity = line.Quantity, cost }, tx);
            }

            await tx.CommitAsync();
            return Results.Json(new
            {
                ok = true,
                id,
                batchNo,
                productsAdded = catalogue.ProductsAdded,
                variantsAdded = catalogue.VariantsAdded,
            }, statusCode: 201);
        });

        // One tag, one garment. Called once per trigger pull on the handheld,
        // and by the dashboard when a tag is typed in by hand.
        g.MapPost("/{id:int}/assign", async (HttpContext ctx, int id, AssignTagRequest req) =>
        {
            var me = ctx.RequireRole("admin", "operator");
            var epc = Epc.Normalise(req.Epc);

            await using var conn = await db.OpenAsync();
            await using var tx = await conn.BeginTransactionAsync();

            var batch = await conn.QueryFirstOrDefaultAsync(
                "SELECT id, batch_no, status, room_id FROM batches WHERE id = @id", new { id }, tx)
                ?? throw ApiException.NotFound($"Intake {id} was not found.");

            if ((string)batch.status != "open")
                throw ApiException.Conflict($"Intake {(string)batch.batch_no} is closed, so nothing more can be added to it.");

            // FOR UPDATE, because two handhelds can work the same intake. Without
            // the lock both read "49 of 50 assigned", both decide there is room,
            // and the pile ends up with 51 garments on it.
            var line = await conn.QueryFirstOrDefaultAsync("""
                SELECT bl.id, bl.batch_id, bl.variant_id, bl.quantity, bl.unit_cost
                  FROM batch_lines bl WHERE bl.id = @lineId FOR UPDATE
                """, new { lineId = req.BatchLineId }, tx)
                ?? throw ApiException.NotFound("That line is not part of this intake.");

            if ((int)line.batch_id != id)
                throw ApiException.BadRequest("That line belongs to a different intake.");

            // What the tag already is, before what the line still needs.
            //
            // The order matters. The last scan of a full line is usually the
            // operator going over the same garment twice, and "you have already
            // done this one" sends him to the next garment while "the line is
            // full" sends him to find a supervisor. A fact about the tag also
            // holds regardless of which line it was offered to, so it is the
            // more honest answer of the two.
            var existing = await conn.QueryFirstOrDefaultAsync("""
                SELECT i.id, i.status, p.name AS product_name, col.name AS color_name, sz.code AS size_code
                  FROM items i
                  JOIN variants v  ON v.id = i.variant_id
                  JOIN products p  ON p.id = v.product_id
                  JOIN colors col  ON col.id = v.color_id
                  JOIN sizes  sz   ON sz.id  = v.size_id
                 WHERE i.epc = @epc
                """, new { epc }, tx);

            // Each refusal carries its own code. The handheld reads a pile
            // continuously and has to tell a fact about the tag - it is already
            // on a garment, or it is a door - which it says once and then stops
            // asking about, from a fact about the line, which changes.
            if (existing is not null)
                throw new ApiException(409, "already_tagged",
                    $"Already tagged: {(string)existing.product_name}, {(string)existing.color_name} {(string)existing.size_code}.");

            var door = await conn.ExecuteScalarAsync<string?>("""
                SELECT r.code FROM room_tags t JOIN rooms r ON r.id = t.room_id WHERE t.epc = @epc
                """, new { epc }, tx);

            if (door is not null)
                throw new ApiException(409, "door_tag", $"That is the door tag for {door}, not a garment tag.");

            var assigned = await conn.ExecuteScalarAsync<int>(
                "SELECT COUNT(*) FROM items WHERE batch_line_id = @lineId",
                new { lineId = req.BatchLineId }, tx);

            if (assigned >= (int)line.quantity)
                throw new ApiException(409, "line_full",
                    $"All {(int)line.quantity} of those are already tagged. Nothing left on this line.");

            var roomId = req.RoomId ?? (int?)batch.room_id;

            var itemId = await conn.ExecuteScalarAsync<int>("""
                INSERT INTO items (epc, tid, variant_id, batch_line_id, room_id, cost_price, notes, enrolled_by)
                VALUES (@epc, @tid, @variantId, @lineId, @roomId, @cost, @notes, @userId)
                RETURNING id
                """,
                new
                {
                    epc,
                    tid = req.Tid,
                    variantId = (int)line.variant_id,
                    lineId = req.BatchLineId,
                    roomId,
                    cost = (decimal)line.unit_cost,
                    notes = req.Notes,
                    userId = me.Id,
                }, tx);

            await Ledger.RecordAsync(conn, tx, itemId, "intake",
                toRoomId: roomId, toStatus: "in_stock", userId: me.Id,
                note: $"Booked in on {(string)batch.batch_no}");

            await tx.CommitAsync();

            var remaining = (int)line.quantity - assigned - 1;

            return Results.Json(new
            {
                ok = true,
                itemId,
                epc,
                assigned = assigned + 1,
                quantity = (int)line.quantity,
                remaining,
            }, statusCode: 201);
        });

        // Undo one scan. The garment has to be untouched since — anything that
        // has moved or been sold is history now, not a mis-scan.
        g.MapDelete("/{id:int}/assign/{itemId:int}", async (HttpContext ctx, int id, int itemId) =>
        {
            ctx.RequireRole("admin", "operator");

            await using var conn = await db.OpenAsync();
            await using var tx = await conn.BeginTransactionAsync();

            var item = await conn.QueryFirstOrDefaultAsync("""
                SELECT i.id, i.epc, i.status, bl.batch_id
                  FROM items i JOIN batch_lines bl ON bl.id = i.batch_line_id
                 WHERE i.id = @itemId
                """, new { itemId }, tx)
                ?? throw ApiException.NotFound("That garment is not part of an intake.");

            if ((int)item.batch_id != id)
                throw ApiException.BadRequest("That garment belongs to a different intake.");
            if ((string)item.status != "in_stock")
                throw ApiException.Conflict("That garment has already moved on, so the scan cannot be undone.");

            if (await conn.ExecuteScalarAsync<long>(
                    "SELECT COUNT(*) FROM order_items WHERE item_id = @itemId", new { itemId }, tx) > 0)
                throw ApiException.Conflict("That garment is on an order, so the scan cannot be undone.");

            await conn.ExecuteAsync("DELETE FROM movements WHERE item_id = @itemId", new { itemId }, tx);
            await conn.ExecuteAsync("DELETE FROM items WHERE id = @itemId", new { itemId }, tx);

            await tx.CommitAsync();
            return Results.Ok(new { ok = true, epc = (string)item.epc });
        });

        g.MapPost("/{id:int}/complete", async (HttpContext ctx, int id) =>
        {
            ctx.RequireRole("admin", "operator");

            await using var conn = await db.OpenAsync();

            // Two independent subqueries rather than one join, because joining
            // the lines to their items multiplies the lines: one line of 50
            // with 50 tags on it becomes 50 rows, and SUM(quantity) over those
            // reports 2,500 expected. Counting each thing where it lives is the
            // only version of this that stays right.
            //
            // CAST so both come back as bigint and Dapper can build the record.
            var tally = await conn.QuerySingleAsync<Tally>("""
                SELECT CAST(COALESCE((SELECT SUM(bl.quantity) FROM batch_lines bl
                                       WHERE bl.batch_id = @id), 0) AS bigint) AS expected,
                       CAST((SELECT COUNT(*) FROM items i
                               JOIN batch_lines bl ON bl.id = i.batch_line_id
                              WHERE bl.batch_id = @id) AS bigint)              AS assigned
                """, new { id });

            var n = await conn.ExecuteAsync("""
                UPDATE batches SET status = 'complete', completed_at = now()
                 WHERE id = @id AND status = 'open'
                """, new { id });

            if (n == 0) throw ApiException.NotFound($"Intake {id} was not found, or is already closed.");

            // Closing short is allowed and reported rather than blocked: a
            // delivery that arrives one garment light is a real thing that
            // happens, and refusing to close the paperwork does not fix it.
            return Results.Ok(new
            {
                ok = true,
                tally.expected,
                tally.assigned,
                shortBy = tally.expected - tally.assigned,
            });
        });

        g.MapDelete("/{id:int}", async (HttpContext ctx, int id) =>
        {
            ctx.RequireRole("admin");

            await using var conn = await db.OpenAsync();
            var tagged = await conn.ExecuteScalarAsync<long>("""
                SELECT COUNT(*) FROM items i JOIN batch_lines bl ON bl.id = i.batch_line_id
                 WHERE bl.batch_id = @id
                """, new { id });

            if (tagged > 0)
                throw ApiException.Conflict(
                    $"{tagged} garment(s) have been tagged against this intake, so it cannot be deleted.");

            var n = await conn.ExecuteAsync("DELETE FROM batches WHERE id = @id", new { id });
            if (n == 0) throw ApiException.NotFound($"Intake {id} was not found.");
            return Results.Ok(new { ok = true });
        });
    }

    /// <summary>
    /// Garments booked in before they were ever in the catalogue: "Silk Kurti,
    /// Red, M" typed on the intake form becomes a product, that colour and size
    /// of it, and - when the colour or size is one the warehouse has never used -
    /// the colour or size itself.
    ///
    /// A name already in the catalogue is that product, so a known suit arriving
    /// in a new size gains the size rather than becoming a second suit with the
    /// same name. Several lines of one new garment make one product between them.
    /// </summary>
    private sealed class NewGarments(NpgsqlConnection conn, NpgsqlTransaction tx, string? supplier)
    {
        private readonly Dictionary<string, (int Id, string Sku)> products = new(StringComparer.OrdinalIgnoreCase);

        public int ProductsAdded { get; private set; }
        public int VariantsAdded { get; private set; }

        public async Task<int> VariantAsync(NewGarmentRequest garment)
        {
            var name = garment.Name?.Trim();
            if (string.IsNullOrEmpty(name))
                throw ApiException.BadRequest("A new garment needs a name.");
            if (name.Length > 200)
                throw ApiException.BadRequest("That name is too long - keep it under 200 characters.");

            var product = await ProductAsync(name, garment);
            var (colorId, colorCode) = await LookupAsync("colors", "colour", garment.ColorId, garment.ColorName);
            var (sizeId, sizeCode) = await LookupAsync("sizes", "size", garment.SizeId, garment.SizeName);

            var existing = await conn.QueryFirstOrDefaultAsync("""
                SELECT id, active FROM variants
                 WHERE product_id = @productId AND color_id = @colorId AND size_id = @sizeId
                """, new { productId = product.Id, colorId, sizeId }, tx);

            if (existing is not null)
            {
                // Booking it in is selling it again.
                if (Convert.ToInt32(existing.active) == 0)
                    await conn.ExecuteAsync("UPDATE variants SET active = 1 WHERE id = @id", new { id = (int)existing.id }, tx);
                return (int)existing.id;
            }

            VariantsAdded++;
            return await conn.ExecuteScalarAsync<int>("""
                INSERT INTO variants (product_id, color_id, size_id, sku)
                VALUES (@productId, @colorId, @sizeId, @sku)
                RETURNING id
                """,
                new { productId = product.Id, colorId, sizeId, sku = $"{product.Sku}-{colorCode}-{sizeCode}" }, tx);
        }

        private async Task<(int Id, string Sku)> ProductAsync(string name, NewGarmentRequest garment)
        {
            if (products.TryGetValue(name, out var known)) return known;

            // Compared ignoring case, so "silk kurti" finds "Silk Kurti".
            var found = await conn.QueryFirstOrDefaultAsync("""
                SELECT id, sku, stock_type FROM products
                 WHERE active = 1 AND lower(name) = lower(@name)
                 ORDER BY id
                 LIMIT 1
                """, new { name }, tx);

            if (found is not null)
            {
                if ((string)found.stock_type == "dropship")
                    throw ApiException.BadRequest(
                        $"{name} is a dropship product - it never comes into the warehouse, so it cannot be booked in.");
                return products[name] = ((int)found.id, (string)found.sku);
            }

            if (garment.CategoryId is not int categoryId)
                throw ApiException.BadRequest($"Choose a category for {name}.");
            if (garment.CostPrice < 0 || garment.SalePrice < 0)
                throw ApiException.BadRequest("A price cannot be negative.");

            var categoryCode = await conn.ExecuteScalarAsync<string?>(
                "SELECT code FROM categories WHERE id = @categoryId AND active = 1", new { categoryId }, tx)
                ?? throw ApiException.BadRequest($"Choose a category for {name} that is still in use.");

            var sku = await ProductEndpoints.NextProductSkuAsync(conn, categoryCode, tx);
            var id = await conn.ExecuteScalarAsync<int>("""
                INSERT INTO products (sku, name, category_id, stock_type, supplier, cost_price, sale_price)
                VALUES (@sku, @name, @categoryId, 'stock', @supplier, @costPrice, @salePrice)
                RETURNING id
                """,
                new
                {
                    sku,
                    name,
                    categoryId,
                    supplier = string.IsNullOrWhiteSpace(supplier) ? null : supplier.Trim(),
                    costPrice = garment.CostPrice ?? 0,
                    salePrice = garment.SalePrice ?? 0,
                }, tx);

            ProductsAdded++;
            return products[name] = (id, sku);
        }

        /// <summary>
        /// A colour or size by its id, or by the name typed for it: the existing
        /// one when that name or its code is already used, a new one otherwise.
        /// </summary>
        private async Task<(int Id, string Code)> LookupAsync(string table, string label, int? chosen, string? typed)
        {
            if (chosen is int chosenId)
            {
                var row = await conn.QueryFirstOrDefaultAsync(
                    $"SELECT id, code FROM {table} WHERE id = @chosenId AND active = 1", new { chosenId }, tx)
                    ?? throw ApiException.BadRequest($"That {label} has been switched off or removed. Choose it again.");
                return ((int)row.id, (string)row.code);
            }

            var name = typed?.Trim();
            if (string.IsNullOrEmpty(name))
                throw ApiException.BadRequest($"Choose a {label} for every new garment.");
            if (name.Length > 64)
                throw ApiException.BadRequest($"That {label} name is too long - keep it under 64 characters.");

            // Codes are what product codes are built from, so letters and digits only.
            var code = new string(name.ToUpperInvariant().Where(char.IsLetterOrDigit).ToArray());
            if (code.Length == 0)
                throw ApiException.BadRequest($"Give the {label} a name with letters or numbers in it.");
            if (code.Length > 32) code = code[..32];

            var match = await conn.QueryFirstOrDefaultAsync($"""
                SELECT id, code, active FROM {table}
                 WHERE lower(name) = lower(@name) OR code = @code
                 ORDER BY (lower(name) = lower(@name)) DESC
                 LIMIT 1
                """,
                new { name, code }, tx);

            if (match is not null)
            {
                // Switched off once, but garments in it have just arrived.
                if (Convert.ToInt32(match.active) == 0)
                    await conn.ExecuteAsync($"UPDATE {table} SET active = 1 WHERE id = @id", new { id = (int)match.id }, tx);
                return ((int)match.id, (string)match.code);
            }

            if (table == "sizes")
            {
                // Last in the order; Categories & sizes can move it.
                var sortOrder = await conn.ExecuteScalarAsync<int>(
                    "SELECT COALESCE(MAX(sort_order), 0) + 10 FROM sizes", null, tx);
                var sizeId = await conn.ExecuteScalarAsync<int>("""
                    INSERT INTO sizes (code, name, sort_order) VALUES (@code, @name, @sortOrder)
                    RETURNING id
                    """, new { code, name, sortOrder }, tx);
                return (sizeId, code);
            }

            var colorId = await conn.ExecuteScalarAsync<int>("""
                INSERT INTO colors (code, name) VALUES (@code, @name)
                RETURNING id
                """, new { code, name }, tx);
            return (colorId, code);
        }
    }
}
