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
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
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
import com.warehouse.handheld.ui.Good
import com.warehouse.handheld.ui.OnScan
import com.warehouse.handheld.ui.ReaderBar
import com.warehouse.handheld.ui.ScanResult
import com.warehouse.handheld.ui.TagCode
import com.warehouse.handheld.ui.Tone
import com.warehouse.handheld.ui.TopBar
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

/**
 * Say where you are, then scan what is going there.
 *
 * Where you are is answered by scanning the doorframe, which is the whole
 * reason room tags exist: a room picked off a list is a room somebody picks
 * wrongly at four o'clock, and every garment on the trolley then says it is in
 * B2 when it is in B1. The list is still there underneath, because a door tag
 * eventually falls off and the work cannot stop for it.
 */
@Composable
fun MoveScreen(app: HandheldApp, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()

    var rooms by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var roomId by remember { mutableStateOf(app.session.roomId) }
    var roomCode by remember { mutableStateOf(app.session.roomCode) }
    var message by remember { mutableStateOf<String?>(null) }
    var tone by remember { mutableStateOf(Tone.Plain) }
    var busy by remember { mutableStateOf(false) }

    // Held in state rather than read where it is drawn: the queue lives in a
    // file, and asking it its size on every recomposition is a disk read on the
    // thread that is trying to keep up with a trigger held down.
    var queued by remember { mutableIntStateOf(0) }

    val basket = remember { mutableStateListOf<String>() }

    LaunchedEffect(Unit) {
        rooms = runCatching { app.api.get("/api/rooms").objects("rooms") }.getOrDefault(emptyList())
        queued = app.queue.size()
    }

    fun chooseRoom(id: Int, code: String) {
        roomId = id
        roomCode = code
        app.session.roomId = id
        app.session.roomCode = code
        message = "Standing in $code."
        tone = Tone.Good
    }

    /**
     * One scan box for both jobs.
     *
     * `by-epc` answers `kind: "room"` when the operator has pointed the reader
     * at a doorframe, and that is a far better answer than "unknown tag" - so a
     * door tag scanned here changes the room rather than being refused, on the
     * screen where that is exactly what was meant.
     */
    fun scan(epc: String) {
        if (busy) return
        busy = true
        scope.launch {
            try {
                val reply = app.api.get("/api/items/by-epc/$epc")
                when (reply.str("kind")) {
                    "room" -> {
                        val room = reply.optJSONObject("room")
                        chooseRoom(room?.optInt("id") ?: 0, room?.str("code").orEmpty())
                        app.reader.beepGood()
                    }
                    "item" -> {
                        if (roomId <= 0) {
                            message = "Scan a doorframe first, or pick the room below."
                            tone = Tone.Warn
                            app.reader.beepBad()
                        } else if (basket.contains(epc)) {
                            message = "Already on the trolley."
                            tone = Tone.Plain
                        } else {
                            basket.add(epc)
                            val item = reply.optJSONObject("item")
                            message = buildString {
                                append(item?.str("product_name").orEmpty())
                                append(", ")
                                append(item?.str("color_name").orEmpty())
                                append(" ")
                                append(item?.str("size_code").orEmpty())
                                append(" — on the trolley")
                            }
                            tone = Tone.Good
                            app.reader.beepGood()
                        }
                    }
                    else -> {
                        message = "We have never seen that tag."
                        tone = Tone.Bad
                        app.reader.beepBad()
                    }
                }
            } catch (e: ApiError) {
                // Offline is not a reason to stop loading a trolley. The tag
                // goes on the list unidentified and the move is sent later; the
                // alternative is an operator standing in a dead aisle unable to
                // work.
                if (e.isOffline && roomId > 0 && !basket.contains(epc)) {
                    basket.add(epc)
                    message = "No signal — kept, and it will be sent when there is."
                    tone = Tone.Warn
                } else {
                    message = e.message
                    tone = Tone.Bad
                    app.reader.beepBad()
                }
            } finally {
                busy = false
            }
        }
    }

    OnScan(app) { scan(it.epc) }

    Column(Modifier.fillMaxSize()) {
        TopBar("Move stock", if (roomCode.isEmpty()) "Scan a doorframe" else "into $roomCode", onBack = onBack)

        Column(Modifier.padding(horizontal = 12.dp)) {
            Row(
                Modifier.fillMaxWidth().padding(vertical = 10.dp),
                horizontalArrangement = Arrangement.SpaceAround,
            ) {
                Counter(roomCode.ifEmpty { "—" }, "room you are in", Good)
                Counter(basket.size.toString(), "on the trolley")
            }

            ScanResult(message, tone)

        }

        LazyColumn(
            Modifier.weight(1f).padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (roomId <= 0) {
                item {
                    Text(
                        "Or pick the room",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                items(rooms) { room ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(MaterialTheme.colorScheme.surface)
                            .clickable { chooseRoom(room.optInt("id"), room.str("code")) }
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(room.str("code"), style = MaterialTheme.typography.titleMedium)
                        Spacer(Modifier.height(2.dp))
                        Text(
                            "  ${room.str("name")}",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            } else {
                itemsIndexed(basket) { index, epc ->
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .background(MaterialTheme.colorScheme.surface)
                            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(10.dp))
                            .padding(10.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        TagCode(epc, Modifier.weight(1f))
                        TextButton(onClick = { basket.removeAt(index) }) { Text("Take off") }
                    }
                }

                item {
                    Spacer(Modifier.height(8.dp))
                    Button(
                        onClick = {
                            scope.launch {
                                val body = JSONObject()
                                    .put("epcs", JSONArray(basket.toList()))
                                    .put("roomId", roomId)
                                    .put("note", "Moved on the handheld")
                                try {
                                    val reply = app.api.post("/api/items/move", body)
                                    val skipped = reply.objects("skipped").size
                                    message = buildString {
                                        append("${reply.optInt("moved")} moved into $roomCode.")
                                        // The tags it did not know are reported
                                        // rather than the whole move failing:
                                        // one bad tag on a trolley of forty must
                                        // not cost the other thirty-nine.
                                        if (skipped > 0) append(" $skipped were not recognised.")
                                    }
                                    tone = if (skipped > 0) Tone.Warn else Tone.Good
                                    basket.clear()
                                } catch (e: ApiError) {
                                    if (e.isOffline) {
                                        app.queue.add("/api/items/move", body)
                                        queued = app.queue.size()
                                        message = "No signal — ${basket.size} saved and they will be sent when there is."
                                        tone = Tone.Warn
                                        basket.clear()
                                    } else {
                                        message = e.message
                                        tone = Tone.Bad
                                    }
                                }
                            }
                        },
                        enabled = basket.isNotEmpty(),
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                    ) {
                        Text("Move ${basket.size} into ${roomCode.ifEmpty { "…" }}")
                    }

                    TextButton(
                        onClick = {
                            roomId = 0
                            roomCode = ""
                            app.session.roomId = 0
                            app.session.roomCode = ""
                        },
                    ) { Text("Change room") }

                    Spacer(Modifier.height(8.dp))
                }
            }
        }

        ReaderBar(app, queued = queued)
    }
}
