# Inaaya Commerce Platform

One platform for **Inaaya Store**'s operations: the RFID **clothing warehouse**
(stock, intake, picking, returns, handhelds) and the **J&T courier portal**
(waybills, bulk order import, tracking, WhatsApp order messages) — integrated
on **one PostgreSQL database**, behind **one address**, with **one login**.

```
                         ┌────────────────────────── gateway (nginx, :5080) ──────────────────────────┐
  Browser  ─────────────▶│  /warehouse/*  /api/*  /uploads/*        /api/v1/*        everything else  │
  C72 handhelds ────────▶│        │                                     │                  │           │
  Customers (tracking) ─▶└────────┼─────────────────────────────────────┼──────────────────┼───────────┘
                                  ▼                                     ▼                  ▼
                        warehouse-api (.NET 10)  ◀── books parcels ──  courier-api       courier-web
                        + React dashboard        ── reads tracking ─▶  (FastAPI)         (Next.js 14)
                                  │                                     │
                                  └──────────────┬──────────────────────┘
                                                 ▼
                                  PostgreSQL 16 — database "inaaya"
                                  ├─ core       accounts, sessions, audit log   (shared)
                                  ├─ warehouse  catalogue, RFID items, orders, returns, shipments
                                  └─ courier    J&T orders, tracking events, postcodes, imports
```

## Start it

Requirements: **Docker Desktop**. Nothing else is installed on the machine.

```bat
START.cmd
```

The first start creates `.env` with random secrets, builds the images (several
minutes) and opens the browser. After that it starts in seconds.

| | |
|---|---|
| Platform (login, courier portal) | http://localhost:5080 |
| Warehouse dashboard | http://localhost:5080/warehouse/ |
| Courier admin portal | http://localhost:5080/admin |
| Public parcel tracking | http://localhost:5080/tracking |
| Handhelds | `http://<this PC's IP>:5080` — they find it on their own |

Sign in as **`admin` / `admin123`** (everything) or **`linked` / `linked123`**
(merchant: courier portal only). Change both under *Users* after the first
login. Staff land in the warehouse, a merchant in the courier portal; the other
module is one click away in the menu.

`STOP.cmd` stops everything; data stays in Docker volumes.
`scripts\platform.ps1 status | logs | backup | restore | test` does the rest.

### Demo data

To show or try the platform without a real customer's name, phone number or
address on the screen:

```bat
scripts\platform.ps1 demo-data
```

Invented customers, orders and J&T parcels, spread over the last fortnight and
across every status — replacing the orders and parcels that are there, leaving
the catalogue, the stock and the accounts alone. `platform.ps1 import-legacy`
puts the shop's own data back.

## What the integration adds

| Before — two separate systems | Now — one platform |
|---|---|
| MySQL 8 (warehouse) **and** PostgreSQL 16 (J&T) | **One PostgreSQL 16 database**, one schema per module, least-privilege role per service |
| Two `users` tables, two `admin/admin123` logins | **One account table** (`core.users`), **single sign-on** and single sign-out across both modules and the handhelds |
| A picked order was re-typed into the J&T portal | **Book J&T courier** from the warehouse order: customer, address, garments and COD go across; tracking number and waybill come back |
| Nobody in the warehouse learned when a parcel arrived | J&T scans flow back: **Delivered** closes the warehouse order, **Returned** opens a return at the desk |
| Ports 5080, 8000, 3000, 3309 | **One gateway on :5080** (the port the handhelds already search for) |
| Two different-looking applications | **One design**: the shop's wordmark, typeface, colours and controls across both modules, on a phone as well as a laptop |
| Batch files, manual installs | **Docker Compose**: health checks, restart policies, JSON logs, request ids, non-root containers |

## Repository

```
├─ apps/
│  ├─ warehouse/            Clothing warehouse module
│  │  ├─ server/            .NET 10 API (Dapper + Npgsql) + test suites
│  │  ├─ dashboard/         React 18 + Vite dashboard  (served at /warehouse/)
│  │  └─ handheld/          Kotlin/Compose app for the Chainway C72
│  └─ courier/              J&T courier module (git history preserved)
│     ├─ backend/           FastAPI + SQLAlchemy + Alembic, waybill PDFs, CSV engine
│     ├─ frontend/          Next.js 14 merchant + admin portal, tracking page
│     ├─ whatsapp/          WhatsApp order notifier (Node)
│     └─ scripts/           CLI tools (bulk create, export, pack)
├─ database/
│  ├─ init/                 roles, schemas, core tables, cross-module grants (runs every start)
│  ├─ tools/                migrate_legacy.py (the shop's data), demo_data.py (invented data)
│  └─ legacy/               the MySQL backups the migration reads
├─ deploy/gateway/          nginx configuration
├─ tests/e2e/               cross-module end-to-end checks
├─ docs/                    architecture, deployment, migration, demo script
├─ docker-compose.yml
├─ START.cmd / STOP.cmd
└─ scripts/platform.ps1
```

## Tests

| Suite | What it covers | Result |
|---|---|---|
| `apps/warehouse/server/test/smoke.mjs` | intake, picking, shipping, returns cross-check, find, permissions | 117 checks |
| `apps/warehouse/server/test/features.mjs` | cancel/deliver/unpick, room tags, accounts, lookups, ledger rules | 96 checks |
| `apps/warehouse/server/test/catalogue.mjs` | products, variants, photos, search | 98 checks |
| `apps/warehouse/server/test/photosearch.mjs` | search by photo (ONNX model) | 26 checks |
| `apps/courier/backend/tests` (pytest) | CSV engine, waybill PDF regression, pipeline, tracking, auth, API | 504 tests |
| `tests/e2e/platform.mjs` | SSO, RBAC, CSRF, warehouse → J&T booking, tracking sync, instant single logout, gateway | 49 checks |

```bash
node tests/e2e/platform.mjs http://localhost:5080          # against the running platform
node apps/warehouse/server/test/smoke.mjs http://localhost:5080
```

## Documentation

* [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — design, data model, security, decisions
* [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — configuration, TLS, backups, operations
* [docs/MIGRATION.md](docs/MIGRATION.md) — MySQL → PostgreSQL port and data migration
* [docs/DEMO.md](docs/DEMO.md) — a guided walkthrough of the platform
* Module manuals: [apps/warehouse/README.md](apps/warehouse/README.md), [apps/courier/README.md](apps/courier/README.md)
