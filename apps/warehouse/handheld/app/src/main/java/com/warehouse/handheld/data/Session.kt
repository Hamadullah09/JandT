package com.warehouse.handheld.data

import android.content.Context
import android.content.SharedPreferences
import com.warehouse.handheld.BuildConfig

/**
 * Who is signed in, and where the server is.
 *
 * Both survive a restart. A handheld that forgets its server address every time
 * the battery is changed is a handheld somebody has to set up again in the
 * middle of a shift.
 */
class Session(context: Context) {

    private val prefs: SharedPreferences =
        context.getSharedPreferences("warehouse", Context.MODE_PRIVATE)

    var serverUrl: String
        get() = prefs.getString(KEY_SERVER, null) ?: BuildConfig.DEFAULT_SERVER
        set(value) = prefs.edit().putString(KEY_SERVER, normalise(value)).apply()

    var token: String?
        get() = prefs.getString(KEY_TOKEN, null)
        set(value) = prefs.edit().putString(KEY_TOKEN, value).apply()

    var userName: String
        get() = prefs.getString(KEY_NAME, "").orEmpty()
        set(value) = prefs.edit().putString(KEY_NAME, value).apply()

    var role: String
        get() = prefs.getString(KEY_ROLE, "operator").orEmpty()
        set(value) = prefs.edit().putString(KEY_ROLE, value).apply()

    /** The room the operator last said they were standing in. */
    var roomId: Int
        get() = prefs.getInt(KEY_ROOM, 0)
        set(value) = prefs.edit().putInt(KEY_ROOM, value).apply()

    var roomCode: String
        get() = prefs.getString(KEY_ROOM_CODE, "").orEmpty()
        set(value) = prefs.edit().putString(KEY_ROOM_CODE, value).apply()

    var readerPower: Int
        get() = prefs.getInt(KEY_POWER, 20)
        set(value) = prefs.edit().putInt(KEY_POWER, value.coerceIn(5, 30)).apply()

    /** Small, Medium or Large - how big the screens are drawn. Small unless changed. */
    var uiSize: String
        get() = prefs.getString(KEY_UI_SIZE, null) ?: "Small"
        set(value) = prefs.edit().putString(KEY_UI_SIZE, value).apply()

    val signedIn: Boolean get() = !token.isNullOrBlank()

    fun signOut() {
        prefs.edit().remove(KEY_TOKEN).remove(KEY_NAME).remove(KEY_ROLE).apply()
    }

    /**
     * "192.168.1.5" and "192.168.1.5:5080" are what somebody types. Both are
     * meant as http, and neither parses as a URL, so the scheme is added rather
     * than the address rejected.
     */
    private fun normalise(raw: String): String {
        val trimmed = raw.trim().trimEnd('/')
        if (trimmed.isEmpty()) return BuildConfig.DEFAULT_SERVER
        return if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) trimmed
        else "http://$trimmed"
    }

    private companion object {
        const val KEY_SERVER = "server"
        const val KEY_TOKEN = "token"
        const val KEY_NAME = "name"
        const val KEY_ROLE = "role"
        const val KEY_ROOM = "room_id"
        const val KEY_ROOM_CODE = "room_code"
        const val KEY_POWER = "power"
        const val KEY_UI_SIZE = "ui_size"
    }
}
