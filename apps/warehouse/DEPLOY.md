# Deploying the warehouse

The warehouse is deployed as part of the **Inaaya Commerce Platform** — see
[docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md) at the repository root.

What changed from the stand-alone warehouse:

* **Database.** MySQL 8 was replaced by the platform's PostgreSQL 16 (schema
  `warehouse`). The connection string setting is now
  `ConnectionStrings:Postgres`; the platform's `db-init` step creates the role,
  the schema and the shared account tables before the API starts. Existing MySQL
  data is moved with `database/tools/migrate_legacy.py` (see
  [docs/MIGRATION.md](../../docs/MIGRATION.md)).
* **Packaging.** The API and the dashboard are one Docker image
  (`apps/warehouse/Dockerfile`), started by the root `docker-compose.yml` behind
  the platform gateway on port 5080.
* **Sign-in.** Accounts are the platform's (`core.users`); the signing secret is
  the platform's `AUTH_JWT_SECRET`, shared with the courier module.
* **Shared hosting (myASP.NET / IIS)** is no longer a supported target: the
  platform needs PostgreSQL and runs the courier module (Python) alongside. The
  `OutOfProcess` hosting model is still set in the `.csproj`, so the API itself can
  still be published to IIS with `server\publish.ps1` if it is pointed at a
  PostgreSQL database that has been initialised with `database/init`.

Two notes from the original deployment guide still apply:

* **Search by photo needs its model file.** `models\dinov2-small.onnx` (84 MB) is
  not kept with the source code. Run `scripts\get-photo-model.cmd` once; the
  platform mounts it read-only into the container.
* **HTTPS and old handhelds.** Android 7.1 and older cannot validate Let's
  Encrypt certificates. Keep such devices on the LAN address over HTTP, or use a
  certificate from a CA they trust.
