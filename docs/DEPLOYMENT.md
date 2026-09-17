# Deployment and operations

The platform runs anywhere Docker Compose runs: a Windows PC in the shop (Docker
Desktop), a Linux server, or a cloud VM. The same `docker-compose.yml` is used
everywhere; only `.env` changes.

## 1. Requirements

| | Minimum | Comfortable |
|---|---|---|
| CPU | 2 cores | 4 cores (waybill rendering and photo search use them) |
| Memory | 4 GB | 8 GB |
| Disk | 10 GB | 20 GB + product photos + backups |
| Software | Docker Engine 24+ with Compose v2 (Docker Desktop on Windows) | |

## 2. Configure

```bash
cp .env.example .env        # START.cmd does this on first run, with random secrets
```

| Variable | Meaning |
|---|---|
| `PUBLIC_BASE_URL` | the address people use, e.g. `https://ops.inaayastore.com`. Tracking links and CORS use it. |
| `GATEWAY_PORT` | host port of the gateway. Keep **5080** where handhelds are in use. |
| `APP_TIMEZONE` | the shop's time zone (order numbers, "today", calendars). |
| `COOKIE_SECURE` | `true` whenever the platform is served over HTTPS. |
| `POSTGRES_PASSWORD`, `WAREHOUSE_DB_PASSWORD`, `COURIER_DB_PASSWORD` | database superuser and the two module roles. Long and random. |
| `AUTH_JWT_SECRET` | signs every session (≥ 32 random characters). Changing it signs everyone out. |
| `PLATFORM_ADMIN_PASSWORD`, `PLATFORM_MERCHANT_PASSWORD` | the two first accounts, used only when the platform is created. |
| `COURIER_SYNC_SECONDS` | how often J&T statuses are read into the warehouse (default 20). |
| `WHATSAPP_ENABLED` | queue WhatsApp order messages (the notifier runs separately, see apps/courier/README.md). |
| `WAREHOUSE_UPLOADS_DIR`, `WAREHOUSE_MODELS_DIR` | host folders for product photos and the photo-search model. |

The applications refuse to start in production with a missing or placeholder
signing secret.

## 3. Start, stop, update

```bash
docker compose up -d --build     # or START.cmd
docker compose ps                # every service should be "healthy"
docker compose logs -f warehouse-api
docker compose down              # or STOP.cmd — data is kept
```

Updating to a new version:

```bash
git pull
docker compose build --pull
docker compose up -d            # migrations run automatically, idempotently
```

Both modules migrate their own schema at start (warehouse: `schema.sql` under an
advisory lock; courier: Alembic), after `db-init` has made the roles, schemas and
shared tables. All steps are safe to repeat.

## 4. HTTPS

Terminate TLS in front of the gateway and forward to port 5080. Any of:

* a cloud load balancer / reverse proxy with a certificate;
* **Caddy** on the same host (automatic Let's Encrypt):

  ```
  ops.inaayastore.com {
      reverse_proxy 127.0.0.1:5080
  }
  ```

Then set `PUBLIC_BASE_URL=https://ops.inaayastore.com` and `COOKIE_SECURE=true`,
and `docker compose up -d`.

The proxy must pass the browser's `Host` header through unchanged (Caddy and
most load balancers do): both APIs compare it with the browser's `Origin` before
accepting a change made with the session cookie.

**Handhelds on Android 7.1 or older** cannot validate Let's Encrypt certificates.
Keep them on the LAN address over HTTP (`http://<server>:5080`), or use a
certificate from a CA they trust.

## 5. Handhelds

1. The server's firewall must allow inbound TCP **5080** on the private network
   (Windows: `apps\warehouse\scripts\allow-lan.cmd`, run as administrator — it
   opens exactly that port).
2. On the C72: *Settings → Find server*. It scans the local network for
   `/api/health` on 5080. Or type `http://<server-ip>:5080`.
3. Staff sign in with their platform account (role `operator` or `admin`).

## 6. Backups

```powershell
scripts\platform.ps1 backup
```

writes `backups\inaaya-<timestamp>.dump` (PostgreSQL custom format: the whole
platform, every schema) and a zip of the product photos.

Restore (replaces the current database):

```powershell
scripts\platform.ps1 restore backups\inaaya-20260918-020000.dump
```

On Linux the equivalents are:

```bash
docker exec inaaya-postgres pg_dump -U inaaya -d inaaya -Fc > inaaya-$(date +%F).dump
docker exec -i inaaya-postgres pg_restore -U inaaya -d inaaya --clean --if-exists < inaaya-2026-09-18.dump
```

**Schedule it.** `warehouse.movements` is the record that settles disputed
returns and `courier.orders` holds every waybill ever issued. A nightly backup
kept for 30 days, copied off the machine, is the minimum. Test a restore on a
spare machine once a quarter.

Waybill PDFs (`inaaya_waybills` volume) do not need backing up: the courier API
re-renders any missing waybill byte-for-byte from the database.

## 7. Monitoring

| Check | Healthy |
|---|---|
| `GET /gateway/health` (gateway) | 200 |
| `GET /api/health` (through gateway) | 200 — what handhelds use |
| `docker compose ps` | every service `healthy` |
| `docker compose logs --since 1h \| grep '"status":5'` | nothing |

Inside the network, `http://warehouse-api:8080/health/ready` and
`http://courier-api:8000/health/ready` report database connectivity and
migration state. All logs are JSON with a `request_id` that is the same in the
gateway and in whichever API served the request.

## 8. Scaling

* The APIs are stateless apart from the database: run more replicas behind the
  gateway (`docker compose up -d --scale courier-api=2`, add them to the nginx
  upstream). Migrations and the courier sync are guarded by advisory locks, so
  replicas can start together.
* Product photos (`WAREHOUSE_UPLOADS_DIR`) and waybills must then be on shared
  storage.
* PostgreSQL: move to a managed service by pointing the connection settings at
  it and running `database/init` against it once.

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `db-init` exits with an error | wrong `POSTGRES_PASSWORD` for an existing volume. The password is fixed when the volume is created; use the original or recreate the volume (data loss). |
| Everyone signed out after an update | `AUTH_JWT_SECRET` changed. Set it once and keep it. |
| Handheld "cannot find server" | PC IP changed, or firewall. Run `apps\warehouse\ADDRESS.cmd`; allow TCP 5080. |
| Logging in on one module does not log in on the other | the two APIs have different signing secrets (only possible outside Compose). |
| "Search by photo is not set up" | the model file is missing: `apps\warehouse\scripts\get-photo-model.cmd`. |
| Booking J&T says "zip code does not match" | the city/state typed on the order disagrees with the postcode; leave them empty on the booking form and the courier fills them from its post-office list. |
| 429 on login | too many attempts from one address in a minute (gateway: 60/min, burst 30). |
