using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.Extensions.FileProviders;
using Warehouse.Api;
using Warehouse.Api.Data;
using Warehouse.Api.Endpoints;
using Warehouse.Api.Services;

var builder = WebApplication.CreateBuilder(args);

// ------------------------------------------------------------------ logging

// One JSON object per line outside development, so the platform's log
// collector can index the request id, the path and the status without parsing
// sentences. Development keeps the readable console.
if (!builder.Environment.IsDevelopment())
{
    builder.Logging.ClearProviders();
    builder.Logging.AddJsonConsole(o =>
    {
        o.IncludeScopes = true;
        o.UseUtcTimestamp = true;
        o.TimestampFormat = "yyyy-MM-ddTHH:mm:ss.fffZ ";
    });
}

// ------------------------------------------------------------ configuration

var connectionString = builder.Configuration.GetConnectionString("Postgres")
    ?? throw new InvalidOperationException(
        "ConnectionStrings:Postgres is not configured. Set ConnectionStrings__Postgres (see the platform .env.example).");

var authOptions = builder.Configuration.GetSection("Auth").Get<AuthOptions>() ?? new AuthOptions();
authOptions.Secret = AuthSecret.Resolve(
    authOptions.Secret, builder.Environment.IsDevelopment(), out var secretSource);

BusinessClock.Configure(builder.Configuration["Platform:TimeZone"]);

var db = new Db(connectionString);
var tokens = new TokenService(authOptions);

// Beside the application unless configured, never inside wwwroot - see PhotoStore.
var uploadsRoot = builder.Configuration["Uploads:Path"] is { Length: > 0 } configured
    ? configured
    : Path.Combine(builder.Environment.ContentRootPath, "uploads");
var photos = new PhotoStore(uploadsRoot);

builder.Services.AddSingleton(db);
builder.Services.AddSingleton(tokens);
builder.Services.AddSingleton(photos);
builder.Services.AddMemoryCache();
builder.Services.AddSingleton<SessionStore>();
builder.Services.AddHostedService<SessionEvents>();

builder.Services.Configure<CourierOptions>(builder.Configuration.GetSection("Courier"));
builder.Services.AddHttpClient<CourierClient>((sp, http) =>
{
    var courier = builder.Configuration.GetSection("Courier").Get<CourierOptions>() ?? new CourierOptions();
    http.BaseAddress = new Uri(courier.BaseUrl.TrimEnd('/') + "/");
    // Rendering a waybill PDF is part of creating the parcel.
    http.Timeout = TimeSpan.FromSeconds(30);
});
builder.Services.AddSingleton<CourierSyncService>();
builder.Services.AddHostedService(sp => sp.GetRequiredService<CourierSyncService>());

// Behind the gateway: the client's address and scheme come from X-Forwarded-*.
builder.Services.Configure<ForwardedHeadersOptions>(o =>
{
    o.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto | ForwardedHeaders.XForwardedHost;
    o.KnownIPNetworks.Clear();
    o.KnownProxies.Clear();
});

// ----------------------------------------------------------- authentication

builder.Services
    .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(o =>
    {
        o.TokenValidationParameters = tokens.ValidationParameters();
        o.MapInboundClaims = false;

        o.Events = new JwtBearerEvents
        {
            // Handhelds and the dashboard send the token as a bearer header.
            // A browser that signed in on the courier portal carries the same
            // token in the platform cookie instead - that is single sign-on.
            OnMessageReceived = context =>
            {
                if (string.IsNullOrEmpty(context.Request.Headers.Authorization)
                    && context.Request.Cookies.TryGetValue(TokenClaims.Cookie, out var cookie)
                    && !string.IsNullOrEmpty(cookie))
                {
                    context.Token = cookie;
                    context.HttpContext.Items[TokenClaims.Cookie] = true;
                }
                return Task.CompletedTask;
            },

            // A good signature is not enough: the session must still exist.
            // Signing out, or an admin blocking the account, deletes it.
            OnTokenValidated = async context =>
            {
                var uid = context.Principal?.FindFirst(TokenClaims.UserId)?.Value;
                var sid = context.Principal?.FindFirst(TokenClaims.SessionId)?.Value;
                var sessions = context.HttpContext.RequestServices.GetRequiredService<SessionStore>();

                if (!int.TryParse(uid, out var userId) || !Guid.TryParse(sid, out var sessionId)
                    || !await sessions.IsLiveAsync(sessionId, userId, context.HttpContext.RequestAborted))
                {
                    context.Fail("The session has ended.");
                }
            },

            // Without this the framework answers an expired token with a bare 401
            // and an empty body, which a handheld can only report as
            // "Request failed (401)". Every other error here is
            // {"error":{"code","message"}}, so this one is too, and the code tells
            // the client to sign in again rather than to retry forever.
            OnChallenge = async context =>
            {
                context.HandleResponse();
                if (context.Response.HasStarted) return;

                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                context.Response.ContentType = "application/json; charset=utf-8";
                await context.Response.WriteAsync(JsonSerializer.Serialize(new
                {
                    error = new
                    {
                        code = "session_expired",
                        message = "Your session has ended. Please sign in again.",
                    },
                }));
            },
        };
    });

builder.Services.AddAuthorization();

// Guessing passwords is slowed to a number of tries a minute per address. The
// default allows a shift's worth of handhelds behind one office router to sign
// in together. The gateway has its own limit in front of this; this one holds
// when the API is reached directly.
var loginAttemptsPerMinute = builder.Configuration.GetValue("Auth:LoginAttemptsPerMinute", 30);
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.AddPolicy("login", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = Math.Max(1, loginAttemptsPerMinute),
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0,
        }));
    o.OnRejected = async (context, ct) =>
    {
        context.HttpContext.Response.ContentType = "application/json; charset=utf-8";
        await context.HttpContext.Response.WriteAsJsonAsync(new
        {
            error = new { code = "too_many_attempts", message = "Too many sign-in attempts. Wait a minute and try again." },
        }, ct);
    };
});

// Same origin in production - everything is served through the gateway - so
// this only matters against the Vite dev server.
var corsOrigins = builder.Configuration.GetSection("Cors:Origins").Get<string[]>() ?? [];
builder.Services.AddCors(o => o.AddDefaultPolicy(p =>
    p.WithOrigins(corsOrigins).AllowAnyHeader().AllowAnyMethod().AllowCredentials()));

// A body that does not bind (text where a number belongs, broken JSON) throws,
// in every environment, so the error middleware below answers it with a
// sentence. The framework's default outside Development is an empty 400, which a
// handheld can only report as "Request failed (400)".
builder.Services.Configure<Microsoft.AspNetCore.Routing.RouteHandlerOptions>(o => o.ThrowOnBadRequest = true);

builder.Services.ConfigureHttpJsonOptions(o =>
{
    // Rows come back from Dapper already named the way the database names them,
    // and the dashboard reads them that way. Camel-casing here would rename
    // half the payload and leave the dynamic rows untouched.
    o.SerializerOptions.PropertyNamingPolicy = null;
    o.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.Never;
});

var app = builder.Build();

// Printed so "everybody got signed out after a restart" is diagnosable at a
// glance rather than by comparing token signatures.
app.Logger.LogInformation("Signing key source: {Source}", secretSource);
app.Logger.LogInformation("Business time zone: {Zone}", BusinessClock.IanaId);

await db.MigrateAsync(app.Logger);

// Search by photo. Looked for where it is configured, then beside the project
// (dotnet run), then beside the program (a published copy).
var matcher = new PhotoMatcher(
[
    app.Configuration["PhotoSearch:ModelPath"],
    Path.Combine(app.Environment.ContentRootPath, "models", PhotoMatcher.ModelFile),
    Path.Combine(AppContext.BaseDirectory, "models", PhotoMatcher.ModelFile),
], app.Logger);

// Photos uploaded before the model was here are read in the background, so
// the server is answering straight away rather than after every photo.
app.Lifetime.ApplicationStarted.Register(() =>
    _ = Task.Run(() => PhotoIndex.CatchUpAsync(db, photos, matcher, app.Logger, app.Lifetime.ApplicationStopping)));
app.Lifetime.ApplicationStopped.Register(matcher.Dispose);

// -------------------------------------------------------------- pipeline

// The dashboard is served under /warehouse/ by the platform gateway and at the
// root when the API is run on its own; both work.
app.UsePathBase("/warehouse");
app.UseRouting();
app.UseForwardedHeaders();

// A request id on every response and every log line of the request, taken from
// the gateway when it set one, so one id follows a request across both modules.
app.Use(async (ctx, next) =>
{
    var requestId = ctx.Request.Headers["X-Request-ID"].FirstOrDefault();
    if (string.IsNullOrWhiteSpace(requestId) || requestId.Length > 64) requestId = ctx.TraceIdentifier;
    else ctx.TraceIdentifier = requestId;

    ctx.Response.Headers["X-Request-ID"] = requestId;
    ctx.Response.Headers.XContentTypeOptions = "nosniff";
    ctx.Response.Headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    ctx.Response.Headers.XFrameOptions = "SAMEORIGIN";

    using (app.Logger.BeginScope(new Dictionary<string, object> { ["RequestId"] = requestId }))
    {
        await next();
    }
});

// One shape for every error the API produces, so the dashboard and the handheld
// each need exactly one place that understands a failure.
app.Use(async (ctx, next) =>
{
    try
    {
        await next();
    }
    catch (ApiException ex)
    {
        if (ctx.Response.HasStarted) throw;
        ctx.Response.StatusCode = ex.Status;
        ctx.Response.ContentType = "application/json; charset=utf-8";
        await ctx.Response.WriteAsJsonAsync(new { error = new { code = ex.Code, message = ex.Message } });
    }
    catch (BadHttpRequestException ex) when (!ctx.Response.HasStarted)
    {
        // A request the framework could not read - a body that is not the JSON
        // the endpoint takes, or bigger than it allows. That is the caller's
        // mistake, and answering 500 "something went wrong at our end" would
        // send somebody looking for a fault in the server that is not there.
        ctx.Response.StatusCode = ex.StatusCode;
        ctx.Response.ContentType = "application/json; charset=utf-8";
        await ctx.Response.WriteAsJsonAsync(new
        {
            error = ex.StatusCode == StatusCodes.Status413PayloadTooLarge
                ? new { code = "too_large", message = "That is too much to send at once." }
                : new { code = "bad_request", message = "The request was not in the form this page expects. Reload the page and try again." },
        });
    }
    catch (Exception ex)
    {
        // The detail goes to the log, not to the client: an unexpected failure
        // usually carries a fragment of SQL or a connection string with it.
        app.Logger.LogError(ex, "Unhandled error on {Method} {Path}", ctx.Request.Method, ctx.Request.Path);

        if (ctx.Response.HasStarted) throw;

        ctx.Response.StatusCode = StatusCodes.Status500InternalServerError;
        ctx.Response.ContentType = "application/json; charset=utf-8";
        await ctx.Response.WriteAsJsonAsync(new
        {
            error = new { code = "server_error", message = "Something went wrong at our end." },
        });
    }
});

app.UseCors();
app.UseAuthentication();

// Two platform rules that sit between signing in and any endpoint:
//
//  * A request authenticated only by the cookie, that changes something, must
//    come from this site. The cookie is sent with any request the browser makes
//    to this address, including one a hostile page triggers; the browser's own
//    Sec-Fetch-Site and Origin headers say where it really came from.
//
//  * The warehouse is for staff. A merchant account signs in to the courier
//    portal and nothing here.
app.Use(async (ctx, next) =>
{
    var path = ctx.Request.Path;
    var isApi = path.StartsWithSegments("/api");

    if (isApi && ctx.Items.ContainsKey(TokenClaims.Cookie) && !HttpMethods.IsGet(ctx.Request.Method)
        && !HttpMethods.IsHead(ctx.Request.Method) && !HttpMethods.IsOptions(ctx.Request.Method))
    {
        var site = ctx.Request.Headers["Sec-Fetch-Site"].ToString();
        var origin = ctx.Request.Headers.Origin.ToString();
        var crossSite = site is "cross-site" or "same-site"
            || (site.Length == 0 && origin.Length > 0
                && !(Uri.TryCreate(origin, UriKind.Absolute, out var o)
                     && string.Equals(o.Authority, ctx.Request.Host.Value, StringComparison.OrdinalIgnoreCase)));

        if (crossSite)
            throw ApiException.Forbidden("That request did not come from this site.");
    }

    if (isApi && !path.StartsWithSegments("/api/auth") && !path.StartsWithSegments("/api/health")
        && ctx.User.FindFirst(TokenClaims.Role)?.Value == "merchant")
    {
        throw ApiException.Forbidden("Your account is for the courier portal. The warehouse needs a staff account.");
    }

    await next();
});

app.UseAuthorization();
app.UseRateLimiter();

app.MapAuth(db, tokens, app.Services.GetRequiredService<SessionStore>());
app.MapUsers(db, app.Services.GetRequiredService<SessionStore>());
app.MapRooms(db);
app.MapRoomTags(db);
app.MapLookups(db);
app.MapProducts(db, photos, matcher);
app.MapVariants(db);
app.MapBatches(db);
app.MapItems(db);
app.MapOrders(db);
app.MapOrderImport(db);
app.MapCourier(db);
app.MapReturns(db);
app.MapFind(db);
app.MapReports(db);

// The handhelds look for a warehouse on the network by asking this, so it stays
// cheap, public and exactly where it always was.
app.MapGet("/api/health", () => Results.Ok(new { ok = true, at = DateTime.UtcNow }));

// For the platform: live = the process answers; ready = it can do its job,
// which needs the database.
app.MapGet("/health/live", () => Results.Ok(new { status = "ok", service = "warehouse-api" }));
app.MapGet("/health/ready", async (CancellationToken ct) =>
{
    var database = await db.PingAsync(ct);
    return Results.Json(
        new { status = database ? "ok" : "unavailable", service = "warehouse-api", database, photoSearch = matcher.Available },
        statusCode: database ? StatusCodes.Status200OK : StatusCodes.Status503ServiceUnavailable);
});

// Product photos. Served without a sign-in, deliberately: an <img> tag and the
// handheld's image loader cannot send a bearer token, these are the same
// pictures the shop already publishes, and each file name is a random GUID
// that cannot be guessed from the product. Cached for a day because a photo is
// replaced by uploading a new file under a new name, never by overwriting one.
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new PhysicalFileProvider(photos.Root),
    RequestPath = "/uploads",
    OnPrepareResponse = ctx =>
        ctx.Context.Response.Headers.CacheControl = "public, max-age=86400",
});

app.UseDefaultFiles();

// Cache the fingerprinted files hard, and index.html not at all.
//
// index.html is the file that names which bundle to load, so a stale copy pins
// somebody to the dashboard as it was days ago. The bundles under /assets have
// a content hash in the name, so a changed file is a different URL and can
// safely be kept for a year.
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        var path = ctx.Context.Request.Path.Value ?? string.Empty;
        var headers = ctx.Context.Response.Headers;

        if (path.StartsWith("/assets/", StringComparison.OrdinalIgnoreCase))
            headers.CacheControl = "public, max-age=31536000, immutable";
        else
            headers.CacheControl = "no-cache, must-revalidate";
    },
});

// The dashboard is a single page application: a browser reloaded on a deep link
// asks the server for a path that is not a file. Anything that is not an API
// call and not a file is handed index.html so the router can take it.
//
// An unmatched /api/... path must still 404 as JSON, or a typo in a fetch comes
// back as a page of HTML and the client reports "Unexpected token <".
app.MapFallback(async ctx =>
{
    if (ctx.Request.Path.StartsWithSegments("/api") || ctx.Request.Path.StartsWithSegments("/uploads")
        || ctx.Request.Path.StartsWithSegments("/health"))
    {
        ctx.Response.StatusCode = StatusCodes.Status404NotFound;
        await ctx.Response.WriteAsJsonAsync(new
        {
            error = new { code = "not_found", message = $"No such endpoint: {ctx.Request.Path}" },
        });
        return;
    }

    var index = Path.Combine(app.Environment.WebRootPath ?? "wwwroot", "index.html");
    if (!File.Exists(index))
    {
        ctx.Response.StatusCode = StatusCodes.Status404NotFound;
        await ctx.Response.WriteAsync(
            "The dashboard has not been built yet. Run `npm run build` in apps/warehouse/dashboard, " +
            "or use the Vite dev server.");
        return;
    }

    ctx.Response.Headers.CacheControl = "no-cache, must-revalidate";
    ctx.Response.ContentType = "text/html; charset=utf-8";
    await ctx.Response.SendFileAsync(index);
});

app.Run();
