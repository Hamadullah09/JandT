package com.warehouse.handheld.rfid

/**
 * The reader every C72 has whether or not the UHF SDK was ever found: the 2D
 * barcode scanner in keyboard-wedge mode.
 *
 * A wedge scanner types the code it read as fast keystrokes and finishes with
 * Enter, so from the app's side it is a keyboard that occasionally types a
 * whole tag in one go. `MainActivity.dispatchKeyEvent` feeds every key press
 * here before any text field sees it, which is what makes scanning work on a
 * screen that has no text field focused - the scan screens deliberately have
 * none, because a soft keyboard on a 4-inch screen covers the thing the
 * operator is reading.
 *
 * The gap between keystrokes is what separates a scan from somebody typing.
 * A wedge sends a character every few milliseconds; a thumb cannot.
 */
class KeypadScanner : UhfBackend {

    override val name = "Barcode scanner"

    private val buffer = StringBuilder()
    private var lastKeyAt = 0L
    private var listener: ((TagRead) -> Unit)? = null

    override fun available() = true

    override var isOpen = false
        private set

    override fun open(): Boolean {
        isOpen = true
        return true
    }

    override fun close() {
        isOpen = false
        buffer.setLength(0)
        listener = null
    }

    override fun startInventory(onTag: (TagRead) -> Unit): Boolean {
        listener = onTag
        return true
    }

    override fun stopInventory() {
        listener = null
    }

    /** There is no "read the nearest tag" without a radio. */
    override fun readOnce(): TagRead? = null

    override var power: Int = 0

    /**
     * Returns true when the key was part of a scan and should not also reach
     * the screen underneath.
     */
    fun onKey(char: Char?, isEnter: Boolean): Boolean {
        if (listener == null) return false

        val now = System.currentTimeMillis()

        // A pause means whatever is in the buffer was a false start - half a
        // scan interrupted by the trigger, usually. Dropping it is better than
        // gluing two scans into one code that matches nothing.
        if (now - lastKeyAt > IDLE_MS) buffer.setLength(0)
        lastKeyAt = now

        if (isEnter) {
            val code = buffer.toString().trim()
            buffer.setLength(0)
            if (code.isEmpty()) return false
            listener?.invoke(TagRead(code.uppercase()))
            return true
        }

        if (char == null || char.isISOControl()) return false
        buffer.append(char)
        return true
    }

    private companion object {
        /**
         * 400ms. A wedge scanner is under 20ms between characters and the
         * slowest observed is about 80ms; nobody types a tag code that fast.
         */
        const val IDLE_MS = 400L
    }
}
