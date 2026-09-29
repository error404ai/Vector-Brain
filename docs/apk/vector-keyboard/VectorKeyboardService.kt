package com.vector.companion.keyboard // ← change to the companion's package

import android.graphics.Color
import android.graphics.Typeface
import android.inputmethodservice.InputMethodService
import android.os.Build
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.inputmethod.EditorInfo
import android.widget.LinearLayout
import android.widget.TextView

/**
 * The Vector Keyboard: an input method the automation types through.
 *
 * Accessibility ACTION_SET_TEXT is refused by custom editors (Instagram's code
 * boxes, PIN pads, games), and an accessibility service cannot inject key
 * events. An input method can: its InputConnection is the same channel a human
 * keyboard uses, so a field that accepts typing accepts this.
 *
 * The on-screen view is a compact bar (digits, backspace, enter, switch back),
 * so a person at the phone can still type a code or hand back to their usual
 * keyboard.
 */
class VectorKeyboardService : InputMethodService() {

    companion object {
        /** The running keyboard, when it is the active input method. Main thread only. */
        @Volatile
        var instance: VectorKeyboardService? = null
            private set
    }

    /** True while an editable field is bound (between onStartInput and onFinishInput). */
    private var fieldFocused = false

    sealed class TypeResult {
        object Ok : TypeResult()
        object NoField : TypeResult()
        data class Failed(val reason: String) : TypeResult()
    }

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        super.onDestroy()
    }

    override fun onStartInput(attribute: EditorInfo?, restarting: Boolean) {
        super.onStartInput(attribute, restarting)
        fieldFocused = attribute != null && attribute.inputType != InputType.TYPE_NULL
    }

    override fun onFinishInput() {
        fieldFocused = false
        super.onFinishInput()
    }

    /**
     * Types [text] into the focused field. Call on the main thread.
     *
     * Short text goes one character at a time through sendKeyChar — digits and
     * Enter become real key events, which one-time code boxes listen for (they
     * often ignore a single commitText of the whole code). Long text is
     * committed in one go.
     */
    fun type(text: String, replace: Boolean): TypeResult {
        val ic = currentInputConnection ?: return TypeResult.NoField
        if (!fieldFocused) return TypeResult.NoField
        return try {
            ic.beginBatchEdit()
            if (replace) {
                val before = ic.getTextBeforeCursor(10_000, 0)?.length ?: 0
                val after = ic.getTextAfterCursor(10_000, 0)?.length ?: 0
                if (before + after > 0) ic.deleteSurroundingText(before, after)
            }
            ic.endBatchEdit()
            if (text.length <= 64) {
                for (c in text) sendKeyChar(c)
            } else {
                ic.commitText(text, 1)
            }
            TypeResult.Ok
        } catch (t: Throwable) {
            TypeResult.Failed(t.message ?: t.javaClass.simpleName)
        }
    }

    /** Presses Enter / the field's IME action (Search, Go, Done, Next). */
    fun pressEnter(): Boolean {
        val ic = currentInputConnection ?: return false
        val action = (currentInputEditorInfo?.imeOptions ?: 0) and EditorInfo.IME_MASK_ACTION
        return if (action != EditorInfo.IME_ACTION_NONE && action != EditorInfo.IME_ACTION_UNSPECIFIED) {
            ic.performEditorAction(action)
        } else {
            sendDownUpKeyEvents(KeyEvent.KEYCODE_ENTER)
            true
        }
    }

    // ---- on-screen view ---------------------------------------------------

    override fun onCreateInputView(): View {
        val dp = { v: Float -> TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, resources.displayMetrics).toInt() }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.parseColor("#0E1630"))
            setPadding(dp(6f), dp(6f), dp(6f), dp(8f))
        }
        fun key(label: String, weight: Float = 1f, onTap: () -> Unit) = TextView(this).apply {
            text = label
            gravity = Gravity.CENTER
            setTextColor(Color.WHITE)
            typeface = Typeface.DEFAULT_BOLD
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            setBackgroundColor(Color.parseColor("#1D2A52"))
            layoutParams = LinearLayout.LayoutParams(0, dp(46f), weight).apply { setMargins(dp(3f), dp(3f), dp(3f), dp(3f)) }
            setOnClickListener { onTap() }
        }
        fun row(vararg views: View) = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            views.forEach { addView(it) }
        }
        val digit = { d: String -> key(d) { currentInputConnection?.let { sendKeyChar(d[0]) } } }
        root.addView(row(*"12345".map { digit(it.toString()) }.toTypedArray()))
        root.addView(row(*"67890".map { digit(it.toString()) }.toTypedArray()))
        root.addView(
            row(
                key("⌨ Keyboards", 2f) { switchBack() },
                key("⌫") { sendDownUpKeyEvents(KeyEvent.KEYCODE_DEL) },
                key("⏎", 1.4f) { pressEnter() },
            ),
        )
        return root
    }

    /** Hands the phone back to the previous keyboard, or shows the picker. */
    private fun switchBack() {
        val switched = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) switchToPreviousInputMethod() else false
        if (!switched) {
            (getSystemService(INPUT_METHOD_SERVICE) as android.view.inputmethod.InputMethodManager).showInputMethodPicker()
        }
    }
}
