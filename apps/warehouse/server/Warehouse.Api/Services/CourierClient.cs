using System.Net;
using System.Net.Http.Headers;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Warehouse.Api.Services;

public sealed class CourierOptions
{
    /// <summary>Where the courier API answers, from inside the platform (http://courier-api:8000).</summary>
    public string BaseUrl { get; set; } = "http://127.0.0.1:8000";

    /// <summary>How often the tracking status of booked parcels is read back into the warehouse.</summary>
    public int SyncSeconds { get; set; } = 20;

    /// <summary>Weight booked per garment when nobody weighs the parcel.</summary>
    public decimal DefaultWeightKgPerUnit { get; set; } = 0.5m;
}

/// <summary>
/// The warehouse's side of the J&amp;T courier module: books a parcel for an
/// order through the courier API.
///
/// Called with the signed-in person's own session token rather than a service
/// account, so the courier records who booked the parcel and applies that
/// person's permissions - the warehouse cannot book anything its user could not
/// have booked on the courier portal.
/// </summary>
public sealed class CourierClient(HttpClient http, ILogger<CourierClient> logger)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = null,
    };

    public sealed record Booking(
        string TrackingNo, string? SortationCode, string? RouteCode, decimal? FreightFee, string WaybillUrl);

    public async Task<Booking> CreateOrderAsync(object payload, string bearerToken, string? requestId, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, "api/v1/orders")
        {
            Content = JsonContent.Create(payload, options: Json),
        };
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        if (!string.IsNullOrEmpty(requestId)) request.Headers.TryAddWithoutValidation("X-Request-ID", requestId);

        HttpResponseMessage response;
        try
        {
            response = await http.SendAsync(request, ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            logger.LogWarning(ex, "Courier API unreachable at {BaseUrl}", http.BaseAddress);
            throw new ApiException(StatusCodes.Status503ServiceUnavailable, "courier_unavailable",
                "The J&T courier service is not answering. The order is unchanged - try booking again in a moment.");
        }

        using (response)
        {
            var body = await response.Content.ReadAsStringAsync(ct);

            if (response.IsSuccessStatusCode)
            {
                var created = JsonNode.Parse(body)
                    ?? throw new ApiException(502, "courier_bad_response", "The courier service answered with nothing.");

                return new Booking(
                    TrackingNo: created["tracking_no"]!.GetValue<string>(),
                    SortationCode: (string?)created["sortation_code"],
                    RouteCode: (string?)created["route_code"],
                    FreightFee: created["freight_fee"] is JsonValue fee ? ReadDecimal(fee) : null,
                    WaybillUrl: (string?)created["waybill_url"] ?? "");
            }

            // The courier answers problems as RFC 7807 JSON; its `detail` is
            // already a sentence written for the person at the screen.
            string? detail = null;
            try
            {
                var problem = JsonNode.Parse(body);
                detail = (string?)problem?["detail"] ?? (string?)problem?["title"];
            }
            catch (JsonException)
            {
                // Not JSON - something in front of the courier API answered.
            }

            logger.LogInformation("Courier API refused a booking: {Status} {Detail}", (int)response.StatusCode, detail);

            throw response.StatusCode switch
            {
                HttpStatusCode.Unauthorized => new ApiException(401, "session_expired",
                    "Your session has ended. Please sign in again."),
                HttpStatusCode.Forbidden => ApiException.Forbidden(
                    detail ?? "Your account cannot book courier parcels."),
                HttpStatusCode.Conflict => ApiException.Conflict(
                    detail ?? "The courier already has a parcel for this order."),
                HttpStatusCode.UnprocessableEntity or HttpStatusCode.BadRequest => new ApiException(422, "courier_rejected",
                    $"J&T refused the parcel: {detail ?? "check the phone number, postcode and address."}"),
                _ => new ApiException(502, "courier_error",
                    $"The courier service failed ({(int)response.StatusCode}). The order is unchanged."),
            };
        }
    }

    private static decimal? ReadDecimal(JsonValue value) =>
        value.TryGetValue<decimal>(out var d) ? d
        : value.TryGetValue<string>(out var s) && decimal.TryParse(s, System.Globalization.CultureInfo.InvariantCulture, out var parsed) ? parsed
        : null;
}
