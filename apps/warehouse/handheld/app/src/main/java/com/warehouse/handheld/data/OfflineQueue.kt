package com.warehouse.handheld.data

import android.content.Context
import android.util.Log
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Work the device did in a dead zone, waiting to be sent.
 *
 * Only two kinds of work go in here, and the choice matters more than the
 * mechanism: a **move** and a **found**. Both are statements of fact that the
 * server cannot argue with, so sending them late changes nothing.
 *
 * An intake scan, an order pick and a return scan are deliberately **not**
 * queued. Every one of them is a question, not a statement - is this the 51st
 * tag, does this order want this garment, did this garment really go out on
 * this order - and the answer is the whole point of scanning it. Queuing one
 * would mean either showing the operator an answer this device invented, or
 * showing them nothing and hoping. The first is how two implementations of the
 * return check end up disagreeing; the second is how a picker walks away from a
 * parcel that was never actually filled.
 *
 * So in a dead zone those three screens say so and stop, and these two carry on.
 */
class OfflineQueue(context: Context) {

    private val file = File(context.filesDir, "queue.json")

    /**
     * A coroutine mutex rather than `@Synchronized`, because `flush` suspends
     * on every send and a monitor held across a suspension point is a monitor
     * held by whichever thread happens to resume - which is how a queue ends up
     * flushed twice and a move applied twice.
     */
    private val lock = Mutex()

    @Synchronized
    fun add(path: String, body: JSONObject) {
        val entries = read()
        entries.put(JSONObject().put("path", path).put("body", body).put("at", System.currentTimeMillis()))
        write(entries)
    }

    @Synchronized
    fun size(): Int = read().length()

    /**
     * Sends what it can and keeps what it cannot.
     *
     * A rejection from the server is dropped rather than retried forever: a
     * move to a room that has since been closed will never succeed, and a queue
     * that cannot drain is a queue nobody looks at. Only a transport failure
     * puts the entry back.
     */
    suspend fun flush(api: Api): Int = lock.withLock {
        val entries = read()
        if (entries.length() == 0) return@withLock 0

        val kept = JSONArray()
        var sent = 0

        for (i in 0 until entries.length()) {
            val entry = entries.optJSONObject(i) ?: continue
            try {
                api.post(entry.getString("path"), entry.getJSONObject("body"))
                sent++
            } catch (e: ApiError) {
                if (e.isOffline || e.isAuth) kept.put(entry) else Log.w("Queue", "dropped: ${e.message}")
            }
        }

        write(kept)
        sent
    }

    private fun read(): JSONArray =
        runCatching { JSONArray(file.readText()) }.getOrElse { JSONArray() }

    private fun write(entries: JSONArray) {
        runCatching { file.writeText(entries.toString()) }
            .onFailure { Log.w("Queue", "could not save", it) }
    }
}
