# Clothing Warehouse

RFID stock and order management for a clothing warehouse. Every garment carries
its own tag, so the system knows not just *how many* navy mediums are in room
B2, but *which ones* — and that is what makes it possible to tell a customer
that the garment they sent back is not the one that was sent to them.

> **Part of the Inaaya Commerce Platform.** The warehouse now runs together with
> the J&T courier module on one PostgreSQL database, behind one gateway, with one
> login — see the [platform README](../../README.md). Orders book their J&T
> parcel from the order page, and J&T's delivered/returned scans move the order
> along by themselves.

## Starting it

Double-click **`START.cmd` at the repository root**. It starts the whole
platform in Docker and opens it. The dashboard is at
<http://localhost:5080/warehouse/>.

```
admin / admin123
```

Change that password under *My account* before anybody else uses it.

The dashboard wears the shop's own design - the same wordmark, typeface, colours
and controls as the courier portal (`dashboard/src/styles.css` holds the tokens,
copied from the portal's `tailwind.config.ts`) - and folds its menu into a drawer
below a laptop width, so a packing-bench tablet gets the same screens.

### Running the API on its own (development)

```powershell
docker compose up -d postgres db-init          # from the repository root
$env:ConnectionStrings__Postgres = "Host=127.0.0.1;Port=5433;Database=inaaya;Username=warehouse_app;Password=<WAREHOUSE_DB_PASSWORD>"
$env:Auth__Secret = "<AUTH_JWT_SECRET>"
dotnet run --project server/Warehouse.Api --urls http://127.0.0.1:5081
```

## What it does

**Rooms.** A1, B2, C3 and the benches. Each can carry a door tag, so a handheld
knows where it is standing because somebody scanned a doorframe rather than
because they picked the right room off a list.

**Catalogue.** A product is a style — "Embroidered Shalwar Kameez". What you
actually sell and count is a colour and a size of it. Six colours in five sizes
is thirty variants, created in one pass rather than thirty.

**Stock, or dropship.** A stock product is tagged and sits in a room. A dropship
product never arrives: the supplier ships it to the customer, so it has no tag
and no room, and its stock is a number rather than a pile. Orders can mix the
two, and the picking screen only asks for tags on the lines that need them.

**Booking in.** You say what arrived — 50 shalwar kameez, in these colours and
sizes — and that becomes an intake with a line per colour and size. Tags then go
on one at a time and each line counts down. The quantity is a limit: the 51st
scan is refused, because the alternative is a mis-scan quietly inventing stock.

**Orders.** There is no public website yet, so orders are typed in or imported.
That is the only difference — an order placed by a customer later is the same
row with `channel` set to `web`, and none of these screens change. Picking is a
scan box: scan any garment the order wants and the server works out which line
it fills, or refuses it with a reason.

**Orders that arrive as a spreadsheet.** Sales files have a customer, an
address, a total and the name of a dress — and no order number and no date,
because nothing outside this system issues either. *Import orders* takes the
file and mints both, which is the difference between an order that can be
picked, shipped and returned against and a line in a spreadsheet.

Nothing is written until the preview has been read. The file is parsed in the
browser, matched against the catalogue by the server, and every row is shown
with what will happen to it. A dress name that matches one garment is used; one
that matches several is left for a person, because picking the first is how a
customer is sent a medium when they ordered a large. A name that matches
nothing is either created as a new product or skipped, and you say which.

Each row is imported in its own transaction, so a file of four hundred where
six name an unknown dress imports three hundred and ninety-four and hands back
six lines saying which and why.

**Returns.** A return is opened against one order. Each garment that comes over
the counter is scanned and gets one of four verdicts:

| | |
|---|---|
| **Correct garment** | went out on this order — this is the only one that is restocked and refunded |
| **Another order** | it is ours, but it went to somebody else. The desk is told which order |
| **Never sent out** | ours, but it has never left the building |
| **Not our tag** | we have never seen it |

Every scan is kept, including the failures — a tag from a different order is
evidence, not an error to throw away at the counter. Nothing is restocked and no
money moves until the return is closed, so the desk can scan, reconsider and
remove a scan without having changed anything.

Closing it moves two numbers in opposite directions: stock value goes **up** by
what the returned garments cost, and the order's revenue goes **down** by the
refund.

**Finding a garment.** Put a tag, a product code or an order number on the find
list and every handheld picks it up. The reader stops counting stock and starts
hunting — a bar that fills as the operator closes in, and a radar screen for
several at once.

## Layout

```
apps/warehouse/
├─ server/       .NET 10 + Dapper + PostgreSQL 16  [337 checks pass]
│  ├─ Warehouse.Api/
│  └─ test/      smoke, features, catalogue, photo search; demo data
├─ dashboard/    React 18 + Vite admin panel       (served at /warehouse/)
├─ handheld/     Kotlin + Compose, for the C72     [done, reader SDK pending]
├─ scripts/      firewall rule, photo-search model download
└─ Dockerfile    API + dashboard in one image
```

The dashboard builds straight into the API's `wwwroot`, so the module is one
image: one thing to deploy, and nothing to keep in step.

```
  Handheld (C72)              Platform gateway :5080
  ┌──────────────┐            ┌─────────────────────────────────────────┐
  │ Kotlin app   │ HTTP+token │ warehouse API (.NET 10) + dashboard     │
  │ RFID SDK     │ ─────────▶ │    │ books parcels ▶ courier API (J&T)   │
  │ local queue  │  (offline  │    ▼                                    │
  │              │  tolerant) │ PostgreSQL: warehouse · courier · core  │
  └──────────────┘            └─────────────────────────────────────────┘
```

## Three decisions worth knowing about

**Tags are never written to.** An EPC is whatever the factory printed on it, and
the system treats it as an opaque unique key. Nothing is encoded into it and
nothing is decoded out of it. That means any brand of tag works, there is no
encoding scheme to get permanently wrong, and a failed write can never leave a
garment in a half-tagged state.

**The ledger is the truth.** `items.room_id` and `items.status` are kept up to
date for fast queries, but every change also appends a row to `movements`, which
is never updated or deleted. A garment's history on its own page is read from
there, and it is what settles an argument about whether something was ever
actually sent.

**Cost is copied, not joined.** Each garment records what *it* cost at intake
rather than pointing at the current price. Re-pricing a style next season must
not silently restate the value of everything bought last season.

## Checking it still works

With the platform running (the suites write test data - use a development copy):

```bash
cd server && node test/smoke.mjs http://localhost:5080
```

`smoke.mjs` is 117 checks, in the order the warehouse does them: intake quotas, duplicate tags,
picking, shipping, all four return verdicts, restocking, refunds, the find list
and the permission rules. Each one is a sentence about the business, so a
failure says which rule broke rather than which line threw.

`features.mjs` is a further 96, covering what smoke does not: cancelling and
delivering an order, taking a garment back off one, rejecting a return and
re-marking a damaged garment, room door tags, accounts and passwords, the
catalogue lookups, and the rules that stop you deleting something the ledger
still needs. Between them the two files touch every route.

```bash
cd server && node test/features.mjs http://localhost:5080
cd server && node test/catalogue.mjs http://localhost:5080
cd server && node test/photosearch.mjs http://localhost:5080
```

To fill an empty system with something to look at:

```bash
cd server && node test/demo-data.mjs http://localhost:5080
```

## Status

**The server and the admin panel are done and driven end to end in a browser.**
Intake with the countdown, picking by scan, the return cross-check catching a
garment from another order, restocking, refunds, and the find list.

**The handheld app is built.** All five jobs — booking in, picking, returns,
finding and moving — are in [handheld/](handheld/README.md), and it signs in
with the same accounts and talks to the same API.

One thing is outstanding: **the UHF trigger needs Chainway's SDK**, which is a
jar that ships with the device and is on no Maven repository. It is not in this
repository either. The app is written so that dropping it into
`handheld/app/libs/` and rebuilding turns the trigger on with no code change —
the reader classes are looked up by name at runtime, which is also why the app
builds and installs on a machine that has never seen the jar. Until then every
screen works through the C72's barcode scanner and its keypad.

For a handheld to reach this PC, run `scripts\allow-lan.cmd` once as
administrator. Windows Firewall blocks port 5080 until you do, and the symptom
is a handheld that says it cannot find a server that is running perfectly well.
The platform gateway listens on 5080, so handhelds already set up keep working.

Deployment: [docs/DEPLOYMENT.md](../../docs/DEPLOYMENT.md).
