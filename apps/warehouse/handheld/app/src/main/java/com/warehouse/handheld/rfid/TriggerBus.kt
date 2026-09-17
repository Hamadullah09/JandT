package com.warehouse.handheld.rfid

import android.view.KeyEvent

/**
 * The gun trigger, and the two side buttons that do the same thing.
 *
 * There is no standard key code for it. Chainway alone reports it as 139, 280,
 * 293 or 520 depending on the revision, and a device that reports one the app
 * has never heard of has a dead trigger with nothing on screen to say why. So
 * the list is generous, and `learned` lets Settings add whatever this particular
 * device turns out to send.
 *
 * Long presses repeat. `down` fires once per physical press because an
 * inventory that restarts thirty times a second reads nothing at all.
 */
object TriggerBus {

    private val KNOWN = setOf(
        139, 280, 281, 282, 283, 284, 285, 286, 287, 288,
        289, 290, 291, 292, 293, 294, 311, 312, 313,
        520, 521, 522, 523, 524, 525,
        KeyEvent.KEYCODE_F1, KeyEvent.KEYCODE_F2, KeyEvent.KEYCODE_F3,
        KeyEvent.KEYCODE_F4, KeyEvent.KEYCODE_F7, KeyEvent.KEYCODE_F8,
    )

    /**
     * Added from Settings when a device turns out to use something else.
     *
     * The C72 in this warehouse was measured at **139** - confirmed by sending
     * each candidate and watching which one made the radio start an inventory.
     * It was already in the list above, but the next device may not be.
     */
    var learned: Set<Int> = emptySet()

    private var held = false

    fun isTrigger(keyCode: Int): Boolean = keyCode in KNOWN || keyCode in learned

    /**
     * Returns true when this press should flip the reader, false for the key
     * repeats that follow it while the key stays down.
     *
     * The trigger is a **toggle**: press once and the reader starts sweeping,
     * press again and it stops. It is not press-and-hold, which is how this was
     * built first and wrong for the job - booking in a box of fifty means
     * holding a sprung trigger down for a minute at a time, one-handed, while
     * the other hand feeds garments past the antenna.
     *
     * Key-up does nothing at all now, which is why there is no `up()` any more.
     */
    fun down(event: KeyEvent): Boolean {
        if (event.repeatCount > 0 || held) return false
        held = true
        return true
    }

    /** The key came up. Nothing happens; the reader stays as it was. */
    fun up() {
        held = false
    }

    fun reset() {
        held = false
    }
}
