-- ============================================================================
-- Inaaya Commerce Platform - database bootstrap, step 3 of 3: cross-module reads
--
-- The modules integrate in two directions, and the database grants exactly that
-- and no more:
--
--   warehouse -> courier   READ  the parcel's tracking status for a booked order
--   courier   -> warehouse READ  which warehouse order a parcel was booked from
--
-- Writes never cross: the warehouse books a parcel through the courier API, and
-- the courier never touches a warehouse table. Default privileges cover tables
-- the owning module creates later, so a new table is readable without editing
-- this file.
-- ============================================================================

\set ON_ERROR_STOP on

GRANT USAGE ON SCHEMA courier TO warehouse_app;
GRANT SELECT ON ALL TABLES IN SCHEMA courier TO warehouse_app;
ALTER DEFAULT PRIVILEGES FOR ROLE courier_app IN SCHEMA courier GRANT SELECT ON TABLES TO warehouse_app;

GRANT USAGE ON SCHEMA warehouse TO courier_app;
GRANT SELECT ON ALL TABLES IN SCHEMA warehouse TO courier_app;
ALTER DEFAULT PRIVILEGES FOR ROLE warehouse_app IN SCHEMA warehouse GRANT SELECT ON TABLES TO courier_app;
