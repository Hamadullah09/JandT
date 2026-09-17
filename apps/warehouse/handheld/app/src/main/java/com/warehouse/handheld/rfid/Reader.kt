package com.warehouse.handheld.rfid

import android.content.Context
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

/**
 * The reader, whichever one this device turned out to have.
 *
 * Every screen talks to this and none of them to a backend directly, so the
 * difference between a C72 with the SDK installed and a C72 without it is one
 * line on the home screen rather than a different app.
 */
class Reader(context: Context) {

    private val chainway = ChainwayUhf(context)
    val keypad = KeypadScanner()

    /**
     * Chainway if its classes are on the classpath, the keypad otherwise. Fixed
     * at construction: a backend that changes under a running screen is a
     * source of bugs nobody can reproduce.
     */
    val backend: UhfBackend = if (chainway.available()) chainway else keypad

    val usingUhf: Boolean get() = backend === chainway

    private val vibrator = context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    private val tones = runCatching { ToneGenerator(AudioManager.STREAM_NOTIFICATION, 80) }.getOrNull()

    private val _tags = MutableSharedFlow<TagRead>(extraBufferCapacity = 64)

    /** Every tag the reader answered, de-duplicated. */
    val tags: SharedFlow<TagRead> = _tags.asSharedFlow()

    private val _scanning = MutableStateFlow(false)
    val scanning: StateFlow<Boolean> = _scanning.asStateFlow()

    private val _open = MutableStateFlow(false)
    val open: StateFlow<Boolean> = _open.asStateFlow()

    /**
     * When each EPC was last passed on.
     *
     * An inventory answers the same tag many times a second. Without this, one
     * garment held in front of the antenna becomes forty scans, and on the
     * intake screen that is forty refusals the operator has to read past.
     *
     * Keyed by EPC and swept rather than cleared, so a tag genuinely scanned
     * twice a few seconds apart still counts twice.
     */
    private val lastSeen = HashMap<String, Long>()

    /** Set by a screen that wants repeats through - the find screen does. */
    @Volatile
    var repeatWindowMs: Long = 1500

    /**
     * Whether the module can hunt a single tag in firmware.
     *
     * When it can, the track screen gets a closeness the radio worked out
     * itself; when it cannot, the screen falls back to the radar's own guess
     * from inventory RSSI. Both work - one is much steadier.
     */
    val canHunt: Boolean get() = usingUhf && backend.canLocate

    /** The tag the trigger is hunting, or null when the trigger sweeps. */
    @Volatile
    var hunting: String? = null
        private set

    private var onCloseness: ((Int) -> Unit)? = null

    /**
     * Hunt one tag instead of sweeping for all of them.
     *
     * The trigger still means the same thing - press to start, press to stop -
     * it just drives a different mode of the radio while a hunt is set. Doing it
     * this way rather than having the track screen call the backend keeps every
     * path to the radio behind one door, which is what stopped the trigger
     * latching last time.
     */
    fun hunt(epc: String, onCloseness: (Int) -> Unit) {
        // Carry on hunting if we already were, just for a different garment.
        //
        // Skip moves to the next one on the list, and stopping the radio when
        // it does would mean reaching for the trigger again every time -
        // halfway down a rack, one-handed, with the other hand on the rail.
        val carryOn = _scanning.value
        stop()
        hunting = epc.uppercase()
        this.onCloseness = onCloseness
        if (carryOn) start()
    }

    /** Back to sweeping. */
    fun stopHunting() {
        stop()
        if (usingUhf) backend.stopLocating()
        hunting = null
        onCloseness = null
    }

    fun open(power: Int): Boolean {
        // Opened, but not yet listening. A screen that wants scans says so by
        // calling keypadListening(true); see OnScan. Listening for the whole
        // time the reader is open means the wedge buffer swallows keys on the
        // sign-in screen too, and the username field never fills in.
        keypad.open()

        if (backend.isOpen) {
            _open.value = true
            return true
        }

        val ok = backend.open()
        if (ok && usingUhf) backend.power = power
        _open.value = ok
        return ok
    }

    fun close() {
        stop()
        backend.close()
        keypad.close()
        _open.value = false
        lastSeen.clear()
    }

    /**
     * Whether a screen is expecting scans typed by the barcode wedge.
     *
     * On for scanning screens, off everywhere else. It is separate from the
     * reader being open because the two answer different questions: the radio
     * is claimed for as long as the app is in front, but the keyboard is only
     * intercepted while a screen actually wants tags rather than text.
     */
    fun keypadListening(on: Boolean) {
        if (on) keypad.startInventory(::emit) else keypad.stopInventory()
    }

    /**
     * The trigger was pressed: start sweeping, or stop if already sweeping.
     *
     * The screens do not call this - only the trigger does - so "what the
     * trigger means" lives in exactly one place.
     */
    fun toggle() {
        if (_scanning.value) stop() else start()
    }

    /** Starts a sweep, or a hunt if one is set. */
    fun start() {
        if (!backend.isOpen || _scanning.value) return
        if (usingUhf) {
            val epc = hunting
            val started = if (epc != null && backend.canLocate) {
                backend.startLocating(epc) { value -> onCloseness?.invoke(value) }
            } else {
                // No hunt set, or a module too old to have the mode. Sweeping
                // still finds the tag - the track screen just reads its
                // closeness off the radar instead of off the firmware.
                backend.startInventory(::emit)
            }
            if (!started) return
        }
        _scanning.value = true
    }

    /** The trigger came up. */
    fun stop() {
        if (!_scanning.value) return
        if (usingUhf) {
            backend.stopLocating()
            backend.stopInventory()
        }
        _scanning.value = false
    }

    /**
     * Forgets a tag immediately, so the next read of it counts.
     *
     * The intake screen calls this after a refusal: a tag rejected because the
     * operator had the wrong line selected has to be scannable again the moment
     * they fix the line, not in a second and a half.
     */
    fun forget(epc: String) {
        lastSeen.remove(epc.uppercase())
    }

    private fun emit(tag: TagRead) {
        val now = System.currentTimeMillis()
        val key = tag.epc.uppercase()

        val seen = lastSeen[key]
        if (seen != null && now - seen < repeatWindowMs) return
        lastSeen[key] = now

        if (lastSeen.size > 512) {
            val cutoff = now - 60_000
            lastSeen.entries.removeAll { it.value < cutoff }
        }

        _tags.tryEmit(tag)
    }

    /** Something worked. */
    fun beepGood() {
        tones?.startTone(ToneGenerator.TONE_PROP_BEEP, 90)
        buzz(40)
    }

    /**
     * One short blip while hunting.
     *
     * How close you are is in **how often** this comes, not in the note - a
     * metal detector, not an alarm. The screen calls it on a timer it works out
     * from the closeness, so the operator can walk with the handheld down and
     * their eyes on the rail instead of on the number.
     *
     * Near enough to touch it also buzzes, because the last few feet are where
     * somebody is head-down in a rack and cannot hear a beep over a forklift.
     */
    fun beepHunt(level: Int) {
        tones?.startTone(ToneGenerator.TONE_PROP_BEEP, 40)
        if (level >= 85) buzz(25)
    }

    /**
     * A line of an intake is full, or an order has gone out.
     *
     * Two quick rising beeps and a longer buzz, told apart from the single beep
     * of one garment without looking: the reader has just stopped by itself,
     * and the operator needs to know that is why.
     */
    fun beepDone() {
        tones?.startTone(ToneGenerator.TONE_PROP_ACK, 300)
        buzz(120)
    }

    /** Something was refused - two notes, so it is told apart without looking. */
    fun beepBad() {
        tones?.startTone(ToneGenerator.TONE_CDMA_ALERT_CALL_GUARD, 250)
        buzz(180)
    }

    private fun buzz(ms: Long) {
        val v = vibrator ?: return
        if (!v.hasVibrator()) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            v.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE))
        } else {
            @Suppress("DEPRECATION")
            v.vibrate(ms)
        }
    }

    fun release() {
        close()
        tones?.release()
    }
}
