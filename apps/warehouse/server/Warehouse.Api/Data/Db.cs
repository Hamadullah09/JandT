using Dapper;
using Npgsql;

namespace Warehouse.Api.Data;

/// <summary>
/// Connection factory and schema bootstrap.
///
/// Dapper over Npgsql rather than an ORM: the interesting part of this system is
/// its queries — the stock rollup by colour and size, the return cross-check,
/// the movement ledger — and those read better as SQL than as generated
/// expression trees.
///
/// The warehouse lives in the `warehouse` schema of the platform's single
/// PostgreSQL database, next to `core` (accounts, shared with the courier
/// portal) and `courier`. Every connection's search path is
/// warehouse, core, public, so the queries name tables without a schema and
/// `users` resolves to the platform's one account table.
/// </summary>
public sealed class Db : IAsyncDisposable
{
    public const string SearchPath = "warehouse,core,public";

    private readonly NpgsqlDataSource _dataSource;

    public Db(string connectionString)
    {
        var builder = new NpgsqlConnectionStringBuilder(connectionString);

        // Forced rather than documented, so a hand-typed connection string cannot
        // leave the queries resolving `orders` to some other module's table.
        builder.SearchPath = SearchPath;
        if (string.IsNullOrWhiteSpace(builder.ApplicationName)) builder.ApplicationName = "warehouse-api";

        _dataSource = new NpgsqlDataSourceBuilder(builder.ConnectionString).Build();
    }

    public async Task<NpgsqlConnection> OpenAsync(CancellationToken ct = default) =>
        await _dataSource.OpenConnectionAsync(ct);

    /// <summary>For the readiness probe: can we reach the database right now.</summary>
    public async Task<bool> PingAsync(CancellationToken ct = default)
    {
        try
        {
            await using var conn = await OpenAsync(ct);
            return await conn.ExecuteScalarAsync<int>("SELECT 1") == 1;
        }
        catch (Exception ex) when (ex is NpgsqlException or TimeoutException or OperationCanceledException)
        {
            return false;
        }
    }

    public ValueTask DisposeAsync() => _dataSource.DisposeAsync();

    /// <summary>
    /// Brings the warehouse schema up to date. Safe on every start: schema.sql is
    /// all IF NOT EXISTS, and several copies of the API starting together take
    /// turns on an advisory lock instead of racing each other's DDL.
    /// </summary>
    public async Task MigrateAsync(ILogger logger, CancellationToken ct = default)
    {
        await using var conn = await OpenAsync(ct);

        // The platform bootstrap (database/init) creates the schemas, the app
        // roles and core.users. Without it every foreign key to users fails with
        // a message that says nothing about the real cause, so check first.
        var ready = await conn.ExecuteScalarAsync<bool>("""
            SELECT to_regclass('core.users') IS NOT NULL
               AND to_regnamespace('warehouse') IS NOT NULL
            """);
        if (!ready)
        {
            throw new InvalidOperationException(
                "The platform database has not been initialised: schema `warehouse` or table `core.users` " +
                "is missing. Run database/init (docker compose runs it as the db-init service) and start again.");
        }

        await conn.ExecuteAsync("SELECT pg_advisory_lock(hashtext('warehouse.migrate'))");
        try
        {
            await using var tx = await conn.BeginTransactionAsync(ct);
            await conn.ExecuteAsync(await ReadSchemaAsync(), transaction: tx, commandTimeout: 120);
            await SeedAsync(conn, tx);
            await tx.CommitAsync(ct);
        }
        finally
        {
            await conn.ExecuteAsync("SELECT pg_advisory_unlock(hashtext('warehouse.migrate'))");
        }

        logger.LogInformation("Warehouse schema is up to date");
    }

    /// <summary>
    /// The minimum a fresh database needs to be usable: somebody to sign in as,
    /// and enough of a catalogue that the first product can be added without
    /// first filling in three lookup tables.
    ///
    /// Each block is guarded separately. Deleting all the sizes because you
    /// want your own should not bring them back on the next restart, so only a
    /// completely empty table is filled.
    /// </summary>
    private static async Task SeedAsync(NpgsqlConnection conn, NpgsqlTransaction tx)
    {
        // The platform's first account. The courier portal seeds the same row if
        // it happens to start first; ON CONFLICT makes the two starts safe to race.
        if (await conn.ExecuteScalarAsync<long>("SELECT COUNT(*) FROM core.users", transaction: tx) == 0)
        {
            await conn.ExecuteAsync("""
                INSERT INTO core.users (username, password_hash, full_name, role, status)
                VALUES (@username, @hash, @fullName, 'admin', 'active')
                ON CONFLICT (username) DO NOTHING
                """,
                new
                {
                    username = "admin",
                    hash = Passwords.Hash("admin123"),
                    fullName = "Administrator",
                }, tx);
        }

        if (await conn.ExecuteScalarAsync<long>("SELECT COUNT(*) FROM sizes", transaction: tx) == 0)
        {
            await conn.ExecuteAsync(
                "INSERT INTO sizes (code, name, sort_order) VALUES (@code, @name, @sort)",
                // Four, because that is what the garments are made in. More
                // sizes in the list than the factory cuts means a buyer can
                // order a size nobody can supply, and every stock report grows
                // rows that are permanently zero.
                new[]
                {
                    new { code = "S",  name = "Small",       sort = 20 },
                    new { code = "M",  name = "Medium",      sort = 30 },
                    new { code = "L",  name = "Large",       sort = 40 },
                    new { code = "XL", name = "Extra large", sort = 50 },
                }, tx);
        }

        if (await conn.ExecuteScalarAsync<long>("SELECT COUNT(*) FROM colors", transaction: tx) == 0)
        {
            await conn.ExecuteAsync(
                "INSERT INTO colors (code, name, hex) VALUES (@code, @name, @hex)",
                new[]
                {
                    new { code = "BLACK", name = "Black",  hex = "#111111" },
                    new { code = "WHITE", name = "White",  hex = "#F5F5F0" },
                    new { code = "NAVY",  name = "Navy",   hex = "#1B2A4A" },
                    new { code = "BEIGE", name = "Beige",  hex = "#D8C9AE" },
                    new { code = "MAROON", name = "Maroon", hex = "#6B1F2E" },
                    new { code = "GREEN", name = "Green",  hex = "#1F5C3A" },
                }, tx);
        }

        if (await conn.ExecuteScalarAsync<long>("SELECT COUNT(*) FROM categories", transaction: tx) == 0)
        {
            await conn.ExecuteAsync(
                "INSERT INTO categories (code, name) VALUES (@code, @name)",
                new[]
                {
                    new { code = "SHALWAR", name = "Shalwar kameez" },
                    new { code = "KURTA",   name = "Kurta" },
                    new { code = "SHIRT",   name = "Shirt" },
                    new { code = "TROUSER", name = "Trousers" },
                    new { code = "WAISTCOAT", name = "Waistcoat" },
                    new { code = "DUPATTA", name = "Dupatta" },
                }, tx);
        }

        if (await conn.ExecuteScalarAsync<long>("SELECT COUNT(*) FROM rooms", transaction: tx) == 0)
        {
            await conn.ExecuteAsync(
                "INSERT INTO rooms (code, name, kind) VALUES (@code, @name, @kind)",
                new[]
                {
                    new { code = "A1", name = "Room A1", kind = "storage" },
                    new { code = "A2", name = "Room A2", kind = "storage" },
                    new { code = "B1", name = "Room B1", kind = "storage" },
                    new { code = "B2", name = "Room B2", kind = "storage" },
                    new { code = "C1", name = "Room C1", kind = "storage" },
                    new { code = "GOODS-IN", name = "Goods in", kind = "receiving" },
                    new { code = "PACKING", name = "Packing bench", kind = "packing" },
                    new { code = "RETURNS", name = "Returns bench", kind = "returns" },
                }, tx);
        }
    }

    private static async Task<string> ReadSchemaAsync()
    {
        var candidate = Path.Combine(AppContext.BaseDirectory, "Data", "schema.sql");
        if (File.Exists(candidate)) return await File.ReadAllTextAsync(candidate);
        throw new FileNotFoundException($"schema.sql was not found at {candidate}");
    }
}
