# Phase 2 — the C72 handheld

The server side of this is already built and tested. What is left is the Android
app.

## What it has to do

Five jobs, in the order they matter:

1. **Book stock in.** Pick an open intake, pick a line, pull the trigger once per
   garment. The line counts down and refuses the scan past its quantity.
2. **Pick an order.** Pick an order that needs picking, scan garments onto it.
3. **Take a return.** Pick an open return, scan what the customer sent back, and
   show the verdict — correct garment, another order, never sent out, not ours.
4. **Find a garment.** Pull the open find list, hunt one tag with a
   warmer/colder bar, or several at once on the radar.
5. **Move stock.** Scan a doorframe to say which room you are in, then scan
   garments into it.

## Where the code comes from

Almost none of the reader work needs writing again. The laundry project at
`C:\Users\GT\Desktop\laundry-rfid\handheld` already solves the hard parts, and
these files port with the package name changed and little else:

| File | What it is | Changes needed |
|---|---|---|
| `rfid/UhfBackend.kt` | One interface over two vendors' SDKs — Chainway for the C72, Fntech U8 for the M10A and M11 | none |
| `rfid/ReaderWrapper.kt`, `rfid/RfidReader.kt` | Open, start, stop, power, hand back the reader | none |
| `rfid/TriggerBus.kt` | The hardware trigger, which reports a different key code on nearly every revision | none |
| `rfid/Radar.kt` | Bearing from a gyroscope, RSSI to 0–100, the sample window | none |
| `ui/screens/DriverRadarScreen.kt` | The radar face | labels only |
| `ui/screens/DriverFindScreen.kt` | The warmer/colder hunt | labels only |
| `data/OfflineStore.kt` | Local queue for a dead zone | the payloads change |
| `data/ApiClient.kt` | OkHttp + JWT + the error shape | the endpoints change |

`Radar.kt` is the piece worth not rewriting. A UHF reader cannot measure
direction — it only knows how loudly a tag answered, and the antenna is
directional. So the bearing is not measured but remembered: every read is
stamped with the heading the reader was on at that instant, and the tag is drawn
in whichever direction it answered loudest. That is why the operator has to turn
on the spot once, and why the screen is honestly empty until they do.

The two SDK `.aar`/`.jar` files in `laundry-rfid/handheld/app/libs/` are not on
any Maven repository and must be copied across.

## The API it talks to

All of it exists and is covered by `server/test/smoke.mjs`.

```
POST   /api/auth/login              {username, password} -> {token, user}
GET    /api/auth/me                 confirm the token is still good
```

**Booking in**

```
GET    /api/batches?status=open     the intakes waiting to be tagged
GET    /api/batches/{id}            lines, each with assigned / remaining
POST   /api/batches/{id}/assign     {epc, tid, batchLineId, roomId}
                                    -> {assigned, quantity, remaining}
DELETE /api/batches/{id}/assign/{itemId}    undo the last scan
POST   /api/batches/{id}/complete
```

**Picking**

```
GET    /api/orders?status=pending
GET    /api/orders/{id}             lines with picked / outstanding
POST   /api/orders/{id}/pick        {epc} -> {product, outstanding, orderStatus}
POST   /api/orders/{id}/ship
```

**Returns**

```
GET    /api/returns?status=received
GET    /api/returns/{id}            what went out, and what has come back
POST   /api/returns/{id}/scan       {epc, condition} -> {verdict, message, accepted}
```

`verdict` is one of `matched`, `wrong_order`, `not_shipped`, `unknown_tag`, and
`message` is already a sentence fit to put on the screen. The device should
never decide a verdict itself — that check is the whole point, and two
implementations of it would eventually disagree.

**Finding**

```
GET    /api/find?status=open        poll this; it is what fills the radar
POST   /api/find/{id}/found         {roomId}
```

**Looking a tag up, and moving**

```
GET    /api/items/by-epc/{epc}      -> {found, kind: item|room|unknown, ...}
GET    /api/room-tags/resolve/{epc} -> which room a doorframe tag means
POST   /api/items/move              {epcs: [...], roomId, note}
```

`by-epc` answers `kind: "room"` when the operator has scanned a doorframe, which
is a much better answer than "unknown tag" and is worth handling on every screen
that reads a tag.

## Things the laundry build learned the hard way

**`TreatTinyAsBoolean=false`.** Already forced on in `Data/Db.cs`. Without it
MySQL returns `true` where the app parses a number, and every device fails with
`Unexpected symbol 't' in numeric literal` — an error that says nothing about
its cause.

**Ship the server address in the build.** Not a developer's LAN address. The
first time a second handheld is set up, an address that only ever existed on one
desk means the app installs, opens, and says it cannot reach the server.
Override it in a Settings screen, but the default must be the real one.

**One APK, both SDKs.** They share no package names and cost about a megabyte
together. Three APKs means three things to install, three to update, and a
driver eventually holding the wrong one.

**Hand the reader back on pause.** Another app on the device cannot open the
module until this one closes it.

**Lock the radar's sample map.** It is written from the SDK's thread and read
from the one that draws, and without the lock they meet in the middle and take
the app down with a `ConcurrentModificationException`.

## What has to be decided before writing it

- **Which devices.** The laundry build covers the Chainway C72 and the Fntech
  M10A and M11. If only the C72 matters here, the Fntech jar can be dropped.
- **Offline.** How long a device is realistically out of signal decides whether
  the queue needs to survive a restart or only a walk across the floor.
- **Whether operators share a login.** One account per device is simpler;
  one per person is what makes `enrolled_by` and `picked_by` worth reading.
