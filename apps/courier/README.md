# Inaaya Store Order Portal — order portal + bulk CSV order engine

> **Part of the Inaaya Commerce Platform.** This module now runs with the clothing
> warehouse on one PostgreSQL database (schema `courier`), behind one gateway
> (<http://localhost:5080>), with one login shared with the warehouse and its
> handhelds — start it with `START.cmd` at the [repository root](../../README.md).
>
> What changed for this module:
> * the database is the platform's (`JT_DATABASE_URL` → role `courier_app`,
>   `JT_DB_SCHEMA=courier`); accounts and sessions are `core.users` /
>   `core.user_sessions`, and the login cookie is `inaaya_session`
>   (`JT_AUTH_JWT_SECRET` must equal the platform's `AUTH_JWT_SECRET`);
> * roles are `admin`, `operator` (warehouse staff) and `merchant`;
> * warehouse orders book parcels through `POST /api/v1/orders` with
>   `source = Warehouse`, and the admin portal links each such parcel back to its
>   warehouse order;
> * the website calls the API on its own origin (`NEXT_PUBLIC_API_BASE` empty).
>
> The stand-alone instructions below (`make up`, ports 3000/8000, `jt-portal`)
> describe the module as it was built; on the platform, use the root
> `docker-compose.yml`. The `jt*.bat` command-line tools still work from this
> folder once `.env` points at the platform database.

A self-hosted order portal for [Inaaya Store](https://inaayastore.com), in the shop's
own style (ink black on white, Plus Jakarta Sans, the Inaaya wordmark), with a working
order-creation engine.

* **Normal Order** — a single-order form.
* **Bulk Import Orders** — upload one CSV of receiver + item data, get N orders, N unique
  tracking numbers, N parcel labels, one packing PDF per item and a WhatsApp
  "order created" message per order.

Parcels travel with J&T Express, so the **parcel label stays in the courier's 3-copy
waybill format**; everything the shop and its customers see is Inaaya Store's.
There is no live courier API and no browser automation: tracking numbers, sortation
codes, route codes and waybills are generated locally and deterministically.

---

## 1. Quick start

### Docker (everything, zero config)

```bash
make up          # or: docker compose up --build
```

> **If the project sits in a OneDrive-synced folder**, use `make up`. OneDrive's *Files
> On-Demand* marks every file as a reparse point and BuildKit refuses to read those
> (`invalid file request alembic/env.py`). `make up` selects the legacy builder, which
> handles them. Details and permanent fixes: [docs/VERIFICATION.md](docs/VERIFICATION.md#known-environment-issue-onedrive-files-on-demand).

* web → <http://localhost:3000>
* API → <http://localhost:8000/docs>
* Postgres → `localhost:5432` (`jt` / `jt` / `jt`)

The API container runs `alembic upgrade head`, seeds the sender profile and ~79,000
postcodes, then starts Uvicorn. Waybills land in `./waybills`, which is mounted into the
container at `/data/waybills`.

> Inside Docker, `JT_OUTPUT_ROOT=/data/waybills`, so every output directory you type into
> the UI must be under `/data/waybills` — that is the only writable mounted volume. On a
> host install `JT_OUTPUT_ROOT` is empty and any absolute path is allowed.

### Host install (no Docker for the app, Postgres in Docker)

```bash
docker compose up -d db

cd backend
pip install -r requirements.txt
export JT_DATABASE_URL=postgresql+asyncpg://jt:jt@localhost:5432/jt
alembic upgrade head
python -m app.db.seed
uvicorn app.main:app --reload --port 8000

cd ../frontend
npm install
npm run dev
```

### Make targets

| target | what it does |
|---|---|
| `make dev` / `make up` | `docker compose up --build -d` |
| `make down` | stop the stack |
| `make clean` | stop and drop the database volume |
| `make migrate` | `alembic upgrade head` |
| `make seed` | seed sender profile + postcodes (idempotent) |
| `make test` | `pytest` |
| `make bench` | the 500-row timing harness |

---

## 2. Repository layout

```
jt-clone/
├─ docker-compose.yml   Makefile   .env.example
├─ backend/
│  ├─ app/
│  │  ├─ main.py                FastAPI app, routers, /health
│  │  ├─ config.py              settings + the fixed sender profile
│  │  ├─ api/  v1/{orders,bulk,waybills,settings}.py, schemas.py, errors.py
│  │  ├─ core/ tracking.py sortation.py pricing.py masking.py phone.py
│  │  │        weights.py naming.py
│  │  ├─ csv_engine/ schema.py parser.py pipeline.py
│  │  ├─ waybill/    layout.py renderer.py batch.py dto.py text.py
│  │  └─ db/         models.py session.py seed.py postcodes.py
│  ├─ alembic/       migrations
│  ├─ config/        rates.yml
│  ├─ samples/       bulk_orders_template.csv, _500.csv, _broken.csv
│  └─ tests/         202 tests, golden PDF fixtures
├─ frontend/         Next.js 14 App Router + Tailwind + TanStack Table
└─ scripts/
   ├─ bulk_create.py   standalone CLI: csv in → PDFs out, no server
   ├─ gen_types.py     OpenAPI → frontend/lib/types.gen.ts
   └─ make_samples.py  regenerate the sample CSVs
```

---

## 3. The CSV contract

The contract is derived from the **real production file** supplied with the build
(`bulk_orders.csv`), whose header row is:

```
order_no, receiver_name, receiver_phone, receiver_postcode, receiver_city,
receiver_state, receiver_address, address_type, goods_name, item_variant,
quantity, actual_weight, length, width, height, payment_type, cod_amount,
order_value, remark
```

`samples/bulk_orders_template.csv` is generated from this column set plus the optional
`source` and `dropship` columns, with fictional example customers (never real ones - the
template is downloaded from the portal and this repository is public).

| Column | Req | Rule |
|---|---|---|
| `order_no` | ✅ | ≤ 64 chars. Becomes `customer_order_no` and drives the PDF filename. |
| `receiver_name` | ✅ | 1–60 chars |
| `receiver_phone` | ✅ | MY mobile. `01x…` / `601x…` / `+601x…` / punctuated forms all normalise to `+60 1XXXXXXXX`. Non-mobiles rejected. |
| `receiver_postcode` | ✅ | exactly 5 digits **and** present in `postcode_zone` |
| `receiver_city` | ⬜ | falls back to the postcode's city |
| `receiver_state` | ⬜ | falls back to the postcode's state |
| `receiver_address` | ✅ | 5–200 chars |
| `address_type` | ⬜ | `HOME` \| `OFFICE`, default `HOME` |
| `goods_name` | ✅ | item description |
| `item_variant` | ⬜ | size/variant, printed as ` -  M` on the sender copy |
| `quantity` | ⬜ | int ≥ 1, default 1 |
| `actual_weight` | ✅ | kg, > 0, ≤ 30 |
| `length` / `width` / `height` | ⬜ | cm, default 0 |
| `payment_type` | ⬜ | `PREPAID` \| `COD`, default `PREPAID` |
| `cod_amount` | ⬜ | ≥ 0. Must be > 0 when `payment_type` is `COD`; forced to 0 when `PREPAID`. |
| `order_value` | ⬜ | ≥ 0, default 0 |
| `remark` | ⬜ | free text |
| `source` | ⬜ | where the order came from: `Website` (default), `WhatsApp`, `Facebook`, `Instagram`, `TikTok Shop`, `Daraz`, `Shopee`, `Lazada`, `Amazon`, `eBay`, `Etsy`, `Other` - common spellings such as `daraz.pk` are tidied; any other name is kept as written. Also read from `channel`, `platform`, `marketplace`. |
| `image` | ⬜ | product photo for the WhatsApp message: a file in `images/` or a full path |
| `dropship` | ⬜ | `yes` / `no` per item row - see the WhatsApp drop-ship group |

**No sender columns.** If a file contains `sender_name`, `deliverer_postcode` and so on,
they are ignored and reported as a warning — the sender is always the fixed profile.

### Header matching and the alias map

Matching is case-insensitive and insensitive to whitespace, underscores, hyphens, dots,
slashes and brackets, so `Receiver Name` == `receiver_name` == `RECEIVER NAME`, and
`Weight (kg)` == `weight_kg`.

On top of that, `app/csv_engine/schema.py::ALIASES` maps common real-world spellings onto
the canonical names so nobody has to edit their export:

```
Order Number / Customer Order No / Reference / Invoice No   -> order_no
Recipient Name / Consignee Name / Name                      -> receiver_name
Contact Number / Mobile / Phone                             -> receiver_phone
Postal Code / Postcode / Zip                                -> receiver_postcode
Delivery Address / Address Details / Address                -> receiver_address
Product Name / Item Name / Description                      -> goods_name
Qty                                                         -> quantity
Weight / Weight (kg)                                        -> actual_weight
Payment Method                                              -> payment_type
COD / Value / Amount                                        -> cod_amount / order_value
Notes / Remarks                                             -> remark
```

Add a row to that dict to support another spelling; nothing else changes.

### Validation output

Every row produces `{row_no, status, field, message}`. Failures appear in the grid's
**Error Message** column, in the API response's `row_errors[]`, and in
`import_errors_<batch_id>.csv` next to the PDFs.

---

## 4. Output paths and file naming

The output directory is chosen **before** the run:

* UI — the `Save waybills to:` field on Bulk Import Orders, persisted in `localStorage`
  and on `import_batch.output_dir`. **Check folder** validates it; the run is blocked with
  an inline error if it does not exist, cannot be created or is not writable. Nothing is
  allocated or created until that passes.
* CLI — `--out /path/to/dir`.

Naming:

* `OrderNo_{order_no}.pdf` — matches the supplied `OrderNo_12808.pdf`.
* blank `order_no` → `{tracking_no}.pdf`.
* collisions → `_1`, `_2`, … and never a silent overwrite. Names are also reserved in
  memory for the duration of a batch, so two rows in the same run cannot race.
* sanitised for Windows and POSIX: `\ / : * ? " < > |` stripped, whitespace collapsed,
  trailing dots removed, reserved device names (`CON`, `LPT1`, …) prefixed, capped at 100
  characters.

Written into the same directory:

* `manifest_<batch_id>.csv` — `order_no, tracking_no, receiver_name, receiver_postcode,
  sortation_code, route_code, chargeable_weight, waybill_file, status, error`
* `import_errors_<batch_id>.csv` — only when something failed
* `merged_<batch_id>.pdf` — optional, via `JT_MERGE_PDF=true` or `--merge-pdf`

---

## 5. The order engine

### Tracking numbers

```
tracking_no = "63" + zero_pad(sequence_value, 10)      # 12 digits
```

`SEQUENCE` mode (default) draws from a native PostgreSQL sequence `tracking_seq`, seeded
at `JT_TRACKING_SEQ_START` (default `2158571544`, so numbers look contemporaneous with the
reference waybill `632158571544`). N numbers cost exactly one round trip. `RANDOM` mode
draws cryptographically random digits and retries against the unique index.

Either way the guarantee is the database's, not the application's:
`CREATE UNIQUE INDEX uq_orders_tracking_no ON orders(tracking_no)`.

### Sortation and route codes

```
sortation_code = f"{zone_code}-{hub_code}-{state_abbr}{dp_code}"     # 300-K41-SG496
route_code     = postcode_zone.route_code                            # E03
```

* `zone_code` — digits 2–4 of the postcode (`43000` → `300`).
* `state_abbr` — two-letter carrier code (`SELANGOR` → `SG`).
* `hub_code`, `dp_code`, `route_code` — **seeded per postcode** in `postcode_zone`.

> **Deviation from the spec, on purpose.** Spec §8.2 gives
> `route_segment = state_abbr + postcode[-3:]`, which for `43000` yields `SG000` — but the
> reference waybill reads `SG496`. The last three digits cannot be derived from the
> postcode, so `dp_code` is a seeded column instead, pinned to `496` for `43000` to
> reproduce the reference exactly. Unseeded postcodes fall back to deterministic rules
> (`fallback_hub_code` / `fallback_dp_code` / `fallback_route_code`) and never crash.

`postcode_zone` is generated from the national allocation ranges — ~79,000 rows covering
every state, with per-block city and hub data for the Klang Valley and all the major
towns. Postcodes outside the national plan (`04000`, `99999`) are rejected per row.

### Service scope

* either endpoint in Sabah / Sarawak / Labuan → `EAST`
* same state, or both inside the Klang Valley → `SAME CITY`
* otherwise Peninsular-to-Peninsular → `WEST`

The Klang Valley clause is what reproduces the reference: it ships 43300 Seri Kembangan →
43000 Kajang and is stamped `SAME CITY` even though those are different towns.

### Phone masking

`mask()` renders `******` + the last two digits. It is a **presentation concern only** —
the masked form appears on the printed waybill and nowhere else. The database and the UI
always hold the full number.

### Freight

`config/rates.yml` holds a zone × weight rate card (first kg + per started extra kg) plus a
COD handling fee. Edit and restart. The Normal Order footer prices drafts through
`POST /api/v1/orders/quote`, so the UI total and the charged amount come from the same
rate card — no pricing logic is duplicated in the browser. Freight is never printed on the
waybill.

---

## 6. The waybill

280 × 510 pt (≈100 × 180 mm thermal label), one page, pure black on white, drawn with
ReportLab's `canvas` API at absolute coordinates.

**Every coordinate lives in `app/waybill/layout.py`** as a named constant, measured off the
reference PDF by decoding its content stream and cross-checking against a 4× raster. The
renderer contains no positional literals.

Three stacked copies separated by dashed cut lines — Receiver, Dispatcher, Sender — each
with a Code128 barcode, the receiver block, and a black copy-name bar. The dispatcher copy
carries the large sortation code, the route code, the `NORMAL` / `SAME CITY` service badge
and, when `cod_amount > 0`, a rotated grey `COD` watermark drawn behind the text.

**Determinism.** The canvas is created with `invariant=1`, which fixes the document ID and
both timestamps, so the same order always renders byte-identical output — the property that
lets the CLI and the web path be compared byte-for-byte.

Fonts are Helvetica / Helvetica-Bold (metrically equivalent to the reference's Arial), with
Bitstream Vera — which ships inside ReportLab — registered as a TrueType fallback for
non-Latin receiver names. Using the bundled font rather than a system DejaVu keeps output
identical between a Windows host and the Linux container.

Text that does not fit is **truncated with a trailing `-`**, never wrapped past its box and
never overlapped.

---

## 7. The bulk pipeline

```
1. UPLOAD + PARSE   pandas, every cell as text, BOM tolerated
2. VALIDATE         per-row pydantic; ok / error partition
3. ENRICH           one query resolves every postcode; weights, scope, freight
4. ALLOCATE         N tracking numbers in ONE sequence call
5. PERSIST          one executemany INSERT + one read-back
6. RENDER           ProcessPoolExecutor over render_waybill
7. FINALISE         manifest + error CSVs, batch marked done
```

Steps 3–5 issue a fixed, small number of statements regardless of row count — no per-row
`SELECT`, no per-row `INSERT`, no N+1. Rows are processed in chunks of
`JT_PIPELINE_CHUNK` (default 1000) so a 5,000-row file never holds every label in memory.

Progress is available at `GET /api/v1/bulk/{batch_id}/progress` as SSE
(`?stream=false` for a single snapshot), which drives the determinate progress bar and the
live counter in the UI.

### Two performance notes worth knowing

* **QR encoding was 72% of render time.** ReportLab's `QrCodeWidget` encodes twice (once in
  `getBounds`, once in `draw`) and builds a scene graph of ~3,600 nodes per label.
  `_qr_code` now encodes once and emits the module matrix as a single run-length-encoded
  path with identical geometry. Per-label render time went from 83 ms to 42 ms.
* **The render pool is created once per process.** On Windows and macOS the pool starts
  workers with *spawn*, which re-imports the parent's `__main__` in every child — about a
  second per worker when `__main__` pulls in SQLAlchemy and pandas. Reusing one pool
  amortises that, and the CLI and bench entry points keep their module-level imports tiny
  so the re-import stays cheap. This alone took the 500-row render stage from 10.9 s to
  5.9 s.

---

## 8. Idempotency

Re-importing the same CSV creates **zero** new orders.

* Before inserting, one query checks `customer_order_no` against `orders` and marks hits as
  `duplicate`.
* The real guard is the database: a partial unique index
  `uq_orders_customer_order_no ON orders(customer_order_no) WHERE customer_order_no IS NOT NULL`
  plus `ON CONFLICT DO NOTHING`. A row that loses a race is reported as a duplicate, never
  written twice.
* A duplicate produces no PDF and no tracking number, and is listed in the error CSV.

---

## 9. API

```
GET    /api/v1/settings/sender                fixed sender profile
PUT    /api/v1/settings/sender                update it (existing orders keep their snapshot)

POST   /api/v1/orders                         create ONE order (Normal Order)
POST   /api/v1/orders/quote                   price a draft, create nothing
GET    /api/v1/orders?page=&size=&q=          paginated list
GET    /api/v1/orders/{tracking_no}

POST   /api/v1/bulk/check-output-dir          validate a folder before a run
POST   /api/v1/bulk/upload        (multipart) parse + validate + stage only
POST   /api/v1/bulk/{id}/commit   [?async=]   run the pipeline
GET    /api/v1/bulk/{id}/progress             SSE progress frames
GET    /api/v1/bulk/{id}/rows                 staged rows for the grid
DELETE /api/v1/bulk/{id}/rows                 delete staged rows
GET    /api/v1/bulk/{id}/manifest.csv
GET    /api/v1/bulk/{id}/errors.csv

GET    /api/v1/waybills/{tracking_no}.pdf     stream one waybill
GET    /api/v1/waybills/batch/{id}.zip        every waybill in a batch
GET    /api/v1/templates/bulk.csv             Template Download
GET    /health
```

Errors are RFC 7807 `application/problem+json`, with a `row_errors[]` array on the bulk and
validation paths.

**Types are generated, not hand-written.** `python scripts/gen_types.py` reads the FastAPI
OpenAPI schema and writes `frontend/lib/types.gen.ts`, so a field rename cannot silently
diverge between Pydantic and TypeScript. Re-run it after changing any schema.

---

## 10. The standalone CLI

Runs with no web server and no browser, against the same `core` / `csv_engine` / `waybill`
modules the API uses — zero logic duplication.

```bash
python scripts/bulk_create.py \
  --csv  "C:/Users/me/Desktop/orders_sept.csv" \
  --out  "C:/Users/me/Desktop/Waybills/Sept" \
  --sender-profile default \
  --workers 8 \
  [--dry-run] [--merge-pdf] [--start-seq 2158571544] [--quiet]
```

Live progress with a rows/sec readout, then a summary table (total, created, duplicates,
failed, elapsed, throughput, output dir, manifest) and a table of rejected rows.

Exit codes: `0` every row created · `1` partial · `2` fatal (bad CSV, unusable output
directory, no sender profile).

---

## 10a. Admin portal, tracking page and order export

| Command | What it does |
|---|---|
| `jt-portal` | Starts the API and the website in two windows and opens the admin portal. |
| `jt-export` | Writes every order to `exports/orders_<date>_<time>.csv` and opens it in Excel. `--today`, `--days 7`, `--status DELIVERED` narrow it down. |

Both the portal and the admin screens fold their menu into a drawer (the **☰**
button) below a laptop width, and the wide tables and the calendar scroll inside
their own frame, so a phone shows the same screens rather than a squeezed page.

**Admin portal** (`/admin`) - every order, newest first, with its tracking status,
in large type. New orders appear on their own (the page checks every 10 seconds)
and are marked NEW. "Where did the orders come from?" filters by source
(Website, Daraz, Amazon... with counts), the status boxes filter by status, and
search takes a tracking number, order number, name or phone. The pencil on each
row opens the order.

**Calendar** (`/admin/calendar`) - a month of orders by day, Malaysia time: how many
orders came in each day (busier days are a deeper sand colour), how many parcels were
delivered or returned that day, and the month's totals with the cash on delivery
to collect. It filters by source like the dashboard; clicking a day lists that
day's orders, with the pencil and a download of just that day. Tick orders to mark them Picked Up, In Transit, On
Delivery, Delivered or Returned in one go, or open one to record a single scan
(On the Way, At Sorting Hub, At Local Branch...) with its place and time, or delete a
mistake. **Export CSV** downloads what the page shows.

**Tracking page** (`/tracking/<waybill>`, up to 10 separated by commas) - in
Inaaya Store's style, with the shop's menu: the stage icons, the status, and the
scans grouped by day in Malaysia time, in plain words ("The parcel has arrived at
Kuantan Hub"). It shows no names or addresses. The courier's own page asks for a
slide puzzle before it shows anything, so statuses cannot be read from it
automatically; they are the scans recorded in the admin portal
(`tracking_event`, migration `0004`).

**Upload many orders** (`/order/bulk-import`) - three steps: choose (or drag in)
a CSV file, check the orders (source, drop-ship, payment and any problem per
row), then **Create N orders**. The result says how many orders were created,
how many WhatsApp "order created" messages are on their way (and how many go to
the drop-shipping group), and offers one packing PDF per item - 25 customers
ordering the same dress give one PDF with 25 labels - plus every label as a zip
and the order list. Saving the labels to a folder of your own is optional.

**The CSV** - one row per order. The tracking number is an Excel `HYPERLINK`
to its tracking page (the plain address is repeated in the last column), phone
numbers and postcodes are kept as text, and any value that starts like a
formula is neutralised. Links point at `JT_TRACKING_PAGE_URL`
(default `http://localhost:3000/tracking/`).

**Zip code check** - Normal Order's Smart Address Filling reads a pasted address
(one line, or the lines of a WhatsApp message) into name, phone, postcode, city,
state and address. A postcode fills in a blank city and state. A state, or a
post-office town, that does not belong to the postcode shows *Zip code does not
match* with a one-click fix, and the API refuses such an order. Unknown
localities such as "Kota Damansara" are never called a mismatch. The postcode
list is `backend/app/db/data/malaysia_postcodes.json` (MIT, see the README
beside it).

---

## 10b. Logins

Every page except the tracking page needs a login. `jt-portal` opens
`http://localhost:3000/login`, in Inaaya Store's style. The box takes a
username, phone number or email.

| Account | Login | Sees |
|---|---|---|
| Admin | `admin` / `admin123` | the admin portal (`/admin`) and the merchant portal |
| The shop | `linked` or `0135763706` / `linked123` | the merchant portal |

These two are created when the API first starts with no accounts at all; change
their passwords in **Admin Portal → Users → Set password** (they are simple on
purpose, for now). **Add user** on the Users page makes an account that works at
once - a shop user or another admin. **Create an account** (`/signup`) makes a merchant login that
waits until the admin approves it on the Users page, where accounts can also be
blocked (which logs them out) or given a new password. **Forgot password** says to
ask the admin.

Passwords are stored as PBKDF2-SHA256 hashes. A login is an HttpOnly cookie
holding a random token; the `user_sessions` table keeps only its SHA-256, and it
lasts 7 days. The API checks every call: the tracking page and login are public,
the merchant portal needs any active account, and the admin portal - order
statuses, exports, users - needs the admin (migration `0005`).

---

## 11. Configuration

Copy `.env.example` to `.env`. Every variable is prefixed `JT_`.

| variable | default | meaning |
|---|---|---|
| `JT_DATABASE_URL` | `postgresql+asyncpg://jt:jt@localhost:5432/jt` | async SQLAlchemy URL |
| `JT_OUTPUT_ROOT` | *(empty)* | output directories must resolve under this. Empty = any absolute path. Docker sets `/data/waybills`. |
| `JT_TRACKING_PREFIX` | `63` | 1–4 digits |
| `JT_TRACKING_MODE` | `SEQUENCE` | `SEQUENCE` \| `RANDOM` |
| `JT_TRACKING_SEQ_START` | `2158571544` | sequence floor |
| `JT_RENDER_WORKERS` | `0` | 0 = `os.cpu_count()` |
| `JT_RENDER_CHUNK` | `32` | labels per pool task — the measured optimum |
| `JT_PIPELINE_CHUNK` | `1000` | rows per persist/render chunk |
| `JT_MERGE_PDF` | `false` | also write `merged_<batch>.pdf` |
| `JT_CORS_ORIGINS` | `["http://localhost:3000", …]` | JSON list |
| `JT_MAX_UPLOAD_MB` | `64` | upload cap |

### Tuning

* **Throughput is bounded by PDF rendering.** Raise `JT_RENDER_WORKERS` on a bigger box;
  `JT_RENDER_CHUNK` of 16–64 is flat, and 32 measured best on 8 cores.
* **Very large files** — lower `JT_PIPELINE_CHUNK` to cut peak memory, raise it to cut
  round trips. A chunk over ~4,600 rows would exceed PostgreSQL's 32,767 bind-parameter
  limit for the 38-column insert; 1000 leaves plenty of headroom.
* **Seeding** uses `COPY` for the postcode table (~2.2 s for 79k rows). It is idempotent
  and short-circuits on later boots.

---

## 12. Data model notes

Three deliberate additions beyond the spec's table list, all because the real CSV needs
them or the API contract does:

* `orders.receiver_city`, `orders.order_payment_type`, `orders.order_value` — columns
  present in the real production CSV (spec §16: *do not drop columns it does contain*).
  `order_payment_type` is the CSV's `PREPAID`/`COD` flag for the goods; it is **distinct
  from** `payment_type`, which is the freight billing mode snapshotted from the sender
  profile and printed on the waybill as `MONTHLY`.
* `import_row` — staging table for parsed-but-uncommitted rows. Required by the API
  contract (`commit` takes `row_ids`, `DELETE …/rows`) and by the grid.
* `tracking_seq` — a native PostgreSQL `SEQUENCE` rather than a counter table: lock-free,
  collision-free and allocatable in one round trip. Spec §8.1 permits either.

Sender fields are **snapshotted onto every order at creation time**, so editing the sender
profile never mutates orders that already exist.

---

## 13. Tests

```bash
cd backend && pytest -q          # 202 tests
```

Tests that need PostgreSQL are marked `db` and skip themselves, with a clear reason, when
nothing is reachable — so the suite is green on a laptop with nothing running and exercises
the full stack in CI.

* **unit** — tracking numbers, sortation, service scope, masking, phone normalisation,
  weight maths, pricing, filename sanitising and collision handling
* **CSV** — header aliasing, the real production header set, per-row validation, batch
  resilience
* **PDF regression** — every text item, black bar, rule and barcode box asserted against
  `tests/golden/OrderNo_12808_reference.pdf` (the artefact shipped with the spec), plus a
  byte-comparison against a committed golden render and overflow/Unicode/watermark cases
* **integration** — the full 100-row pipeline, idempotency, partial failure, artefacts
* **API** — the whole contract over ASGI

The golden PDF intentionally fails if renderer output changes; the failure message prints
the command to regenerate it.

`python -m tests.bench_500` prints the staged timing breakdown for a 500-row run.

---

## 14. Known deviations

Everything here was chosen deliberately and is explained above.

1. **`dp_code` is seeded, not derived** — spec §8.2's formula cannot produce the reference's
   `SG496` from postcode `43000`. See §5.
2. **`SAME CITY` covers the whole Klang Valley**, not just an exact city match — required to
   reproduce the reference's 43300 → 43000 lane. See §5.
3. **Three extra `orders` columns and an `import_row` table** — see §12.
4. **A `Save waybills to:` row on Bulk Import Orders** that the reference screenshot does
   not have. Spec §10 requires the output directory to be chosen and validated up front, so
   it has to live somewhere on that page.
5. **Multiple-Pieces Shipment Order and International Orders** are sidebar entries (the
   sidebar is matched to the screenshot) whose routes render a short "outside the scope of
   this build" page rather than a non-functional form.
6. **Helvetica instead of Arial/MicrosoftYaHei** — spec §9 calls for it. The two are
   metrically close but not identical, so centred and right-aligned strings land within a
   few points of the reference rather than exactly on it; the PDF regression test allows a
   tolerance that scales with font size and asserts the centring itself.
