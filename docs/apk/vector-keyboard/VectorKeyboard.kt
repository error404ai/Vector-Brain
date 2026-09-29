package com.vector.companion.keyboard // ← change to the companion's package

import android.accessibilityservice.AccessibilityService
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.provider.Settings
import android.view.inputmethod.InputMethodManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/**
 * Everything the companion does with the Vector Keyboard, in one place:
 *
 *  - [state] for capabilities.vectorKeyboard ("active" | "enabled" | "off"),
 *    sent on device:register and in every device:heartbeat's capabilities.
 *  - [setKeyboard] for the SetKeyboard action.
 *  - [type] for the KeyboardType action.
 *  - [openEnableScreen] for the setup screen's "Enable Vector Keyboard" button.
 *
 * Enabling (ticking it in Settings → On-screen keyboards) is a user step
 * unless the app holds WRITE_SECURE_SETTINGS — grant it once per phone with
 *   adb shell pm grant <package> android.permission.WRITE_SECURE_SETTINGS
 * and the app enables and switches it itself, on any Android version.
 * Switching an already-enabled keyboard needs no user on Android 13+
 * (AccessibilityService.softKeyboardController.switchToInputMethod).
 */
object VectorKeyboard {

    private const val PREFS = "vector_keyboard"
    private const val KEY_PREVIOUS = "previous_ime"

    fun imeId(context: Context): String =
        ComponentName(context, VectorKeyboardService::class.java).flattenToShortString()

    private fun currentIme(context: Context): String? =
        Settings.Secure.getString(context.contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD)

    private fun sameIme(context: Context, a: String?, b: String): Boolean =
        a != null && ComponentName.unflattenFromString(a) == ComponentName.unflattenFromString(b)

    fun isEnabled(context: Context): Boolean {
        val imm = context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        val id = imeId(context)
        return imm.enabledInputMethodList.any { sameIme(context, it.id, id) }
    }

    fun state(context: Context): String = when {
        sameIme(context, currentIme(context), imeId(context)) -> "active"
        isEnabled(context) -> "enabled"
        else -> "off"
    }

    private fun canWriteSecure(context: Context) =
        context.checkSelfPermission("android.permission.WRITE_SECURE_SETTINGS") == PackageManager.PERMISSION_GRANTED

    /** Setup button: the system's keyboard list, where the user ticks Vector Keyboard. */
    fun openEnableScreen(context: Context) {
        if (canWriteSecure(context) && enableSilently(context)) return
        context.startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    /** Setup button, second step, from a foreground Activity: the system keyboard picker. */
    fun showPicker(context: Context) {
        (context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).showInputMethodPicker()
    }

    private fun enableSilently(context: Context): Boolean = runCatching {
        val cr = context.contentResolver
        val id = imeId(context)
        val enabled = Settings.Secure.getString(cr, Settings.Secure.ENABLED_INPUT_METHODS).orEmpty()
        if (enabled.split(':').none { sameIme(context, it.substringBefore(';'), id) }) {
            Settings.Secure.putString(cr, Settings.Secure.ENABLED_INPUT_METHODS, if (enabled.isEmpty()) id else "$enabled:$id")
        }
        true
    }.getOrDefault(false)

    sealed class Outcome {
        data class Ok(val summary: String) : Outcome()
        /** Maps to FailureCode; message is shown to the agent as-is. */
        data class Fail(val code: String, val message: String) : Outcome()
    }

    /** SetKeyboard action. keyboard: "VECTOR" or "DEFAULT". */
    suspend fun setKeyboard(service: AccessibilityService, keyboard: String): Outcome {
        val ctx = service.applicationContext
        val vectorId = imeId(ctx)
        val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val target = if (keyboard == "VECTOR") {
            if (!isEnabled(ctx) && !(canWriteSecure(ctx) && enableSilently(ctx))) {
                return Outcome.Fail("ACTION_REJECTED", "The Vector Keyboard is not enabled on this phone. Enable it once from the Vector app setup (Enable Vector Keyboard).")
            }
            currentIme(ctx)?.takeUnless { sameIme(ctx, it, vectorId) }?.let { prefs.edit().putString(KEY_PREVIOUS, it).apply() }
            vectorId
        } else {
            prefs.getString(KEY_PREVIOUS, null)
                ?: return Outcome.Fail("ACTION_REJECTED", "No previous keyboard is recorded to go back to.")
        }
        if (sameIme(ctx, currentIme(ctx), target)) return Outcome.Ok("The ${label(keyboard)} is already active")

        val switched = when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU ->
                withContext(Dispatchers.Main) { service.softKeyboardController.switchToInputMethod(target) }
            canWriteSecure(ctx) ->
                runCatching { Settings.Secure.putString(ctx.contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD, target) }.isSuccess
            else -> false
        }
        if (!switched) {
            return Outcome.Fail(
                "ACTION_REJECTED",
                "Android ${Build.VERSION.RELEASE} does not let the app switch keyboards by itself. Grant WRITE_SECURE_SETTINGS once over adb, or pick the keyboard from the Vector app setup.",
            )
        }
        // The system rebinds the input method asynchronously.
        repeat(20) {
            if (sameIme(ctx, currentIme(ctx), target)) return Outcome.Ok("The ${label(keyboard)} is now active")
            delay(100)
        }
        return Outcome.Fail("TIMEOUT", "Asked Android to switch to the ${label(keyboard)}, but it is not active yet.")
    }

    private fun label(keyboard: String) = if (keyboard == "VECTOR") "Vector Keyboard" else "usual keyboard"

    /** KeyboardType action. */
    suspend fun type(text: String, replace: Boolean): Outcome = withContext(Dispatchers.Main) {
        val ime = VectorKeyboardService.instance
            ?: return@withContext Outcome.Fail("ACTION_REJECTED", "The Vector Keyboard is not the active keyboard. Switch to it first (SetKeyboard VECTOR).")
        when (val r = ime.type(text, replace)) {
            VectorKeyboardService.TypeResult.Ok -> Outcome.Ok("Typed ${text.length} characters with the Vector Keyboard")
            VectorKeyboardService.TypeResult.NoField -> Outcome.Fail("NODE_NOT_FOUND", "No text field has keyboard focus. Tap the field first.")
            is VectorKeyboardService.TypeResult.Failed -> Outcome.Fail("ACTION_REJECTED", "Vector Keyboard could not type: ${r.reason}")
        }
    }
}
