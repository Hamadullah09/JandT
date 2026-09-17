package com.warehouse.handheld.ui.screens

import android.content.ActivityNotFoundException
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.PhotoCamera
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import com.warehouse.handheld.HandheldApp
import com.warehouse.handheld.data.ApiError
import com.warehouse.handheld.data.SearchPhoto
import com.warehouse.handheld.data.money
import com.warehouse.handheld.data.objects
import com.warehouse.handheld.data.str
import com.warehouse.handheld.ui.ColourDot
import com.warehouse.handheld.ui.Empty
import com.warehouse.handheld.ui.Good
import com.warehouse.handheld.ui.Loading
import com.warehouse.handheld.ui.Pill
import com.warehouse.handheld.ui.ProductPhoto
import com.warehouse.handheld.ui.ScanResult
import com.warehouse.handheld.ui.Screen
import com.warehouse.handheld.ui.Tone
import com.warehouse.handheld.ui.TopBar
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File

/**
 * The last search, for as long as the app runs. Back from a hunt comes to this
 * screen again, and the operator is usually after the next colour or size of
 * the same product - which would be gone if the box started empty.
 */
private var lastQuery = ""

/** The last search by photo, kept for the same reason as [lastQuery]. */
private var lastPhotoSearch: PhotoSearch? = null

/** A search by photo: a thumbnail of what was photographed, and what came back (null while looking). */
private class PhotoSearch(
    val preview: ImageBitmap,
    val products: List<JSONObject>?,
    val clearMatch: Boolean = false,
    val withoutPhotos: Int = 0,
)

/**
 * Search products, with their photos.
 *
 * Somebody on the floor has an order for "the maroon gharara, medium" and no
 * idea what it looks like or where one is. This shows the picture, every colour
 * and size with how many are on a shelf, and **Tap to find** beside each one -
 * which puts every one of that colour and size on the hunt and opens the reader
 * straight into it. Finding any one of them ends the hunt for the rest.
 *
 * Or somebody is holding a garment with no tag, or a customer's picture of one,
 * and no name to type: **Take photo** (or a picture from the **Gallery**) and the
 * products that look most like it come up the same way.
 */
@Composable
fun ProductSearchScreen(app: HandheldApp, onNavigate: (Screen) -> Unit) {
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    val context = LocalContext.current

    var query by remember { mutableStateOf(lastQuery) }
    var products by remember { mutableStateOf<List<JSONObject>?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var tone by remember { mutableStateOf(Tone.Plain) }
    var busyVariant by remember { mutableIntStateOf(0) }

    var photoSearch by remember { mutableStateOf(lastPhotoSearch) }
    // Moved on by every photo search and by leaving one, so an answer that
    // arrives after the operator has moved on is recognised and dropped.
    var photoRun by remember { mutableIntStateOf(0) }

    fun showPhotoSearch(value: PhotoSearch?) {
        photoSearch = value
        lastPhotoSearch = value
    }

    fun leavePhotoSearch() {
        photoRun++
        showPhotoSearch(null)
    }

    // Typing goes into the search box on this screen, not into a scan, and a
    // trigger press left over from the last screen must not keep the radio
    // sweeping with nothing listening.
    DisposableEffect(Unit) {
        app.reader.stop()
        onDispose { }
    }

    // A pause after the last key before searching, so each letter is not its
    // own trip to the server over warehouse Wi-Fi.
    LaunchedEffect(query) {
        delay(if (query.isEmpty()) 0 else 350)
        try {
            val path = if (query.isBlank()) "/api/products/search"
            else "/api/products/search?q=" + java.net.URLEncoder.encode(query.trim(), "UTF-8")
            products = app.api.get(path).objects("products")
            if (tone == Tone.Bad) message = null
        } catch (e: ApiError) {
            message = e.message
            tone = Tone.Bad
            if (products == null) products = emptyList()
        }
    }

    fun find(variant: JSONObject, productName: String) {
        if (busyVariant != 0) return
        val id = variant.optInt("id")
        busyVariant = id
        scope.launch {
            try {
                val reply = app.api.post("/api/find/variant/$id", JSONObject())
                val label = "$productName · ${variant.str("color_name")} ${variant.str("size_code")}"
                val group = reply.str("groupKey")
                if (group.isNotEmpty()) {
                    onNavigate(Screen.FindGroup(group, label))
                } else {
                    // Every one of them was already being hunted - the list
                    // already has them, so go to it rather than start a second hunt.
                    onNavigate(Screen.Find)
                }
            } catch (e: ApiError) {
                message = e.message
                tone = Tone.Bad
                app.reader.beepBad()
            } finally {
                busyVariant = 0
            }
        }
    }

    // ------------------------------------------------------------------ search by photo

    fun searchByPhoto(uri: Uri) {
        val run = ++photoRun
        message = null
        focus.clearFocus()
        scope.launch {
            val photo = try {
                withContext(Dispatchers.IO) { SearchPhoto.from(context, uri) }
            } catch (e: Exception) {
                null
            }
            if (run != photoRun) return@launch
            if (photo == null) {
                message = "That picture could not be read. Take the photo again, or pick another from the Gallery."
                tone = Tone.Bad
                app.reader.beepBad()
                return@launch
            }

            val preview = photo.preview.asImageBitmap()
            showPhotoSearch(PhotoSearch(preview, products = null))
            try {
                val reply = app.api.postPhoto("/api/products/search-by-photo", photo.jpeg)
                if (run != photoRun) return@launch
                val found = reply.objects("products")
                val clear = reply.optBoolean("clearMatch")
                showPhotoSearch(PhotoSearch(preview, found, clear, reply.optInt("productsWithoutPhotos")))
                if (found.isNotEmpty() && clear) app.reader.beepGood()
            } catch (e: ApiError) {
                if (run != photoRun) return@launch
                showPhotoSearch(null)
                message = e.message
                tone = Tone.Bad
                app.reader.beepBad()
            }
        }
    }

    // The camera app writes the photo into a file of ours, handed over by name.
    // One file, replaced each time: nothing piles up on the handheld.
    val cameraFile = remember { File(File(context.cacheDir, "search").apply { mkdirs() }, "camera.jpg") }
    val cameraUri = remember { FileProvider.getUriForFile(context, "${context.packageName}.photos", cameraFile) }

    val takePhoto = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { saved ->
        when {
            saved && cameraFile.length() > 0 -> searchByPhoto(cameraUri)
            // Some camera apps report a photo they never wrote.
            saved -> {
                message = "The camera did not save the photo. Try again, or pick one from the Gallery instead."
                tone = Tone.Bad
            }
        }
    }
    val choosePicture = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) searchByPhoto(uri)
    }

    fun openCamera() {
        message = null
        cameraFile.delete()
        try {
            takePhoto.launch(cameraUri)
        } catch (e: ActivityNotFoundException) {
            message = "This handheld has no camera app to take the photo with. Use Gallery instead."
            tone = Tone.Bad
        } catch (e: SecurityException) {
            // Never expected now the camera permission is left out, but a
            // refusal must be a sentence on the screen, not the app closing.
            message = "The handheld did not allow the camera to open. Use Gallery instead."
            tone = Tone.Bad
        }
    }

    fun openPictures() {
        message = null
        try {
            choosePicture.launch("image/*")
        } catch (e: ActivityNotFoundException) {
            message = "This handheld has no app to choose a picture from."
            tone = Tone.Bad
        } catch (e: SecurityException) {
            message = "The handheld did not allow the pictures to open."
            tone = Tone.Bad
        }
    }

    // ------------------------------------------------------------------ screen

    Column(Modifier.fillMaxSize()) {
        TopBar(
            title = "Search products",
            subtitle = "By name, or by photo",
            onBack = { onNavigate(Screen.Home) },
        )

        Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
            OutlinedTextField(
                value = query,
                onValueChange = {
                    query = it
                    lastQuery = it
                    // Typing is a search by name: a photo's results make way for it.
                    if (photoSearch != null) leavePhotoSearch()
                },
                label = { Text("Name, code or colour") },
                singleLine = true,
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                // The search runs as the operator types; the key puts the
                // keyboard away so the results it was covering can be seen.
                keyboardActions = KeyboardActions(onSearch = { focus.clearFocus() }),
                modifier = Modifier.fillMaxWidth(),
            )
            Spacer(Modifier.height(8.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = ::openCamera, modifier = Modifier.weight(1f).height(48.dp)) {
                    Icon(Icons.Filled.PhotoCamera, contentDescription = null, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Take photo", maxLines = 1)
                }
                OutlinedButton(onClick = ::openPictures, modifier = Modifier.weight(1f).height(48.dp)) {
                    Icon(Icons.Filled.Image, contentDescription = null, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(6.dp))
                    Text("Gallery", maxLines = 1)
                }
            }
            if (message != null) {
                Spacer(Modifier.height(8.dp))
                ScanResult(message, tone)
            }
        }

        val photo = photoSearch
        val list = products
        when {
            photo != null -> LazyColumn(
                Modifier.padding(horizontal = 12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                item(key = "photo-header") {
                    PhotoHeader(photo, onClear = ::leavePhotoSearch)
                }
                val found = photo.products.orEmpty()
                itemsIndexed(found, key = { _, p -> "photo-" + p.optInt("id") }) { index, product ->
                    ProductCard(
                        app = app,
                        product = product,
                        busyVariant = busyVariant,
                        onFind = { find(it, product.str("name")) },
                        badge = when {
                            index > 0 -> "Also similar" to MaterialTheme.colorScheme.outline
                            photo.clearMatch -> "Best match" to Good
                            else -> "Closest" to MaterialTheme.colorScheme.secondary
                        },
                    )
                }
                item { Spacer(Modifier.height(12.dp)) }
            }
            list == null -> Loading()
            list.isEmpty() -> Empty(
                if (query.isBlank()) "No products yet.\nThe office adds them on the dashboard."
                else "Nothing matches \"$query\".",
            )
            else -> LazyColumn(
                Modifier.padding(horizontal = 12.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp),
            ) {
                items(list, key = { it.optInt("id") }) { product ->
                    ProductCard(
                        app = app,
                        product = product,
                        busyVariant = busyVariant,
                        onFind = { find(it, product.str("name")) },
                    )
                }
                item { Spacer(Modifier.height(12.dp)) }
            }
        }
    }
}

/** What was photographed, and in a sentence what it looks like. */
@Composable
private fun PhotoHeader(photo: PhotoSearch, onClear: () -> Unit) {
    val found = photo.products
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surface)
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(12.dp))
            .padding(10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Image(
            bitmap = photo.preview,
            contentDescription = "The photo searched with",
            contentScale = ContentScale.Fit,
            modifier = Modifier
                .width(72.dp)
                .height(96.dp)
                .clip(RoundedCornerShape(8.dp))
                .background(MaterialTheme.colorScheme.surfaceVariant),
        )
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text("Search by photo", style = MaterialTheme.typography.titleMedium)
            Text(
                when {
                    found == null -> "Looking for this garment…"
                    found.isEmpty() -> "Nothing in the catalogue looks like this photo."
                    photo.clearMatch -> "This looks like ${found.first().str("name")}."
                    // Not sure - either several look alike, or nothing is close enough
                    // to be the garment (the server now says which by clearMatch).
                    else -> "No sure match - these look closest, so check the pictures."
                },
                style = MaterialTheme.typography.bodyMedium,
            )
            if (photo.withoutPhotos > 0) {
                Spacer(Modifier.height(4.dp))
                Text(
                    if (photo.withoutPhotos == 1) "1 product has no photo yet, so a photo cannot find it."
                    else "${photo.withoutPhotos} products have no photo yet, so a photo cannot find them.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        TextButton(onClick = onClear) { Text("Clear") }
    }
}

@Composable
private fun ProductCard(
    app: HandheldApp,
    product: JSONObject,
    busyVariant: Int,
    onFind: (JSONObject) -> Unit,
    badge: Pair<String, Color>? = null,
) {
    val dropship = product.str("stock_type") == "dropship"
    val variants = product.objects("variants")

    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(MaterialTheme.colorScheme.surface)
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(12.dp))
            .padding(12.dp),
    ) {
        Row(verticalAlignment = Alignment.Top) {
            ProductPhoto(
                app = app,
                path = product.str("photo_url"),
                modifier = Modifier.width(96.dp).height(128.dp),
            )
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    product.str("name"),
                    style = MaterialTheme.typography.titleMedium,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    product.str("sku"),
                    fontFamily = FontFamily.Monospace,
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    "${product.str("category_name")} · ${formatPrice(product.money("sale_price"))}",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    if (badge != null) Pill(badge.first, badge.second)
                    if (dropship) {
                        Pill("Dropship", MaterialTheme.colorScheme.secondary)
                    } else {
                        val total = product.optInt("in_stock")
                        Pill("$total in stock", if (total > 0) Good else MaterialTheme.colorScheme.outline)
                    }
                }
            }
        }

        if (variants.isEmpty()) {
            Spacer(Modifier.height(8.dp))
            Text(
                "No colours or sizes yet.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }

        variants.forEach { variant ->
            val inStock = variant.optInt("in_stock")
            val id = variant.optInt("id")

            Spacer(Modifier.height(8.dp))
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .padding(start = 10.dp, end = 6.dp, top = 6.dp, bottom = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ColourDot(variant.str("color_hex"))
                Spacer(Modifier.width(8.dp))
                Text(
                    "${variant.str("color_name")} · ${variant.str("size_code")}",
                    style = MaterialTheme.typography.titleSmall,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    if (dropship) "${variant.optInt("sellable")} at supplier" else "$inStock",
                    style = MaterialTheme.typography.titleMedium,
                    color = if (!dropship && inStock > 0) Good else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(horizontal = 8.dp),
                )
                if (!dropship) {
                    Button(
                        onClick = { onFind(variant) },
                        enabled = inStock > 0 && busyVariant == 0,
                        modifier = Modifier.height(44.dp),
                    ) {
                        Text(if (busyVariant == id) "…" else if (inStock > 0) "Tap to find" else "None")
                    }
                }
            }
        }
    }
}

/** The price as the dashboard shows it: ringgit and sen, grouped, RM kept on the number's line. */
private fun formatPrice(value: Double): String =
    "RM\u00A0" + String.format(java.util.Locale.US, "%,.2f", value)
