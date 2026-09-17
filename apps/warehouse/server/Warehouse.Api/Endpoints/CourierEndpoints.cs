using System.Text.RegularExpressions;
using Dapper;
using Microsoft.Extensions.Options;
using Npgsql;
using Warehouse.Api.Data;
using Warehouse.Api.Services;

namespace Warehouse.Api.Endpoints;

/// <summary>
/// Booking the J&amp;T courier for a warehouse order - where the two halves of the
/// platform meet.
///
/// Before the integration an order was picked here and then typed again, by
/// hand, into the courier portal to get a waybill; the two systems shared
/// customers but not a single identifier. Now the order books its own parcel:
/// the customer, the address and every line go across, the tracking number
/// comes back and is kept on `shipments`, and from then on the courier's
/// tracking moves the order along (CourierSyncService).
/// </summary>
public static class CourierEndpoints
{
    private static readonly string[] Bookable = ["pending", "allocated", "packed", "shipped"];

    public static void MapCourier(this IEndpointRouteBuilder app, Db db)
    {
        var g = app.MapGroup("/api/orders").RequireAuthorization();

        g.MapPost("/{id:int}/courier", async (
            HttpContext ctx, int id, CourierBookingRequest? req,
            CourierClient courier, IOptions<CourierOptions> options) =>
        {
            var me = ctx.RequireRole("admin", "operator");
            req ??= new CourierBookingRequest(null, null, null, null, null, null, null);

            await using var conn = await db.OpenAsync();

            var order = await conn.QueryFirstOrDefaultAsync("""
                SELECT o.id, o.order_no, o.status, o.customer_name, o.customer_phone, o.address,
                       o.city, o.postal_code, o.payment_type, o.total, o.refunded_total, o.notes
                  FROM orders o WHERE o.id = @id
                """, new { id })
                ?? throw ApiException.NotFound($"Order {id} was not found.");

            var orderNo = (string)order.order_no;

            var existing = await conn.ExecuteScalarAsync<string?>(
                "SELECT tracking_no FROM shipments WHERE order_id = @id", new { id });
            if (existing is not null)
                throw ApiException.Conflict($"Order {orderNo} is already booked with J&T: {existing}.");

            if (!Bookable.Contains((string)order.status))
                throw ApiException.Conflict($"Order {orderNo} is {(string)order.status}, so it cannot be sent by courier.");

            var lines = (await conn.QueryAsync("""
                SELECT ol.quantity, ol.route, p.name AS product_name, col.name AS color_name, sz.code AS size_code
                  FROM order_lines ol
                  JOIN variants v  ON v.id = ol.variant_id
                  JOIN products p  ON p.id = v.product_id
                  JOIN colors col  ON col.id = v.color_id
                  JOIN sizes  sz   ON sz.id  = v.size_id
                 WHERE ol.order_id = @id
                 ORDER BY ol.id
                """, new { id })).ToList();

            if (lines.Count == 0)
                throw ApiException.Conflict($"Order {orderNo} has nothing on it to send.");

            // What the parcel needs that an order may not have been given. Each
            // gap is named, so the form can say exactly what to fill in.
            var phone = Clean(req.Phone) ?? Clean((string?)order.customer_phone);
            var postcode = Digits(Clean(req.Postcode) ?? Clean((string?)order.postal_code));
            var address = Clean(req.Address) ?? Clean((string?)order.address);

            if (phone is null)
                throw ApiException.BadRequest("The courier needs the customer's mobile number. Add it and book again.");
            if (postcode is not { Length: 5 })
                throw ApiException.BadRequest("The courier needs a 5-digit Malaysian postcode for this address.");
            if (address is null || address.Length < 5)
                throw ApiException.BadRequest("The courier needs the delivery address.");

            var units = lines.Sum(l => (int)l.quantity);
            var weight = req.WeightKg ?? Math.Max(0.5m, units * options.Value.DefaultWeightKgPerUnit);
            if (weight is <= 0 or > 30)
                throw ApiException.BadRequest("A J&T parcel weighs more than 0 kg and at most 30 kg.");

            var isCod = (string)order.payment_type == "cod";
            var codAmount = isCod ? Math.Max(0m, (decimal)order.total - (decimal)order.refunded_total) : 0m;
            if (isCod && codAmount <= 0)
                throw ApiException.BadRequest(
                    $"Order {orderNo} is cash on delivery but has nothing left to collect. Mark it paid, or check its total.");

            var items = lines.Select(l => new
            {
                goods_name = Truncate((string)l.product_name, 255),
                item_variant = Truncate($"{(string)l.color_name} {(string)l.size_code}", 32),
                quantity = (int)l.quantity,
                dropship = (string)l.route == "dropship",
            }).ToList();

            var payload = new
            {
                customer_order_no = orderNo,
                receiver_name = Truncate((string)order.customer_name, 60),
                receiver_phone = phone,
                receiver_postcode = postcode,
                receiver_address = Truncate(address, 200),
                // Left for the courier to fill from its post-office list unless
                // somebody corrected them on the booking form: a town name typed
                // into a sales spreadsheet is the commonest cause of "zip code
                // does not match".
                receiver_city = Clean(req.City) ?? "",
                receiver_state = Clean(req.State) ?? "",
                address_type = "HOME",
                goods_type = "PARCEL",
                goods_name = items[0].goods_name,
                item_variant = items[0].item_variant,
                quantity = units,
                items,
                actual_weight = weight,
                order_payment_type = isCod ? "COD" : "PREPAID",
                cod_amount = codAmount,
                order_value = (decimal)order.total,
                service_mode = "PICK_UP",
                source = "Warehouse",
                remark = Truncate(Clean(req.Remark) ?? $"Warehouse order {orderNo}", 500),
            };

            var booking = await courier.CreateOrderAsync(
                payload, ctx.RawToken() ?? "", ctx.TraceIdentifier, ctx.RequestAborted);

            // Recorded even if the person has gone: the parcel exists at the
            // courier now, and an unlinked parcel is the one outcome to avoid.
            await conn.ExecuteAsync("""
                INSERT INTO shipments (order_id, tracking_no, status, sortation_code, route_code,
                                       weight_kg, freight_fee, cod_amount, booked_by)
                VALUES (@id, @trackingNo, 'CREATED', @sortation, @route, @weight, @freight, @cod, @userId)
                """,
                new
                {
                    id,
                    trackingNo = booking.TrackingNo,
                    sortation = booking.SortationCode,
                    route = booking.RouteCode,
                    weight,
                    freight = booking.FreightFee,
                    cod = codAmount,
                    userId = me.Id,
                });

            await Audit.WriteAsync(conn, "courier.booked", me, entity: "order", entityId: id.ToString(),
                detail: new { orderNo, trackingNo = booking.TrackingNo, weight, cod = codAmount },
                ip: ctx.ClientIp());

            return Results.Json(new
            {
                ok = true,
                shipment = await ShipmentOfAsync(conn, id),
            }, statusCode: 201);
        });

        // Every parcel booked from the warehouse, newest first - the shipping desk's list.
        app.MapGet("/api/shipments", async (HttpContext ctx) =>
        {
            var status = ctx.Request.Query["status"].ToString();
            await using var conn = await db.OpenAsync();

            var shipments = await conn.QueryAsync("""
                SELECT s.id, s.order_id, o.order_no, o.customer_name, o.city, o.payment_type,
                       s.carrier, s.tracking_no, s.status, s.sortation_code, s.route_code,
                       s.weight_kg, s.freight_fee, s.cod_amount, s.booked_at, s.status_at,
                       u.full_name AS booked_by_name
                  FROM shipments s
                  JOIN orders o ON o.id = s.order_id
                  LEFT JOIN users u ON u.id = s.booked_by
                 WHERE (@status = '' OR s.status = @status)
                 ORDER BY s.booked_at DESC, s.tracking_no DESC
                 LIMIT 300
                """, new { status });

            return Results.Ok(new { shipments });
        }).RequireAuthorization();
    }

    /// <summary>
    /// An order's parcel as the dashboard shows it: the warehouse's own record,
    /// and - read straight from the courier module's schema, which this database
    /// role may read - the parcel's latest scan. Null when the order has not
    /// been booked.
    /// </summary>
    internal static async Task<object?> ShipmentOfAsync(NpgsqlConnection conn, int orderId)
    {
        var shipment = await conn.QueryFirstOrDefaultAsync("""
            SELECT s.id, s.carrier, s.tracking_no, s.status, s.sortation_code, s.route_code,
                   s.weight_kg, s.freight_fee, s.cod_amount, s.booked_at, s.status_at, s.synced_at,
                   u.full_name AS booked_by_name
              FROM shipments s
              LEFT JOIN users u ON u.id = s.booked_by
             WHERE s.order_id = @orderId
            """, new { orderId });

        if (shipment is null) return null;

        var trackingNo = (string)shipment.tracking_no;
        object? live = null;
        IEnumerable<dynamic> events = [];
        try
        {
            live = await conn.QueryFirstOrDefaultAsync("""
                SELECT co.tracking_status AS status, co.tracking_updated_at AS updated_at,
                       co.service_scope, co.chargeable_weight, co.order_payment_type
                  FROM courier.orders co
                 WHERE co.tracking_no = @trackingNo
                """, new { trackingNo });

            events = await conn.QueryAsync("""
                SELECT te.event_type, te.location, te.description, te.occurred_at
                  FROM courier.tracking_event te
                  JOIN courier.orders co ON co.id = te.order_id
                 WHERE co.tracking_no = @trackingNo
                 ORDER BY te.occurred_at DESC, te.id DESC
                 LIMIT 20
                """, new { trackingNo });
        }
        catch (PostgresException ex) when (ex.SqlState is PostgresErrorCodes.UndefinedTable
                                               or PostgresErrorCodes.InvalidSchemaName
                                               or PostgresErrorCodes.InsufficientPrivilege)
        {
            // The courier module is not installed in this database. The
            // warehouse's own record still answers.
        }

        return new
        {
            id = (int)shipment.id,
            carrier = (string)shipment.carrier,
            tracking_no = trackingNo,
            status = (string)shipment.status,
            sortation_code = (string?)shipment.sortation_code,
            route_code = (string?)shipment.route_code,
            weight_kg = (decimal?)shipment.weight_kg,
            freight_fee = (decimal?)shipment.freight_fee,
            cod_amount = (decimal)shipment.cod_amount,
            booked_at = (DateTime)shipment.booked_at,
            status_at = (DateTime?)shipment.status_at,
            synced_at = (DateTime?)shipment.synced_at,
            booked_by_name = (string?)shipment.booked_by_name,
            courier = live,
            events,
            waybill_url = $"/api/v1/waybills/{trackingNo}.pdf",
            tracking_url = $"/tracking/{trackingNo}",
        };
    }

    /// <summary>The session token this request was made with, to pass on to the courier API.</summary>
    internal static string? RawToken(this HttpContext ctx)
    {
        var header = ctx.Request.Headers.Authorization.ToString();
        if (header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return header[7..].Trim();
        return ctx.Request.Cookies[TokenClaims.Cookie];
    }

    private static string? Clean(string? value) => string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private static string? Digits(string? value) => value is null ? null : Regex.Replace(value, "[^0-9]", "");

    private static string Truncate(string value, int max) => value.Length <= max ? value : value[..max];
}

/// <summary>
/// The booking form. Everything is optional: the order already has the customer
/// and the address, and these are for filling a gap or correcting it.
/// </summary>
public record CourierBookingRequest(
    decimal? WeightKg,
    string? Phone,
    string? Postcode,
    string? Address,
    string? City,
    string? State,
    string? Remark);
