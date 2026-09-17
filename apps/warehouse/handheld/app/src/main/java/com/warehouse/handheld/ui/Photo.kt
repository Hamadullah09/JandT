package com.warehouse.handheld.ui

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.warehouse.handheld.HandheldApp
import com.warehouse.handheld.data.PhotoCache

/**
 * A product's photo, cropped to fill a 3:4 frame the way the dashboard shows
 * it, or "No photo" when there is none or it cannot be fetched.
 *
 * [path] is what the server sends - "/uploads/products/…" - and is joined to
 * whichever server this handheld is signed in to, so the same search works
 * over the warehouse Wi-Fi and through a USB tunnel alike.
 */
@Composable
fun ProductPhoto(app: HandheldApp, path: String, modifier: Modifier = Modifier) {
    val bitmap by produceState<Bitmap?>(initialValue = null, path) {
        value = if (path.isBlank()) null
        else PhotoCache.load(app.session.serverUrl.trimEnd('/') + path, targetPx = 360)
    }

    Box(
        modifier
            .clip(RoundedCornerShape(10.dp))
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(10.dp)),
        contentAlignment = Alignment.Center,
    ) {
        val shown = bitmap
        if (shown != null) {
            Image(
                bitmap = shown.asImageBitmap(),
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
            )
        } else {
            Text(
                "No photo",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
        }
    }
}

/** The dot beside a colour name, in the colour the office set for it. */
@Composable
fun ColourDot(hex: String, size: Dp = 16.dp) {
    val colour = runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrDefault(Color.LightGray)
    Box(
        Modifier
            .size(size)
            .clip(CircleShape)
            .background(colour)
            .border(1.dp, Color(0x33000000), CircleShape),
    )
}
