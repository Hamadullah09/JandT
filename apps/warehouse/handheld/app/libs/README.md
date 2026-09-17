# The reader SDK

**`DeviceAPI_ver20230301_release.aar` is here and the UHF reader works.**

It came out of Chainway's own `C72 SDK & MANUAL` archive, from
`SDK C72/API_Ver20230301/version20230301/`. The same file also ships inside
their `uhf-uart-demo` under `Demo-uhf_as/`.

The AAR carries both halves of what the reader needs:

| | |
|---|---|
| `classes.jar` | `com.rscja.deviceapi.*` — 608 classes |
| `jni/{arm64-v8a,armeabi-v7a,armeabi}/` | `libDeviceAPIM.so` (MediaTek), `libDeviceAPIQ.so` (Qualcomm) |

The C72 reports itself as `C72_6765` — a MediaTek part — so `libDeviceAPIM.so`
is the one it loads, over `/dev/ttyS1`. Both are shipped because the SDK decides
at runtime and the pair costs about a megabyte.

## Nothing imports it

`rfid/ChainwayUhf.kt` reaches every one of these classes by reflection and names
none of them at compile time. That is why this folder can be emptied and the app
still builds, installs and runs — with the reader replaced by the barcode
scanner and the keypad, and the home screen saying so.

So: deleting this file degrades the app. It does not break the build.

## If you replace it with a newer release

Nothing to change. The method names it is reached by — `getInstance`, `init`,
`startInventoryTag`, `readTagFromBuffer`, `stopInventory`, `inventorySingleTag`,
`setPower`, `getPower`, `free` — have been stable across releases, and
`ChainwayUhf` looks each one up by name and argument count rather than by exact
signature. `init()` exists both with and without a `Context` and either is
accepted.

The one shape worth knowing about: `UHFTAGInfo.getRssi()` returns a **String**,
not a number. It is parsed, not cast.
