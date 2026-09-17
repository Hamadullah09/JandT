-- ============================================================================
-- Inaaya Commerce Platform - database bootstrap, step 1 of 3
--
-- ONE PostgreSQL database for the whole platform, split into one schema per
-- bounded context:
--
--   core       identity (users, sessions) and the audit trail - shared
--   warehouse  stock, intake, orders, picking, returns    (owned by warehouse_app)
--   courier    waybills, tracking, bulk imports           (owned by courier_app)
--
-- Each application logs in as its own role and owns only its own schema, so a
-- bug in one module cannot rewrite another module's tables. Cross-module reads
-- are granted explicitly (20-cross-module-grants.sql); cross-module writes go
-- through the owning module's API.
--
-- Run by the `db-init` service on every start. Every statement is idempotent.
-- Variables (psql -v): warehouse_password, courier_password
-- ============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------- app roles

SELECT format('CREATE ROLE warehouse_app LOGIN PASSWORD %L', :'warehouse_password')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'warehouse_app') \gexec
SELECT format('ALTER ROLE warehouse_app WITH LOGIN PASSWORD %L', :'warehouse_password') \gexec

SELECT format('CREATE ROLE courier_app LOGIN PASSWORD %L', :'courier_password')
 WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'courier_app') \gexec
SELECT format('ALTER ROLE courier_app WITH LOGIN PASSWORD %L', :'courier_password') \gexec

SELECT format('GRANT CONNECT, TEMPORARY ON DATABASE %I TO warehouse_app, courier_app', current_database()) \gexec

-- -------------------------------------------------------------- extensions

-- citext: usernames and emails compare case-insensitively.
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;
-- pgcrypto: hashes the default accounts' passwords when the platform is first
-- created (bcrypt; both applications rehash to PBKDF2 at the first login).
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;

-- Nobody but the owner creates objects in public (the PostgreSQL 15+ default,
-- stated here so an older server behaves the same way).
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO warehouse_app, courier_app;

-- ------------------------------------------------------------------ schemas

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS warehouse AUTHORIZATION warehouse_app;
CREATE SCHEMA IF NOT EXISTS courier   AUTHORIZATION courier_app;

-- AUTHORIZATION only applies when the schema is created; restate ownership so a
-- schema made by hand is corrected rather than silently left with the wrong owner.
ALTER SCHEMA warehouse OWNER TO warehouse_app;
ALTER SCHEMA courier   OWNER TO courier_app;

COMMENT ON SCHEMA core      IS 'Shared identity (users, sessions) and audit trail';
COMMENT ON SCHEMA warehouse IS 'Warehouse module: catalogue, RFID stock, intake, orders, returns';
COMMENT ON SCHEMA courier   IS 'Courier module (J&T): waybills, tracking, bulk order imports';

-- Every connection resolves unqualified names in its own module first.
ALTER ROLE warehouse_app SET search_path = warehouse, core, public;
ALTER ROLE courier_app   SET search_path = courier, core, public;
