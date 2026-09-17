using Dapper;
using Warehouse.Api.Data;

namespace Warehouse.Api.Endpoints;

/// <summary>
/// Signing in, and the platform's accounts as the warehouse sees them.
///
/// Accounts live in core.users and are shared with the courier portal, so an
/// account made here signs in there and the other way round. The shapes of these
/// responses are what the dashboard and the handheld were built against and are
/// unchanged; what is new is the session row behind every token and the cookie
/// that carries the same token to the other module.
/// </summary>
public static class AuthEndpoints
{
    private static readonly string[] Roles = ["admin", "operator", "merchant"];

    /// <summary>A merchant account asking for the warehouse. The code lets a client send it to the courier portal.</summary>
    private static ApiException WrongModule() => new(StatusCodes.Status403Forbidden, "wrong_module",
        "This account is for the courier portal. The warehouse needs a staff account (admin or operator).");

    public static void MapAuth(this IEndpointRouteBuilder app, Db db, TokenService tokens, SessionStore sessions)
    {
        var g = app.MapGroup("/api/auth");

        g.MapPost("/login", async (HttpContext ctx, LoginRequest req) =>
        {
            var login = req.Username?.Trim() ?? "";
            await using var conn = await db.OpenAsync();

            // A username, or the email the courier portal also accepts.
            var user = await conn.QueryFirstOrDefaultAsync("""
                SELECT id, username::text AS username, password_hash, full_name, role, status
                  FROM core.users
                 WHERE username = @login::citext OR (position('@' in @login) > 0 AND email = @login::citext)
                 ORDER BY (username = @login::citext) DESC
                 LIMIT 1
                """, new { login });

            // One message for "no such user" and for "wrong password", so that
            // trying usernames cannot be used to find out which ones exist.
            if (user is null)
            {
                Passwords.Decoy(req.Password ?? "");
                await Audit.WriteAsync(conn, "auth.login", username: login, outcome: "failure",
                    detail: new { reason = "unknown_user" }, ip: ctx.ClientIp());
                throw ApiException.Unauthorised("Wrong username or password.");
            }

            if (!Passwords.Verify(req.Password ?? "", (string)user.password_hash))
            {
                await Audit.WriteAsync(conn, "auth.login", username: (string)user.username, outcome: "failure",
                    detail: new { reason = "wrong_password" }, ip: ctx.ClientIp());
                throw ApiException.Unauthorised("Wrong username or password.");
            }

            if ((string)user.status != "active")
            {
                throw ApiException.Unauthorised((string)user.status == "pending"
                    ? "Your account is waiting for an admin to approve it."
                    : "Wrong username or password.");
            }

            // A merchant account is for the courier portal. Said at the door,
            // rather than letting it in to a dashboard where every screen fails.
            if ((string)user.role == "merchant")
                throw WrongModule();

            var userId = (int)user.id;
            if (Passwords.NeedsRehash((string)user.password_hash))
            {
                await conn.ExecuteAsync("UPDATE core.users SET password_hash = @hash WHERE id = @userId",
                    new { userId, hash = Passwords.Hash(req.Password!) });
            }

            await conn.ExecuteAsync("UPDATE core.users SET last_login_at = now() WHERE id = @userId", new { userId });

            var userAgent = ctx.Request.Headers.UserAgent.ToString();
            var client = userAgent.Contains("Dalvik", StringComparison.OrdinalIgnoreCase) ? "handheld" : "web";
            var expires = DateTime.UtcNow.AddHours(tokens.ExpiresHours);
            var sessionId = await sessions.CreateAsync(conn, userId, client, expires, ctx.ClientIp(), userAgent);

            var (token, expiresAt) = tokens.Issue(
                userId, (string)user.username, (string)user.full_name, (string)user.role, sessionId, expires);

            // The same token as a cookie: the courier portal and the dashboard's
            // other tabs pick up this sign-in without asking for the password again.
            ctx.Response.Cookies.Append(TokenClaims.Cookie, token, tokens.CookieOptions(expiresAt));

            await Audit.WriteAsync(conn, "auth.login", username: (string)user.username,
                detail: new { client }, entity: "user", entityId: userId.ToString(), ip: ctx.ClientIp());

            return Results.Ok(new
            {
                token,
                expiresAt,
                user = new
                {
                    id = userId,
                    username = (string)user.username,
                    fullName = (string)user.full_name,
                    role = (string)user.role,
                },
                timeZone = BusinessClock.IanaId,
            });
        }).RequireRateLimiting("login");

        // timeZone: the shop's clock, which the dashboard shows every time on, so
        // a time reads the same on every screen of the platform whatever computer
        // is looking at it.
        g.MapGet("/me", (HttpContext ctx) =>
        {
            var me = ctx.RequireUser();
            return Results.Ok(new
            {
                id = me.Id, username = me.Username, fullName = me.FullName, role = me.Role,
                timeZone = BusinessClock.IanaId,
            });
        }).RequireAuthorization();

        // Single sign-on: somebody who signed in on the courier portal arrives at
        // the dashboard with the session cookie and no token of its own. This
        // hands the dashboard the token it keeps, so it never asks for a password
        // the person has already given.
        g.MapGet("/session", (HttpContext ctx) =>
        {
            var me = ctx.RequireUser();
            if (me.Role == "merchant") throw WrongModule();

            var token = ctx.Request.Cookies[TokenClaims.Cookie];
            if (string.IsNullOrEmpty(token))
            {
                var header = ctx.Request.Headers.Authorization.ToString();
                token = header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? header[7..].Trim() : null;
            }

            var exp = ctx.User.FindFirst("exp")?.Value;
            DateTime? expiresAt = long.TryParse(exp, out var seconds)
                ? DateTimeOffset.FromUnixTimeSeconds(seconds).UtcDateTime
                : null;

            return Results.Ok(new
            {
                token,
                expiresAt,
                user = new { id = me.Id, username = me.Username, fullName = me.FullName, role = me.Role },
                timeZone = BusinessClock.IanaId,
            });
        }).RequireAuthorization();

        // Signing out ends the session everywhere: this API, the courier portal
        // and every browser tab holding the cookie.
        g.MapPost("/logout", async (HttpContext ctx) =>
        {
            var me = ctx.User.Identity?.IsAuthenticated == true ? ctx.RequireUser() : null;
            if (me?.SessionId is Guid sid) await sessions.RevokeAsync(sid);

            ctx.Response.Cookies.Delete(TokenClaims.Cookie, new CookieOptions { Path = "/" });

            if (me is not null)
            {
                await using var conn = await db.OpenAsync();
                await Audit.WriteAsync(conn, "auth.logout", me, ip: ctx.ClientIp());
            }
            return Results.Ok(new { ok = true });
        });

        g.MapPost("/password", async (HttpContext ctx, ChangePasswordRequest req) =>
        {
            var me = ctx.RequireUser();

            if ((req.NewPassword?.Length ?? 0) < 6)
                throw ApiException.BadRequest("Choose a password of at least 6 characters.");

            await using var conn = await db.OpenAsync();
            var hash = await conn.ExecuteScalarAsync<string>(
                "SELECT password_hash FROM core.users WHERE id = @id", new { id = me.Id });

            if (hash is null || !Passwords.Verify(req.CurrentPassword ?? "", hash))
                throw ApiException.BadRequest("Your current password is not right.");

            await conn.ExecuteAsync(
                "UPDATE core.users SET password_hash = @hash WHERE id = @id",
                new { id = me.Id, hash = Passwords.Hash(req.NewPassword!) });

            // Any other device signed in as this person is signed out; this one stays.
            await sessions.RevokeAllAsync(conn, me.Id, except: me.SessionId);
            await Audit.WriteAsync(conn, "auth.password_changed", me, entity: "user", entityId: me.Id.ToString(), ip: ctx.ClientIp());

            return Results.Ok(new { ok = true });
        }).RequireAuthorization();
    }

    public static void MapUsers(this IEndpointRouteBuilder app, Db db, SessionStore sessions)
    {
        var g = app.MapGroup("/api/users").RequireAuthorization();

        g.MapGet("/", async (HttpContext ctx) =>
        {
            ctx.RequireRole("admin");
            await using var conn = await db.OpenAsync();
            var users = await conn.QueryAsync("""
                SELECT id, username::text AS username, full_name, role, active, status,
                       phone, email::text AS email, last_login_at, created_at
                  FROM core.users ORDER BY username
                """);
            return Results.Ok(new { users });
        });

        g.MapPost("/", async (HttpContext ctx, CreateUserRequest req) =>
        {
            var me = ctx.RequireRole("admin");

            var username = req.Username?.Trim().ToLowerInvariant() ?? "";
            if (username.Length < 3) throw ApiException.BadRequest("A username needs at least 3 characters.");
            if ((req.Password?.Length ?? 0) < 6) throw ApiException.BadRequest("Choose a password of at least 6 characters.");
            if (!Roles.Contains(req.Role))
                throw ApiException.BadRequest("Role must be admin, operator or merchant.");

            await using var conn = await db.OpenAsync();

            if (await conn.ExecuteScalarAsync<long>(
                    "SELECT COUNT(*) FROM core.users WHERE username = @username::citext", new { username }) > 0)
                throw ApiException.Conflict($"There is already a user called {username}.");

            var id = await conn.ExecuteScalarAsync<int>("""
                INSERT INTO core.users (username, password_hash, full_name, role, status)
                VALUES (@username, @hash, @fullName, @role, 'active')
                RETURNING id
                """,
                new
                {
                    username,
                    hash = Passwords.Hash(req.Password!),
                    fullName = string.IsNullOrWhiteSpace(req.FullName) ? username : req.FullName.Trim(),
                    role = req.Role,
                });

            await Audit.WriteAsync(conn, "user.created", me, entity: "user", entityId: id.ToString(),
                detail: new { username, role = req.Role }, ip: ctx.ClientIp());

            return Results.Json(new { ok = true, id }, statusCode: 201);
        });

        g.MapPatch("/{id:int}/active", async (HttpContext ctx, int id, ActiveRequest req) =>
        {
            var me = ctx.RequireRole("admin");

            // Locking yourself out is the one change nobody can undo from here.
            if (id == me.Id && req.Active == 0)
                throw ApiException.BadRequest("You cannot switch off your own account.");

            await using var conn = await db.OpenAsync();
            var n = await conn.ExecuteAsync(
                "UPDATE core.users SET status = @status WHERE id = @id",
                new { id, status = req.Active == 0 ? "blocked" : "active" });

            if (n == 0) throw ApiException.NotFound($"User {id} was not found.");

            // Switched off means signed out, on every device, now.
            if (req.Active == 0) await sessions.RevokeAllAsync(conn, id);

            await Audit.WriteAsync(conn, req.Active == 0 ? "user.blocked" : "user.activated", me,
                entity: "user", entityId: id.ToString(), ip: ctx.ClientIp());
            return Results.Ok(new { ok = true });
        });

        g.MapPost("/{id:int}/password", async (HttpContext ctx, int id, ResetPasswordRequest req) =>
        {
            var me = ctx.RequireRole("admin");
            if ((req.NewPassword?.Length ?? 0) < 6)
                throw ApiException.BadRequest("Choose a password of at least 6 characters.");

            await using var conn = await db.OpenAsync();
            var n = await conn.ExecuteAsync(
                "UPDATE core.users SET password_hash = @hash WHERE id = @id",
                new { id, hash = Passwords.Hash(req.NewPassword!) });

            if (n == 0) throw ApiException.NotFound($"User {id} was not found.");

            await sessions.RevokeAllAsync(conn, id, except: id == me.Id ? me.SessionId : null);
            await Audit.WriteAsync(conn, "user.password_reset", me, entity: "user", entityId: id.ToString(), ip: ctx.ClientIp());
            return Results.Ok(new { ok = true });
        });
    }
}

public record ActiveRequest(int Active);
public record ResetPasswordRequest(string NewPassword);
