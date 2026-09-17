using Dapper;
using Npgsql;
using Warehouse.Api.Data;

namespace Warehouse.Api.Endpoints;

/// <summary>
/// Orders that arrive as a spreadsheet.
///
/// Sales come in as a file with a customer, an address, a total and the name of
/// a dress — and with no order number and no date, because nothing outside this
/// system issues either. Minting both is the whole reason for feeding the file
/// in rather than filing it: an order with an id can be picked, shipped and
/// returned against, and one in a spreadsheet cannot.
///
/// Two rules shape the rest of it.
///
/// **A row is imported or reported, never half-imported.** Each one gets its
/// own transaction, so a file of four hundred where six name a dress nobody can
/// identify imports three hundred and ninety-four and hands back six lines
/// saying which and why.
///
/// **A dress name is matched, never guessed.** If it names one garment in the
/// catalogue, that is the one. If it names several, the row is left for a
/// person: picking the first is how a customer is sent a medium when they
/// ordered a large, and the mistake is invisible until it comes back.
/// </summary>
public static class OrderImportEndpoints
{
    /// <summary>
    /// A cap, so a mis-selected file cannot spend ten minutes writing rows
    /// nobody asked for. Well above any real day's sales.
    /// </summary>
    private const int MaxRows = 2000;

    public static void MapOrderImport(this IEndpointRouteBuilder app, Db db)
    {
        var g = app.MapGroup("/api/orders").RequireAuthorization();

        // Admin, not operator: this writes to the catalogue as well as to
        // orders, and a new product invented on the packing bench is a product
        // with nobody's price on it.
        g.MapPost("/import", async (HttpContext ctx, ImportOrdersRequest req) =>
        {
            var me = ctx.RequireRole("admin");

            if (req.Rows is not { Length: > 0 })
                throw ApiException.BadRequest("There are no rows in that file.");

            if (req.Rows.Length > MaxRows)
                throw ApiException.BadRequest(
                    $"That file has {req.Rows.Length} rows. {MaxRows} at a time is the limit.");

            var stockType = req.StockType is "stock" or "dropship" ? req.StockType : "dropship";

            await using var conn = await db.OpenAsync();

            string? categoryCode = null;
            if (req.CreateMissing)
            {
                if (req.CategoryId is null)
                    throw ApiException.BadRequest(
                        "Choose which category the new products should go in.");

                categoryCode = await conn.ExecuteScalarAsync<string?>(
                    "SELECT code FROM categories WHERE id = @id AND active = 1",
                    new { id = req.CategoryId })
                    ?? throw ApiException.NotFound($"Category {req.CategoryId} was not found.");
            }

            // One moment for the whole file, as the shop's clock read it: the
            // number carries that day, the row stores the instant.
            var placedAtUtc = req.PlacedAt is { } typed ? BusinessClock.ToUtc(typed) : DateTime.UtcNow;
            var placedOn = BusinessClock.ToLocal(placedAtUtc);

            var imported = new List<object>();
            var skipped = new List<object>();
            var productsCreated = new List<object>();

            // A dress name repeated down the file is looked up once, and — more
            // to the point — invented once. Without this, ten rows of "Pearl
            // Hand Embellished 3 Piece Suit" become ten products.
            var resolved = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);

            for (var i = 0; i < req.Rows.Length; i++)
            {
                var row = req.Rows[i];

                // The spreadsheet's own line number, header included, because
                // that is what the operator is looking at when they read this.
                var line = i + 2;

                var name = row.CustomerName?.Trim();
                if (string.IsNullOrWhiteSpace(name))
                {
                    skipped.Add(new { line, name = "", reason = "No customer name." });
                    continue;
                }

                var dress = row.DressName?.Trim();

                await using var tx = await conn.BeginTransactionAsync();
                try
                {
                    var variantId = row.VariantId
                        ?? await ResolveAsync(conn, tx, dress, resolved, req, stockType,
                                              categoryCode, row.Total, productsCreated);

                    if (variantId is null)
                    {
                        await tx.RollbackAsync();
                        skipped.Add(new
                        {
                            line,
                            name,
                            reason = string.IsNullOrWhiteSpace(dress)
                                ? "No dress named on that row."
                                : await WhyNotAsync(conn, dress, req.CreateMissing),
                        });
                        continue;
                    }

                    var variant = await conn.QueryFirstOrDefaultAsync("""
                        SELECT v.id, v.sku, p.stock_type,
                               COALESCE(v.sale_price, p.sale_price) AS sale_price
                          FROM variants v JOIN products p ON p.id = v.product_id
                         WHERE v.id = @id
                        """, new { id = variantId }, tx);

                    if (variant is null)
                    {
                        await tx.RollbackAsync();
                        skipped.Add(new { line, name, reason = $"Garment {variantId} no longer exists." });
                        continue;
                    }

                    var orderNo = await Ref.NextAsync(conn, tx, "orders", "order_no", "SO", placedOn);
                    var trackingId = await Ref.NextTrackingAsync(conn, tx);

                    // The total is put on the line rather than into shipping or
                    // a discount, so the order's total comes back out exactly
                    // as the spreadsheet had it. That is what makes the two
                    // reconcilable afterwards, which is the only reason the
                    // figure is carried across at all.
                    var price = row.Total ?? (decimal)variant.sale_price;

                    var orderId = await conn.ExecuteScalarAsync<int>("""
                        INSERT INTO orders (order_no, tracking_id, customer_name, customer_phone, address,
                                            city, postal_code, payment_type, channel,
                                            notes, placed_at, created_by)
                        VALUES (@orderNo, @trackingId, @name, @phone, @address, @city, @postalCode,
                                @paymentType, 'manual', @notes, @placedAt, @userId)
                        RETURNING id
                        """,
                        new
                        {
                            orderNo,
                            trackingId,
                            name,
                            phone = Blank(row.Phone),
                            address = Blank(row.Address),
                            city = Blank(row.City),
                            postalCode = Blank(row.PostalCode),
                            paymentType = Payment.Normalise(row.PaymentType),
                            notes = $"Imported from a sales file, row {line}.",
                            placedAt = placedAtUtc,
                            userId = me.Id,
                        }, tx);

                    await conn.ExecuteAsync("""
                        INSERT INTO order_lines (order_id, variant_id, quantity, unit_price, route)
                        VALUES (@orderId, @variantId, 1, @price, @route)
                        """,
                        new
                        {
                            orderId,
                            variantId,
                            price,
                            route = (string)variant.stock_type,
                        }, tx);

                    await OrderEndpoints.RecalculateTotalsAsync(conn, tx, orderId);

                    await tx.CommitAsync();

                    imported.Add(new
                    {
                        line,
                        name,
                        id = orderId,
                        orderNo,
                        sku = (string)variant.sku,
                        total = price,
                    });
                }
                catch (ApiException ex)
                {
                    await tx.RollbackAsync();
                    skipped.Add(new { line, name, reason = ex.Message });
                }
                catch (PostgresException ex)
                {
                    // PostgreSQL has already abandoned the transaction; rolling
                    // back is what lets the next row start a fresh one.
                    await tx.RollbackAsync();
                    skipped.Add(new { line, name, reason = $"The database refused that row: {ex.MessageText}" });
                }
            }

            return Results.Ok(new
            {
                ok = true,
                imported = imported.Count,
                skippedCount = skipped.Count,
                productsCreatedCount = productsCreated.Count,
                orders = imported,
                skipped,
                productsCreated,
            });
        });

        // What the preview screen asks before anybody commits to anything: for
        // each dress name in the file, does the catalogue know it, and if so,
        // does it know exactly one of it.
        g.MapPost("/import/preview", async (HttpContext ctx, ImportOrdersRequest req) =>
        {
            ctx.RequireRole("admin", "operator");

            if (req.Rows is not { Length: > 0 })
                throw ApiException.BadRequest("There are no rows in that file.");

            var names = req.Rows
                .Select(r => r.DressName?.Trim())
                .Where(n => !string.IsNullOrWhiteSpace(n))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();

            await using var conn = await db.OpenAsync();

            var dresses = new List<object>();
            foreach (var name in names)
            {
                var matches = (await MatchesAsync(conn, null, name!)).ToList();
                dresses.Add(new
                {
                    dressName = name,
                    matched = matches.Count,
                    variants = matches,
                });
            }

            return Results.Ok(new { dresses });
        });
    }

    /// <summary>
    /// Every variant whose product is called this.
    ///
    /// Matched on the product name rather than the SKU because a spreadsheet
    /// written by the sales desk has the name on it and never the code. Exact
    /// apart from case, not a pattern: "Embroidered Maxi" must not quietly match
    /// "Embroidered Maxi Chic", and a near miss is a row for a person to look at.
    /// </summary>
    private static async Task<IEnumerable<dynamic>> MatchesAsync(
        NpgsqlConnection conn, NpgsqlTransaction? tx, string dressName) =>
        await conn.QueryAsync("""
            SELECT v.id, v.sku, p.name AS product_name, p.stock_type,
                   col.name AS color_name, sz.code AS size_code,
                   COALESCE(v.sale_price, p.sale_price) AS sale_price
              FROM variants v
              JOIN products p  ON p.id = v.product_id
              JOIN colors col  ON col.id = v.color_id
              JOIN sizes  sz   ON sz.id  = v.size_id
             WHERE lower(p.name) = lower(@dressName) AND p.active = 1 AND v.active = 1
             ORDER BY v.id
            """, new { dressName }, tx);

    /// <summary>
    /// The variant a row should go on, creating the product if that is allowed
    /// and nothing matched. Null means the row cannot be imported.
    /// </summary>
    private static async Task<int?> ResolveAsync(
        NpgsqlConnection conn, NpgsqlTransaction tx, string? dressName,
        Dictionary<string, int> resolved, ImportOrdersRequest req, string stockType,
        string? categoryCode, decimal? total, List<object> productsCreated)
    {
        if (string.IsNullOrWhiteSpace(dressName)) return null;
        if (resolved.TryGetValue(dressName, out var known)) return known;

        var matches = (await MatchesAsync(conn, tx, dressName)).ToList();

        if (matches.Count == 1)
        {
            var id = (int)matches[0].id;
            resolved[dressName] = id;
            return id;
        }

        // Several. Deliberately not resolved here — see the class comment.
        if (matches.Count > 1) return null;

        if (!req.CreateMissing || categoryCode is null) return null;

        var variantId = await CreateProductAsync(
            conn, tx, dressName, categoryCode, req.CategoryId!.Value, stockType, total, productsCreated);

        resolved[dressName] = variantId;
        return variantId;
    }

    /// <summary>
    /// Invents the garment the spreadsheet is selling.
    ///
    /// One variant, because the file says nothing about colour or size. Rather
    /// than pick a real colour and a real size and be wrong about both, it uses
    /// a placeholder pair — "As pictured" and "One size" — created once and
    /// reused. That is honest about what is known, and it leaves a product the
    /// office can give proper colours and sizes to later without the orders
    /// already placed against it having lied.
    /// </summary>
    private static async Task<int> CreateProductAsync(
        NpgsqlConnection conn, NpgsqlTransaction tx, string dressName,
        string categoryCode, int categoryId, string stockType, decimal? total,
        List<object> productsCreated)
    {
        var colorId = await EnsureLookupAsync(
            conn, tx, "colors", "ASIS", "As pictured", "hex", "#9CA3AF");

        // 900, not 0. Sizes are ordered by this column so that a picker reads
        // XS, S, M, L rather than alphabetically, and a placeholder sorted to
        // zero puts "One size" in front of Extra small on every size list in
        // the system.
        var sizeId = await EnsureLookupAsync(
            conn, tx, "sizes", "ONE", "One size", "sort_order", 900);

        var sku = await ProductEndpoints.NextProductSkuAsync(conn, categoryCode, tx);

        var productId = await conn.ExecuteScalarAsync<int>("""
            INSERT INTO products (sku, name, category_id, stock_type, sale_price, description)
            VALUES (@sku, @name, @categoryId, @stockType, @salePrice, @description)
            RETURNING id
            """,
            new
            {
                sku,
                name = dressName,
                categoryId,
                stockType,
                salePrice = total ?? 0m,
                description = "Created by a sales file import. Colour and size are placeholders.",
            }, tx);

        var variantId = await conn.ExecuteScalarAsync<int>("""
            INSERT INTO variants (product_id, color_id, size_id, sku)
            VALUES (@productId, @colorId, @sizeId, @sku)
            RETURNING id
            """,
            new { productId, colorId, sizeId, sku = $"{sku}-ASIS-ONE" }, tx);

        productsCreated.Add(new { id = productId, sku, name = dressName, stockType });
        return variantId;
    }

    /// <summary>
    /// Finds a colour or size by code, adding it if it has never been needed.
    ///
    /// Only ever called for the two placeholders, and only when a product is
    /// actually being created, so a warehouse that never imports a spreadsheet
    /// never grows them.
    /// </summary>
    private static async Task<int> EnsureLookupAsync(
        NpgsqlConnection conn, NpgsqlTransaction tx, string table, string code, string name,
        string extraColumn, object extraValue)
    {
        var existing = await conn.ExecuteScalarAsync<int?>(
            $"SELECT id FROM {table} WHERE code = @code", new { code }, tx);

        if (existing is not null) return existing.Value;

        return await conn.ExecuteScalarAsync<int>($"""
            INSERT INTO {table} (code, name, {extraColumn}) VALUES (@code, @name, @extra)
            RETURNING id
            """, new { code, name, extra = extraValue }, tx);
    }

    /// <summary>
    /// Why a row could not be imported, in a sentence that says what to do.
    ///
    /// Run only for rows that failed, so the extra query costs nothing on a
    /// file that imports cleanly.
    /// </summary>
    private static async Task<string> WhyNotAsync(NpgsqlConnection conn, string dressName, bool createMissing)
    {
        var matches = (await MatchesAsync(conn, null, dressName)).ToList();

        if (matches.Count > 1)
        {
            var options = string.Join(", ", matches.Take(4).Select(m => $"{m.color_name} {m.size_code}"));
            return $"\"{dressName}\" matches {matches.Count} garments ({options}). " +
                   "Choose one on the row, or give the file a colour and size.";
        }

        return createMissing
            ? $"\"{dressName}\" could not be created."
            : $"\"{dressName}\" is not in the catalogue. Choose \"create the product\" to add it.";
    }

    /// <summary>An empty spreadsheet cell is nothing, not an empty string.</summary>
    private static string? Blank(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
