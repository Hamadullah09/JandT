# From two systems to one database

This records what changed when the Clothing Warehouse (MySQL 8) and the J&T
courier portal (PostgreSQL 16) became the Inaaya Commerce Platform, and how to
move existing data across.

## 1. Stack conflicts and how each was resolved

| Conflict | Warehouse | J&T courier | Resolution |
|---|---|---|---|
| Database engine | MySQL 8 (Dapper + MySqlConnector) | PostgreSQL 16 (SQLAlchemy + asyncpg) | **PostgreSQL 16** for both; warehouse ported to Npgsql |
| Table names | `orders`, `users` | `orders`, `users` | schema per module: `warehouse.orders`, `courier.orders`; one `core.users` |
| Accounts | bcrypt, `active` flag, roles admin/operator | PBKDF2, `status`, roles admin/merchant | one table: `status` + derived `active`; roles admin/operator/merchant; both hash formats verified, PBKDF2 written |
| Sessions | stateless JWT (12 h), bearer | random token in cookie, server-side rows | one JWT format naming a server-side session row; cookie *and* bearer accepted by both |
| Timestamps | `DATETIME`, server-local | `timestamptz` | `timestamptz` everywhere; business dates in `APP_TIMEZONE` |
| Ports / origins | :5080 (API + dashboard) | :8000 API, :3000 web | one gateway on :5080; dashboard at `/warehouse/` |
| Deployment | `START.cmd`, MySQL on the host | Docker Compose / `.bat` + venv | one Docker Compose stack |
| Folder layout | repository root | `J&T/J&T` (an `&` breaks `cmd.exe`) | `apps/warehouse`, `apps/courier` (courier git history preserved) |

## 2. Warehouse: MySQL → PostgreSQL port

The table shapes, the API responses and every business rule are unchanged — the
four warehouse test suites (337 checks) pass unmodified against PostgreSQL. What
had to change in the SQL:

| MySQL | PostgreSQL |
|---|---|
| `INSERT …; SELECT LAST_INSERT_ID();` | `INSERT … RETURNING id` |
| `SUM(status = 'x')` | `COUNT(*) FILTER (WHERE status = 'x')` |
| `GROUP BY p.id` with other tables' columns | group by every joined table's key |
| `DELETE fr FROM a fr JOIN b …` | `DELETE FROM a fr USING b …` |
| `UPDATE a JOIN b SET a.x = …` | `UPDATE a SET x = … FROM b WHERE …` |
| `IN @list` (Dapper expansion) | `= ANY(@list)` (Npgsql arrays) |
| case-insensitive collation (`name = @name`, `LIKE`) | `lower(name) = lower(@name)`, `ILIKE` |
| `ORDER BY x DESC` (NULLs last) | `ORDER BY x DESC NULLS LAST` |
| `CONCAT(…)`, `CAST(… AS CHAR/SIGNED)` | `\|\|`, `::text`, `bigint` |
| `DATE_SUB(NOW(), INTERVAL n DAY)`, `DATE(x)` | `now() - make_interval(days => n)`, `(x AT TIME ZONE tz)::date` |
| `ENUM`, `TINYINT(1)`, `DATETIME`, `VARBINARY` | `varchar + CHECK`, `smallint`, `timestamptz`, `bytea` |
| `information_schema` checks before `ALTER`/`CREATE INDEX` | `IF NOT EXISTS` everywhere |
| `ON UPDATE CURRENT_TIMESTAMP` | trigger `warehouse.touch_updated_at()` |
| `FOR UPDATE` on joins (locks every joined row) | `FOR UPDATE OF <table>` |
| boolean expressions returned as 0/1 | `::int` casts where the handheld reads a number |
| reference numbers from `MAX()` in a transaction | same, plus `pg_advisory_xact_lock` so concurrent intakes queue instead of failing |

## 3. Courier: onto the shared database

* Tables moved into the `courier` schema by setting the connection's
  `search_path` (`courier, core, public`); Alembic's version table lives there
  too. No courier SQL had to change.
* `users` and `user_sessions` now map to `core.users` / `core.user_sessions`;
  migration `0005` checks the platform tables exist instead of creating its own.
* Logins issue the platform token; `current_user` accepts cookie or bearer and
  checks the session row. Cookie name: `inaaya_session`.
* The admin portal shows which warehouse order a parcel was booked from (read
  from `warehouse.shipments`, inside a savepoint so a courier-only database still
  works).
* Naive `datetime.now()` writes became UTC-aware.

## 4. Moving the existing data

`database/tools/migrate_legacy.py` performs the one-time move, in a single
PostgreSQL transaction:

1. starts a throwaway `mysql:8.4` container and loads the latest warehouse dump
   into it (MySQL reads its own dump — binary photo embeddings included);
2. merges warehouse accounts into `core.users` by username;
3. copies every warehouse table **with its ids**, converting `DATETIME` from the
   old server's zone (`--mysql-timezone`, Asia/Karachi for the development PC) to
   UTC, and remapping user references; moves every identity sequence past the
   imported ids;
4. imports the J&T portal's order export (`--courier-export`) **with the original
   tracking numbers**, recomputing sortation and route codes from the postcode
   table, and moves `tracking_seq` past them so new parcels never collide;
5. links orders present in both systems — same customer name and phone — by
   creating `warehouse.shipments` rows, exactly as if they had been booked from
   the warehouse.

```powershell
# the platform must have started once, so the schemas exist
docker compose up -d
python database\tools\migrate_legacy.py `
  --pg "postgresql://inaaya:<POSTGRES_PASSWORD>@127.0.0.1:5433/inaaya" `
  --mysql-dump database\legacy\mysql-backups\backup-before-delete-product-20260917.sql `
  --mysql-timezone Asia/Karachi `
  --courier-export apps\courier\exports\orders_2026-09-17_1602.csv `
  --replace
```

Requirements on the machine running it: Python 3.11 with `psycopg`, `pymysql`
and the courier backend's requirements; Docker.

Afterwards restart the warehouse API (`docker compose restart warehouse-api`);
it reads photos whose embeddings are missing in the background.

`database/legacy/` keeps the original MySQL dumps and scripts for reference and
is not used at runtime.

## 5. Demo data, instead of the shop's own

For a demonstration, a training session or a test run, the shop's customers
should not be on the screen at all:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\platform.ps1 demo-data
```

`database/tools/demo_data.py` empties the orders, the parcels and the returns
and writes invented ones in their place - a fortnight of trading by twelve
invented customers, at every stage from *to pick* to *returned*, booked through
the platform's own API so each parcel has a real waybill and a real journey. The
catalogue, the garments on the shelves and the accounts are left alone: they
carry nobody's personal data, and without them the screens would be empty.

Both directions are repeatable: `demo-data` and `import-legacy` each replace
what the other left behind.
