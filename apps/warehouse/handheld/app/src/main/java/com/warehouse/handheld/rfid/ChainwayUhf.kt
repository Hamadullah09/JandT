package com.warehouse.handheld.rfid

import android.content.Context
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import java.lang.reflect.InvocationHandler
import java.lang.reflect.Method
import java.lang.reflect.Proxy

/**
 * The C72's UHF module, reached entirely by reflection.
 *
 * Nothing here imports `com.rscja.*`. The SDK is a jar that ships with the
 * device and is on no Maven repository, so a build machine that has never seen
 * it must still produce an APK, and that APK must still install on a phone with
 * no reader in it at all. `available()` answers whether the classes turned up;
 * every screen asks that rather than assuming.
 *
 * Drop the jar into `app/libs`, rebuild, and this class starts working without
 * a line changing. Until then `KeypadScanner` stands in, reading tag codes off
 * the barcode scanner.
 *
 * The method names are also not quite the same between SDK releases - `init()`
 * takes a Context in some and nothing in others - so each is looked up by name
 * across the shapes it is known to come in.
 */
class ChainwayUhf(private val context: Context) : UhfBackend {

    override val name = "Chainway UHF"

    private var reader: Any? = null
    private var readerClass: Class<*>? = null
    private var inventoryThread: HandlerThread? = null
    private var handler: Handler? = null

    @Volatile
    private var polling = false

    @Volatile
    private var locating = false

    override var isOpen = false
        private set

    override fun available(): Boolean = loadClass() != null

    private fun loadClass(): Class<*>? {
        readerClass?.let { return it }
        for (name in CLASS_NAMES) {
            val found = runCatching { Class.forName(name) }.getOrNull()
            if (found != null) {
                readerClass = found
                return found
            }
        }
        return null
    }

    override fun open(): Boolean {
        if (isOpen) return true
        val cls = loadClass() ?: return false

        return try {
            val instance = cls.getMethod("getInstance").invoke(null) ?: return false

            // init(Context) in most releases, init() in a few older ones.
            val started = call(instance, "init", context) as? Boolean
                ?: call(instance, "init") as? Boolean
                ?: true

            if (!started) return false

            // EPC only. The other modes make the module fetch TID or user
            // memory from every tag as well, which roughly halves how often any
            // one tag is heard - and the find screen lives or dies on that rate.
            call(instance, "setEPCMode")

            // Tag focus makes a tag answer once and then stay quiet until it
            // leaves the field. That is exactly right for counting a rail and
            // exactly wrong for hunting, where the whole point is to hear the
            // same tag over and over and watch it get louder.
            call(instance, "setTagFocus", false)

            // Clear any filter left in the module by whoever had it last -
            // a previous run of this app, or the demo app that ships on the
            // device. See clearFilter: this survives a reboot of the process
            // but not of the handheld, so it is exactly the sort of thing that
            // gets reported as "the scanner only reads one tag now".
            call(instance, "setFilter", BANK_EPC, 0, 0, "")

            reader = instance
            isOpen = true
            true
        } catch (e: Throwable) {
            // Throwable, not Exception: a missing .so raises UnsatisfiedLinkError,
            // which is an Error, and catching only Exception takes the app down on
            // exactly the device this class exists to tolerate.
            Log.w(TAG, "could not open the reader", e)
            false
        }
    }

    override fun close() {
        stopLocating()
        stopInventory()
        val instance = reader ?: return
        runCatching { call(instance, "free") }
        reader = null
        isOpen = false
    }

    override fun startInventory(onTag: (TagRead) -> Unit): Boolean {
        val instance = reader ?: return false

        // Locating and inventory are two different modes of one radio. Starting
        // a sweep while the module is hunting a single tag gets a refusal from
        // the firmware and a trigger that looks broken.
        stopLocating()

        // Unconditionally, not just when this run did the hunting: a sweep must
        // always begin able to hear everything.
        clearFilter()

        // An explicit true, not "anything that is not false".
        //
        // `call` hands back null when the method could not be reached or threw,
        // and treating that as success latched the app into saying "Reading"
        // with a radio that was doing nothing - so the next press of the
        // trigger "stopped" a scan that had never started, and the control read
        // backwards from then on. startInventoryTag returns a boolean in every
        // release; if a boolean did not come back, it did not start.
        if (call(instance, "startInventoryTag") != true) return false

        // The SDK hands tags over by being asked, not by calling back, so
        // something has to ask. On its own thread: the buffer poll blocks, and
        // doing it on the main thread freezes the screen the operator is
        // watching fill up.
        val thread = HandlerThread("uhf-inventory").also { it.start() }
        inventoryThread = thread
        val h = Handler(thread.looper)
        handler = h
        polling = true

        h.post(object : Runnable {
            override fun run() {
                if (!polling) return

                // Drain the buffer, do not sip at it.
                //
                // This used to take one tag per tick and then wait 20ms, which
                // caps the whole device at fifty reads a second no matter how
                // fast the radio is - and those fifty are shared out between
                // every tag in the room. Twenty tags on a rail meant any one of
                // them was heard two or three times a second, which is why the
                // find screen's number jumped about instead of rising smoothly
                // as somebody walked towards it. The module had already heard
                // them; they were sitting in the buffer waiting to be asked for.
                var drained = 0
                while (polling && drained < DRAIN_LIMIT) {
                    val tag = runCatching { tagFrom(call(instance, "readTagFromBuffer")) }
                        .getOrNull() ?: break
                    onTag(tag)
                    drained++
                }

                // Straight round again while the buffer is still full; the
                // pause is only for when it has run dry.
                h.postDelayed(this, if (drained >= DRAIN_LIMIT) 0L else POLL_MS)
            }
        })
        return true
    }

    override fun stopInventory() {
        val wasRunning = polling
        polling = false
        handler = null
        inventoryThread?.quitSafely()
        inventoryThread = null

        // Only tell the module to stop if it was started.
        //
        // Asking it to stop an inventory it is not running makes the firmware
        // retry the STOP command five times over two and a half seconds before
        // giving up with "stop failed" - and that happens on the way into a
        // hunt, so the trigger appears dead for the first few seconds of
        // exactly the job that most needs to feel immediate.
        if (!wasRunning) return
        reader?.let { runCatching { call(it, "stopInventory") } }
    }

    override fun readOnce(): TagRead? {
        val instance = reader ?: return null
        return runCatching { tagFrom(call(instance, "inventorySingleTag")) }.getOrNull()
    }

    /**
     * Whether this SDK release has `startLocation`.
     *
     * Checked by looking the method up rather than by version number, because
     * the version string is not reliable across the rebadged builds that ship
     * on these devices.
     */
    override val canLocate: Boolean
        get() = loadClass()?.methods?.any { it.name == "startLocation" } == true

    override fun startLocating(epc: String, onCloseness: (Int) -> Unit): Boolean {
        val instance = reader ?: return false
        val cls = loadClass() ?: return false

        stopInventory()
        stopLocating()

        val callbackClass = runCatching {
            Class.forName("com.rscja.deviceapi.interfaces.IUHFLocationCallback")
        }.getOrNull() ?: return false

        // The SDK wants an instance of its own interface, and this app has
        // never seen that interface at compile time. A dynamic proxy is the way
        // to hand it one anyway.
        val callback = Proxy.newProxyInstance(
            callbackClass.classLoader,
            arrayOf(callbackClass),
            InvocationHandler { proxy, method, args ->
                when (method.name) {
                    // getLocationValue(int closeness, boolean found)
                    "getLocationValue" -> {
                        val value = (args?.getOrNull(0) as? Int) ?: 0
                        val found = (args?.getOrNull(1) as? Boolean) ?: false
                        // Not heard on this pass reads as nothing, not as the
                        // last number: a bar that holds its reading when the tag
                        // has gone silent walks people into the wrong aisle.
                        runCatching { onCloseness(if (found) value.coerceIn(0, 100) else 0) }
                        null
                    }
                    // Object's own methods reach the handler too, and returning
                    // null from hashCode throws inside the proxy.
                    "hashCode" -> System.identityHashCode(proxy)
                    "equals" -> proxy === args?.getOrNull(0)
                    "toString" -> "IUHFLocationCallback(warehouse)"
                    else -> null
                }
            },
        )

        val method = cls.methods.firstOrNull {
            it.name == "startLocation" && it.parameterTypes.size == 5
        } ?: return false

        // Bank 1 is EPC; the pointer skips the 32 bits of CRC and PC that sit
        // in front of the number printed on the tag.
        val ok = runCatching {
            method.invoke(instance, context, epc.uppercase(), BANK_EPC, EPC_PTR, callback)
        }.getOrNull() as? Boolean ?: false

        locating = ok
        return ok
    }

    override fun stopLocating() {
        if (!locating) return
        locating = false
        reader?.let { runCatching { call(it, "stopLocation") } }
        clearFilter()
    }

    /**
     * Lets the module hear every tag again.
     *
     * Hunting one tag works by pushing its EPC down into the module as a
     * **filter**, and stopping the hunt does not take it out again. The filter
     * lives in the module's own firmware, not in this process, so it outlives
     * the app being killed and even reinstalled - the radio simply stops
     * answering to anything else, on every screen, until somebody reboots the
     * device.
     *
     * Found by hunting one tag and then sweeping on the move screen, which
     * reads everything: it returned that one tag and nothing else, ten seconds
     * running, in front of a pile of twenty.
     *
     * A length of zero is how the SDK spells "no filter".
     */
    private fun clearFilter() {
        val instance = reader ?: return
        runCatching { call(instance, "setFilter", BANK_EPC, 0, 0, "") }
    }

    override var power: Int
        get() = reader?.let { call(it, "getPower") as? Int } ?: 0
        set(value) {
            reader?.let { call(it, "setPower", value.coerceIn(MIN_POWER, MAX_POWER)) }
        }

    /**
     * UHFTAGInfo, also by reflection. `getRssi()` is a String in every release
     * seen so far - "-52", sometimes "-52.0" - so it is parsed rather than cast.
     */
    private fun tagFrom(info: Any?): TagRead? {
        if (info == null) return null
        val epc = (call(info, "getEPC") as? String)?.trim().orEmpty()
        if (epc.isEmpty()) return null

        val tid = (call(info, "getTid") as? String)
            ?.trim()
            ?.takeIf { it.isNotEmpty() && it.any { ch -> ch != '0' } }

        val rssi = when (val raw = call(info, "getRssi")) {
            is Number -> raw.toInt()
            is String -> raw.trim().toDoubleOrNull()?.toInt() ?: 0
            else -> 0
        }

        return TagRead(epc.uppercase(), tid, rssi)
    }

    /** Calls a method by name, matching on argument count rather than types. */
    private fun call(target: Any, name: String, vararg args: Any?): Any? {
        val method: Method = target.javaClass.methods.firstOrNull {
            it.name == name && it.parameterTypes.size == args.size
        } ?: return null
        return runCatching { method.invoke(target, *args) }.getOrNull()
    }

    companion object {
        private const val TAG = "ChainwayUhf"
        private const val POLL_MS = 10L

        /** Tags taken in one pass before the loop checks whether to stop. */
        private const val DRAIN_LIMIT = 64

        private const val BANK_EPC = 1
        private const val EPC_PTR = 32

        const val MIN_POWER = 5
        const val MAX_POWER = 30

        /**
         * Where the reader class has lived. UART is the C72; the others are here
         * because one jar covers several devices and costs nothing to try.
         */
        private val CLASS_NAMES = listOf(
            "com.rscja.deviceapi.RFIDWithUHFUART",
            "com.rscja.deviceapi.RFIDWithUHFA8",
            "com.rscja.deviceapi.RFIDWithUHFBLE",
        )
    }
}
