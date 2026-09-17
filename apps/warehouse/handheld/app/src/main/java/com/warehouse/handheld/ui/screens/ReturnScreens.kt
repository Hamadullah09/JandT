package com.warehouse.handheld.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.warehouse.handheld.HandheldApp
import com.warehouse.handheld.data.ApiError
import com.warehouse.handheld.data.objects
import com.warehouse.handheld.data.str
import com.warehouse.handheld.ui.Bad
import com.warehouse.handheld.ui.ColourDot
import com.warehouse.handheld.ui.Counter
import com.warehouse.handheld.ui.Good
import com.warehouse.handheld.ui.OnScan
import com.warehouse.handheld.ui.ReaderBar
import com.warehouse.handheld.ui.ScanResult
import com.warehouse.handheld.ui.TagCode
import com.warehouse.handheld.ui.Tone
import com.warehouse.handheld.ui.TopBar
import com.warehouse.handheld.ui.Warn
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/**
 * Taking returns, in the returns room.
 *
 * Every garment that comes back is put in one room. The operator stands in it,
 * presses the trigger and sweeps: each tag heard is checked, and the screen
 * says straight away whether it is a return - which order it went out on and
 * to whom - or not, and why. Every return starts at grade **1**; a tap changes
 * it to 2 or 3. **Add to inventory** takes them all back in one go.
 *
 * Nothing has to be chosen first. The tag already knows which order each
 * garment belongs to, so a returns room holding parcels from six customers is
 * one sweep, not six.
 */
@Composable
fun ReturnRoomScreen(app: HandheldApp, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()

    // Everything heard, in the order it was heard. The check result arrives a
    // moment later, so a row can exist before anything is known about it.
    val order = remember { mutableStateListOf<String>() }
    val results = remember { mutableStateMapOf<String, JSONObject>() }
    val grades = remember { mutableStateMapOf<String, Int>() }
    // Taken out by the operator: a garment that is in the room but must not be
    // added now. Kept, rather than forgotten, so the next sweep - which will
    // hear it again - does not quietly put it back.
    val removed = remember { mutableStateMapOf<String, Boolean>() }
    val pending = remember { LinkedHashSet<String>() }

    var roomCode by remember { mutableStateOf<String?>(null) }
    var roomProblem by remember { mutableStateOf<String?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var tone by remember { mutableStateOf(Tone.Plain) }
    var busy by remember { mutableStateOf(false) }

    // Moved on by Clear. A check already on its way when the list was cleared
    // answers for tags no longer on it, and that answer is dropped.
    var generation by remember { mutableIntStateOf(0) }
    // One more each time a return is heard for the first time.
    var arrivals by remember { mutableIntStateOf(0) }

    // Asked again until it answers: a Wi-Fi blip as the screen opened must not
    // leave it without its room until somebody leaves and comes back.
    LaunchedEffect(Unit) {
        while (true) {
            try {
                val rooms = app.api.get("/api/rooms").objects("rooms")
                val returnsRoom = rooms.firstOrNull { it.str("kind") == "returns" && it.optInt("active", 1) == 1 }
                if (returnsRoom == null) {
                    roomProblem = "There is no returns room. Add one on the dashboard first."
                } else {
                    roomCode = returnsRoom.str("code")
                    roomProblem = null
                }
                break
            } catch (e: ApiError) {
                roomProblem = e.message
                delay(3000)
            }
        }
    }

    // Tags are checked in batches rather than one request each: a sweep hears
    // dozens a second, and a request per tag would queue behind itself.
    LaunchedEffect(Unit) {
        while (true) {
            delay(500)
            if (pending.isEmpty()) continue

            val batch = pending.take(100)
            val asked = generation
            try {
                val body = JSONObject().put("epcs", JSONArray(batch))
                val reply = app.api.post("/api/returns/check", body)
                // Cleared while this was on its way. Any of these swept again
                // since are in pending again and are asked about afresh.
                if (asked != generation) continue
                batch.forEach { pending.remove(it) }
                for (result in reply.objects("results")) {
                    val epc = result.str("epc")
                    val firstTime = epc !in results
                    results[epc] = result
                    if (firstTime) {
                        if (result.str("state") == "returnable") {
                            app.reader.beepGood()
                            arrivals++
                        } else {
                            app.reader.beepBad()
                        }
                    }
                }
                // The server answers only for real tag codes. Anything else in
                // the batch - a barcode, a mis-read - gets no answer, and left
                // alone it would read "checking" for ever and hold the Add
                // button shut. It is said to be what it is instead.
                for (epc in batch) {
                    if (epc !in results) {
                        results[epc] = JSONObject()
                            .put("epc", epc)
                            .put("state", "not_ours")
                            .put("message", "Not a tag code.")
                    }
                }
                if (tone == Tone.Bad) message = null
            } catch (e: ApiError) {
                // Left in pending and tried again on the next pass - a dropped
                // packet in the returns room must not lose a garment.
                message = e.message
                tone = Tone.Bad
                delay(1500)
            }
        }
    }

    OnScan(app) { tag ->
        val epc = tag.epc.filter { it.isLetterOrDigit() }.uppercase()
        if (epc.isEmpty() || epc in order) return@OnScan
        order.add(0, epc)
        pending.add(epc)
    }

    val toAdd = order.filter { results[it]?.str("state") == "returnable" && removed[it] != true }
    val notReturns = order.filter { results[it] != null && results[it]?.str("state") != "returnable" }
    val takenOut = order.filter { results[it]?.str("state") == "returnable" && removed[it] == true }
    val checking = order.count { results[it] == null }

    // A new return goes to the top of the list, and a list keeps whatever was
    // first on screen in view when something is put above it - so the newest
    // return, the one that most needs grading, landed just out of sight above
    // the fold. Bring it into view. Only for a return just heard, while the
    // trigger is sweeping: "Put back" is a tap further down the list, and
    // jumping to the top under that thumb would lose the operator's place.
    val listState = rememberLazyListState()
    LaunchedEffect(arrivals) {
        if (arrivals > 0) listState.animateScrollToItem(0)
    }

    fun clearAll() {
        order.clear(); results.clear(); grades.clear(); removed.clear(); pending.clear()
        generation++
    }

    fun add() {
        if (busy || toAdd.isEmpty()) return
        busy = true
        app.reader.stop()
        scope.launch {
            try {
                val items = JSONArray()
                toAdd.forEach { epc ->
                    items.put(JSONObject().put("epc", epc).put("reusability", grades[epc] ?: 1))
                }
                val reply = app.api.post("/api/returns/intake", JSONObject().put("items", items))

                val added = reply.optInt("added")
                val summary = buildString {
                    append("Added $added to ${reply.str("room")}: ")
                    val parts = mutableListOf<String>()
                    reply.optInt("restocked").takeIf { it > 0 }?.let { parts.add("$it back in stock") }
                    reply.optInt("damaged").takeIf { it > 0 }?.let { parts.add("$it defective") }
                    reply.optInt("writtenOff").takeIf { it > 0 }?.let { parts.add("$it discarded") }
                    append(parts.joinToString(", "))
                    append(".")
                    val returns = reply.objects("returns")
                    if (returns.isNotEmpty()) {
                        append(" ")
                        append(returns.joinToString(" · ") { "${it.str("return_no")} (${it.str("order_no")})" })
                    }
                    val skipped = reply.objects("skipped").size
                    if (skipped > 0) append(" $skipped had already been added elsewhere and were left out.")
                }

                clearAll()
                message = summary
                tone = Tone.Good
                app.reader.beepGood()
            } catch (e: ApiError) {
                message = e.message
                tone = Tone.Bad
                app.reader.beepBad()
            } finally {
                busy = false
            }
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopBar(
            title = "Take returns",
            subtitle = roomCode?.let { "Returns room · $it" } ?: "Returns room",
            onBack = onBack,
        )

        Row(
            Modifier.fillMaxWidth().padding(vertical = 8.dp),
            horizontalArrangement = Arrangement.SpaceEvenly,
        ) {
            Counter("${toAdd.size}", "to add", Good)
            Counter("${notReturns.size}", "not returns", if (notReturns.isEmpty()) MaterialTheme.colorScheme.onSurfaceVariant else Warn)
            Counter(if (checking > 0) "$checking" else "—", "checking", MaterialTheme.colorScheme.onSurfaceVariant)
        }

        Column(Modifier.padding(horizontal = 12.dp)) {
            roomProblem?.let { ScanResult(it, Tone.Bad); Spacer(Modifier.height(8.dp)) }
            ScanResult(message, tone)
        }

        LazyColumn(
            Modifier.weight(1f).padding(horizontal = 12.dp),
            state = listState,
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            if (order.isEmpty()) {
                item {
                    Text(
                        "Press the trigger and sweep the returns room.\n" +
                            "Every return starts at grade 1 - tap 2 or 3 to change it.",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.fillMaxWidth().padding(vertical = 28.dp),
                    )
                }
            }

            items(toAdd, key = { "add-$it" }) { epc ->
                val result = results[epc] ?: return@items
                ReturnCard(
                    result = result,
                    grade = grades[epc] ?: 1,
                    onGrade = { grades[epc] = it },
                    onRemove = { removed[epc] = true },
                )
            }

            if (checking > 0) {
                item {
                    Text(
                        "Checking $checking…",
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(4.dp),
                    )
                }
            }

            if (takenOut.isNotEmpty()) {
                item { SectionLabel("Taken out - will not be added") }
                items(takenOut, key = { "out-$it" }) { epc ->
                    val result = results[epc] ?: return@items
                    LeftOutRow(result, note = "Taken out", actionLabel = "Put back") { removed.remove(epc) }
                }
            }

            if (notReturns.isNotEmpty()) {
                item { SectionLabel("Not returns - will not be added") }
                items(notReturns, key = { "not-$it" }) { epc ->
                    val result = results[epc] ?: return@items
                    LeftOutRow(result, note = result.str("message"))
                }
            }

            item { Spacer(Modifier.height(8.dp)) }
        }

        Row(
            Modifier.fillMaxWidth().padding(horizontal = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (order.isNotEmpty()) {
                Button(
                    onClick = { clearAll(); message = null },
                    enabled = !busy,
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.surfaceVariant,
                        contentColor = MaterialTheme.colorScheme.onSurfaceVariant),
                    modifier = Modifier.height(56.dp),
                ) { Text("Clear") }
            }
            Button(
                onClick = ::add,
                // Not held back for the room: the server chooses it, and says so
                // plainly if there is none.
                enabled = !busy && toAdd.isNotEmpty() && checking == 0,
                colors = ButtonDefaults.buttonColors(containerColor = Good),
                modifier = Modifier.weight(1f).height(56.dp),
            ) {
                Text(
                    when {
                        busy -> "Adding…"
                        checking > 0 -> "Checking…"
                        toAdd.isEmpty() -> "Add to inventory"
                        else -> "Add ${toAdd.size} to inventory"
                    },
                    style = MaterialTheme.typography.titleMedium,
                )
            }
        }

        ReaderBar(app)
    }
}

/** One return: what it is, where it came from, and its grade. */
@Composable
private fun ReturnCard(
    result: JSONObject,
    grade: Int,
    onGrade: (Int) -> Unit,
    onRemove: () -> Unit,
) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surface)
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(12.dp))
            .padding(12.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(
                    result.str("product_name"),
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis,
                )
                Row(verticalAlignment = Alignment.CenterVertically) {
                    ColourDot(result.str("color_hex"), size = 12.dp)
                    Spacer(Modifier.width(6.dp))
                    Text(
                        "${result.str("color_name")} · ${result.str("size_code")}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            TextButton(onClick = onRemove) { Text("Take out") }
        }

        Text(
            buildString {
                append(result.str("order_no"))
                if (!result.isNull("tracking_id")) append(" · tracking ${result.optInt("tracking_id")}")
                if (result.str("customer_name").isNotEmpty()) append(" · ${result.str("customer_name")}")
            },
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
        )
        TagCode(result.str("epc"))

        Spacer(Modifier.height(8.dp))

        // Three equal targets rather than chips: big enough for a gloved thumb,
        // and the number first, because the number is what the grade is.
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            GradeButton(1, "Good", Good, selected = grade == 1, onClick = { onGrade(1) }, modifier = Modifier.weight(1f))
            GradeButton(2, "Defective", Warn, selected = grade == 2, onClick = { onGrade(2) }, modifier = Modifier.weight(1f))
            GradeButton(3, "Discard", Bad, selected = grade == 3, onClick = { onGrade(3) }, modifier = Modifier.weight(1f))
        }
    }
}

@Composable
private fun GradeButton(
    number: Int,
    label: String,
    colour: Color,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier
            .height(50.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (selected) colour else MaterialTheme.colorScheme.surface)
            .border(2.dp, colour, RoundedCornerShape(10.dp))
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            "$number $label",
            color = if (selected) Color.White else colour,
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
        )
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.labelLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(top = 10.dp, start = 4.dp),
    )
}

/** A tag that will not be added, and why - or that the operator took out. */
@Composable
private fun LeftOutRow(
    result: JSONObject,
    note: String,
    actionLabel: String? = null,
    onAction: () -> Unit = {},
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .padding(horizontal = 10.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(
                result.str("product_name").ifEmpty { "Unknown tag" } +
                    (if (result.str("size_code").isNotEmpty()) " · ${result.str("color_name")} ${result.str("size_code")}" else ""),
                style = MaterialTheme.typography.titleSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(note, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            TagCode(result.str("epc"))
        }
        if (actionLabel != null) {
            TextButton(onClick = onAction) { Text(actionLabel) }
        }
    }
}
