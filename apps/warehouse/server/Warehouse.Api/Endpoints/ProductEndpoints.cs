using Dapper;
using Microsoft.AspNetCore.Http.Features;
using Npgsql;
using Warehouse.Api.Data;
using Warehouse.Api.Services;

namespace Warehouse.Api.Endpoints;

public static class ProductEndpoints
{
    /// <summary>
    /// Stock for a variant, as one reusable sub-select.
    ///
    /// "How many can I sell" is not a count of rows in `items`: a garment that
    /// is allocated to an order is still in the building but is already
    /// somebody else's, and a dropship variant has no rows at all and its stock
    /// is a number the supplier gave us. Getting this wrong oversells, so it is
    /// written once here and joined everywhere rather than retyped per query.
    /// </summary>
    private const string StockJoin = """
        LEFT JOIN (
              SELECT variant_id,
                     COUNT(*) FILTER (WHERE status = 'in_stock')  AS in_stock,
                     COUNT(*) FILTER (WHERE status = 'allocated') AS allocated,
                     COUNT(*) FILTER (WHERE status = 'shipped')   AS shipped,
                     COUNT(*) FILTER (WHERE status IN ('damaged','lost','written_off')) AS out_of_play,
                     SUM(CASE WHEN status IN ('in_stock','allocated') THEN cost_price ELSE 0 END) AS stock_value
                FROM items
               GROUP BY variant_id
        ) st ON st.variant_id = v.id
        """;

    /// <summary>
    /// The cover photo of a product: its lowest sort_order, as a URL, or null.
    /// A correlated sub-select rather than a join so a product with six photos
    /// is still one row in a list.
    /// </summary>
    private const string CoverPhoto = """
        (SELECT '/uploads/products/' || ph.file_name
           FROM product_photos ph
          WHERE ph.product_id = p.id
          ORDER BY ph.sort_order, ph.id
          LIMIT 1)
        """;

    /// <summary>How many products search by photo offers, closest first.</summary>
    private const int PhotoMatchesShown = 8;

    /// <summary>
    /// Below this nothing in the catalogue looks like the photo at all - a photo
    /// of a floor or a cardboard box. Different outfits photographed the same
    /// way still score well above it, which is why it is not used to judge
    /// between them.
    /// </summary>
    private const float NothingAlike = 0.40f;

    /// <summary>
    /// How far ahead the closest product must be to be called the match rather
    /// than one of several close ones. Measured on the shop's own photos: a
    /// right answer led the next product by 0.07 to 0.33.
    /// </summary>
    private const float ClearLead = 0.05f;

    /// <summary>
    /// How close the first product must be before it is called the match at all.
    /// A dress that is not in the catalogue still resembles the nearest suit in
    /// it: the main photos of all 294 inaayastore.com listings that are not in
    /// the catalogue scored up to 0.846 against its 15 products, some well ahead
    /// of the next product, while screenshots and photos of a screen showing a
    /// stocked garment mostly scored 0.88 to 0.97. Below this the answer is
    /// "these look closest" with the right product usually first, never "this is it".
    /// </summary>
    private const float SureMatch = 0.87f;

    /// <summary>When it is not sure, at least this many are offered, so there is something to compare.</summary>
    private const int UnsureChoices = 3;

    /// <summary>
    /// How far behind the closest product another may be and still be offered.
    /// When the first is plainly the garment, products well behind it are only
    /// clutter; when several are close, they all stay. On the shop's photos a
    /// right answer that did not come first was never more than 0.05 behind.
    /// </summary>
    private const float CloseToBest = 0.15f;

    /// <summary>The columns a product card needs, for the search and search by photo alike.</summary>
    private const string CardColumns = $"""
        p.id, p.sku, p.name, p.description, p.stock_type,
        p.sale_price, p.cost_price,
        p.category_id, cat.name AS category_name,
        {CoverPhoto} AS photo_url,
        (SELECT COUNT(*) FROM product_photos ph WHERE ph.product_id = p.id) AS photo_count
        """;

    public static void MapProducts(this IEndpointRouteBuilder app, Db db, PhotoStore photos, PhotoMatcher matcher)
    {
        var g = app.MapGroup("/api/products").RequireAuthorization();

        g.MapGet("/", async (HttpContext ctx) =>
        {
            var search = ctx.Request.Query["search"].ToString().Trim();
            var categoryId = int.TryParse(ctx.Request.Query["categoryId"], out var c) ? c : (int?)null;
            var stockType = ctx.Request.Query["stockType"].ToString();

            await using var conn = await db.OpenAsync();

            var products = await conn.QueryAsync($"""
                SELECT p.id, p.sku, p.name, p.description, p.stock_type, p.supplier,
                       p.cost_price, p.sale_price, p.active, p.created_at,
                       p.category_id, cat.name AS category_name,
                       COUNT(DISTINCT v.id)                  AS variant_count,
                       COALESCE(SUM(st.in_stock), 0)         AS in_stock,
                       COALESCE(SUM(st.allocated), 0)        AS allocated,
                       COALESCE(SUM(st.stock_value), 0)      AS stock_value,
                       COALESCE(SUM(v.dropship_qty), 0)      AS dropship_qty,
                       {CoverPhoto}                          AS photo_url,
                       (SELECT COUNT(*) FROM product_photos ph WHERE ph.product_id = p.id) AS photo_count
                  FROM products p
                  JOIN categories cat ON cat.id = p.category_id
                  LEFT JOIN variants v ON v.product_id = p.id AND v.active = 1
                  {StockJoin}
                 WHERE (@search = '' OR p.name ILIKE @like OR p.sku ILIKE @like OR cat.name ILIKE @like)
                   AND (@categoryId::int IS NULL OR p.category_id = @categoryId)
                   AND (@stockType = '' OR p.stock_type = @stockType)
                 GROUP BY p.id, cat.name
                 ORDER BY p.active DESC, lower(p.name)
                """,
                new { search, like = $"%{search}%", categoryId, stockType });

            return Results.Ok(new { products });
        });

        g.MapGet("/{id:int}", async (int id) =>
        {
            await using var conn = await db.OpenAsync();

            var product = await conn.QueryFirstOrDefaultAsync("""
                SELECT p.id, p.sku, p.name, p.description, p.stock_type, p.supplier,
                       p.cost_price, p.sale_price, p.active, p.created_at,
                       p.category_id, cat.name AS category_name
                  FROM products p
                  JOIN categories cat ON cat.id = p.category_id
                 WHERE p.id = @id
                """, new { id })
                ?? throw ApiException.NotFound($"Product {id} was not found.");

            var variants = await conn.QueryAsync($"""
                SELECT v.id, v.sku, v.color_id, v.size_id, v.dropship_qty, v.reorder_level, v.active,
                       COALESCE(v.cost_price, p.cost_price) AS cost_price,
                       COALESCE(v.sale_price, p.sale_price) AS sale_price,
                       v.cost_price AS cost_override, v.sale_price AS sale_override,
                       col.name AS color_name, col.hex AS color_hex,
                       sz.name  AS size_name,  sz.code AS size_code, sz.sort_order,
                       COALESCE(st.in_stock, 0)    AS in_stock,
                       COALESCE(st.allocated, 0)   AS allocated,
                       COALESCE(st.shipped, 0)     AS shipped,
                       COALESCE(st.out_of_play, 0) AS out_of_play,
                       COALESCE(st.stock_value, 0) AS stock_value
                  FROM variants v
                  JOIN products p ON p.id = v.product_id
                  JOIN colors col ON col.id = v.color_id
                  JOIN sizes  sz  ON sz.id  = v.size_id
                  {StockJoin}
                 WHERE v.product_id = @id
                 ORDER BY lower(col.name), sz.sort_order
                """, new { id });

            var productPhotos = await PhotosOfAsync(conn, id);

            // What deleting it would take with it, and whether it can be deleted
            // at all: not once it has been on an order. See the DELETE below.
            var usage = await conn.QueryFirstAsync("""
                SELECT (SELECT COUNT(*) FROM items i JOIN variants v ON v.id = i.variant_id
                         WHERE v.product_id = @id) AS garments,
                       (SELECT COUNT(DISTINCT bl.batch_id) FROM batch_lines bl JOIN variants v ON v.id = bl.variant_id
                         WHERE v.product_id = @id) AS intakes,
                       (SELECT COUNT(DISTINCT ol.order_id) FROM order_lines ol JOIN variants v ON v.id = ol.variant_id
                         WHERE v.product_id = @id) AS orders
                """, new { id });

            return Results.Ok(new { product, variants, photos = productPhotos, usage });
        });

        g.MapPost("/", async (HttpContext ctx, ProductRequest req) =>
        {
            ctx.RequireRole("admin");

            if (string.IsNullOrWhiteSpace(req.Name))
                throw ApiException.BadRequest("A product needs a name.");
            if (req.StockType is not (null or "stock" or "dropship"))
                throw ApiException.BadRequest("Stock type must be either stock or dropship.");

            await using var conn = await db.OpenAsync();
            await using var tx = await conn.BeginTransactionAsync();

            var category = await conn.QueryFirstOrDefaultAsync<string?>(
                "SELECT code FROM categories WHERE id = @id", new { id = req.CategoryId }, tx)
                ?? throw ApiException.NotFound($"Category {req.CategoryId} was not found.");

            var sku = string.IsNullOrWhiteSpace(req.Sku)
                ? await NextProductSkuAsync(conn, category, tx)
                : req.Sku.Trim().ToUpperInvariant();

            if (await conn.ExecuteScalarAsync<long>(
                    "SELECT COUNT(*) FROM products WHERE sku = @sku", new { sku }, tx) > 0)
                throw ApiException.Conflict($"There is already a product with the code {sku}.");

            var id = await conn.ExecuteScalarAsync<int>("""
                INSERT INTO products (sku, name, category_id, description, stock_type,
                                      supplier, cost_price, sale_price)
                VALUES (@sku, @name, @categoryId, @description, @stockType,
                        @supplier, @costPrice, @salePrice)
                RETURNING id
                """,
                new
                {
                    sku,
                    name = req.Name.Trim(),
                    categoryId = req.CategoryId,
                    description = req.Description,
                    stockType = req.StockType ?? "stock",
                    supplier = req.Supplier,
                    costPrice = req.CostPrice,
                    salePrice = req.SalePrice,
                }, tx);

            await tx.CommitAsync();
            return Results.Json(new { ok = true, id, sku }, statusCode: 201);
        });

        g.MapPatch("/{id:int}", async (HttpContext ctx, int id, ProductRequest req) =>
        {
            ctx.RequireRole("admin");
            await using var conn = await db.OpenAsync();

            // Switching a product that has tagged garments to dropship would
            // orphan them: dropship stock has no tags and no room, so the items
            // would exist with nothing able to sell them.
            if (req.StockType == "dropship")
            {
                var tagged = await conn.ExecuteScalarAsync<long>("""
                    SELECT COUNT(*) FROM items i JOIN variants v ON v.id = i.variant_id
                     WHERE v.product_id = @id AND i.status IN ('in_stock','allocated')
                    """, new { id });
                if (tagged > 0)
                    throw ApiException.Conflict(
                        $"This product has {tagged} tagged garment(s) in the warehouse, so it cannot become a dropship product.");
            }

            var n = await conn.ExecuteAsync("""
                UPDATE products
                   SET name        = COALESCE(@name, name),
                       category_id = COALESCE(@categoryId, category_id),
                       description = @description,
                       stock_type  = COALESCE(@stockType, stock_type),
                       supplier    = @supplier,
                       cost_price  = @costPrice,
                       sale_price  = @salePrice
                 WHERE id = @id
                """,
                new
                {
                    id,
                    name = string.IsNullOrWhiteSpace(req.Name) ? null : req.Name.Trim(),
                    categoryId = req.CategoryId == 0 ? (int?)null : req.CategoryId,
                    description = req.Description,
                    stockType = req.StockType,
                    supplier = req.Supplier,
                    costPrice = req.CostPrice,
                    salePrice = req.SalePrice,
                });

            if (n == 0) throw ApiException.NotFound($"Product {id} was not found.");
            return Results.Ok(new { ok = true });
        });

        g.MapPatch("/{id:int}/active", async (HttpContext ctx, int id, ActiveRequest req) =>
        {
            ctx.RequireRole("admin");
            await using var conn = await db.OpenAsync();
            var n = await conn.ExecuteAsync(
                "UPDATE products SET active = @active WHERE id = @id", new { id, active = (short)req.Active });
            if (n == 0) throw ApiException.NotFound($"Product {id} was not found.");
            return Results.Ok(new { ok = true });
        });

        // Deleting a product, for one that should never have been made: a test,
        // a duplicate, a mistake. Everything booked against it goes with it - its
        // colours and sizes, its photos, and the garments tagged onto it, whose
        // tags are then free to be booked in as something else. An intake left
        // with nothing on it goes too.
        //
        // Not once any of it has been on an order. That is a sale: the order, its
        // totals and the returns desk all still need to know what was sold.
        // Switching the product off hides it everywhere new work starts instead.
        g.MapDelete("/{id:int}", async (HttpContext ctx, int id) =>
        {
            ctx.RequireRole("admin");

            await using var conn = await db.OpenAsync();
            await using var tx = await conn.BeginTransactionAsync();

            var product = await conn.QueryFirstOrDefaultAsync(
                "SELECT id, sku FROM products WHERE id = @id FOR UPDATE", new { id }, tx)
                ?? throw ApiException.NotFound($"Product {id} was not found.");
            var sku = (string)product.sku;

            var orders = await conn.ExecuteScalarAsync<long>("""
                SELECT COUNT(DISTINCT ol.order_id)
                  FROM order_lines ol JOIN variants v ON v.id = ol.variant_id
                 WHERE v.product_id = @id
                """, new { id }, tx);

            if (orders > 0)
                throw ApiException.Conflict(
                    $"{sku} is on {orders} order{(orders == 1 ? "" : "s")}, so it cannot be deleted: " +
                    "the order history needs it. Switch it off instead to hide it.");

            var photoFiles = (await conn.QueryAsync<string>(
                "SELECT file_name FROM product_photos WHERE product_id = @id", new { id }, tx)).ToList();

            var batchIds = (await conn.QueryAsync<int>("""
                SELECT DISTINCT bl.batch_id
                  FROM batch_lines bl JOIN variants v ON v.id = bl.variant_id
                 WHERE v.product_id = @id
                """, new { id }, tx)).ToArray();

            // The garments, and everything that points at them, before the
            // colours and sizes they belong to.
            await conn.ExecuteAsync("""
                DELETE FROM find_requests fr
                 USING items i, variants v
                 WHERE i.id = fr.item_id AND v.id = i.variant_id AND v.product_id = @id
                """, new { id }, tx);

            await conn.ExecuteAsync("""
                DELETE FROM movements m
                 USING items i, variants v
                 WHERE i.id = m.item_id AND v.id = i.variant_id AND v.product_id = @id
                """, new { id }, tx);

            var garments = await conn.ExecuteAsync("""
                DELETE FROM items i
                 USING variants v
                 WHERE v.id = i.variant_id AND v.product_id = @id
                """, new { id }, tx);

            await conn.ExecuteAsync("""
                DELETE FROM batch_lines bl
                 USING variants v
                 WHERE v.id = bl.variant_id AND v.product_id = @id
                """, new { id }, tx);

            var intakes = batchIds.Length == 0 ? 0 : await conn.ExecuteAsync("""
                DELETE FROM batches
                 WHERE id = ANY(@batchIds)
                   AND NOT EXISTS (SELECT 1 FROM batch_lines bl WHERE bl.batch_id = batches.id)
                """, new { batchIds }, tx);

            // The colours, sizes and photo rows go with it.
            await conn.ExecuteAsync("DELETE FROM products WHERE id = @id", new { id }, tx);
            await tx.CommitAsync();

            // Only once the rows are gone for good: a delete that failed must not
            // leave behind a product whose photos have vanished.
            foreach (var file in photoFiles) photos.Delete(file);

            return Results.Ok(new { ok = true, sku, garments, intakes, photos = photoFiles.Count });
        });

        // ------------------------------------------------------------ with stock

        // A new product, its colours and sizes, and what arrived of each, in one
        // transaction. For a stock product the quantities become an open intake,
        // which is what the handheld's "Book stock in" lists - so the moment this
        // returns, the garments are waiting on the C72 to be tagged.
        g.MapPost("/with-stock", async (HttpContext ctx, ProductWithStockRequest req) =>
        {
            var me = ctx.RequireRole("admin");

            if (string.IsNullOrWhiteSpace(req.Name))
                throw ApiException.BadRequest("A product needs a name.");
            if (req.StockType is not (null or "stock" or "dropship"))
                throw ApiException.BadRequest("Stock type must be either stock or dropship.");
            if (req.Lines is not { Length: > 0 })
                throw ApiException.BadRequest("Choose at least one colour and one size.");
            if (req.CostPrice < 0 || req.SalePrice < 0)
                throw ApiException.BadRequest("A price cannot be negative.");

            foreach (var line in req.Lines)
            {
                if (line.Quantity < 0)
                    throw ApiException.BadRequest("A quantity cannot be negative.");
                if (line.Quantity > 100_000)
                    throw ApiException.BadRequest("A quantity above 100,000 is almost certainly a typing slip.");
            }

            var stockType = req.StockType ?? "stock";

            // The same colour and size twice is one line, not two variants and
            // a unique-key failure. The grid cannot send it, but a script can.
            var lines = req.Lines
                .GroupBy(l => (l.ColorId, l.SizeId))
                .Select(g => (g.Key.ColorId, g.Key.SizeId, Quantity: g.Sum(l => l.Quantity)))
                .ToList();

            await using var conn = await db.OpenAsync();
            await using var tx = await conn.BeginTransactionAsync();

            var categoryCode = await conn.ExecuteScalarAsync<string?>(
                "SELECT code FROM categories WHERE id = @id AND active = 1", new { id = req.CategoryId }, tx)
                ?? throw ApiException.NotFound("Choose a category that still exists.");

            var colorIds = lines.Select(l => l.ColorId).Distinct().ToArray();
            var sizeIds = lines.Select(l => l.SizeId).Distinct().ToArray();

            var codes = (await conn.QueryAsync("""
                SELECT 'color' AS kind, id, code FROM colors WHERE id = ANY(@colors) AND active = 1
                UNION ALL
                SELECT 'size' AS kind, id, code FROM sizes WHERE id = ANY(@sizes) AND active = 1
                """, new { colors = colorIds, sizes = sizeIds }, tx))
                .ToDictionary(r => ((string)r.kind, (int)r.id), r => (string)r.code);

            foreach (var (colorId, sizeId, _) in lines)
            {
                if (!codes.ContainsKey(("color", colorId)) || !codes.ContainsKey(("size", sizeId)))
                    throw ApiException.BadRequest(
                        "One of those colours or sizes has been switched off or removed. Reopen the form and choose again.");
            }

            var sku = await NextProductSkuAsync(conn, categoryCode, tx);

            var productId = await conn.ExecuteScalarAsync<int>("""
                INSERT INTO products (sku, name, category_id, description, stock_type,
                                      supplier, cost_price, sale_price)
                VALUES (@sku, @name, @categoryId, @description, @stockType,
                        @supplier, @costPrice, @salePrice)
                RETURNING id
                """,
                new
                {
                    sku,
                    name = req.Name.Trim(),
                    categoryId = req.CategoryId,
                    description = string.IsNullOrWhiteSpace(req.Description) ? null : req.Description.Trim(),
                    stockType,
                    supplier = string.IsNullOrWhiteSpace(req.Supplier) ? null : req.Supplier.Trim(),
                    costPrice = req.CostPrice,
                    salePrice = req.SalePrice,
                }, tx);

            var variantIds = new List<(int VariantId, int Quantity)>();
            foreach (var (colorId, sizeId, quantity) in lines)
            {
                var variantId = await conn.ExecuteScalarAsync<int>("""
                    INSERT INTO variants (product_id, color_id, size_id, sku, dropship_qty)
                    VALUES (@productId, @colorId, @sizeId, @variantSku, @dropshipQty)
                    RETURNING id
                    """,
                    new
                    {
                        productId,
                        colorId,
                        sizeId,
                        variantSku = $"{sku}-{codes[("color", colorId)]}-{codes[("size", sizeId)]}",
                        // A dropship product is never tagged: what the supplier
                        // can send is simply a number on the colour and size.
                        dropshipQty = stockType == "dropship" ? quantity : 0,
                    }, tx);

                variantIds.Add((variantId, quantity));
            }

            var total = lines.Sum(l => l.Quantity);
            int? batchId = null;
            string? batchNo = null;

            if (stockType == "stock" && total > 0)
            {
                // Goods-in unless told otherwise: that is the room a delivery
                // is unpacked in, and a garment tagged into no room at all is
                // one the move and find screens cannot place.
                var roomId = req.RoomId ?? await conn.ExecuteScalarAsync<int?>(
                    "SELECT id FROM rooms WHERE kind = 'receiving' AND active = 1 ORDER BY id LIMIT 1",
                    null, tx);

                batchNo = await Ref.NextAsync(conn, tx, "batches", "batch_no", "BAT");
                batchId = await conn.ExecuteScalarAsync<int>("""
                    INSERT INTO batches (batch_no, supplier, room_id, notes, created_by)
                    VALUES (@batchNo, @supplier, @roomId, @notes, @userId)
                    RETURNING id
                    """,
                    new
                    {
                        batchNo,
                        supplier = string.IsNullOrWhiteSpace(req.Supplier) ? null : req.Supplier.Trim(),
                        roomId,
                        notes = $"New product {sku}",
                        userId = me.Id,
                    }, tx);

                foreach (var (variantId, quantity) in variantIds.Where(v => v.Quantity > 0))
                {
                    await conn.ExecuteAsync("""
                        INSERT INTO batch_lines (batch_id, variant_id, quantity, unit_cost)
                        VALUES (@batchId, @variantId, @quantity, @cost)
                        """,
                        new { batchId, variantId, quantity, cost = req.CostPrice }, tx);
                }
            }

            await tx.CommitAsync();

            return Results.Json(new
            {
                ok = true,
                id = productId,
                sku,
                variants = variantIds.Count,
                total,
                batchId,
                batchNo,
            }, statusCode: 201);
        });

        // ------------------------------------------------------------ photos

        g.MapPost("/{id:int}/photos", async (HttpContext ctx, int id) =>
        {
            ctx.RequireRole("admin");

            if (!ctx.Request.HasFormContentType)
                throw ApiException.BadRequest("Send the photos as a file upload.");

            // Twelve photos of 10 MB each is more than the server takes in one
            // request by default, so the limit is raised for this request alone
            // - before anything reads the body, after which it cannot change.
            var bodyLimit = ctx.Features.Get<IHttpMaxRequestBodySizeFeature>();
            if (bodyLimit is { IsReadOnly: false })
                bodyLimit.MaxRequestBodySize = PhotoStore.MaxUploadBytes;

            if (ctx.Request.ContentLength > PhotoStore.MaxUploadBytes)
                throw TooMuchToUpload();

            // Read by hand rather than bound as IFormFile parameters. A bound
            // IFormFile makes ASP.NET Core demand antiforgery middleware, and
            // this API's cross-site protection is the origin check in Program.cs.
            IFormCollection form;
            try
            {
                form = await ctx.Request.ReadFormAsync(ctx.RequestAborted);
            }
            catch (BadHttpRequestException ex) when (ex.StatusCode == StatusCodes.Status413PayloadTooLarge)
            {
                // Sent without a length up front, so only found out part-way.
                throw TooMuchToUpload();
            }
            catch (InvalidDataException)
            {
                throw ApiException.BadRequest("The upload arrived incomplete. Choose the photos and try again.");
            }

            var files = form.Files;

            if (files.Count == 0)
                throw ApiException.BadRequest("Choose at least one photo.");
            if (files.Count > PhotoStore.MaxFilesPerUpload)
                throw ApiException.BadRequest($"Up to {PhotoStore.MaxFilesPerUpload} photos at a time.");

            await using var conn = await db.OpenAsync();

            if (await conn.ExecuteScalarAsync<long>(
                    "SELECT COUNT(*) FROM products WHERE id = @id", new { id }) == 0)
                throw ApiException.NotFound($"Product {id} was not found.");

            // All or nothing. If the fourth file of five is not a photo, the
            // three already written are removed again, so an upload never
            // leaves a product with some of what somebody chose.
            var saved = new List<string>();
            try
            {
                foreach (var file in files)
                    saved.Add(await photos.SaveAsync(file, ctx.RequestAborted));

                // Each one read back as a picture. The right first bytes do not
                // make a readable photo - a download cut off halfway has them
                // too - and a photo nobody can see is no use on a product. The
                // same reading is what search by photo compares against.
                var embeddings = new List<byte[]?>();
                for (var i = 0; i < saved.Count; i++)
                {
                    var fileName = saved[i];
                    var reading = await Task.Run(() => PhotoIndex.Read(photos, matcher, fileName), ctx.RequestAborted);
                    if (!reading.Readable)
                        throw ApiException.BadRequest(
                            $"{files[i].FileName} could not be read as a picture. It may be damaged - try saving it again.");
                    embeddings.Add(reading.Embedding);
                }

                await using var tx = await conn.BeginTransactionAsync();

                var next = await conn.ExecuteScalarAsync<int?>(
                    "SELECT MAX(sort_order) FROM product_photos WHERE product_id = @id", new { id }, tx) ?? -1;

                for (var i = 0; i < saved.Count; i++)
                {
                    next++;
                    await conn.ExecuteAsync("""
                        INSERT INTO product_photos (product_id, file_name, sort_order, embedding, embedding_model)
                        VALUES (@id, @fileName, @next, @embedding, @model)
                        """,
                        new
                        {
                            id,
                            fileName = saved[i],
                            next,
                            embedding = embeddings[i],
                            model = embeddings[i] is null ? null : PhotoMatcher.ModelName,
                        }, tx);
                }

                await tx.CommitAsync();
            }
            catch
            {
                foreach (var fileName in saved) photos.Delete(fileName);
                throw;
            }

            return Results.Json(new
            {
                ok = true,
                added = saved.Count,
                photos = await PhotosOfAsync(conn, id),
            }, statusCode: 201);
        });

        g.MapDelete("/{id:int}/photos/{photoId:int}", async (HttpContext ctx, int id, int photoId) =>
        {
            ctx.RequireRole("admin");
            await using var conn = await db.OpenAsync();

            var fileName = await conn.ExecuteScalarAsync<string?>(
                "SELECT file_name FROM product_photos WHERE id = @photoId AND product_id = @id",
                new { id, photoId })
                ?? throw ApiException.NotFound("That photo was not found.");

            await conn.ExecuteAsync("DELETE FROM product_photos WHERE id = @photoId", new { photoId });
            photos.Delete(fileName);

            return Results.Ok(new { ok = true, photos = await PhotosOfAsync(conn, id) });
        });

        // The cover is simply whichever photo sorts first.
        g.MapPost("/{id:int}/photos/{photoId:int}/cover", async (HttpContext ctx, int id, int photoId) =>
        {
            ctx.RequireRole("admin");
            await using var conn = await db.OpenAsync();

            var n = await conn.ExecuteAsync("""
                UPDATE product_photos
                   SET sort_order = (SELECT COALESCE(MIN(sort_order), 0) - 1
                                       FROM product_photos WHERE product_id = @id)
                 WHERE id = @photoId AND product_id = @id
                """, new { id, photoId });

            if (n == 0) throw ApiException.NotFound("That photo was not found.");
            return Results.Ok(new { ok = true, photos = await PhotosOfAsync(conn, id) });
        });

        // ------------------------------------------------------------ search

        // The product search the office and the handheld share: each product
        // with its cover photo and every colour and size under it, with how many
        // are on a shelf - which is what somebody holding a customer's order
        // needs in order to decide which one to go and find.
        //
        // An empty search is the newest products rather than nothing, so the
        // handheld's screen opens on something to look at.
        g.MapGet("/search", async (HttpContext ctx) =>
        {
            var q = ctx.Request.Query["q"].ToString().Trim();
            var like = $"%{q}%";

            await using var conn = await db.OpenAsync();

            var products = (await conn.QueryAsync($"""
                SELECT {CardColumns}
                  FROM products p
                  JOIN categories cat ON cat.id = p.category_id
                 WHERE p.active = 1
                   AND (@q = ''
                        OR p.name ILIKE @like OR p.sku ILIKE @like OR cat.name ILIKE @like
                        OR EXISTS (SELECT 1 FROM variants v
                                     JOIN colors col ON col.id = v.color_id
                                    WHERE v.product_id = p.id AND v.active = 1
                                      AND (v.sku ILIKE @like OR col.name ILIKE @like)))
                 ORDER BY (@q <> '' AND p.name ILIKE @starts) DESC,
                          CASE WHEN @q = '' THEN p.id END DESC NULLS LAST,
                          lower(p.name)
                 LIMIT 60
                """, new { q, like, starts = $"{q}%" })).ToList();

            return Results.Ok(new { products = await CardsAsync(conn, products) });
        });

        // Search by photo: the products that look most like a picture somebody
        // has - a customer's screenshot, or a photo taken on the handheld of a
        // garment with no tag to read - closest first, each shaped exactly like
        // the search above so the same cards and "Find" buttons show it.
        //
        // Several are offered rather than one answer, because two outfits in the
        // same cut and embroidery can look nearly alike. `clearMatch` says
        // whether the first is far enough ahead to be called the match.
        g.MapPost("/search-by-photo", async (HttpContext ctx) =>
        {
            ctx.RequireUser();

            if (!matcher.Available)
                throw new ApiException(StatusCodes.Status503ServiceUnavailable, "photo_search_off", matcher.Problem!);

            if (!ctx.Request.HasFormContentType)
                throw ApiException.BadRequest("Send the photo as a file upload.");

            var limit = PhotoStore.MaxBytes + 1024 * 1024;
            var bodyLimit = ctx.Features.Get<IHttpMaxRequestBodySizeFeature>();
            if (bodyLimit is { IsReadOnly: false }) bodyLimit.MaxRequestBodySize = limit;

            var tooLarge = new ApiException(StatusCodes.Status413PayloadTooLarge, "too_large",
                $"A photo to search with can be up to {PhotoStore.Megabytes(PhotoStore.MaxBytes)}.");
            if (ctx.Request.ContentLength > limit) throw tooLarge;

            IFormCollection form;
            try
            {
                form = await ctx.Request.ReadFormAsync(ctx.RequestAborted);
            }
            catch (BadHttpRequestException ex) when (ex.StatusCode == StatusCodes.Status413PayloadTooLarge)
            {
                throw tooLarge;
            }
            catch (InvalidDataException)
            {
                throw ApiException.BadRequest("The upload arrived incomplete. Choose the photo and try again.");
            }

            var file = form.Files.FirstOrDefault()
                ?? throw ApiException.BadRequest("Choose a photo to search with.");
            if (file.Length == 0)
                throw ApiException.BadRequest($"{file.FileName} is empty.");
            if (file.Length > PhotoStore.MaxBytes)
                throw ApiException.BadRequest(
                    $"{file.FileName} is {PhotoStore.Megabytes(file.Length)}. A photo to search with can be up to {PhotoStore.Megabytes(PhotoStore.MaxBytes)}.");

            byte[] bytes;
            await using (var stream = file.OpenReadStream())
            {
                using var memory = new MemoryStream((int)file.Length);
                await stream.CopyToAsync(memory, ctx.RequestAborted);
                bytes = memory.ToArray();
            }

            if (PhotoStore.ExtensionOf(bytes.AsSpan(0, Math.Min(12, bytes.Length))) is null)
                throw ApiException.BadRequest($"{file.FileName} is not a photo. Use a JPEG, PNG or WebP image.");

            var views = await Task.Run(() =>
            {
                using var picture = PhotoMatcher.Decode(bytes)
                    ?? throw ApiException.BadRequest($"{file.FileName} could not be read as a picture.");
                return matcher.EmbedForSearch(picture);
            }, ctx.RequestAborted);

            await using var conn = await db.OpenAsync();

            var stored = await conn.QueryAsync<(int ProductId, byte[] Embedding)>("""
                SELECT ph.product_id, ph.embedding
                  FROM product_photos ph
                  JOIN products p ON p.id = ph.product_id
                 WHERE p.active = 1 AND ph.embedding IS NOT NULL AND ph.embedding_model = @model
                """, new { model = PhotoMatcher.ModelName });

            // A product is as close as its closest photo.
            var closest = new Dictionary<int, float>();
            foreach (var (productId, embedding) in stored)
            {
                var vector = PhotoMatcher.FromBytes(embedding);
                var score = views.Max(view => PhotoMatcher.Similarity(view, vector));
                if (!closest.TryGetValue(productId, out var best) || score > best) closest[productId] = score;
            }

            var ranked = closest
                .Where(c => c.Value >= NothingAlike)
                .OrderByDescending(c => c.Value)
                .ToList();

            // Judged on everything alike, before any is left out below: close
            // enough to be the garment, and plainly ahead of the next product.
            var clearMatch = ranked.Count > 0
                && ranked[0].Value >= SureMatch
                && (ranked.Count == 1 || ranked[0].Value - ranked[1].Value >= ClearLead);

            if (ranked.Count > 0)
            {
                var floor = ranked[0].Value - CloseToBest;
                ranked = ranked
                    .Where((c, i) => c.Value >= floor || (!clearMatch && i < UnsureChoices))
                    .Take(PhotoMatchesShown)
                    .ToList();
            }

            var cards = new List<Dictionary<string, object?>>();
            if (ranked.Count > 0)
            {
                var ids = ranked.Select(r => r.Key).ToArray();
                var rows = (await conn.QueryAsync($"""
                    SELECT {CardColumns}
                      FROM products p
                      JOIN categories cat ON cat.id = p.category_id
                     WHERE p.id = ANY(@ids)
                    """, new { ids })).ToList();

                var byId = (await CardsAsync(conn, rows)).ToDictionary(c => (int)c["id"]!);
                foreach (var (productId, score) in ranked)
                {
                    if (!byId.TryGetValue(productId, out var card)) continue;
                    card["match"] = Math.Round(score, 3);
                    cards.Add(card);
                }
            }

            var counts = await conn.QueryFirstAsync("""
                SELECT (SELECT COUNT(*) FROM products WHERE active = 1) AS active,
                       (SELECT COUNT(DISTINCT ph.product_id)
                          FROM product_photos ph JOIN products p ON p.id = ph.product_id
                         WHERE p.active = 1) AS with_photos,
                       (SELECT COUNT(*) FROM product_photos
                         WHERE embedding IS NULL OR embedding_model IS NULL OR embedding_model <> @model) AS unread
                """, new { model = PhotoMatcher.ModelName });

            return Results.Ok(new
            {
                products = cards,
                clearMatch,
                // So the screen can say why a product it expected is not here.
                productsWithoutPhotos = Convert.ToInt32(counts.active) - Convert.ToInt32(counts.with_photos),
                photosNotReadYet = Convert.ToInt32(counts.unread),
            });
        });

        // ------------------------------------------------------------ variants

        // Colours times sizes, in one call. Anything that already exists is
        // skipped rather than rejected, so this doubles as "add navy to this
        // product" without the caller having to work out what is missing.
        g.MapPost("/{id:int}/variants", async (HttpContext ctx, int id, VariantGridRequest req) =>
        {
            ctx.RequireRole("admin");

            if (req.ColorIds is not { Length: > 0 } || req.SizeIds is not { Length: > 0 })
                throw ApiException.BadRequest("Choose at least one colour and one size.");

            await using var conn = await db.OpenAsync();

            var product = await conn.QueryFirstOrDefaultAsync(
                "SELECT id, sku FROM products WHERE id = @id", new { id })
                ?? throw ApiException.NotFound($"Product {id} was not found.");

            var codes = (await conn.QueryAsync("""
                SELECT 'color' AS kind, id, code FROM colors WHERE id = ANY(@colors)
                UNION ALL
                SELECT 'size' AS kind, id, code FROM sizes WHERE id = ANY(@sizes)
                """, new { colors = req.ColorIds, sizes = req.SizeIds }))
                .ToDictionary(r => ((string)r.kind, (int)r.id), r => (string)r.code);

            var added = 0;
            var existing = 0;

            await using var tx = await conn.BeginTransactionAsync();

            foreach (var colorId in req.ColorIds.Distinct())
            foreach (var sizeId in req.SizeIds.Distinct())
            {
                if (!codes.TryGetValue(("color", colorId), out var colorCode)
                    || !codes.TryGetValue(("size", sizeId), out var sizeCode))
                    throw ApiException.BadRequest("One of those colours or sizes no longer exists.");

                var already = await conn.ExecuteScalarAsync<long>("""
                    SELECT COUNT(*) FROM variants
                     WHERE product_id = @id AND color_id = @colorId AND size_id = @sizeId
                    """, new { id, colorId, sizeId }, tx);

                if (already > 0) { existing++; continue; }

                await conn.ExecuteAsync("""
                    INSERT INTO variants (product_id, color_id, size_id, sku)
                    VALUES (@id, @colorId, @sizeId, @sku)
                    """,
                    new { id, colorId, sizeId, sku = $"{(string)product.sku}-{colorCode}-{sizeCode}" }, tx);

                added++;
            }

            await tx.CommitAsync();
            return Results.Ok(new { ok = true, added, existing });
        });
    }

    public static void MapVariants(this IEndpointRouteBuilder app, Db db)
    {
        var g = app.MapGroup("/api/variants").RequireAuthorization();

        // The picker behind every "choose a garment" box in the dashboard and
        // on the handheld. One flat, searchable list with stock on it, because
        // the question being answered is always "which one, and have we got any".
        g.MapGet("/", async (HttpContext ctx) =>
        {
            var search = ctx.Request.Query["search"].ToString().Trim();
            var inStockOnly = ctx.Request.Query["inStock"] == "1";
            // One colour and size by its id, for "Book more in".
            var id = int.TryParse(ctx.Request.Query["id"], out var only) ? only : (int?)null;

            await using var conn = await db.OpenAsync();
            var variants = await conn.QueryAsync($"""
                SELECT v.id, v.sku, v.dropship_qty, v.reorder_level,
                       p.id AS product_id, p.name AS product_name, p.stock_type, p.description,
                       cat.name AS category_name,
                       col.name AS color_name, col.hex AS color_hex,
                       sz.name  AS size_name,  sz.code AS size_code,
                       COALESCE(v.cost_price, p.cost_price) AS cost_price,
                       COALESCE(v.sale_price, p.sale_price) AS sale_price,
                       COALESCE(st.in_stock, 0)  AS in_stock,
                       COALESCE(st.allocated, 0) AS allocated,
                       CASE WHEN p.stock_type = 'dropship'
                            THEN v.dropship_qty ELSE COALESCE(st.in_stock, 0) END AS sellable
                  FROM variants v
                  JOIN products p  ON p.id = v.product_id
                  JOIN categories cat ON cat.id = p.category_id
                  JOIN colors col  ON col.id = v.color_id
                  JOIN sizes  sz   ON sz.id  = v.size_id
                  {StockJoin}
                 WHERE v.active = 1 AND p.active = 1
                   AND (@id::int IS NULL OR v.id = @id)
                   AND (@search = '' OR p.name ILIKE @like OR v.sku ILIKE @like
                        OR col.name ILIKE @like OR cat.name ILIKE @like)
                   AND (@inStockOnly = 0
                        OR CASE WHEN p.stock_type = 'dropship'
                                THEN v.dropship_qty ELSE COALESCE(st.in_stock, 0) END > 0)
                 ORDER BY lower(p.name), lower(col.name), sz.sort_order
                 LIMIT 500
                """,
                new { search, like = $"%{search}%", inStockOnly = inStockOnly ? 1 : 0, id });

            return Results.Ok(new { variants });
        });

        g.MapPatch("/{id:int}", async (HttpContext ctx, int id, VariantRequest req) =>
        {
            ctx.RequireRole("admin");
            await using var conn = await db.OpenAsync();

            var n = await conn.ExecuteAsync("""
                UPDATE variants
                   SET cost_price    = @costPrice,
                       sale_price    = @salePrice,
                       dropship_qty  = COALESCE(@dropshipQty, dropship_qty),
                       reorder_level = COALESCE(@reorderLevel, reorder_level),
                       active        = COALESCE(@active, active)
                 WHERE id = @id
                """,
                new
                {
                    id,
                    costPrice = req.CostPrice,
                    salePrice = req.SalePrice,
                    dropshipQty = req.DropshipQty,
                    reorderLevel = req.ReorderLevel,
                    active = (short?)req.Active,
                });

            if (n == 0) throw ApiException.NotFound($"Variant {id} was not found.");
            return Results.Ok(new { ok = true });
        });

        // Only ever removes a variant nothing has happened to. Once a garment
        // has been tagged or ordered against it, switching it off is the only
        // safe answer — deleting would take the history with it.
        g.MapDelete("/{id:int}", async (HttpContext ctx, int id) =>
        {
            ctx.RequireRole("admin");
            await using var conn = await db.OpenAsync();

            var used = await conn.ExecuteScalarAsync<long>("""
                SELECT (SELECT COUNT(*) FROM items WHERE variant_id = @id)
                     + (SELECT COUNT(*) FROM order_lines WHERE variant_id = @id)
                     + (SELECT COUNT(*) FROM batch_lines WHERE variant_id = @id)
                """, new { id });

            if (used > 0)
                throw ApiException.Conflict(
                    "This colour and size has history, so it cannot be deleted. Switch it off instead.");

            await conn.ExecuteAsync("DELETE FROM variants WHERE id = @id", new { id });
            return Results.Ok(new { ok = true });
        });
    }

    /// <summary>An upload over the limit, said in the terms somebody choosing photos thinks in.</summary>
    private static ApiException TooMuchToUpload() => new(
        StatusCodes.Status413PayloadTooLarge, "too_large",
        $"That is too much to upload at once. Send up to {PhotoStore.MaxFilesPerUpload} photos, " +
        $"up to {PhotoStore.MaxBytes / (1024 * 1024)} MB each.");

    /// <summary>
    /// Product rows as the search shows them: each with every active colour and
    /// size under it and how many of each are on a shelf, in the order given.
    /// </summary>
    private static async Task<List<Dictionary<string, object?>>> CardsAsync(NpgsqlConnection conn, List<dynamic> products)
    {
        var ids = products.Select(p => (int)p.id).ToArray();

        List<dynamic> variants = [];
        if (ids.Length > 0) variants = (await conn.QueryAsync($"""
                SELECT v.id, v.product_id, v.sku,
                       col.name AS color_name, col.hex AS color_hex,
                       sz.code AS size_code, sz.name AS size_name,
                       COALESCE(v.sale_price, p.sale_price) AS sale_price,
                       COALESCE(st.in_stock, 0)  AS in_stock,
                       COALESCE(st.allocated, 0) AS allocated,
                       CASE WHEN p.stock_type = 'dropship'
                            THEN v.dropship_qty ELSE COALESCE(st.in_stock, 0) END AS sellable
                  FROM variants v
                  JOIN products p  ON p.id = v.product_id
                  JOIN colors col  ON col.id = v.color_id
                  JOIN sizes  sz   ON sz.id  = v.size_id
                  {StockJoin}
                 WHERE v.active = 1 AND v.product_id = ANY(@ids)
                 ORDER BY lower(col.name), sz.sort_order
                """, new { ids })).ToList();

        var byProduct = variants.ToLookup(v => (int)v.product_id);

        // Spelled out key by key: the rows are dynamic, and a dictionary is what
        // lets search by photo add how close each one was.
        return products.Select(p => new Dictionary<string, object?>
        {
            ["id"] = (int)p.id,
            ["sku"] = (string)p.sku,
            ["name"] = (string)p.name,
            ["description"] = (string?)p.description,
            ["stock_type"] = (string)p.stock_type,
            ["sale_price"] = (decimal)p.sale_price,
            ["category_id"] = (int)p.category_id,
            ["category_name"] = (string)p.category_name,
            ["photo_url"] = (string?)p.photo_url,
            ["photo_count"] = Convert.ToInt32(p.photo_count),
            ["in_stock"] = byProduct[(int)p.id].Sum(v => Convert.ToInt32(v.in_stock)),
            ["variants"] = byProduct[(int)p.id].ToList(),
        }).ToList();
    }

    /// <summary>A product's photos, cover first, each with the URL to draw it from.</summary>
    internal static async Task<List<object>> PhotosOfAsync(NpgsqlConnection conn, int productId)
    {
        var rows = await conn.QueryAsync(
            "SELECT id, file_name, sort_order FROM product_photos WHERE product_id = @productId ORDER BY sort_order, id",
            new { productId });

        return rows.Select(r => (object)new
        {
            id = (int)r.id,
            url = PhotoStore.UrlFor((string)r.file_name),
            sort_order = (int)r.sort_order,
        }).ToList();
    }

    /// <summary>
    /// SHALWAR-0003: readable, and sorted by when it was added. Inside a
    /// transaction the category's numbers are handed out one caller at a time.
    /// </summary>
    internal static async Task<string> NextProductSkuAsync(
        NpgsqlConnection conn, string categoryCode, NpgsqlTransaction? tx = null)
    {
        var stem = categoryCode + "-";

        if (tx is not null)
            await conn.ExecuteAsync("SELECT pg_advisory_xact_lock(hashtext('sku:' || @stem))", new { stem }, tx);

        var highest = await conn.ExecuteScalarAsync<string?>(
            "SELECT MAX(sku) FROM products WHERE sku LIKE @like", new { like = stem + "%" }, tx);

        var next = 1;
        if (highest is not null && int.TryParse(highest[stem.Length..], out var n)) next = n + 1;
        return stem + next.ToString("D4");
    }
}
