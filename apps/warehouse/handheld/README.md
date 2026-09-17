# The C72 handheld

The Android app. Five screens, one for each job the warehouse floor does:

| | |
|---|---|
| **Book stock in** | pick an open intake, pick a line, scan a tag per garment. The line counts down and the server refuses the one past its quantity |
| **Pick an order** | scan any garment the order wants. Which line it fills is worked out from the tag |
| **Take a return** | scan what came back and read the verdict — correct garment, another order, never sent out, not ours |
| **Find a garment** | pull the open find list and hunt one down with a warmer/colder bar |
| **Move stock** | scan a doorframe to say which room you are standing in, then scan garments into it |

It talks to the same API the dashboard does, signs in with the same accounts,
and never decides anything the server decides — a verdict shown here is a
verdict the server gave.

## Building it

```
gradlew assembleDebug
```

The APK lands in `app/build/outputs/apk/debug/app-debug.apk`, about 15 MB.

Needs JDK 17 and an Android SDK with platform 35. Nothing else: it pulls its own
Gradle the first time.

## Installing it

Double-click **`install.cmd`**. It finds `adb`, builds the APK if it is missing,
installs onto whatever device is connected, and starts it.

First the C72 has to be visible. *Settings → About → tap the build number seven
times* turns Developer options on. Then either:

**Over USB.** *Developer options → USB debugging*, plug it in, accept the prompt
on the device.

**Over Wi-Fi** (Android 11 and later). *Developer options → Wireless debugging →
Pair device with pairing code*. The handheld shows an address, a port and a
six-digit code:

```
adb pair 192.168.x.x:PAIRING_PORT
adb connect 192.168.x.x:DEBUG_PORT
```

The two ports are different numbers, and reaching for the pairing port a second
time is the usual reason `connect` fails. The pairing port is on the pairing
dialog and disappears with it; the debug port is on the Wireless debugging
screen itself and stays.

Sideloading the APK from a USB stick works too, and needs neither a cable nor
adb.

## The reader

**The UHF trigger needs Chainway's SDK, which is not in this repository.** See
[`app/libs/README.md`](app/libs/README.md): drop the jar in and rebuild, and the
trigger starts working with no code change. `rfid/ChainwayUhf.kt` looks the
classes up by name at runtime, which is why the app builds and installs on a
machine that has never seen the jar.

Until then the app is complete and usable through the C72's **barcode scanner**
and its **keypad**. Every screen has an entry box; a wedge scanner types into it
and presses Enter for you. The home screen and Settings both say which reader is
live, so nobody has to guess.

## The server address

Compiled in, as `DEFAULT_SERVER` in `app/build.gradle.kts`:

```
http://192.168.100.6:5080
```

Change it there before you build for a different site. Settings on the device
overrides it, but the default has to be the real address — the laundry build
learned that the hard way, when the second handheld somebody set up installed,
opened, and could not reach a server that only ever existed on one desk.

Two things have to be true for a handheld to reach it:

- the application is bound to every interface, not just localhost. `START.cmd`
  does that (`--urls http://0.0.0.0:5080`)
- Windows Firewall lets port 5080 in. It does not by default. Run
  `scripts\allow-lan.cmd` **as administrator**, once, on the warehouse PC

## What is offline-tolerant, and what deliberately is not

**Moves and finds are queued.** Both are statements of fact the server cannot
argue with, so sending them late changes nothing. They survive a restart, and
Settings shows how many are waiting.

**Intake scans, order picks and return scans are not queued, on purpose.** Every
one of them is a *question* — is this the 51st tag, does this order want this
garment, did this garment really go out on this order — and the answer is the
whole reason for scanning it. Queuing one would mean either showing the operator
an answer this device invented, or showing them nothing and hoping. The first is
how two implementations of the return check end up disagreeing in front of a
customer; the second is how a picker walks away from a parcel that was never
filled. In a dead zone those three screens say so and stop.

## Layout

```
app/src/main/java/com/warehouse/handheld/
├─ MainActivity.kt      one activity; the trigger and the wedge are key events
├─ HandheldApp.kt       session, api, queue, reader
├─ data/
│  ├─ Api.kt            HttpURLConnection + org.json, no OkHttp
│  ├─ Session.kt        who is signed in, where the server is
│  └─ OfflineQueue.kt   moves and finds, and why only those
├─ rfid/
│  ├─ UhfBackend.kt     one interface over every way to read a tag
│  ├─ ChainwayUhf.kt    the C72's module, entirely by reflection
│  ├─ KeypadScanner.kt  the barcode wedge and the keypad
│  ├─ TriggerBus.kt     the trigger, which is a different key code on every revision
│  └─ Reader.kt         lifecycle, de-duplication, beeps
└─ ui/screens/          the five jobs, plus login and settings
```

## Two things worth knowing

**The reader is handed back on pause.** The UHF module is exclusive: an app that
holds it in the background stops every other app on the device from reading a
tag, with nothing on screen to say why.

**Repeat reads are dropped, except when hunting.** An inventory answers the same
tag many times a second, and without that one garment held in front of the
antenna becomes forty scans — on the intake screen, forty refusals to read past.
The find screen turns it off, because there one reading and then a dead bar is
exactly the failure.
