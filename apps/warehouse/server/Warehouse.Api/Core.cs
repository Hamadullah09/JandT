using System.Security.Claims;
using Dapper;
using Npgsql;

namespace Warehouse.Api;

/// <summary>
/// An error the caller should see, with the HTTP status it deserves.
///
/// Everything thrown deliberately in this application is one of these, so the
/// error middleware can tell "the operator scanned a tag we do not know" from
/// "the database fell over" and answer the two differently. Unhandled
/// exceptions become a 500 with no detail; these carry their message through.
/// </summary>
public sealed class ApiException : Exception
{
    public int Status { get; }
    public string Code { get; }

    public ApiException(int status, string code, string message) : base(message)
    {
        Status = status;
        Code = code;
    }

    public static ApiException BadRequest(string message) => new(400, "bad_request", message);
    public static ApiException Unauthorised(string message) => new(401, "unauthorised", message);
    public static ApiException Forbidden(string message) => new(403, "forbidden", message);
    public static ApiException NotFound(string message) => new(404, "not_found", message);
    public static ApiException Conflict(string message) => new(409, "conflict", message);
}

/// <summary>Who is making the request, lifted out of the session token.</summary>
public sealed record CurrentUser(int Id, string Username, string FullName, string Role, Guid? SessionId);

public static class HttpContextExtensions
{
    public static CurrentUser RequireUser(this HttpContext ctx)
    {
        var id = ctx.User.FindFirst(TokenClaims.UserId)?.Value;
        if (id is null || !int.TryParse(id, out var userId))
            throw ApiException.Unauthorised("Sign in to continue.");

        return new CurrentUser(
            userId,
            ctx.User.FindFirst(TokenClaims.Username)?.Value ?? "",
            ctx.User.FindFirst(TokenClaims.Name)?.Value ?? "",
            ctx.User.FindFirst(TokenClaims.Role)?.Value ?? "",
            Guid.TryParse(ctx.User.FindFirst(TokenClaims.SessionId)?.Value, out var sid) ? sid : null);
    }

    /// <summary>
    /// Refuses the request unless the caller holds one of these roles.
    ///
    /// Said at the top of each endpoint rather than in a policy attribute
    /// because it then sits next to the query it is guarding, where somebody
    /// changing that query can see it.
    /// </summary>
    public static CurrentUser RequireRole(this HttpContext ctx, params string[] roles)
    {
        var user = ctx.RequireUser();
        if (!roles.Contains(user.Role))
            throw ApiException.Forbidden("Your account cannot do that.");
        return user;
    }

    /// <summary>The caller's address as the gateway saw it, for the audit trail.</summary>
    public static string? ClientIp(this HttpContext ctx) => ctx.Connection.RemoteIpAddress?.ToString();
}

/// <summary>
/// Tag codes.
///
/// We never write to a tag, so an EPC is only ever compared, never decoded.
/// What matters is that the same physical tag produces the same string every
/// time: readers hand back "E2 80 11 70" one day and "e2801170" the next, and
/// without normalising those are two different garments.
/// </summary>
public static class Epc
{
    public static string Normalise(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
            throw ApiException.BadRequest("A tag code is required.");

        var epc = new string(raw.Where(char.IsLetterOrDigit).ToArray()).ToUpperInvariant();

        if (epc.Length == 0)
            throw ApiException.BadRequest($"That is not a tag code: {raw}");
        if (!epc.All(c => (c >= '0' && c <= '9') || (c >= 'A' && c <= 'F')))
            throw ApiException.BadRequest($"A tag code is hexadecimal; this is not: {raw}");
        if (epc.Length % 2 != 0)
            throw ApiException.BadRequest($"A tag code has an even number of characters; this does not: {raw}");

        return epc;
    }

    /// <summary>Normalises, but hands back null instead of throwing.</summary>
    public static string? TryNormalise(string? raw)
    {
        try { return Normalise(raw); }
        catch (ApiException) { return null; }
    }
}

/// <summary>
/// Whether the money is already in.
///
/// Spreadsheets write this a dozen ways — "COD", "cod", "Cash on Delivery",
/// "Paid", "PAID", "Prepaid" — and the column holds two values. A row that says
/// nothing recognisable is treated as cash on delivery rather than rejected: an
/// import of four hundred orders must not stop on a spelling, and of the two
/// ways to be wrong, "somebody still owes us" is the one that gets noticed.
/// </summary>
public static class Payment
{
    public static string Normalise(string? raw)
    {
        var value = raw?.Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(value)) return "cod";

        return value is "paid" or "prepaid" or "pre-paid" or "online" or "transfer"
            ? "paid"
            : "cod";
    }
}

/// <summary>
/// The business's own clock. Order numbers carry the day they were placed on,
/// and "the day" is the shop's, not the server's: a container runs in UTC and
/// would stamp an order placed at 7am in Kuala Lumpur with yesterday's date.
/// </summary>
public static class BusinessClock
{
    private static TimeZoneInfo _zone = TimeZoneInfo.Local;

    public static TimeZoneInfo Zone => _zone;

    /// <summary>The zone's IANA name ("Asia/Kuala_Lumpur"), which is what PostgreSQL understands.</summary>
    public static string IanaId { get; private set; } = IanaOf(TimeZoneInfo.Local);

    public static void Configure(string? timeZoneId)
    {
        if (string.IsNullOrWhiteSpace(timeZoneId)) return;
        _zone = TimeZoneInfo.FindSystemTimeZoneById(timeZoneId);
        IanaId = IanaOf(_zone);
    }

    private static string IanaOf(TimeZoneInfo zone)
    {
        if (zone.HasIanaId) return zone.Id;
        return TimeZoneInfo.TryConvertWindowsIdToIanaId(zone.Id, out var iana) ? iana : "UTC";
    }

    /// <summary>Now, on the shop's wall clock.</summary>
    public static DateTime Now => TimeZoneInfo.ConvertTimeFromUtc(DateTime.UtcNow, _zone);

    /// <summary>
    /// A date and time as somebody typed it - a spreadsheet's "placed on" - read
    /// on the shop's clock and turned into the UTC instant PostgreSQL stores.
    /// </summary>
    public static DateTime ToUtc(DateTime value) => value.Kind switch
    {
        DateTimeKind.Utc => value,
        DateTimeKind.Local => value.ToUniversalTime(),
        _ => TimeZoneInfo.ConvertTimeToUtc(value, _zone),
    };

    /// <summary>A UTC instant on the shop's wall clock.</summary>
    public static DateTime ToLocal(DateTime utc) =>
        TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), _zone);
}

/// <summary>
/// Human-facing reference numbers: SO-20260914-0007, BAT-20260914-0002.
/// </summary>
public static class Ref
{
    /// <summary>
    /// The next number for today.
    ///
    /// Derived from what is already in the table rather than from a counter
    /// table, so restoring a backup cannot hand out a number twice. Callers
    /// inside a transaction also take a transaction-scoped advisory lock on the
    /// stem, so two intakes started in the same second queue for the number
    /// instead of both reading the same maximum and one failing on the unique
    /// index.
    /// </summary>
    /// <param name="on">
    /// The day the number belongs to. Defaults to today, and is only passed by
    /// the spreadsheet import: an order placed last Tuesday that comes out as
    /// SO-20260915-0003 is an order nobody can find by date.
    /// </param>
    public static async Task<string> NextAsync(
        NpgsqlConnection conn, NpgsqlTransaction? tx, string table, string column, string prefix,
        DateTime? on = null)
    {
        var stem = $"{prefix}-{on ?? BusinessClock.Now:yyyyMMdd}-";

        if (tx is not null)
            await conn.ExecuteAsync("SELECT pg_advisory_xact_lock(hashtext(@stem))", new { stem }, tx);

        var highest = await conn.ExecuteScalarAsync<string?>(
            $"SELECT MAX({column}) FROM {table} WHERE {column} LIKE @like",
            new { like = stem + "%" }, tx);

        var next = 1;
        if (highest is not null && int.TryParse(highest[stem.Length..], out var n)) next = n + 1;

        return stem + next.ToString("D4");
    }

    /// <summary>
    /// The next order tracking number: 1, 2, 3 and upwards for the life of the
    /// warehouse, not restarting each day the way the reference numbers do.
    ///
    /// Read from the table rather than from a counter, for the same reason as
    /// above, and serialised on an advisory lock for the same reason too. The
    /// unique index is what catches it if anybody forgets.
    /// </summary>
    public static async Task<int> NextTrackingAsync(NpgsqlConnection conn, NpgsqlTransaction? tx)
    {
        if (tx is not null)
            await conn.ExecuteAsync("SELECT pg_advisory_xact_lock(hashtext('warehouse.orders.tracking_id'))", transaction: tx);

        return (await conn.ExecuteScalarAsync<int?>(
                   "SELECT MAX(tracking_id) FROM orders", null, tx) ?? 0) + 1;
    }
}

/// <summary>
/// The platform's audit trail (core.audit_log): who signed in, who changed an
/// account, who booked a courier. Written best-effort - a failure to record never
/// fails the thing being recorded.
///
/// Always after the work has committed and never inside a transaction: in
/// PostgreSQL a failed statement aborts the whole transaction it is in, so an
/// audit insert that failed there would take the real change down with it.
/// </summary>
public static class Audit
{
    public static async Task WriteAsync(
        NpgsqlConnection conn, string action, CurrentUser? actor = null, string? username = null,
        string outcome = "success", string? entity = null, string? entityId = null,
        object? detail = null, string? ip = null)
    {
        try
        {
            await conn.ExecuteAsync("""
                INSERT INTO core.audit_log (module, action, outcome, actor_user_id, actor_username,
                                            entity, entity_id, detail, ip)
                VALUES ('warehouse', @action, @outcome, @actorId, @username,
                        @entity, @entityId, CAST(@detail AS jsonb), @ip)
                """,
                new
                {
                    action,
                    outcome,
                    actorId = actor?.Id,
                    username = actor?.Username ?? username,
                    entity,
                    entityId,
                    detail = detail is null ? null : System.Text.Json.JsonSerializer.Serialize(detail),
                    ip,
                });
        }
        catch (NpgsqlException)
        {
            // Deliberately swallowed: see the class comment.
        }
    }
}
