package com.warehouse.handheld.rfid

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin

/** One tag on the radar face: how loud, and which way it was loudest. */
data class Blip(
    val epc: String,
    /** 0-100. 100 is as loud as a tag gets. */
    val strength: Int,
    /** Degrees the reader was pointing when it answered loudest. */
    val bearing: Float,
    val lastSeenAt: Long,
    /**
     * Whether the direction is worth walking towards yet.
     *
     * False while the tag has been heard but no one direction stands out - the
     * operator has not turned far enough yet, or they are close enough that it
     * answers from everywhere. The face draws these as a ring rather than an
     * arrow, because a confident dot pointing nowhere in particular is how
     * people end up searching the wrong aisle.
     */
    val settled: Boolean = false,
) {
    /** True once the tag has answered at all. Until then it has no bearing. */
    val heard: Boolean get() = strength > 0
}

/**
 * Where a tag is, as far as a UHF reader can honestly say.
 *
 * A UHF reader cannot measure direction. It knows one thing: how loudly a tag
 * answered. What makes a radar possible is that the antenna is **directional** -
 * it hears what it is pointed at far better than what is beside it - so the
 * bearing is not measured, it is *remembered*: every read is stamped with the
 * heading the handheld was on at that instant, and the tag is drawn in whichever
 * direction it answered loudest.
 *
 * That is why the operator has to turn on the spot once, and why the face is
 * honestly empty until they do. A radar that guessed a direction before hearing
 * the tag from one would be pointing people down the wrong aisle with total
 * confidence.
 *
 * ## Why the first version pointed the wrong way
 *
 * It kept one number per tag - the loudest read so far - and moved the blip only
 * when a read beat it. In open air that is fine. In a shed full of steel racking
 * it is not: the first strong reflection off a shutter sets a record no honest
 * read ever beats, and from that moment the blip is nailed to a direction the
 * garment is not in, getting *more* confident the longer you look.
 *
 * So the record is no longer a single number. Each tag keeps a ring of
 * directions that **fades**, and a direction has to keep answering to stay the
 * favourite. A reflection still gets its moment - it just loses it again a few
 * seconds later, which is what turning on the spot is for.
 */
class Radar(context: Context) : SensorEventListener {

    private val sensors = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager

    // Game rotation vector, not the geomagnetic one. This runs inside a steel
    // building full of motors: a compass needle here points at the nearest
    // roller shutter. The game vector is gyroscope-only, so it has no idea
    // where north is - which does not matter, because the operator only needs
    // "the way I was facing then" against "the way I am facing now".
    private val rotation: Sensor? =
        sensors?.getDefaultSensor(Sensor.TYPE_GAME_ROTATION_VECTOR)
            ?: sensors?.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)

    private val _heading = MutableStateFlow(0f)

    /** Which way the handheld is pointing now, in degrees. */
    val heading: StateFlow<Float> = _heading.asStateFlow()

    private val _blips = MutableStateFlow<List<Blip>>(emptyList())
    val blips: StateFlow<List<Blip>> = _blips.asStateFlow()

    /**
     * The samples, and the lock around them.
     *
     * Written from the SDK's inventory thread and read from the one that draws.
     * Without the lock the two meet in the middle and take the app down with a
     * ConcurrentModificationException - which the laundry build learned the
     * hard way, and always in front of somebody.
     */
    private val lock = Any()
    private val tracks = HashMap<String, Track>()

    /** Only these tags are plotted. Everything else the reader hears is ignored. */
    @Volatile
    private var wanted: Set<String> = emptySet()

    /** What one tag has told us so far. */
    private class Track(val epc: String) {
        /** Smoothed 0-100. Raw RSSI swings ten dB between two reads of a tag
         *  that has not moved, and a bar that does that is unreadable. */
        var level = 0f

        var lastSeenAt = 0L

        /** Loudness heard from each direction, fading. */
        val sectors = FloatArray(SECTORS)
        var fadedAt = 0L

        var bearing = 0f
        var settled = false

        /** Ages every direction towards nothing. */
        fun fade(now: Long) {
            if (fadedAt == 0L) {
                fadedAt = now
                return
            }
            val elapsed = now - fadedAt
            if (elapsed <= 0) return
            fadedAt = now
            val factor = 0.5f.pow(elapsed.toFloat() / SECTOR_HALF_LIFE_MS)
            for (i in sectors.indices) sectors[i] *= factor
        }

        /**
         * The favourite direction, and whether it is a favourite by enough to
         * be worth believing.
         */
        fun resolve() {
            var peak = 0
            var best = 0f
            var total = 0f
            for (i in sectors.indices) {
                total += sectors[i]
                if (sectors[i] > best) {
                    best = sectors[i]
                    peak = i
                }
            }

            if (best <= 0f) {
                settled = false
                return
            }

            // Vector sum of the peak and its neighbours, so the needle lands
            // between sectors instead of snapping to the middle of one, and so
            // the wrap from 355 to 5 degrees costs nothing.
            var x = 0f
            var y = 0f
            for (d in -1..1) {
                val i = (peak + d + SECTORS) % SECTORS
                val radians = Math.toRadians((i * SECTOR_DEGREES + SECTOR_DEGREES / 2f).toDouble())
                x += sectors[i] * cos(radians).toFloat()
                y += sectors[i] * sin(radians).toFloat()
            }
            bearing = ((Math.toDegrees(atan2(y, x).toDouble()).toFloat()) + 360f) % 360f

            // One direction has to be clearly louder than the average of them
            // all. Turning through a full circle in front of a tag that is
            // genuinely to the north-east gives a big peak and a low average;
            // standing still gives one sector with everything in it and the
            // rest at zero, which also passes - correctly, because that is the
            // only direction anything has been heard from.
            val mean = total / SECTORS
            settled = best >= mean * SETTLED_RATIO
        }

        fun snapshot(): Blip =
            Blip(epc, level.toInt().coerceIn(0, 100), bearing, lastSeenAt, settled && level > 0)

        fun reset() {
            level = 0f
            lastSeenAt = 0L
            sectors.fill(0f)
            fadedAt = 0L
            bearing = 0f
            settled = false
        }
    }

    fun watch(epcs: Collection<String>) {
        val set = epcs.map { it.uppercase() }.toSet()
        wanted = set
        synchronized(lock) {
            tracks.keys.retainAll(set)
            for (epc in set) tracks.getOrPut(epc) { Track(epc) }
            publish()
        }
    }

    fun start() {
        val sensor = rotation ?: return
        sensors?.registerListener(this, sensor, SensorManager.SENSOR_DELAY_GAME)
    }

    fun stop() {
        sensors?.unregisterListener(this)
    }

    fun clear() {
        synchronized(lock) {
            for (track in tracks.values) track.reset()
            publish()
        }
    }

    /**
     * A tag answered.
     *
     * The read is filed under whichever of the twenty-four directions the
     * handheld was pointing in, and that direction keeps the loudest thing it
     * has heard lately. "Lately" is the whole trick - see the class note.
     */
    fun onTag(tag: TagRead) {
        val epc = tag.epc.uppercase()
        if (epc !in wanted) return

        val strength = strengthOf(tag.rssi).toFloat()
        val now = System.currentTimeMillis()

        synchronized(lock) {
            val track = tracks.getOrPut(epc) { Track(epc) }

            // Follow a rise quickly and a fall slowly. Walking towards a tag
            // should show immediately; one missed read out of thirty should not
            // drop the bar through the floor and then bounce it back.
            val alpha = if (strength > track.level) RISE else FALL
            track.level += alpha * (strength - track.level)
            track.lastSeenAt = now

            track.fade(now)
            val sector = sectorOf(_heading.value)
            if (strength > track.sectors[sector]) track.sectors[sector] = strength
            track.resolve()

            publish()
        }
    }

    /**
     * Fades a tag that has gone quiet.
     *
     * Called on a timer by the screen. A blip frozen at full strength while the
     * operator walks away from it is worse than an empty face, because it is
     * believed.
     */
    fun decay(quietForMs: Long = 500) {
        val now = System.currentTimeMillis()
        synchronized(lock) {
            var changed = false
            for (track in tracks.values) {
                if (track.level <= 0f) continue
                if (now - track.lastSeenAt < quietForMs) continue
                track.level *= QUIET_FADE
                if (track.level < 1f) track.level = 0f
                track.fade(now)
                track.resolve()
                changed = true
            }
            if (changed) publish()
        }
    }

    /** Caller must hold the lock. */
    private fun publish() {
        _blips.value = wanted.mapNotNull { tracks[it]?.snapshot() }
    }

    override fun onSensorChanged(event: SensorEvent) {
        if (event.sensor.type != rotation?.type) return

        val matrix = FloatArray(9)
        SensorManager.getRotationMatrixFromVector(matrix, event.values)
        val angles = FloatArray(3)
        SensorManager.getOrientation(matrix, angles)

        val degrees = Math.toDegrees(angles[0].toDouble()).toFloat()
        _heading.value = (degrees + 360f) % 360f
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    companion object {
        /**
         * Twenty-four directions, fifteen degrees each.
         *
         * Finer than the antenna can actually tell apart - its beam is a good
         * sixty degrees wide - but the vector sum across neighbouring sectors
         * is what smooths that out, and coarse sectors make the blip jump in
         * visible steps as somebody turns.
         */
        private const val SECTORS = 24
        private const val SECTOR_DEGREES = 360f / SECTORS

        /** How long a direction keeps half its loudness with nothing to back it up. */
        private const val SECTOR_HALF_LIFE_MS = 3500f

        /** How far above the average of all directions the favourite must be. */
        private const val SETTLED_RATIO = 1.8f

        private const val RISE = 0.45f
        private const val FALL = 0.15f
        private const val QUIET_FADE = 0.80f

        private fun sectorOf(heading: Float): Int =
            (((heading % 360f) + 360f) % 360f / SECTOR_DEGREES).toInt().coerceIn(0, SECTORS - 1)

        /**
         * dBm to 0-100.
         *
         * -80 is the edge of hearing and -30 is about as loud as a tag gets, so
         * the fifty dB between them are stretched across the whole bar. Outside
         * that range the bar would otherwise spend its life pinned at one end.
         */
        fun strengthOf(rssi: Int): Int = ((rssi + 80).coerceIn(0, 50) * 2)
    }
}
