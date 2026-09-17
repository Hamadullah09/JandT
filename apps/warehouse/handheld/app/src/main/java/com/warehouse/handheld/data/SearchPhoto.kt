package com.warehouse.handheld.data

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import java.io.ByteArrayOutputStream

/**
 * A picture to search by, ready to send: turned the right way up, no bigger
 * than it needs to be, as a JPEG.
 *
 * The C72's camera saves 13-megapixel photos of several megabytes. Sent as
 * they are, over warehouse Wi-Fi, the operator waits for nothing - the server
 * reads a picture at a few hundred pixels anyway. So it is shrunk here, and
 * turned upright here too: the camera stores a portrait photo sideways with a
 * note saying so, and a dress lying on its side is a different picture.
 */
class SearchPhoto(val jpeg: ByteArray, val preview: Bitmap) {

    companion object {
        /** The longest side sent. Plenty for recognition, small enough to send in a moment. */
        private const val SIDE = 1280

        /** The longest side of the thumbnail shown back to the operator. */
        private const val PREVIEW = 320

        /** Null when there is no picture at [uri] that can be read. */
        fun from(context: Context, uri: Uri): SearchPhoto? {
            val resolver = context.contentResolver

            // Measuring only: a bounds-only decode always returns null, by design,
            // so the size is read from the options - not from what it returns.
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            val measuring = resolver.openInputStream(uri) ?: return null
            measuring.use { BitmapFactory.decodeStream(it, null, bounds) }
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

            // Decoded at the largest halving that is still at least as big as
            // what is sent, so a 13-megapixel photo never lands in memory whole.
            var sample = 1
            val longest = maxOf(bounds.outWidth, bounds.outHeight)
            while (longest / (sample * 2) >= SIDE) sample *= 2

            val decoded = resolver.openInputStream(uri)?.use {
                BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
            } ?: return null

            val orientation = try {
                resolver.openInputStream(uri)?.use {
                    ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
                } ?: ExifInterface.ORIENTATION_NORMAL
            } catch (e: Exception) {
                ExifInterface.ORIENTATION_NORMAL   // a PNG or a screenshot has no such note
            }

            val upright = orient(decoded, orientation)
            val scale = minOf(1f, SIDE.toFloat() / maxOf(upright.width, upright.height))
            val sized = if (scale < 1f) {
                Bitmap.createScaledBitmap(
                    upright,
                    maxOf(1, (upright.width * scale).toInt()),
                    maxOf(1, (upright.height * scale).toInt()),
                    true,
                ).also { if (it !== upright) upright.recycle() }
            } else {
                upright
            }

            val out = ByteArrayOutputStream()
            sized.compress(Bitmap.CompressFormat.JPEG, 85, out)

            // Only a thumbnail is kept, to show what was searched with: the
            // full picture is in the JPEG now and is not needed as pixels.
            val thumbScale = minOf(1f, PREVIEW.toFloat() / maxOf(sized.width, sized.height))
            val preview = if (thumbScale < 1f) {
                Bitmap.createScaledBitmap(
                    sized,
                    maxOf(1, (sized.width * thumbScale).toInt()),
                    maxOf(1, (sized.height * thumbScale).toInt()),
                    true,
                ).also { if (it !== sized) sized.recycle() }
            } else {
                sized
            }
            return SearchPhoto(out.toByteArray(), preview)
        }

        private fun orient(bitmap: Bitmap, orientation: Int): Bitmap {
            val m = Matrix()
            when (orientation) {
                ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> m.setScale(-1f, 1f)
                ExifInterface.ORIENTATION_ROTATE_180 -> m.setRotate(180f)
                ExifInterface.ORIENTATION_FLIP_VERTICAL -> m.setScale(1f, -1f)
                ExifInterface.ORIENTATION_TRANSPOSE -> { m.setRotate(90f); m.postScale(-1f, 1f) }
                ExifInterface.ORIENTATION_ROTATE_90 -> m.setRotate(90f)
                ExifInterface.ORIENTATION_TRANSVERSE -> { m.setRotate(-90f); m.postScale(-1f, 1f) }
                ExifInterface.ORIENTATION_ROTATE_270 -> m.setRotate(-90f)
                else -> return bitmap
            }
            return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, m, true)
                .also { if (it !== bitmap) bitmap.recycle() }
        }
    }
}
