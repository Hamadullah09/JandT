package com.warehouse.handheld

import android.annotation.SuppressLint
import android.os.Bundle
import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.warehouse.handheld.rfid.TriggerBus
import com.warehouse.handheld.ui.HandheldTheme
import com.warehouse.handheld.ui.Screen
import com.warehouse.handheld.ui.AppRoot

/**
 * One activity. Every screen is a composable inside it.
 *
 * It exists as a single activity mostly because of the two things below: the
 * hardware trigger and the wedge scanner are key events, and key events arrive
 * at an activity. Spreading the screens across activities would mean each of
 * them re-solving that, and one of them eventually getting it wrong.
 */
class MainActivity : ComponentActivity() {

    private val app: HandheldApp get() = application as HandheldApp

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        setContent {
            val size by app.uiSize.collectAsState()
            HandheldTheme(size) {
                var screen by remember {
                    mutableStateOf<Screen>(if (app.session.signedIn) Screen.Home else Screen.Login)
                }

                DisposableEffect(Unit) {
                    app.api.onSessionExpired = { screen = Screen.Login }
                    onDispose { app.api.onSessionExpired = null }
                }

                AppRoot(
                    app = app,
                    screen = screen,
                    onNavigate = { screen = it },
                )
            }
        }
    }

    /**
     * The reader is opened when the screen is in front of the operator and
     * handed back when it is not.
     *
     * Not tidiness: the UHF module is exclusive, and an app that holds it while
     * sitting in the background is an app that stops every other app on the
     * device from reading a tag, with no clue on screen as to why.
     */
    override fun onResume() {
        super.onResume()
        app.reader.open(app.session.readerPower)
    }

    override fun onPause() {
        app.radar.stop()
        app.reader.close()
        TriggerBus.reset()
        super.onPause()
    }

    override fun onDestroy() {
        app.reader.release()
        super.onDestroy()
    }

    /**
     * Every key, before anything on screen sees it.
     *
     * Two jobs. The trigger starts and stops an inventory - it is not a
     * character and no text field should ever receive it. And the barcode
     * scanner types its code as ordinary key presses, which have to be
     * assembled whether or not a text field happens to be focused, because the
     * scanning screens deliberately do not focus one.
     *
     * Lint objects: androidx marks `ComponentActivity.dispatchKeyEvent`
     * `@RestrictTo`, so overriding it and calling through to it both report as
     * RestrictedApi. It is the documented way to see a key before the view
     * hierarchy does, there is no public alternative that runs early enough,
     * and `onKeyDown` is too late - a focused text field will have eaten the
     * event by then, which is exactly the case this has to handle.
     */
    @SuppressLint("RestrictedApi")
    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (TriggerBus.isTrigger(event.keyCode)) {
            when (event.action) {
                // One press flips it. Holding the trigger down is what an
                // operator does by accident, not what starts a second scan.
                KeyEvent.ACTION_DOWN -> if (TriggerBus.down(event)) app.reader.toggle()
                KeyEvent.ACTION_UP -> TriggerBus.up()
            }
            return true
        }

        if (event.action == KeyEvent.ACTION_DOWN) {
            val isEnter = event.keyCode == KeyEvent.KEYCODE_ENTER ||
                event.keyCode == KeyEvent.KEYCODE_NUMPAD_ENTER ||
                event.keyCode == KeyEvent.KEYCODE_DPAD_CENTER

            val char = event.unicodeChar.takeIf { it != 0 }?.toChar()

            // Only swallowed when a screen is actually listening for scans;
            // otherwise the keypad still works for typing into Settings.
            if (app.reader.keypad.onKey(char, isEnter)) return true
        }

        return super.dispatchKeyEvent(event)
    }
}
