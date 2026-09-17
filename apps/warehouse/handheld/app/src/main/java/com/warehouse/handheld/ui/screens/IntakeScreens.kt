package com.warehouse.handheld.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.warehouse.handheld.HandheldApp
import com.warehouse.handheld.data.ApiError
import com.warehouse.handheld.data.objects
import com.warehouse.handheld.data.str
import com.warehouse.handheld.ui.Counter
import com.warehouse.handheld.ui.Empty
import com.warehouse.handheld.ui.Good
import com.warehouse.handheld.ui.Loading
import com.warehouse.handheld.ui.OnScan
import com.warehouse.handheld.ui.ReaderBar
import com.warehouse.handheld.ui.ScanResult
import com.warehouse.handheld.ui.Screen
import com.warehouse.handheld.ui.Tile
import com.warehouse.handheld.ui.Tone
import com.warehouse.handheld.ui.TopBar
import com.warehouse.handheld.ui.Warn
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable
fun IntakeListScreen(app: HandheldApp, onNavigate: (Screen) -> Unit) {
    var batches by remember { mutableStateOf<List<JSONObject>?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            batches = app.api.get("/api/batches?status=open").objects("batches")
        } catch (e: ApiError) {
            problem = e.message
            batches = emptyList()
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopBar("Book stock in", "Intakes still being tagged", onBack = { onNavigate(Screen.Home) })

        val list = batches
        when {
            list == null -> Loading()
            problem != null -> Column(Modifier.padding(12.dp)) { ScanResult(problem, Tone.Bad) }
            list.isEmpty() -> Empty("Nothing is waiting to be tagged.\nThe office opens an intake when a delivery arrives.")
            else -> LazyColumn(
                Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(list) { batch ->
                    val assigned = batch.optInt("assigned")
                    val expected = batch.optInt("expected")
                    Tile(
                        title = batch.str("batch_no"),
                        detail = buildString {
                            append(batch.str("supplier").ifEmpty { "No supplier given" })
                            append(" · into ")
                            append(batch.str("room_code").ifEmpty { "nowhere yet" })
                            append(" · $assigned of $expected tagged")
                        },
                        badge = expected - assigned,
                    ) {
                        onNavigate(Screen.Intake(batch.optInt("id"), batch.str("batch_no")))
                    }
                }
            }
        }
    }
}

/**
 * Tag what arrived, one garment at a time.
 *
 * The selected line is what a scan counts against. When it fills up the reader
 * stops, the screen says which line is next, and the next press of the trigger
 * starts that line. It used to carry straight on by itself, which suits a
 * trigger pulled once per garment and not a reader left sweeping a pile: the
 * next line is a different pile - Beige Large after Beige Small - and whatever
 * the reader heard in the moment after the last one went onto a colour and size
 * it was not.
 */
@Composable
fun IntakeDetailScreen(app: HandheldApp, screen: Screen.Intake, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()

    var lines by remember { mutableStateOf<List<JSONObject>?>(null) }
    var roomCode by remember { mutableStateOf("") }
    var selected by remember { mutableStateOf<Int?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var tone by remember { mutableStateOf(Tone.Plain) }
    var lastItemId by remember { mutableStateOf<Int?>(null) }
    var lastEpc by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    var confirmFinish by remember { mutableStateOf(false) }

    // Tags this visit is finished with: tagged here, or refused because they are
    // already on a garment or on a door. A pile left beside the reader is heard
    // again every second and a half, and each of those was a red beep and a trip
    // to the server that held up the garment actually being tagged.
    val settled = remember { HashSet<String>() }

    suspend fun load() {
        try {
            val reply = app.api.get("/api/batches/${screen.id}")
            roomCode = reply.optJSONObject("batch")?.str("room_code").orEmpty()
            val all = reply.objects("lines")
            lines = all
            // Land on the first line that still needs tags when the screen
            // opens. After that the line changes only when the operator says
            // so, because a full line is where one pile ends.
            if (selected == null || all.none { it.optInt("id") == selected }) {
                selected = all.firstOrNull { it.optInt("remaining") > 0 }?.optInt("id")
                    ?: all.firstOrNull()?.optInt("id")
            }
        } catch (e: ApiError) {
            message = e.message
            tone = Tone.Bad
            lines = emptyList()
        }
    }

    LaunchedEffect(screen.id) { load() }

    fun lineOf(id: Int?): JSONObject? = lines?.firstOrNull { it.optInt("id") == id }

    /** The next line down with garments left, wrapping round to one skipped earlier. */
    fun nextLine(): JSONObject? {
        val all = lines ?: return null
        val at = all.indexOfFirst { it.optInt("id") == selected }
        return (all.drop(at + 1) + all.take(at + 1)).firstOrNull { it.optInt("remaining") > 0 }
    }

    /** "Beige · L", with the garment's name as well when the delivery has more than one. */
    fun nameOf(line: JSONObject): String {
        val colourSize = "${line.str("color_name")} · ${line.str("size_code")}"
        val garments = lines.orEmpty().map { it.str("product_name") }.distinct().size
        return if (garments > 1) "${line.str("product_name")}, $colourSize" else colourSize
    }

    /**
     * The chosen line is full: move to the next one with garments left.
     *
     * Only ever the operator's doing - a press of the trigger or of Start - which
     * is them saying the next pile is in front of the reader.
     */
    fun moveOn(): Boolean {
        val line = lineOf(selected) ?: return false
        if (line.optInt("remaining") > 0) return false
        val next = nextLine()
        if (next == null) {
            message = "Every line is tagged. Press Finish this intake."
            tone = Tone.Good
            return false
        }
        selected = next.optInt("id")
        message = "Now tagging ${nameOf(next)} - ${next.optInt("remaining")} to go."
        tone = Tone.Plain
        return true
    }

    /** A line has just filled up: stop reading and say what comes next. */
    suspend fun lineFilled(lineId: Int) {
        app.reader.stop()
        app.reader.beepDone()
        load()
        val done = lineOf(lineId)
        val next = nextLine()
        message = buildString {
            append(done?.let { "${nameOf(it)} done - all ${it.optInt("quantity")} tagged." } ?: "That line is done.")
            append('\n')
            append(
                if (next == null) "Every line is tagged. Press Finish this intake."
                else "Next: ${nameOf(next)}, ${next.optInt("remaining")} to tag. Bring them and press the trigger."
            )
        }
        tone = Tone.Good
    }

    // The trigger is the go-ahead for the next line. Pressed while the chosen
    // line is full, it moves on before the first tag of the new pile arrives.
    LaunchedEffect(Unit) {
        app.reader.scanning.collect { reading -> if (reading) moveOn() }
    }

    fun scan(epc: String) {
        val key = epc.uppercase()
        if (key in settled || busy) return

        var line = lineOf(selected)
        if (line == null) {
            message = "Choose a line first."
            tone = Tone.Warn
            return
        }
        if (line.optInt("remaining") <= 0) {
            // Still coming in from the pile that filled this line, read before
            // the reader stopped: not a garment for the next one. The one
            // exception is a tag that beats the trigger's own move to the next
            // line, which moves on here instead.
            if (!app.reader.scanning.value || !moveOn()) return
            line = lineOf(selected) ?: return
        }

        val lineId = line.optInt("id")
        busy = true

        scope.launch {
            try {
                val body = JSONObject().put("epc", epc).put("batchLineId", lineId)
                val reply = app.api.post("/api/batches/${screen.id}/assign", body)

                settled.add(key)
                lastItemId = reply.optInt("itemId").takeIf { it > 0 }
                lastEpc = key
                val remaining = reply.optInt("remaining")
                if (remaining > 0) {
                    message = "Tagged. $remaining of ${reply.optInt("quantity")} still to go."
                    tone = Tone.Good
                    app.reader.beepGood()
                    load()
                } else {
                    lineFilled(lineId)
                }
            } catch (e: ApiError) {
                if (e.code == "line_full") {
                    // Filled from another handheld or the website while this
                    // one was reading - the same as filling it here.
                    app.reader.forget(epc)
                    lineFilled(lineId)
                } else {
                    message = e.message
                    tone = Tone.Bad
                    app.reader.beepBad()
                    // Already on a garment, or a door tag: no line will ever
                    // take it, so it is said once and then left alone. Anything
                    // else has to be scannable again the moment it is put right,
                    // not in a second and a half.
                    if (e.code == "already_tagged" || e.code == "door_tag") settled.add(key)
                    else app.reader.forget(epc)
                }
            } finally {
                busy = false
            }
        }
    }

    fun finish() {
        scope.launch {
            try {
                val reply = app.api.post("/api/batches/${screen.id}/complete")
                val short = reply.optInt("shortBy")
                message = if (short > 0) "Intake closed $short short." else "Intake closed."
                tone = if (short > 0) Tone.Warn else Tone.Good
                onBack()
            } catch (e: ApiError) {
                message = e.message
                tone = Tone.Bad
            }
        }
    }

    OnScan(app) { scan(it.epc) }

    val list = lines
    val current = list?.firstOrNull { it.optInt("id") == selected }
    val outstanding = list?.sumOf { it.optInt("remaining") } ?: 0
    val waitingFor = if (current != null && current.optInt("remaining") <= 0) nextLine() else null

    if (confirmFinish) {
        AlertDialog(
            onDismissRequest = { confirmFinish = false },
            title = { Text("Finish it $outstanding short?") },
            text = {
                Text(
                    "$outstanding garment${if (outstanding == 1) "" else "s"} on this delivery " +
                        "still have no tag. Finishing cannot be undone - the rest would need a " +
                        "new intake."
                )
            },
            confirmButton = {
                TextButton(onClick = { confirmFinish = false; finish() }) { Text("Finish it short") }
            },
            dismissButton = {
                TextButton(onClick = { confirmFinish = false }) { Text("Keep tagging") }
            },
        )
    }

    Column(Modifier.fillMaxSize()) {
        TopBar(screen.label, "into ${roomCode.ifEmpty { "no room" }}", onBack = onBack)

        if (list == null) {
            Loading()
            return@Column
        }

        Column(Modifier.padding(horizontal = 12.dp)) {
            Row(
                Modifier.fillMaxWidth().padding(vertical = 10.dp),
                horizontalArrangement = Arrangement.SpaceAround,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Counter(
                    (current?.optInt("remaining") ?: 0).toString(),
                    "still to tag on this line",
                    if ((current?.optInt("remaining") ?: 0) > 0) Warn else Good,
                )
                Counter(
                    "${list.sumOf { it.optInt("assigned") }} / ${list.sumOf { it.optInt("quantity") }}",
                    "whole delivery",
                )
            }

            ScanResult(message, tone)

            // The same as pressing the trigger, for a thumb that is nearer the
            // screen: moves to the next line and starts reading it.
            if (waitingFor != null) {
                Spacer(Modifier.height(8.dp))
                Button(
                    onClick = {
                        moveOn()
                        app.reader.start()
                    },
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                ) { Text("Start ${nameOf(waitingFor)}") }
            }

            if (lastItemId != null) {
                TextButton(onClick = {
                    val itemId = lastItemId ?: return@TextButton
                    scope.launch {
                        try {
                            app.api.delete("/api/batches/${screen.id}/assign/$itemId")
                            lastItemId = null
                            // Free again, so it has to be taggable again.
                            lastEpc?.let { settled.remove(it) }
                            lastEpc = null
                            message = "Last scan undone."
                            tone = Tone.Plain
                            load()
                        } catch (e: ApiError) {
                            message = e.message
                            tone = Tone.Bad
                        }
                    }
                }) { Text("Undo that scan") }
            }

        }

        Text(
            "Scanning onto",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 16.dp, top = 10.dp),
        )

        LazyColumn(
            Modifier.weight(1f).padding(horizontal = 12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(list) { line ->
                val chosen = line.optInt("id") == selected
                val remaining = line.optInt("remaining")

                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(
                            if (chosen) MaterialTheme.colorScheme.primaryContainer
                            else MaterialTheme.colorScheme.surface
                        )
                        .border(
                            if (chosen) 2.dp else 1.dp,
                            if (chosen) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
                            RoundedCornerShape(12.dp),
                        )
                        .clickable {
                            selected = line.optInt("id")
                            message = if (remaining > 0) "Now tagging ${nameOf(line)} - $remaining to go." else null
                            tone = Tone.Plain
                        }
                        .padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(line.str("product_name"), style = MaterialTheme.typography.titleMedium)
                        Text(
                            "${line.str("color_name")} · ${line.str("size_code")} · ${line.str("sku")}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Text(
                        "${line.optInt("assigned")}/${line.optInt("quantity")}",
                        style = MaterialTheme.typography.titleMedium,
                        color = if (remaining == 0) Good else Warn,
                    )
                }
            }

            item {
                Spacer(Modifier.height(8.dp))
                Button(
                    // Asks first when the delivery is short.
                    //
                    // Finishing cannot be undone - there is no endpoint that
                    // reopens an intake - and this button sits under a list the
                    // operator is scrolling with a gloved thumb. One stray tap
                    // closed a delivery here with 129 of 260 still untagged,
                    // and the only way back was to raise a second intake for
                    // the rest. The web has always asked; this did not.
                    onClick = { if (outstanding > 0) confirmFinish = true else finish() },
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                ) { Text("Finish this intake") }
                Spacer(Modifier.height(8.dp))
            }
        }

        ReaderBar(app)
    }
}
