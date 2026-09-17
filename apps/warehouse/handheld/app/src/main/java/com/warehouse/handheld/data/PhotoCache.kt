package com.warehouse.handheld.data

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import android.util.LruCache
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URL

/**
 * Product photos, downloaded once and kept in memory.
 *
 * No image library, for the same reason the API has none: it is a handful of
 * small pictures on one screen, and the platform decodes them perfectly well.
 * Photos are decoded at roughly the size they are drawn rather than at the
 * size they were taken - a 4000-pixel phone photo is 60 MB as a bitmap, and a
 * handheld that runs out of memory scrolling a search result is not a
 * handheld anyone trusts.
 */
object PhotoCache {

    /** An eighth of what the app may use, in kilobytes. */
    private val cache = object : LruCache<String, Bitmap>(
        (Runtime.getRuntime().maxMemory() / 1024 / 8).toInt(),
    ) {
        override fun sizeOf(key: String, value: Bitmap) = value.byteCount / 1024
    }

    /**
     * The photo at [url], decoded to about [targetPx] on its longer side, or
     * null when it cannot be had - no signal, or removed since the search.
     * Null is drawn as "No photo", never as an error: a missing picture must
     * not stop anybody finding a garment.
     */
    suspend fun load(url: String, targetPx: Int): Bitmap? {
        val key = "$url@$targetPx"
        cache.get(key)?.let { return it }

        return withContext(Dispatchers.IO) {
            val bytes = try {
                val conn = URL(url).openConnection() as HttpURLConnection
                try {
                    conn.connectTimeout = 8000
                    conn.readTimeout = 15000
                    if (conn.responseCode !in 200..299) return@withContext null
                    conn.inputStream.use { it.readBytes() }
                } finally {
                    conn.disconnect()
                }
            } catch (e: Exception) {
                Log.w("PhotoCache", "could not fetch $url", e)
                return@withContext null
            }

            // Measure first, then decode at the largest power-of-two reduction
            // that is still at least as big as it will be drawn.
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return@withContext null

            var sample = 1
            val longest = maxOf(bounds.outWidth, bounds.outHeight)
            while (longest / (sample * 2) >= targetPx) sample *= 2

            val bitmap = BitmapFactory.decodeByteArray(
                bytes, 0, bytes.size, BitmapFactory.Options().apply { inSampleSize = sample },
            ) ?: return@withContext null

            cache.put(key, bitmap)
            bitmap
        }
    }
}
