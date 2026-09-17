package com.warehouse.handheld

import android.app.Application
import com.warehouse.handheld.data.Api
import com.warehouse.handheld.data.OfflineQueue
import com.warehouse.handheld.data.Session
import com.warehouse.handheld.rfid.Radar
import com.warehouse.handheld.rfid.Reader
import com.warehouse.handheld.ui.UiSize
import kotlinx.coroutines.flow.MutableStateFlow

/**
 * The five things that outlive any screen.
 *
 * Held on the Application rather than injected: this is one activity with ten
 * screens and a reader that must be opened once, and a dependency framework
 * here would be scaffolding around five fields.
 */
class HandheldApp : Application() {

    lateinit var session: Session
        private set

    lateinit var api: Api
        private set

    lateinit var queue: OfflineQueue
        private set

    lateinit var reader: Reader
        private set

    /** Bearings and signal strength for the find screen. */
    lateinit var radar: Radar
        private set

    /** How big the screens are drawn. A flow, so changing it in Settings redraws at once. */
    val uiSize = MutableStateFlow(UiSize.Small)

    override fun onCreate() {
        super.onCreate()
        session = Session(this)
        uiSize.value = UiSize.named(session.uiSize)
        api = Api(session)
        queue = OfflineQueue(this)
        reader = Reader(this)
        radar = Radar(this)
    }
}
