package com.warehouse.handheld.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.warehouse.handheld.HandheldApp
import com.warehouse.handheld.rfid.TagRead

/**
 * Wires a screen up to the reader for as long as it is on screen.
 *
 * Every scanning screen calls this and none of them touches the reader
 * directly, which is what stops one of them forgetting to unhook and quietly
 * carrying on processing tags for the screen after it.
 */
@Composable
fun OnScan(app: HandheldApp, repeatWindowMs: Long = 1500, handle: suspend (TagRead) -> Unit) {
    val current by rememberUpdatedState(handle)

    DisposableEffect(repeatWindowMs) {
        val previous = app.reader.repeatWindowMs
        app.reader.repeatWindowMs = repeatWindowMs

        // The wedge buffer is switched on here and nowhere else.
        //
        // It swallows key presses so that a barcode typed by the scanner is
        // read as one code rather than landing in whatever happens to be
        // focused. That is right on a scanning screen and wrong everywhere
        // else: while it was on for the whole time the reader was open, the
        // sign-in screen ate its own username and password and the fields
        // simply stayed empty. Only screens that call OnScan want it.
        app.reader.keypadListening(true)

        // Start from a known state. A screen must never inherit "Reading" from
        // the one before it: the bar would say the reader is sweeping when it
        // is not, and the operator's first press would appear to do nothing.
        app.reader.stop()

        onDispose {
            app.reader.repeatWindowMs = previous
            app.reader.keypadListening(false)
            app.reader.stop()
        }
    }

    // collect, not collectLatest: a second tag arriving must not cancel the
    // handling of the first. On a continuous inventory they arrive in bursts,
    // and cancelling means a garment that was scanned and beeped for never
    // reaches the server.
    LaunchedEffect(Unit) {
        app.reader.tags.collect { current(it) }
    }
}

/**
 * The strip along the bottom of every scanning screen: what is doing the
 * reading, whether it is reading right now, and anything waiting to be sent.
 */
@Composable
fun ReaderBar(app: HandheldApp, queued: Int = 0) {
    val scanning by app.reader.scanning.collectAsState()
    val open by app.reader.open.collectAsState()

    // The trigger toggles, so the bar says which way it will flip next rather
    // than describing a state the operator can already see.
    // Short. The whole strip is one line on a 4-inch screen, and a longer
    // sentence pushed the reader's name into wrapping on top of it.
    val (label, colour) = when {
        !open -> "Reader not open" to Bad
        scanning -> "Reading — press to stop" to Good
        app.reader.usingUhf -> "Press the trigger to scan" to Cool
        else -> "No reader on this device" to Warn
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = 8.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(MaterialTheme.colorScheme.surface)
            .padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // The state takes the space it needs and the reader's name gives way,
        // rather than both wrapping and overlapping each other.
        Text(
            label,
            color = colour,
            style = MaterialTheme.typography.labelLarge,
            maxLines = 1,
        )
        Spacer(Modifier.width(8.dp))
        Text(
            if (queued > 0) "$queued waiting to send" else app.reader.backend.name,
            color = if (queued > 0) Warn else MaterialTheme.colorScheme.onSurfaceVariant,
            style = MaterialTheme.typography.labelMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
        )
    }
}
