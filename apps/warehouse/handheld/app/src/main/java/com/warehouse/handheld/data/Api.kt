package com.warehouse.handheld.data

import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.UnknownHostException
import java.nio.charset.StandardCharsets

/**
 * A failure the operator can be shown.
 *
 * The server answers every error as {"error":{"code","message"}} and the
 * message is already a sentence fit for a screen, so it is carried through
 * untouched rather than being re-worded here. Two implementations of the same
 * wording eventually disagree, and the one on the device is the one nobody can
 * correct without a reinstall.
 */
class ApiError(
    val code: String,
    override val message: String,
    val status: Int = 0,
) : Exception(message) {
    val isAuth: Boolean get() = status == 401 || code == "session_expired"
    val isOffline: Boolean get() = code == "offline"
}

/**
 * Everything the handheld asks the server, over plain HttpURLConnection.
 *
 * No OkHttp and no JSON library: the platform has both, the payloads are small
 * and flat, and an APK that a warehouse has to sideload is better off a
 * megabyte smaller with one less thing to keep up to date.
 */
class Api(private val session: Session) {

    /**
     * Called once when the server says the sign-in is no longer good.
     *
     * Handled here rather than on each screen because there are eight of them
     * and a token expires on whichever one happens to be open. Without this the
     * screen shows "your session has ended" and goes on showing it, with no way
     * back to the sign-in box except killing the app.
     */
    var onSessionExpired: (() -> Unit)? = null

    private fun url(path: String) = URL(session.serverUrl.trimEnd('/') + path)

    suspend fun get(path: String): JSONObject = request("GET", path, null)

    suspend fun post(path: String, body: JSONObject? = null): JSONObject =
        request("POST", path, body?.let { Body("application/json; charset=utf-8", it.toString().toByteArray(StandardCharsets.UTF_8)) })

    suspend fun delete(path: String): JSONObject = request("DELETE", path, null)

    /**
     * A JPEG sent as a file upload in a field called "photo" - what search by
     * photo takes, in the same form a browser sends it.
     */
    suspend fun postPhoto(path: String, jpeg: ByteArray, fileName: String = "photo.jpg"): JSONObject {
        val boundary = "----handheld" + System.nanoTime()
        val head = ("--$boundary\r\n" +
            "Content-Disposition: form-data; name=\"photo\"; filename=\"$fileName\"\r\n" +
            "Content-Type: image/jpeg\r\n\r\n").toByteArray(StandardCharsets.UTF_8)
        val tail = "\r\n--$boundary--\r\n".toByteArray(StandardCharsets.UTF_8)
        return request("POST", path, Body("multipart/form-data; boundary=$boundary", head + jpeg + tail))
    }

    private class Body(val contentType: String, val bytes: ByteArray)

    private suspend fun request(method: String, path: String, body: Body?): JSONObject =
        withContext(Dispatchers.IO) {
            val conn = try {
                url(path).openConnection() as HttpURLConnection
            } catch (e: Exception) {
                throw ApiError("offline", "Cannot reach ${session.serverUrl}.")
            }

            try {
                conn.requestMethod = method
                conn.connectTimeout = 8000
                conn.readTimeout = 15000
                conn.setRequestProperty("Accept", "application/json")
                session.token?.let { conn.setRequestProperty("Authorization", "Bearer $it") }

                if (body != null) {
                    conn.doOutput = true
                    conn.setRequestProperty("Content-Type", body.contentType)
                    // Sent with its length up front rather than buffered twice:
                    // a photo is a few hundred kilobytes.
                    conn.setFixedLengthStreamingMode(body.bytes.size)
                    conn.outputStream.use { it.write(body.bytes) }
                }

                val status = conn.responseCode
                val stream = if (status in 200..299) conn.inputStream else conn.errorStream
                val text = stream?.bufferedReader()?.use(BufferedReader::readText).orEmpty()

                if (status in 200..299) return@withContext parse(text)

                // An error body that is not JSON means something in front of
                // the application answered - a proxy, or the wrong address
                // entirely. Saying so beats showing the operator a page of
                // HTML.
                val parsed = runCatching { JSONObject(text).getJSONObject("error") }.getOrNull()
                val error = ApiError(
                    parsed?.optString("code").orEmpty().ifEmpty { "http_$status" },
                    parsed?.optString("message").orEmpty().ifEmpty {
                        "The server answered $status. Check the address in Settings."
                    },
                    status,
                )

                // Not on the login call itself: a wrong password is a 401 too,
                // and treating it as an expired session would clear a token
                // that was never issued and bounce the operator off the very
                // screen they are trying to sign in on.
                if (error.isAuth && !path.startsWith("/api/auth/login")) {
                    session.signOut()
                    onSessionExpired?.invoke()
                }

                throw error
            } catch (e: ApiError) {
                throw e
            } catch (e: UnknownHostException) {
                throw ApiError("offline", "Cannot find ${session.serverUrl}. Check the address and the Wi-Fi.")
            } catch (e: Exception) {
                Log.w("Api", "$method $path failed", e)
                throw ApiError("offline", "Cannot reach the server. ${e.message ?: "No connection."}")
            } finally {
                conn.disconnect()
            }
        }

    /**
     * Some endpoints answer with a bare array. Wrapping it rather than having
     * two return types keeps every caller reading the same shape.
     */
    private fun parse(text: String): JSONObject {
        val trimmed = text.trim()
        if (trimmed.isEmpty()) return JSONObject()
        return if (trimmed.startsWith("[")) JSONObject().put("items", JSONArray(trimmed))
        else JSONObject(trimmed)
    }
}

/** Convenience: a JSON array as a list of objects. */
fun JSONObject.objects(key: String): List<JSONObject> {
    val array = optJSONArray(key) ?: return emptyList()
    return (0 until array.length()).mapNotNull { array.optJSONObject(it) }
}

/**
 * A string field, with a JSON null read as absent.
 *
 * `optString` hands back the four characters "null" when the value is JSON
 * null, because it coerces through String.valueOf. Every nullable column in
 * this API - a customer with no city, a find with no note, a return line with
 * no product - therefore arrives as the word "null" and gets printed. The
 * picking list read "SMOKE Never Shipped - null" until this existed.
 */
fun JSONObject.str(key: String): String = if (isNull(key)) "" else optString(key)

/** The server sends money as a JSON number; missing means zero, not crash. */
fun JSONObject.money(key: String): Double = optDouble(key, 0.0).let { if (it.isNaN()) 0.0 else it }
