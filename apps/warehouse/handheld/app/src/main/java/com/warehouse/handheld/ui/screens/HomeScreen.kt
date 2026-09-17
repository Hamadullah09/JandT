package com.warehouse.handheld.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.warehouse.handheld.HandheldApp
import com.warehouse.handheld.data.ApiError
import com.warehouse.handheld.data.objects
import com.warehouse.handheld.ui.ScanResult
import com.warehouse.handheld.ui.Screen
import com.warehouse.handheld.ui.Tile
import com.warehouse.handheld.ui.Tone
import com.warehouse.handheld.ui.TopBar

/**
 * The jobs on this handheld, in the order they matter, with how much of each
 * is waiting.
 *
 * The counts are the reason this screen exists rather than a menu: an operator
 * who can see that three orders need picking does not have to open the picking
 * list to find out there is nothing to do.
 */
@Composable
fun HomeScreen(app: HandheldApp, onNavigate: (Screen) -> Unit) {
    var intakes by remember { mutableIntStateOf(0) }
    var orders by remember { mutableIntStateOf(0) }
    var finds by remember { mutableIntStateOf(0) }
    var queued by remember { mutableIntStateOf(0) }
    var problem by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        // Anything that was done in a dead zone goes first, before the counts
        // are read, so the numbers on this screen are not stale by the width of
        // the queue.
        runCatching { app.queue.flush(app.api) }
        queued = app.queue.size()

        try {
            intakes = app.api.get("/api/batches?status=open").objects("batches").size
            // Only orders with something left to scan: one with every line
            // dropship is sent out from the website, not picked here.
            orders = app.api.get("/api/orders?status=pending").objects("orders")
                .count { it.optInt("stock_units") > it.optInt("picked") }
            finds = app.api.get("/api/find?status=open").objects("requests").size
            problem = null
        } catch (e: ApiError) {
            problem = e.message
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopBar(
            title = app.session.userName.ifBlank { "Warehouse" },
            subtitle = app.session.serverUrl.removePrefix("http://"),
            trailing = {
                IconButton(onClick = { onNavigate(Screen.Settings) }) {
                    Icon(Icons.Filled.Settings, contentDescription = "Settings")
                }
            },
        )

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            if (problem != null) {
                ScanResult(problem, Tone.Bad)
                Spacer(Modifier.height(2.dp))
            }

            // Moving stock was taken off at the owner's request. The screen is
            // still in the project and still works - it is simply not reachable
            // - so putting it back is one Tile line.
            Tile("Book stock in", "Tag what arrived", intakes) { onNavigate(Screen.Intakes) }
            Tile("Pick an order", "Scan garments onto an order", orders) { onNavigate(Screen.Orders) }
            // Returns have no count: nothing waits to be opened any more. The
            // returns room is simply swept whenever there is something in it.
            Tile("Take returns", "Sweep the returns room") { onNavigate(Screen.Returns) }
            Tile("Search products", "By name or by photo - tap to find") { onNavigate(Screen.Products) }
            Tile("Find a garment", "Hunt a tag down", finds) { onNavigate(Screen.Find) }

            Spacer(Modifier.height(6.dp))

            Text(
                buildString {
                    append(app.reader.backend.name)
                    if (!app.reader.usingUhf) append(" — no UHF SDK on this build")
                    if (queued > 0) append(" · $queued waiting to send")
                },
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
