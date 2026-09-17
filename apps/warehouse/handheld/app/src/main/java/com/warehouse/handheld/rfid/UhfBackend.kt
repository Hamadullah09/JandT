package com.warehouse.handheld.rfid

/** One answer from one tag. */
data class TagRead(
    val epc: String,
    val tid: String? = null,
    /** dBm, negative, closer to zero is nearer. 0 when the backend has none. */
    val rssi: Int = 0,
)

/**
 * One interface over however many ways this device can read a tag.
 *
 * There are two implementations here - Chainway's UHF module, and the keypad
 * and barcode scanner every C72 has whether or not the SDK is installed - and
 * the screens above cannot tell which one they are talking to. That is the
 * point: the five jobs an operator does are the same five jobs, and a warehouse
 * waiting for a jar to be located should not also be waiting to find out
 * whether the rest of the app works.
 *
 * It is also how the laundry build ended up supporting two vendors' readers in
 * one APK without any screen knowing either of their names.
 */
interface UhfBackend {

    /** Shown on the home screen, so the operator knows what they are holding. */
    val name: String

    /** Whether this backend can run on this device at all. */
    fun available(): Boolean

    val isOpen: Boolean

    /** Claims the reader. Returns false when the hardware refused. */
    fun open(): Boolean

    /**
     * Hands the reader back.
     *
     * Not optional, and not only on exit: no other app on the device can open
     * the module until this one closes it, and an operator who switches to the
     * stock-take app and finds a dead trigger will reboot the device rather
     * than report it.
     */
    fun close()

    /** Continuous inventory - the trigger is held down. */
    fun startInventory(onTag: (TagRead) -> Unit): Boolean

    fun stopInventory()

    /** One tag, the nearest. Returns null when nothing answered. */
    fun readOnce(): TagRead?

    /**
     * Whether the module has a hardware "find this one tag" mode.
     *
     * False on the keypad backend, and false on any SDK release that predates
     * it, so the screens fall back to working the closeness out from RSSI
     * themselves.
     */
    val canLocate: Boolean get() = false

    /**
     * Hunt for a single tag, and let the firmware say how close it is.
     *
     * This is a different thing from an inventory. The EPC is pushed down into
     * the module, which then talks to that tag and nothing else and reports a
     * **0-100** closeness many times a second. Working the same number out up
     * here from inventory RSSI cannot compete: in a room with twenty tags the
     * radio spends nineteen twentieths of its time on the wrong ones, so the
     * wanted tag is heard a few times a second and the number jumps about.
     *
     * Returns false when the module would not start; the caller then falls back
     * to RSSI.
     */
    fun startLocating(epc: String, onCloseness: (Int) -> Unit): Boolean = false

    fun stopLocating() = Unit

    var power: Int
}
