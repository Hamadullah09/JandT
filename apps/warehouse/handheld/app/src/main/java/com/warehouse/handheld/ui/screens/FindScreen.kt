package com.warehouse.handheld.ui.screens

import androidx.activity.compose.BackHandler
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.warehouse.handheld.HandheldApp
import com.warehouse.handheld.data.ApiError
import com.warehouse.handheld.data.objects
import com.warehouse.handheld.data.str
import com.warehouse.handheld.rfid.Blip
import com.warehouse.handheld.ui.Bad
import com.warehouse.handheld.ui.Cool
import com.warehouse.handheld.ui.Empty
import com.warehouse.handheld.ui.Good
import com.warehouse.handheld.ui.Loading
import com.warehouse.handheld.ui.OnScan
import com.warehouse.handheld.ui.RadarFace
import com.warehouse.handheld.ui.ReaderBar
import com.warehouse.handheld.ui.ScanResult
import com.warehouse.handheld.ui.TagCode
import com.warehouse.handheld.ui.Tone
import com.warehouse.handheld.ui.TopBar
import com.warehouse.handheld.ui.Warn
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Finding a garment, the way the laundry handheld does it.
 *
 * Two ways to hunt, because they answer different questions:
 *
 *  * **Track** - one garment, warmer and colder. The question is "am I getting
 *    closer?", and the answer is one number the size of the screen.
 *  * **Radar** - everything on the list at once, drawn around the operator. The
 *    question is "which way do I start walking?".
 *
 * Neither claims a distance or a direction the reader cannot measure. See
 * `Radar` for why the bearing is remembered rather than measured, and why the
 * face is honestly empty until somebody turns on the spot.
 */
@Composable
fun FindScreen(
    app: HandheldApp,
    /**
     * Set when this was opened by "Tap to find" in the product search: only the
     * garments of that one colour and size are shown and hunted, and finding
     * any one of them ends it. Null is the whole list, as the office sent it.
     */
    group: String? = null,
    groupLabel: String? = null,
    onBack: () -> Unit,
) {
    val scope = rememberCoroutineScope()

    var requests by remember { mutableStateOf<List<JSONObject>?>(null) }
    var mode by remember { mutableStateOf(Mode.List) }
    var target by remember { mutableStateOf<JSONObject?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var tone by remember { mutableStateOf(Tone.Plain) }
    // The set chosen from the list - Radar and Track then work through just its
    // pieces. Null is everything on the list.
    var chosenSet by remember { mutableStateOf<String?>(null) }

    val blips by app.radar.blips.collectAsState()
    val heading by app.radar.heading.collectAsState()

    // A hunt for one colour and size opens straight into it rather than on a
    // list the operator then has to choose from: one garment goes to Track,
    // several to Radar, which is the "which way do I start walking" answer.
    var opened by remember { mutableStateOf(false) }

    suspend fun load() {
        try {
            val all = app.api.get("/api/find?status=open").objects("requests")
            val list = if (group == null) all else all.filter { it.str("group_key") == group }
            requests = list
            if (group != null && !opened && list.isNotEmpty()) {
                opened = true
                if (list.size == 1) {
                    target = list.first()
                    mode = Mode.Track
                } else {
                    mode = Mode.Radar
                }
            }
            // A set that has just been found - or taken off every handheld - is gone.
            if (chosenSet != null && list.none { setKeyOf(it) == chosenSet }) chosenSet = null
        } catch (e: ApiError) {
            message = e.message
            tone = Tone.Bad
            requests = emptyList()
        }
    }

    LaunchedEffect(Unit) { load() }

    // The radar listens for what is being hunted: the chosen set, or the lot.
    // Tags from the other sets would put blips on the face - and beeps in the
    // speaker - for garments nobody is walking to.
    LaunchedEffect(requests, chosenSet) {
        val all = requests ?: return@LaunchedEffect
        val hunted = chosenSet?.let { key -> all.filter { setKeyOf(it) == key } } ?: all
        app.radar.watch(hunted.map { it.str("epc") })
    }

    // The sensor runs only while this screen is in front, and the fade runs
    // with it. A gyroscope left registered by a screen nobody is looking at is
    // a battery flat by lunchtime.
    LaunchedEffect(Unit) {
        app.radar.start()
        while (true) {
            delay(250)
            app.radar.decay()
        }
    }

    // On the track screen the trigger hunts one tag in firmware rather than
    // sweeping for everything. That is the difference between hearing the
    // wanted tag a couple of times a second - because the radio is busy with
    // the nineteen others on the rail - and hearing it constantly, and it is
    // the whole reason the bar used to jump about instead of rising as somebody
    // walked in. The closeness arrives on the SDK's own thread, so it lands in
    // a flow rather than straight into Compose state.
    val closenessFlow = remember { MutableStateFlow(0) }
    val closeness by closenessFlow.collectAsState()
    val huntEpc = target?.str("epc")?.takeIf { it.isNotEmpty() && mode == Mode.Track }

    DisposableEffect(huntEpc) {
        if (huntEpc != null && app.reader.canHunt) {
            closenessFlow.value = 0
            app.reader.hunt(huntEpc) { closenessFlow.value = it }
        } else {
            app.reader.stopHunting()
        }
        onDispose { app.reader.stopHunting() }
    }

    // The hunting beep.
    //
    // Faster as it gets closer, like a metal detector, so the operator can walk
    // with the handheld pointed at the rail instead of at the screen - which is
    // the whole difference between hunting and reading a number off a phone.
    // The level is read out of the flows inside the loop rather than closed
    // over, or every beep would be told how close things were when the screen
    // last drew.
    //
    // On the radar and the list it beeps too, for the closest of everything
    // being looked for: the owner hunts "any one of these 15" from the radar,
    // and it was silent there - the beep only ever came on Track.
    val scanning by app.reader.scanning.collectAsState()

    LaunchedEffect(mode, scanning, huntEpc) {
        if (!scanning) return@LaunchedEffect
        if (mode == Mode.Track && huntEpc == null) return@LaunchedEffect
        while (true) {
            val level = when {
                mode != Mode.Track -> app.radar.blips.value.maxOfOrNull { it.strength } ?: 0
                app.reader.canHunt -> closenessFlow.value
                else -> app.radar.blips.value.firstOrNull { it.epc.equals(huntEpc, true) }?.strength ?: 0
            }

            if (level <= 0) {
                // Silence means nothing is answering, which is information too.
                delay(300)
                continue
            }

            app.reader.beepHunt(level)
            // Seven times a second when it is right there, once every two
            // paces when it is barely audible.
            delay((700L - level * 6L).coerceIn(90L, 700L))
        }
    }

    // Repeats are the whole point of a hunt: one read per tag would give one
    // reading and then a dead needle.
    OnScan(app, repeatWindowMs = 0) { app.radar.onTag(it) }

    BackHandler(enabled = mode != Mode.List) {
        mode = Mode.List
        target = null
        chosenSet = null
    }

    fun gotIt(request: JSONObject) {
        scope.launch {
            val id = request.optInt("id")
            val body = JSONObject()
            if (app.session.roomId > 0) body.put("roomId", app.session.roomId)
            try {
                try {
                    app.api.post("/api/find/$id/found", body)
                    message = "Marked found. It is off every other handheld."
                } catch (e: ApiError) {
                    if (!e.isOffline) throw e
                    app.queue.add("/api/find/$id/found", body)
                    message = "No signal — saved, and it will be sent when there is."
                }
                tone = Tone.Good
                app.reader.beepGood()
                target = null
                mode = Mode.List
                load()
            } catch (e: ApiError) {
                message = e.message
                tone = Tone.Bad
            }
        }
    }

    val list = requests
    val chosenPieces = list?.let { all -> chosenSet?.let { key -> all.filter { setKeyOf(it) == key } } }.orEmpty()

    Column(Modifier.fillMaxSize()) {
        TopBar(
            title = when (mode) {
                Mode.List -> if (group != null) "Find one" else "Find a garment"
                Mode.Track -> "Track"
                Mode.Radar -> "Radar"
            },
            subtitle = when (mode) {
                Mode.List -> groupLabel ?: "What every handheld is looking for"
                Mode.Track -> target?.str("product_name").orEmpty()
                Mode.Radar -> if (chosenPieces.isNotEmpty()) {
                    "${chosenPieces.first().str("product_name")} · ${chosenPieces.size} pieces"
                } else {
                    "${list?.size ?: 0} on the list"
                }
            },
            onBack = {
                if (mode == Mode.List) onBack() else {
                    mode = Mode.List
                    target = null
                    chosenSet = null
                }
            },
        )

        if (list == null) {
            Loading()
            return@Column
        }

        if (list.isEmpty()) {
            if (group != null) {
                // Either it was found - here or on another handheld - or every
                // one of them has been taken off the list. Both mean the hunt is over.
                Column(Modifier.padding(12.dp)) {
                    ScanResult(message ?: "Found. The rest of this colour and size came off every handheld.", Tone.Good)
                }
                Empty("Nothing left to find for\n${groupLabel.orEmpty()}")
            } else {
                Empty("Nothing is being looked for.\nThe office puts a tag, a product code or an order number on the list.")
            }
            return@Column
        }

        // What Radar and Track work through: the chosen set, or the whole list.
        val inPlay = chosenPieces.ifEmpty { list }

        Column(Modifier.weight(1f)) {
            when (mode) {
                Mode.List -> FindList(
                    requests = list,
                    blips = blips,
                    onSet = { key, pieces ->
                        chosenSet = key
                        if (pieces.size == 1) {
                            target = pieces.first()
                            mode = Mode.Track
                        } else {
                            mode = Mode.Radar
                        }
                    },
                    onRadar = { chosenSet = null; mode = Mode.Radar },
                )

                Mode.Radar -> RadarMode(
                    requests = inPlay,
                    blips = blips,
                    heading = heading,
                    onGotIt = ::gotIt,
                    onTrack = { target = it; mode = Mode.Track },
                )

                Mode.Track -> {
                    val chosen = target
                    if (chosen == null) {
                        mode = Mode.List
                    } else {
                        TrackMode(
                            request = chosen,
                            blip = blips.firstOrNull { it.epc.equals(chosen.str("epc"), true) },
                            closeness = closeness,
                            fromFirmware = app.reader.canHunt,
                            remaining = inPlay.size,
                            usingUhf = app.reader.usingUhf,
                            message = message,
                            tone = tone,
                            onGotIt = { gotIt(chosen) },
                            onSkip = {
                                val at = inPlay.indexOfFirst { it.optInt("id") == chosen.optInt("id") }
                                target = inPlay.getOrNull(at + 1) ?: inPlay.firstOrNull()
                            },
                            onRadar = { mode = Mode.Radar },
                        )
                    }
                }
            }
        }

        ReaderBar(app)
    }
}

private enum class Mode { List, Track, Radar }

/**
 * Which set a find belongs to.
 *
 * "Tap to find" puts every garment of one colour and size on the list under one
 * group - finding any one of them ends the hunt - so a group is a set. A find
 * with no group joins the others of its colour and size, and a tag nobody knows
 * is a set of its own.
 */
private fun setKeyOf(request: JSONObject): String =
    request.str("group_key").ifEmpty { request.str("sku") }.ifEmpty { "tag:" + request.str("epc") }

/** The pieces of one set, as the list shows them: one card, however many tags. */
private class FindSet(val key: String, val pieces: List<JSONObject>)

/** How loud a find's tag is right now, 0 when nothing answers. */
private fun strengthOf(request: JSONObject, blips: List<Blip>): Int =
    blips.firstOrNull { it.epc.equals(request.str("epc"), true) }?.strength ?: 0

/**
 * Rows in the order to walk to them: the loudest - the closest - first.
 *
 * Re-sorted twice a second at most, and numbers are compared in steps of five:
 * a live number wobbles by a few points between reads, and rows swapping back
 * and forth under a thumb reaching for "Got it" would be worse than no order at
 * all. Rows that are level keep the order they already had.
 */
@Composable
private fun <T> rememberClosestFirst(items: List<T>, keyOf: (T) -> String, loudness: (T) -> Int): List<T> {
    var order by remember { mutableStateOf(emptyList<String>()) }
    val latestItems by rememberUpdatedState(items)
    val latestKeyOf by rememberUpdatedState(keyOf)
    val latestLoudness by rememberUpdatedState(loudness)

    LaunchedEffect(Unit) {
        while (true) {
            val before = order
            order = latestItems
                .sortedWith(
                    compareByDescending<T> { latestLoudness(it) / 5 }
                        .thenBy { item ->
                            before.indexOf(latestKeyOf(item)).let { if (it < 0) Int.MAX_VALUE else it }
                        },
                )
                .map { latestKeyOf(it) }
            delay(500)
        }
    }

    return items.sortedBy { item ->
        order.indexOf(keyOf(item)).let { if (it < 0) Int.MAX_VALUE else it }
    }
}

/**
 * The list, one card per set.
 *
 * Six garments of the same colour and size put on the list by "Tap to find" are
 * one thing to go and get, and used to be six identical cards - twelve, with
 * two of them - which buried everything else. A set of one still shows its tag
 * code and opens Track; a set of several says how many, and opens the radar on
 * just its pieces.
 */
@Composable
private fun FindList(
    requests: List<JSONObject>,
    blips: List<Blip>,
    onSet: (String, List<JSONObject>) -> Unit,
    onRadar: () -> Unit,
) {
    val sets = remember(requests) {
        requests.groupBy(::setKeyOf).map { (key, pieces) -> FindSet(key, pieces) }
    }
    val closestFirst = rememberClosestFirst(sets, { it.key }) { set ->
        set.pieces.maxOf { strengthOf(it, blips) }
    }

    Column(Modifier.fillMaxSize()) {
        Button(
            onClick = onRadar,
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 6.dp)
                .height(42.dp),
        ) { Text("Radar — all ${requests.size} at once") }

        Text(
            "Or press Find on one set to hunt just that",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 16.dp, bottom = 6.dp),
        )

        LazyColumn(
            Modifier.padding(horizontal = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            items(closestFirst, key = { it.key }) { set ->
                val first = set.pieces.first()
                val count = set.pieces.size
                val loudest = set.pieces.maxOf { strengthOf(it, blips) }
                val rooms = set.pieces
                    .mapNotNull { piece -> piece.str("last_room_code").takeIf { it.isNotEmpty() } }
                    .distinct()

                // Details across the full width, then the button on its own
                // line. Squeezing them side by side wrapped the tag code, and
                // the tag code is the one thing on the card that tells two
                // identical navy mediums apart.
                Column(
                    Modifier
                        .animateItem()
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(MaterialTheme.colorScheme.surface)
                        .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(12.dp))
                        .clickable { onSet(set.key, set.pieces) }
                        .padding(horizontal = 12.dp, vertical = 8.dp),
                ) {
                    Text(
                        first.str("product_name").ifEmpty { "Unknown garment" },
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        listOfNotNull(
                            first.str("color_name").takeIf { it.isNotEmpty() },
                            first.str("size_code").takeIf { it.isNotEmpty() },
                            rooms.takeIf { it.isNotEmpty() }?.let { "last seen in ${it.joinToString(", ")}" },
                        ).joinToString(" · "),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    if (count == 1) {
                        TagCode(first.str("epc"))
                    } else {
                        Text(
                            if (first.str("group_key").isNotEmpty()) "$count pieces · any one will do" else "$count pieces",
                            style = MaterialTheme.typography.labelLarge,
                            color = Cool,
                        )
                    }

                    Spacer(Modifier.height(4.dp))

                    Row(
                        Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        // Doubles as a rough "which of these can I hear from
                        // where I am standing" before anybody walks anywhere:
                        // the loudest piece of the set.
                        Text(
                            if (loudest > 0) "$loudest" else "—",
                            style = MaterialTheme.typography.titleLarge,
                            color = if (loudest > 0) Good else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Spacer(Modifier.weight(1f))
                        // A button, not just a tappable row. The row has always
                        // opened the hunt; nothing on it said so, and the first
                        // person to use the screen could not find Track at all.
                        Button(
                            onClick = { onSet(set.key, set.pieces) },
                            modifier = Modifier.height(38.dp).width(104.dp),
                        ) { Text(if (count == 1) "Track" else "Find") }
                    }
                }
            }
        }
    }
}

@Composable
private fun RadarMode(
    requests: List<JSONObject>,
    blips: List<Blip>,
    heading: Float,
    onGotIt: (JSONObject) -> Unit,
    onTrack: (JSONObject) -> Unit,
) {
    val anyHeard = blips.any { it.heard }
    val closestFirst = rememberClosestFirst(requests, { it.optInt("id").toString() }) { strengthOf(it, blips) }

    Column(Modifier.fillMaxSize()) {
        RadarFace(blips = blips, heading = heading)

        Text(
            if (anyHeard) "Walk towards the blip" else "TURN ON THE SPOT TO SWEEP",
            style = MaterialTheme.typography.titleMedium,
            color = if (anyHeard) Good else Warn,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth().padding(vertical = 2.dp),
        )

        LazyColumn(
            Modifier.padding(horizontal = 12.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            items(closestFirst, key = { it.optInt("id") }) { request ->
                val blip = blips.firstOrNull { it.epc.equals(request.str("epc"), true) }
                // The top row, once it answers, is the one to walk to.
                val closest = blip?.heard == true && request === closestFirst.first()
                Row(
                    Modifier.animateItem().fillMaxWidth().clickable { onTrack(request) },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        request.str("epc").takeLast(6),
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.width(110.dp),
                    )
                    Text(
                        when {
                            closest -> "closest"
                            blip?.heard == true -> "heard"
                            else -> "no answer"
                        },
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = if (closest) FontWeight.Bold else null,
                        color = if (blip?.heard == true) Good else MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.weight(1f),
                    )
                    Text(
                        "${blip?.strength ?: 0}",
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.width(46.dp),
                        textAlign = TextAlign.End,
                    )
                    Spacer(Modifier.width(8.dp))
                    Button(
                        onClick = { onGotIt(request) },
                        colors = ButtonDefaults.buttonColors(containerColor = Good),
                        modifier = Modifier.height(36.dp),
                    ) { Text("Got it") }
                }
            }
        }
    }
}

@Composable
private fun TrackMode(
    request: JSONObject,
    blip: Blip?,
    /** What the module itself says, 0-100. Only meaningful when fromFirmware. */
    closeness: Int,
    fromFirmware: Boolean,
    remaining: Int,
    usingUhf: Boolean,
    message: String?,
    tone: Tone,
    onGotIt: () -> Unit,
    onSkip: () -> Unit,
    onRadar: () -> Unit,
) {
    // The module's own number when it has one, the radar's guess otherwise.
    val strength = if (fromFirmware) closeness else (blip?.strength ?: 0)
    val filled by animateFloatAsState(strength / 100f, label = "strength")

    val colour = when {
        strength >= 70 -> Good
        strength >= 35 -> Warn
        strength > 0 -> Cool
        else -> Bad
    }

    Column(
        Modifier.fillMaxSize().padding(horizontal = 16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            request.str("product_name").ifEmpty { "Unknown garment" },
            style = MaterialTheme.typography.titleLarge,
        )
        Text(
            listOfNotNull(
                request.str("color_name").takeIf { it.isNotEmpty() },
                request.str("size_code").takeIf { it.isNotEmpty() },
            ).joinToString(" · "),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        // The tag code, not just the style. Two navy mediums on the same shelf
        // look identical; the code is the only thing that says which one the
        // office is asking for.
        TagCode(request.str("epc"))
        Text(
            "$remaining left",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )

        // One number, the size of the screen. At arm's length under warehouse
        // lighting this is the only thing that has to be readable.
        Text("$strength", fontSize = 66.sp, fontWeight = FontWeight.Bold, color = colour)

        Box(
            Modifier
                .fillMaxWidth()
                .height(86.dp)
                .clip(RoundedCornerShape(14.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant),
            contentAlignment = Alignment.CenterStart,
        ) {
            Box(
                Modifier
                    .fillMaxWidth(filled.coerceIn(0f, 1f))
                    .fillMaxHeight()
                    .background(if (strength > 0) colour else MaterialTheme.colorScheme.surfaceVariant),
            )
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(
                    when {
                        strength >= 80 -> "It is right here"
                        strength >= 50 -> "Very close"
                        strength >= 25 -> "Getting warmer"
                        strength > 0 -> "Faint — keep going"
                        else -> "No answer — press the trigger and sweep"
                    },
                    style = MaterialTheme.typography.titleMedium,
                    textAlign = TextAlign.Center,
                )
            }
        }

        Text(
            if (fromFirmware) "measured by the reader" else "estimated on this handheld",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 6.dp),
        )

        if (!usingUhf) {
            Spacer(Modifier.height(8.dp))
            ScanResult("This build has no UHF reader, so the bar cannot fill.", Tone.Warn)
        }

        Spacer(Modifier.height(6.dp))
        ScanResult(message, tone)

        Spacer(Modifier.height(10.dp))

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Button(
                onClick = onSkip,
                colors = ButtonDefaults.buttonColors(containerColor = Warn),
                modifier = Modifier.weight(1f).height(54.dp),
            ) { Text("Skip") }
            Button(
                onClick = onGotIt,
                colors = ButtonDefaults.buttonColors(containerColor = Good),
                modifier = Modifier.weight(1f).height(54.dp),
            ) { Text("Got it") }
        }

        Spacer(Modifier.height(8.dp))

        Button(onClick = onRadar, modifier = Modifier.fillMaxWidth().height(48.dp)) {
            Text("Radar")
        }
    }
}
