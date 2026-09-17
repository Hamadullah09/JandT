package com.warehouse.handheld.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Slider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.warehouse.handheld.HandheldApp
import com.warehouse.handheld.data.ApiError
import com.warehouse.handheld.data.ServerFinder
import com.warehouse.handheld.rfid.ChainwayUhf
import com.warehouse.handheld.ui.ScanResult
import com.warehouse.handheld.ui.Tone
import com.warehouse.handheld.ui.TopBar
import com.warehouse.handheld.ui.UiSize
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(app: HandheldApp, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()

    var server by remember { mutableStateOf(app.session.serverUrl) }
    var power by remember { mutableFloatStateOf(app.session.readerPower.toFloat()) }
    var message by remember { mutableStateOf<String?>(null) }
    var tone by remember { mutableStateOf(Tone.Plain) }
    var searching by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize()) {
        TopBar("Settings", app.session.userName, onBack = onBack)

        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("The server", style = MaterialTheme.typography.titleMedium)
            OutlinedTextField(
                value = server,
                onValueChange = { server = it },
                singleLine = true,
                label = { Text("Address") },
                modifier = Modifier.fillMaxWidth(),
            )
            Text(
                "The warehouse PC. If the scanner stops reaching it, the PC's address " +
                    "has probably changed — press Find it for me.",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            // The first button, and the wide one, because it is the answer to
            // the fault people actually hit. Typing an IP address is the
            // fallback now, not the instruction.
            Button(
                onClick = {
                    searching = true
                    message = "Looking for the warehouse PC…"
                    tone = Tone.Plain
                    scope.launch {
                        val found = ServerFinder.find()
                        searching = false
                        if (found != null) {
                            app.session.serverUrl = found
                            server = app.session.serverUrl
                            message = "Found it: $found — saved."
                            tone = Tone.Good
                        } else {
                            message = "Nothing answered on this network. Check the PC is on, " +
                                "that START.cmd has been run, and that this scanner is on the " +
                                "same Wi-Fi."
                            tone = Tone.Bad
                        }
                    }
                },
                enabled = !searching,
                modifier = Modifier.fillMaxWidth().height(52.dp),
            ) { Text(if (searching) "Looking…" else "Find it for me") }

            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = {
                    app.session.serverUrl = server
                    server = app.session.serverUrl
                    message = "Saved."
                    tone = Tone.Good
                }) { Text("Save") }

                OutlinedButton(onClick = {
                    app.session.serverUrl = server
                    server = app.session.serverUrl
                    scope.launch {
                        message = try {
                            app.api.get("/api/health")
                            tone = Tone.Good
                            "The server answered."
                        } catch (e: ApiError) {
                            tone = Tone.Bad
                            e.message
                        }
                    }
                }) { Text("Test it") }
            }

            Spacer(Modifier.height(4.dp))
            Text("The reader", style = MaterialTheme.typography.titleMedium)
            Text(
                buildString {
                    append(app.reader.backend.name)
                    append(if (app.reader.usingUhf) " — found and open" else " — no Chainway SDK in this build")
                },
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            if (app.reader.usingUhf) {
                Text("Power: ${power.toInt()} dBm", style = MaterialTheme.typography.bodyLarge)
                Slider(
                    value = power,
                    onValueChange = { power = it },
                    valueRange = ChainwayUhf.MIN_POWER.toFloat()..ChainwayUhf.MAX_POWER.toFloat(),
                    onValueChangeFinished = {
                        app.session.readerPower = power.toInt()
                        app.reader.backend.power = power.toInt()
                    },
                )
                Text(
                    // Turning it up is not free: a reader at full power in a
                    // narrow aisle reads the shelf behind the one the operator
                    // is standing at, and every one of those is a garment
                    // counted in the wrong room.
                    "Lower it when you are picking up tags from the next aisle. " +
                        "Raise it when tags at the back of a deep shelf are being missed.",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            } else {
                Text(
                    // No mention of typing a tag: there is nowhere left to type
                    // one. The barcode scanner still works because it types for
                    // you, and that is the only way in on a build with no radio.
                    "The trigger will do nothing on this build. The barcode scanner still " +
                        "reads a printed tag code. Put Chainway's DeviceAPI jar in app/libs " +
                        "and rebuild to turn the reader on.",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }

            Spacer(Modifier.height(4.dp))
            Text("Screen size", style = MaterialTheme.typography.titleMedium)
            val size by app.uiSize.collectAsState()
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (choice in UiSize.entries) {
                    val pick = {
                        app.session.uiSize = choice.name
                        app.uiSize.value = choice
                    }
                    if (choice == size) {
                        Button(onClick = pick, modifier = Modifier.weight(1f)) { Text(choice.label) }
                    } else {
                        OutlinedButton(onClick = pick, modifier = Modifier.weight(1f)) { Text(choice.label) }
                    }
                }
            }
            Text(
                "Small fits the most on the screen. Choose Large if the text is hard to read.",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Spacer(Modifier.height(4.dp))
            Text("Waiting to be sent", style = MaterialTheme.typography.titleMedium)
            Text(
                "${app.queue.size()} moves and finds are saved on this device.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            OutlinedButton(onClick = {
                scope.launch {
                    val sent = runCatching { app.queue.flush(app.api) }.getOrDefault(0)
                    message = if (sent > 0) "$sent sent." else "Nothing was waiting, or there is still no signal."
                    tone = if (sent > 0) Tone.Good else Tone.Plain
                }
            }) { Text("Send them now") }

            Spacer(Modifier.height(8.dp))
            ScanResult(message, tone)

            Spacer(Modifier.height(8.dp))
            OutlinedButton(
                onClick = {
                    app.session.signOut()
                    onBack()
                },
                modifier = Modifier.fillMaxWidth().height(50.dp),
            ) { Text("Sign out") }
        }
    }
}
