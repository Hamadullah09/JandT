package com.warehouse.handheld.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
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
import com.warehouse.handheld.ui.TagCode
import com.warehouse.handheld.ui.Tile
import com.warehouse.handheld.ui.Tone
import com.warehouse.handheld.ui.TopBar
import com.warehouse.handheld.ui.Warn
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable
fun OrderListScreen(app: HandheldApp, onNavigate: (Screen) -> Unit) {
    var orders by remember { mutableStateOf<List<JSONObject>?>(null) }
    var problem by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        try {
            // Only orders with something left to scan. One with every line
            // dropship has nothing to pick, so it is sent out from the website.
            orders = app.api.get("/api/orders?status=pending").objects("orders")
                .filter { it.optInt("stock_units") > it.optInt("picked") }
        } catch (e: ApiError) {
            problem = e.message
            orders = emptyList()
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopBar("Pick an order", "Orders waiting for garments", onBack = { onNavigate(Screen.Home) })

        val list = orders
        when {
            list == null -> Loading()
            problem != null -> Column(Modifier.padding(12.dp)) { ScanResult(problem, Tone.Bad) }
            list.isEmpty() -> Empty("Nothing is waiting to be picked.")
            else -> LazyColumn(
                Modifier.padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(list) { order ->
                    // stock_units, not units: a dropship line is on the order
                    // but never gets a tag scanned onto it, so counting it here
                    // would send a picker looking for something that is not in
                    // the building.
                    val outstanding = order.optInt("stock_units") - order.optInt("picked")
                    Tile(
                        title = order.str("order_no"),
                        detail = buildString {
                            append(order.str("customer_name"))
                            order.str("city").takeIf { it.isNotEmpty() }?.let { append(" · $it") }
                        },
                        badge = outstanding.coerceAtLeast(0),
                    ) {
                        onNavigate(Screen.Order(order.optInt("id"), order.str("order_no")))
                    }
                }
            }
        }
    }
}

/**
 * Scan any garment the order wants.
 *
 * The operator is never asked which line a tag is for. The server works that
 * out from the tag and refuses anything the order does not want, with the
 * reason - which is the only way it can work when a picker is carrying an
 * armful and reading a screen at arm's length.
 *
 * The last garment scanned sends the order out; there is no button for it any
 * more. The reader stops there, so it does not go on refusing the rest of the
 * rail on an order that has gone.
 */
@Composable
fun OrderDetailScreen(app: HandheldApp, screen: Screen.Order, onBack: () -> Unit) {
    val scope = rememberCoroutineScope()

    var lines by remember { mutableStateOf<List<JSONObject>?>(null) }
    var picked by remember { mutableStateOf<List<JSONObject>>(emptyList()) }
    var status by remember { mutableStateOf("") }
    var customer by remember { mutableStateOf("") }
    var message by remember { mutableStateOf<String?>(null) }
    var tone by remember { mutableStateOf(Tone.Plain) }
    var busy by remember { mutableStateOf(false) }

    suspend fun load() {
        try {
            val reply = app.api.get("/api/orders/${screen.id}")
            reply.optJSONObject("order")?.let {
                status = it.str("status")
                customer = it.str("customer_name")
            }
            lines = reply.objects("lines")
            picked = reply.objects("picked")
        } catch (e: ApiError) {
            message = e.message
            tone = Tone.Bad
            lines = emptyList()
        }
    }

    LaunchedEffect(screen.id) { load() }

    fun scan(epc: String) {
        // Gone out: whatever is still being heard is the rest of the rail.
        if (busy || status == "shipped") return
        busy = true
        scope.launch {
            try {
                val reply = app.api.post("/api/orders/${screen.id}/pick", JSONObject().put("epc", epc))
                val outstanding = reply.optInt("outstanding")
                if (reply.str("orderStatus") == "shipped") {
                    status = "shipped"
                    app.reader.stop()
                    app.reader.beepDone()
                    message = "${reply.str("product")} — that was the last one. Sent out."
                } else {
                    app.reader.beepGood()
                    message = "${reply.str("product")} — $outstanding still to scan"
                }
                tone = Tone.Good
                load()
            } catch (e: ApiError) {
                message = e.message
                tone = Tone.Bad
                app.reader.beepBad()
                app.reader.forget(epc)
            } finally {
                busy = false
            }
        }
    }

    OnScan(app) { scan(it.epc) }

    val list = lines
    val outstanding = list?.sumOf { it.optInt("outstanding") } ?: 0

    Column(Modifier.fillMaxSize()) {
        TopBar(screen.label, customer, onBack = onBack)

        if (list == null) {
            Loading()
            return@Column
        }

        Column(Modifier.padding(horizontal = 12.dp)) {
            Row(
                Modifier.fillMaxWidth().padding(vertical = 10.dp),
                horizontalArrangement = Arrangement.SpaceAround,
            ) {
                Counter(
                    outstanding.toString(),
                    "still to scan",
                    if (outstanding > 0) Warn else Good,
                )
                Counter(picked.size.toString(), "on the order")
            }

            ScanResult(message, tone)

        }

        LazyColumn(
            Modifier.weight(1f).padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items(list) { line ->
                val dropship = line.str("route") == "dropship"
                val left = line.optInt("outstanding")

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
                            Text(line.str("product_name"), style = MaterialTheme.typography.titleMedium)
                            Text(
                                "${line.str("color_name")} · ${line.str("size_code")}",
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        Text(
                            // A dropship line never gets a tag scanned onto it:
                            // the supplier posts it to the customer and it was
                            // never in the building. Saying so is what stops a
                            // picker hunting the shelves for it.
                            if (dropship) "supplier ships"
                            else "${line.optInt("picked")}/${line.optInt("quantity")}",
                            style = MaterialTheme.typography.titleMedium,
                            color = when {
                                dropship -> MaterialTheme.colorScheme.onSurfaceVariant
                                left == 0 -> Good
                                else -> Warn
                            },
                        )
                    }
                }
            }

            if (picked.isNotEmpty()) {
                item {
                    Spacer(Modifier.height(4.dp))
                    Text(
                        "Scanned onto this order",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                items(picked) { row ->
                    Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp)) {
                        TagCode(row.str("epc"), Modifier.weight(1f))
                        Text(
                            when (row.str("status")) {
                                "allocated" -> "picked"
                                "shipped" -> "sent out"
                                else -> row.str("status")
                            },
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            }

            item { Spacer(Modifier.height(8.dp)) }
        }

        ReaderBar(app)
    }
}
