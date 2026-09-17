# Verification report

Every acceptance criterion from spec §14, with the command that proves it and the output
it produced. All runs are on the delivery machine: Windows 11, 8 cores, Python 3.11.9,
PostgreSQL 16 (Docker), Node 24.

---

## AC1 — `docker compose up` brings up web, API and a migrated, seeded database

Use `make up`, which is `docker compose up --build -d` with `DOCKER_BUILDKIT=0` — see
**[Known environment issue: OneDrive](#known-environment-issue-onedrive-files-on-demand)**.

```
$ make up

 Container jt_db   Started / Waiting / Healthy
 Container jt_api  Started / Waiting / Healthy
 Container jt_web  Started

$ docker compose ps
SERVICE   STATUS
api       Up 28 seconds (healthy)
db        Up 32 seconds (healthy)
web       Up 17 seconds

$ curl -s localhost:8000/health
{"status":"ok"}

$ curl -o /dev/null -w "%{http_code}" localhost:8000/docs                  # 200
$ curl -o /dev/null -w "%{http_code}" localhost:3000/order/bulk-import     # 200
```

Images: `jt-clone-api:latest` 614 MB, `jt-clone-web:latest` 224 MB.

Creating an order through the containerised API writes through the mounted volume:

```
$ curl -X POST localhost:8000/api/v1/orders -d '{... "output_dir":"/data/waybills/docker"}'
tracking_no   : 632158589094
sortation_code: 300-K41-SG496 / route E03
waybill_path  : /data/waybills/docker/OrderNo_DOCKER-0001.pdf

$ ls waybills/docker/                      # on the host
OrderNo_DOCKER-0001.pdf
```

And `JT_OUTPUT_ROOT` is enforced, so a container path outside the mount is refused before
anything is created:

```
$ curl -X POST localhost:8000/api/v1/bulk/check-output-dir -d '{"output_dir":"/etc/passwd-dir"}'
{"ok": false,
 "message": "The output directory must be inside /data/waybills (got /etc/passwd-dir).
             In Docker this is the mounted ./waybills volume."}
```

### Two defects found and fixed while getting here

1. `python:3.11-slim` ships pip 24.0, which cannot read the metadata on the pinned wheels
   (`No matching distribution found for pydantic-core==2.46.4`). The image now upgrades pip
   first, after which `pydantic_core-2.46.4` installs normally.
2. The Docker VM on this machine has a degraded route to PyPI — intermittent DNS failures
   and roughly 20 kB/s — which hung the build indefinitely. `PIP_DEFAULT_TIMEOUT=30` and
   `PIP_RETRIES=10` make it retry instead:

   ```
   WARNING: Retrying (Retry(total=5, ...)) after connection broken by
     'NameResolutionError("... Failed to resolve \'files.pythonhosted.org\' ...")'
   Downloading greenlet-3.5.1-...whl (614 kB)
      ━━━━━━━━━━━━━━━━━━━━━━━ 614.8/614.8 kB 19.7 kB/s  0:00:39
   ```

   The first API image build took ~25 minutes for this reason. It is a property of this
   machine's network, not of the image; a normal connection builds it in two or three.

The API container's entrypoint runs, on every boot:

```
[entrypoint] running migrations...
INFO  [alembic.runtime.migration] Running upgrade  -> 0001, initial schema
[entrypoint] seeding reference data...
[seed] tracking_seq: ready (last_value=2158571544)
[seed] sender_profile: seeded (JTMY027288)
[seed] postcode_zone: seeded 78945 rows via COPY in 2205 ms
[entrypoint] starting uvicorn...
```

Re-running is idempotent:

```
[seed] sender_profile: already present (JTMY027288)
[seed] postcode_zone: already present (78945 rows)
```

Migrations from a clean database:

```
$ alembic upgrade head
INFO  [alembic.runtime.migration] Context impl PostgresqlImpl.
INFO  [alembic.runtime.migration] Will assume transactional DDL.
INFO  [alembic.runtime.migration] Running upgrade  -> 0001, initial schema
```

The reference postcode resolves exactly as the reference waybill requires:

```
$ psql -c "SELECT * FROM postcode_zone WHERE postcode IN ('43000','43300','47810','94300')"
 postcode |  state   |      city      | zone_code | hub_code | dp_code | route_code
----------+----------+----------------+-----------+----------+---------+------------
 43000    | SELANGOR | KAJANG         | 300       | K41      | 496     | E03
 43300    | SELANGOR | SERI KEMBANGAN | 330       | S44      | 700     | E06
 47810    | SELANGOR | PETALING JAYA  | 781       | P66      | 390     | C06
 94300    | SARAWAK  | KOTA SAMARAHAN | 430       | Q18      | 700     | T03
```

`43000` → `300-K41-SG496`, route `E03` — identical to `OrderNo_12808.pdf`.

---

## AC2 / AC3 — the two pages match their reference screenshots

Side-by-side captures (reference above, generated below), both rendered at the reference's
1600 px width with headless Chrome:

* `docs/screenshots/bulk-import-orders-vs-reference.png`
* `docs/screenshots/normal-order-vs-reference.png`

Matched against the spec's design tokens rather than the JPEG's pixel grid — the supplied
screenshots are scaled (their 253 px sidebar occupies 270 px of image), so the tokens in
§4.1 are the ground truth: sidebar 253 px, top bar 56 px, controls 32 px, base font 13 px,
`--jt-red #DA251C`, `--jt-red-soft #F08A85`.

**Bulk Import Orders** — sidebar with the red pill on the active child, breadcrumb, tab
strip with the 2 px underline, the five toolbar buttons (Analysis Assistant greyed), the
red `How to import?` / `Import Rules` pair, the 26-column sticky-header grid with a blank
480 px body, the footer strip (`Data on this page: 0 Unit`, the grey modify-hint chip,
`‹ [1] ›`, `Total 0`) and the five-button action bar.

**Normal Order** — three cards with grey header strips; the sender card locked and grey
with only Address Details editable; `+ 60` phone prefixes; the `PARCEL` / `DOCUMENT`
segmented control with PARCEL outlined red; the `− 1 +` quantity stepper; read-only
Volumetric Weight; and the sticky footer with `Total Parcel` / `Total Weight` /
`Total Shipping Fee` and `Order` / `Save` / `List →` with its red count badge.

Required-field asterisks render **before** the label (`* Name:`) throughout.

---

## AC4 — a Normal Order returns a 12-digit `63…` tracking number and writes a PDF

```
$ curl -X POST localhost:8000/api/v1/orders -d @order.json

tracking_no    : 632158575044
sortation_code : 300-K41-SG496
route_code     : E03
freight_fee    : 6.86
waybill_url    : /api/v1/waybills/632158575044.pdf
service_scope  : SAME CITY
chargeable_wt  : 0.60
waybill_file   : OrderNo_NORMAL-0001.pdf
batch_id       : None

$ ls -la waybills/OrderNo_NORMAL-0001.pdf
-rw-r--r-- 1 HP 197121 5450 waybills/OrderNo_NORMAL-0001.pdf
```

Re-posting the same `customer_order_no` is refused as RFC 7807 problem+json:

```
HTTP 409  content-type=application/problem+json
{
    "type": "urn:jt:duplicate-order",
    "title": "Duplicate order number",
    "status": 409,
    "detail": "order_no NORMAL-0001 already exists - skipped (no new order)"
}
```

---

## AC5 — the generated waybill matches `OrderNo_12808.pdf`

Visual: `docs/waybill/waybill-vs-reference.png` (reference left, generated right, 4× raster).
Both PDFs are in `docs/waybill/`.

Measured, by decoding both content streams and rasterising at 4×:

| element | reference | generated |
|---|---|---|
| page size | 280 × 510 pt | 280 × 510 pt |
| receiver barcode | x 79.25 → 185.00 (w 105.75), y 484 → 504.25 | x 79.25 → 185.00 (w 105.75), y 484 → 504 |
| QR module matrix | x 208 → 268 (60), y 407 → 467 (60) | x 208 → 268 (60), y 407 → 467 (60) |
| dispatcher barcode | x 63.75 → 218.25 (w 154.50) | x 63.75 → 218.25 (w 154.50) |
| sender barcode | x 63.25 → 223.25 (w 160.00) | x 63.25 → 223.25 (w 160.00) |
| sortation code | 24 pt, centred at x 140.00 | 24 pt, centred at x 140.00 |
| route code `E03` | 24 pt, right edge 271.25 | 24 pt, right edge 271.25 |
| Receiver Copy bar | rect 41, 379, 189 × 10 | rect 41, 379, 189 × 10 |
| Dispatcher Copy bar | rect 171, 190, 108 × 20 | rect 171, 190, 108 × 20 |
| Sender Copy bar | rect 0, 1, 279 × 10 | rect 0, 1, 279 × 10 |
| phone masking | `******94` / `******06` | `******94` / `******06` |
| date format | `2026-09-14` | `2026-09-14` |
| legal sentences | verbatim | verbatim |

46 individual text items are asserted against the reference's own text matrices by
`tests/test_waybill.py::TestTextAgainstReference`, which also asserts that the reference
really contains each expected item — so the expectation table cannot silently drift.

The one systematic difference is font metrics: the spec mandates Helvetica, while the
reference embeds Arial and MicrosoftYaHei subsets. Helvetica is slightly narrower, so
*centred* strings start a few points further right while remaining centred on exactly the
same axis — the 24 pt sortation code starts at 53.29 vs 49.93 and both centre on x = 140.00.

---

## AC6 — a 500-row CSV completes in under 15 seconds with 500 correctly named PDFs

```
$ python -m tests.bench_500

parse+validate :    196.4 ms   (500 rows, 500 ok, 0 invalid)
create (3,4,5) :    393.2 ms
render (6)     :   6546.9 ms
pipeline total :   6922.0 ms
END TO END     :   7136.5 ms   <-- budget 15000 ms

created=500 duplicates=0 failed=0
PDFs on disk   : 500  (e.g. OrderNo_20000.pdf)
manifest       : manifest_1.csv
orders table   : count=500 distinct_tracking_no=500 OK

AC6 under 15 s        : PASS
AC6 one PDF per order : PASS
AC7 unique tracking   : PASS
```

**7.1 s against a 15 s budget.** Spec §11's sub-budgets are met too: steps 1–5 take
196 + 393 = **589 ms** against 2 s, and step 6 takes **6.5 s** against 13 s.

Also verified through the browser: a 500-row upload via the Bulk Import Orders page,
committed with **Order all (Async)**, produced 500 PDFs and reported
`duration_ms = 9739` including SSE progress overhead.

### How the budget was won

| change | render stage, 500 rows |
|---|---|
| naive | 10.9 s |
| reuse one process pool instead of one per batch | 5.9 s |
| encode the QR once and emit a run-length path | *(included above; per-label 83 ms → 42 ms)* |

and for the create stage:

| change | steps 3–5, 500 rows |
|---|---|
| SQLAlchemy ORM bulk insert (19,000 bind parameters in one statement) | 2301 ms |
| parameterised `text()` executemany + one read-back | **393 ms** |

---

## AC7 — all 500 tracking numbers are unique

```
$ psql -c "SELECT count(*), count(DISTINCT tracking_no) FROM orders"
 count | count
-------+-------
   500 |   500
```

The guarantee is the database's: `CREATE UNIQUE INDEX uq_orders_tracking_no ON orders(tracking_no)`.
`tests/test_pipeline.py::TestIdempotency::test_the_unique_index_is_the_real_guard` proves the
constraint rejects a hand-written duplicate even when the application pre-check is bypassed.

---

## AC8 — re-importing the same CSV creates zero new orders

```
$ python -m tests.bench_500          # second run, same file
created=0 duplicates=500 failed=0
PDFs on disk   : 0
orders table   : count=500 distinct_tracking_no=500 OK
```

Confirmed through the UI as well — re-committing the template CSV reported
`0 order(s) created in 136 ms, 3 duplicate(s) skipped.`

No PDF is written and no tracking number is consumed for a duplicate.

---

## AC9 — 10 broken rows yield 490 orders and 10 precise errors

`samples/bulk_orders_broken.csv` is 490 good rows with 10 deliberately broken ones mixed in.

```
$ python -m tests.bench_500 --csv samples/bulk_orders_broken.csv --out .../broken

parse+validate :    137.0 ms   (500 rows, 491 ok, 9 invalid)
created=490 duplicates=0 failed=10
PDFs on disk   : 490
```

`import_errors_1.csv`:

```
row_no,order_no,status,field,message
4,39000,error,receiver_postcode,receiver_postcode must be exactly 5 digits: '478'
53,39001,error,receiver_postcode,postcode 04000 is not a recognised Malaysian postcode
102,39002,error,receiver_phone,receiver_phone: not a Malaysian mobile number: '0225064173'
151,39003,error,receiver_phone,receiver_phone: phone is required
200,39004,error,actual_weight,actual_weight is required
249,39005,error,actual_weight,actual_weight must not exceed 30 kg: '45'
298,39006,error,receiver_name,receiver_name is required
347,39007,error,receiver_address,receiver_address must be 5-200 characters (got 2)
396,39008,error,address_type,address_type must be HOME or OFFICE: 'CASTLE'
445,39009,error,quantity,quantity must be 1 or more: '0'
```

Nine are caught at validation and one (`04000`, structurally valid but outside the national
plan) at enrichment — all ten are reported per row, and the other 490 are unaffected.

---

## AC10 — the CLI and the web path produce byte-identical PDFs

Same CSV, same starting sequence value, two different code paths:

```
$ python scripts/bulk_create.py --csv samples/bulk_orders_500.csv --out .../cli_a \
      --workers 8 --start-seq 2158571544
created 500, elapsed 6.74 s, exit 0

$ # database reset, sequence restarted at 2158571544, same file through POST /bulk/upload + /commit
created=500 duplicates=0 failed=0 duration_ms=4904

CLI files=500  API files=500  same names=True
identical=500  different=0
ALL 500 PDFs ARE BYTE-IDENTICAL  -> AC10 PASS
```

This works because the renderer is deterministic (`invariant=1` fixes the document ID and
both timestamps) and because the CLI imports the very same `core` / `csv_engine` / `waybill`
modules the API uses.

---

## AC11 — `pytest` is green

```
$ cd backend && pytest -q
........................................................................ [ 35%]
........................................................................ [ 71%]
..........................................................               [100%]
202 passed in 45.54s
```

| file | tests | covers |
|---|---|---|
| `test_core.py` | 59 | tracking numbers, sortation, scope, masking, phone, weights, pricing, filename safety and collisions |
| `test_csv_engine.py` | 35 | header aliasing, the real production header set, per-row validation, batch resilience |
| `test_waybill.py` | 64 | PDF regression against the reference and a golden byte stream, overflow, Unicode, watermark |
| `test_pipeline.py` | 15 | the full 100-row pipeline, idempotency, partial failure, artefacts |
| `test_api.py` | 29 | the whole §12 contract over ASGI |

Database-backed tests are marked `db` and skip with a clear reason when PostgreSQL is not
reachable, so the suite is green on a bare laptop and complete in CI.

---

## AC12 — README

`README.md` documents setup (Docker and host), the CSV contract, the alias map, output
naming and collision rules, the engine's derivations, the pipeline, idempotency, the API,
the CLI, every environment variable, tuning guidance, the data-model additions, and a
**Known deviations** section listing all six places this build departs from the letter of
the spec and why.

---

## Known environment issue: OneDrive Files On-Demand

The project lives under `C:\Users\HP\OneDrive\Desktop\`. With OneDrive's *Files On-Demand*
enabled, every file carries a `ReparsePoint` attribute even when it is fully downloaded,
and **BuildKit refuses to read reparse points**:

```
#5 ERROR: invalid file request alembic/env.py
failed to solve: invalid file request alembic/env.py
```

This is a Docker Desktop + OneDrive interaction, not a defect in this project — the same
tree builds fine with the legacy builder, which walks the context differently:

```
DOCKER_BUILDKIT=0 COMPOSE_DOCKER_CLI_BUILD=0 docker compose build
```

`make up` and `make dev` set those variables, so the documented entry point works as-is.
Three permanent fixes, in order of preference:

1. keep the repository outside the OneDrive folder;
2. right-click the folder → **Always keep on this device**, then disable Files On-Demand in
   OneDrive settings;
3. keep using `DOCKER_BUILDKIT=0`.

Everything else — the API, the CLI, the web app, the test suite and every timing figure
above — is unaffected and was measured on this machine from this directory.
