package com.warehouse.handheld.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.Inet4Address
import java.net.NetworkInterface
import java.net.URL
import java.util.Collections
import java.util.concurrent.atomic.AtomicReference

/**
 * Finds the warehouse PC on the local network, so nobody has to type its number.
 *
 * The address is not fixed and never was. A different Wi-Fi, or the router
 * handing out new numbers after a power cut, moves the PC - and then every
 * handheld is looking for yesterday's address while nothing on the PC looks
 * wrong. It is the commonest fault in this system, it always looks like
 * something worse, and the fix has been "read an IP address off one screen and
 * retype it into another", which is a poor thing to ask of somebody holding a
 * garment.
 *
 * The handheld is already on the same network. So it can just look: ask every
 * address on that network whether it is the warehouse server, and take the one
 * that says yes.
 */
object ServerFinder {

    /**
     * Sweeps this device's own network.
     *
     * Returns an address ready to save, or null when nothing answered - which
     * means the PC is off, the system is not started, or the two are on
     * different Wi-Fi networks.
     */
    suspend fun find(port: Int = PORT): String? = withContext(Dispatchers.IO) {
        val prefix = localPrefix() ?: return@withContext null
        val hit = AtomicReference<String?>(null)

        // In batches rather than all at once. Two hundred and fifty sockets
        // opened together is more than the radio settles for, and the ones that
        // time out on a busy network are exactly the ones that would have
        // answered.
        for (batch in (1..254).chunked(AT_ONCE)) {
            if (hit.get() != null) break
            coroutineScope {
                for (n in batch) {
                    launch {
                        if (hit.get() != null) return@launch
                        val host = "$prefix$n"
                        if (answers(host, port)) hit.compareAndSet(null, host)
                    }
                }
            }
        }

        hit.get()?.let { "http://$it:$port" }
    }

    /**
     * Is the warehouse server at this address?
     *
     * Asks for the health endpoint rather than just opening the port, because
     * plenty of things on a warehouse network answer on a port - a printer, a
     * router's admin page - and none of them are this.
     */
    private fun answers(host: String, port: Int): Boolean = try {
        val connection = URL("http://$host:$port/api/health").openConnection() as HttpURLConnection
        connection.connectTimeout = WAIT_MS
        connection.readTimeout = WAIT_MS
        connection.requestMethod = "GET"
        val ok = connection.responseCode == 200
        connection.disconnect()
        ok
    } catch (e: Exception) {
        false
    }

    /**
     * This device's own network, as "192.168.1." ready for a last number.
     *
     * Assumes the ordinary /24 every small office router hands out. A warehouse
     * on a wider network would need the netmask read properly, and would also
     * have somebody in it who knows what to type.
     */
    private fun localPrefix(): String? {
        val interfaces = runCatching {
            Collections.list(NetworkInterface.getNetworkInterfaces())
        }.getOrNull() ?: return null

        for (nic in interfaces) {
            val up = runCatching { nic.isUp && !nic.isLoopback }.getOrDefault(false)
            if (!up) continue
            for (address in Collections.list(nic.inetAddresses)) {
                if (address !is Inet4Address || address.isLoopbackAddress) continue
                val ip = address.hostAddress ?: continue
                val lastDot = ip.lastIndexOf('.')
                if (lastDot > 0) return ip.substring(0, lastDot + 1)
            }
        }
        return null
    }

    private const val PORT = 5080
    private const val AT_ONCE = 48
    private const val WAIT_MS = 400
}
