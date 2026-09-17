using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Dapper;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.IdentityModel.Tokens;
using Npgsql;
using Warehouse.Api.Data;

namespace Warehouse.Api;

public sealed class AuthOptions
{
    public string Secret { get; set; } = "";
    public int ExpiresHours { get; set; } = 12;

    /// <summary>Send the session cookie over HTTPS only. On for any public deployment.</summary>
    public bool CookieSecure { get; set; }
}

/// <summary>
/// The session token the whole platform shares.
///
/// Signing in on the courier portal, on the warehouse dashboard or on a handheld
/// all produce the same kind of token: an HS256 JWT signed with the platform
/// secret, naming the account and the session row in core.user_sessions. The
/// courier API (Python) and this API both check the signature and the session,
/// so one sign-in works everywhere and one sign-out ends it everywhere.
///
/// The claim names are the contract with the courier API - change them in both
/// places or neither.
/// </summary>
public static class TokenClaims
{
    public const string Issuer = "inaaya-platform";
    public const string Audience = "inaaya-platform";

    public const string UserId = "uid";
    public const string Username = "username";
    public const string Name = "name";
    public const string Role = "role";
    public const string SessionId = "sid";

    /// <summary>Browsers carry the token in this cookie; handhelds send it as a bearer header.</summary>
    public const string Cookie = "inaaya_session";
}

/// <summary>
/// Where the signing key comes from, and why the application will not start
/// without a real one.
///
/// A token signed with a key that is published in this repository is not a
/// token: anybody who has read the source can mint themselves an admin
/// sign-in. So the placeholder is refused outright in production. In
/// development a key is generated instead of demanded, because being asked to
/// invent a 40-character secret before the project will run once is how people
/// end up pasting the placeholder back in.
/// </summary>
public static class AuthSecret
{
    public const string Placeholder = "CHANGE-ME-BEFORE-DEPLOYING";
    private const int Minimum = 32;

    public static string Resolve(string? configured, bool isDevelopment, out string source)
    {
        if (!string.IsNullOrWhiteSpace(configured)
            && configured != Placeholder
            && configured.Length >= Minimum)
        {
            source = "configuration";
            return configured;
        }

        if (!isDevelopment)
        {
            throw new InvalidOperationException(
                $"Auth:Secret is not set. Put at least {Minimum} random characters in the Auth__Secret " +
                "environment variable (AUTH_JWT_SECRET in the platform .env) before deploying. The courier " +
                "API must be given the same value, or signing in on one module will not sign in on the other.");
        }

        // Stable across restarts on this machine, so a developer is not signed
        // out every time the server reloads, but never shared and never in git.
        // Single sign-on with the courier portal needs the shared secret instead.
        var file = Path.Combine(Path.GetTempPath(), "warehouse-dev-signing-key.txt");
        if (File.Exists(file))
        {
            source = $"development key ({file}) - set Auth__Secret to share sign-ins with the courier portal";
            return File.ReadAllText(file).Trim();
        }

        var generated = Convert.ToBase64String(RandomNumberGenerator.GetBytes(48));
        File.WriteAllText(file, generated);
        source = $"development key, newly generated ({file})";
        return generated;
    }
}

public sealed class TokenService(AuthOptions options)
{
    private readonly SymmetricSecurityKey _key = new(Encoding.UTF8.GetBytes(options.Secret));

    public int ExpiresHours => options.ExpiresHours;

    public (string Token, DateTime ExpiresAt) Issue(int id, string username, string fullName, string role, Guid sessionId, DateTime expiresUtc)
    {
        var now = DateTime.UtcNow;

        var token = new JwtSecurityToken(
            issuer: TokenClaims.Issuer,
            audience: TokenClaims.Audience,
            claims:
            [
                new Claim(TokenClaims.UserId, id.ToString()),
                new Claim(TokenClaims.Username, username),
                new Claim(TokenClaims.Name, fullName),
                new Claim(TokenClaims.Role, role),
                new Claim(TokenClaims.SessionId, sessionId.ToString()),
                new Claim(JwtRegisteredClaimNames.Iat, new DateTimeOffset(now).ToUnixTimeSeconds().ToString(), ClaimValueTypes.Integer64),
            ],
            notBefore: now,
            expires: expiresUtc,
            signingCredentials: new SigningCredentials(_key, SecurityAlgorithms.HmacSha256));

        return (new JwtSecurityTokenHandler().WriteToken(token), expiresUtc);
    }

    public TokenValidationParameters ValidationParameters() => new()
    {
        ValidateIssuer = true,
        ValidIssuer = TokenClaims.Issuer,
        ValidateAudience = true,
        ValidAudience = TokenClaims.Audience,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = _key,
        ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
        // The default five minutes of grace means a 12-hour token is really a
        // 12-hour-and-five-minute token. The expiry shown should be the expiry.
        ClockSkew = TimeSpan.Zero,
        RoleClaimType = TokenClaims.Role,
        NameClaimType = TokenClaims.Username,
    };

    public CookieOptions CookieOptions(DateTime expiresUtc) => new()
    {
        HttpOnly = true,
        Secure = options.CookieSecure,
        SameSite = SameSiteMode.Lax,
        Path = "/",
        Expires = new DateTimeOffset(expiresUtc),
        IsEssential = true,
    };
}

/// <summary>
/// Password hashes, in the one format both modules write.
///
///   pbkdf2_sha256$&lt;iterations&gt;$&lt;base64 salt&gt;$&lt;base64 hash&gt;
///
/// identical to the courier API's, so an account created on either side signs in
/// on both. Accounts carried over from the MySQL warehouse have bcrypt hashes;
/// those still verify, and are rewritten in this format the first time their
/// owner signs in.
/// </summary>
public static class Passwords
{
    private const string Algorithm = "pbkdf2_sha256";
    private const int Iterations = 390_000;
    private const int SaltBytes = 16;
    private const int HashBytes = 32;

    public static string Hash(string password)
    {
        var salt = RandomNumberGenerator.GetBytes(SaltBytes);
        var hash = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password), salt, Iterations, HashAlgorithmName.SHA256, HashBytes);
        return $"{Algorithm}${Iterations}${Convert.ToBase64String(salt)}${Convert.ToBase64String(hash)}";
    }

    public static bool Verify(string password, string? stored)
    {
        if (string.IsNullOrEmpty(stored)) return false;

        if (stored.StartsWith("$2", StringComparison.Ordinal))
        {
            try { return BCrypt.Net.BCrypt.Verify(password, stored); }
            catch (BCrypt.Net.SaltParseException) { return false; }
        }

        var parts = stored.Split('$');
        if (parts.Length != 4 || parts[0] != Algorithm || !int.TryParse(parts[1], out var iterations) || iterations < 1)
            return false;

        try
        {
            var salt = Convert.FromBase64String(parts[2]);
            var expected = Convert.FromBase64String(parts[3]);
            var actual = Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password), salt, iterations, HashAlgorithmName.SHA256, expected.Length);
            return CryptographicOperations.FixedTimeEquals(actual, expected);
        }
        catch (FormatException)
        {
            return false;
        }
    }

    /// <summary>True for a hash worth rewriting after a successful sign-in.</summary>
    public static bool NeedsRehash(string stored) =>
        !stored.StartsWith($"{Algorithm}${Iterations}$", StringComparison.Ordinal);

    /// <summary>
    /// Burns the same time as a real check, so "no such user" cannot be told
    /// apart from "wrong password" by timing the response.
    /// </summary>
    public static void Decoy(string password) => Verify(password, DecoyHash.Value);

    private static readonly Lazy<string> DecoyHash = new(() => Hash("not-a-real-password"));
}

/// <summary>
/// Sign-ins, as rows in core.user_sessions.
///
/// A token is only as good as its row: signing out deletes it, blocking an
/// account deletes all of them, and both APIs refuse a token whose row is gone.
/// A handheld scans many tags a minute, so a live session is remembered for a
/// few seconds rather than looked up on every scan. A session ended anywhere -
/// here or on the courier portal - is announced by the database and forgotten at
/// once (see SessionEvents); the few seconds are only the longest a revoked
/// session can keep working if that announcement is missed.
/// </summary>
public sealed class SessionStore(Db db, IMemoryCache cache)
{
    private static readonly TimeSpan Remember = TimeSpan.FromSeconds(15);

    // Part of every key: moving it on forgets every remembered session at once.
    private long _generation;

    private string Key(Guid sessionId) => $"session:{Interlocked.Read(ref _generation)}:{sessionId}";

    /// <summary>Drops what is remembered about one session, so its next request is checked.</summary>
    public void Forget(Guid sessionId) => cache.Remove(Key(sessionId));

    /// <summary>Drops everything remembered: after announcements may have been missed.</summary>
    public void ForgetAll() => Interlocked.Increment(ref _generation);

    public async Task<Guid> CreateAsync(
        NpgsqlConnection conn, int userId, string client, DateTime expiresUtc, string? ip, string? userAgent)
    {
        var id = Guid.NewGuid();
        await conn.ExecuteAsync("""
            INSERT INTO core.user_sessions (id, user_id, client, expires_at, last_seen_at, ip, user_agent)
            VALUES (@id, @userId, @client, @expiresUtc, now(), @ip, @userAgent)
            """,
            new
            {
                id,
                userId,
                client,
                expiresUtc,
                ip,
                userAgent = userAgent is { Length: > 256 } ? userAgent[..256] : userAgent,
            });

        // Housekeeping on the way past: expired sign-ins are never looked at again.
        await conn.ExecuteAsync("DELETE FROM core.user_sessions WHERE expires_at < now() - interval '1 day'");
        return id;
    }

    public async Task<bool> IsLiveAsync(Guid sessionId, int userId, CancellationToken ct = default)
    {
        var key = Key(sessionId);
        if (cache.TryGetValue(key, out bool live)) return live;

        await using var conn = await db.OpenAsync(ct);
        live = await conn.ExecuteScalarAsync<bool>("""
            WITH touched AS (
                UPDATE core.user_sessions s
                   SET last_seen_at = now()
                  FROM core.users u
                 WHERE s.id = @sessionId
                   AND s.user_id = @userId
                   AND u.id = s.user_id
                   AND s.revoked_at IS NULL
                   AND s.expires_at > now()
                   AND u.status = 'active'
             RETURNING 1)
            SELECT EXISTS (SELECT 1 FROM touched)
            """, new { sessionId, userId });

        cache.Set(key, live, Remember);
        return live;
    }

    public async Task RevokeAsync(Guid sessionId)
    {
        await using var conn = await db.OpenAsync();
        await conn.ExecuteAsync("DELETE FROM core.user_sessions WHERE id = @sessionId", new { sessionId });
        Forget(sessionId);
    }

    /// <summary>Every sign-in of an account: a blocked account, a reset password.</summary>
    public async Task RevokeAllAsync(NpgsqlConnection conn, int userId, Guid? except = null)
    {
        var ids = (await conn.QueryAsync<Guid>(
            "DELETE FROM core.user_sessions WHERE user_id = @userId AND id IS DISTINCT FROM @except RETURNING id",
            new { userId, except })).ToList();

        foreach (var id in ids) Forget(id);
    }
}
