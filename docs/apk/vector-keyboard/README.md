# Vector Keyboard — companion (APK) side

The server side is live in this repo: `type_text` falls back to the Vector
Keyboard when a field refuses accessibility text, and the agent has a
`use_vector_keyboard` tool, so a task can say "Vector Keyboard lagao". Both only
act on phones whose companion reports `capabilities.vectorKeyboard`. Older
companions are left alone, so nothing breaks before the APK update ships.

Why this is needed: Instagram's sign-up code field rejects `ACTION_SET_TEXT`
("The app rejected text input"), paste was blocked, and the on-screen keyboard
is not in the accessibility list, so taps on its keys were refused as guesses.
An input method types through the same channel as a human keyboard.

## 1. Add the keyboard

| File here | Goes to |
|---|---|
| `VectorKeyboardService.kt` | `app/src/main/java/<pkg>/keyboard/` |
| `VectorKeyboard.kt` | `app/src/main/java/<pkg>/keyboard/` |
| `res/xml/vector_keyboard_method.xml` | `app/src/main/res/xml/` |
| `AndroidManifest.snippet.xml` | merge into `AndroidManifest.xml` (+ the string) |

Fix the `package` line in both `.kt` files.

## 2. Two new actions (`server:execute_action` → `payload.action`)

```jsonc
{ "type": "KeyboardType", "text": "482913", "replace": true }
{ "type": "SetKeyboard", "keyboard": "VECTOR" }   // or "DEFAULT"
```

In the action dispatcher (where `SetText`, `Paste`, … are handled):

```kotlin
is AutomationAction.KeyboardType -> VectorKeyboard.type(action.text, action.replace ?: false).toActionResult()
is AutomationAction.SetKeyboard  -> VectorKeyboard.setKeyboard(accessibilityService, action.keyboard).toActionResult()

fun VectorKeyboard.Outcome.toActionResult() = when (this) {
    is VectorKeyboard.Outcome.Ok   -> ActionResult.Success(summary = summary)
    is VectorKeyboard.Outcome.Fail -> ActionResult.Failure(code = code, message = message, recoverable = true)
}
```

The JSON parser must also answer an unknown `type` with a FAILURE
(`INVALID_WORKFLOW`) instead of never replying; the server waits 17 s for a
reply otherwise.

## 3. Report the state

Add to `capabilities` in `device:register` **and** in every
`device:heartbeat` (the server tracks it from the heartbeat):

```kotlin
"vectorKeyboard" to VectorKeyboard.state(context)   // "active" | "enabled" | "off"
```

## 4. Setup screen

Add a step after Accessibility:

- **Enable Vector Keyboard** → `VectorKeyboard.openEnableScreen(context)`
  (opens Settings → On-screen keyboards; the user ticks *Vector Keyboard* and
  accepts Android's standard "this keyboard can collect text" warning). Show ✓
  when `state != "off"`.
- **Use Vector Keyboard** (optional) → `VectorKeyboard.showPicker(context)`.
  Not required: the server switches to it by itself when a field needs it.

Fully hands-free option for a fleet: grant once per phone over adb

```
adb shell pm grant <package> android.permission.WRITE_SECURE_SETTINGS
```

and the app enables and switches the keyboard itself on every Android version.
Without it, switching an enabled keyboard is still automatic on Android 13+;
Android 12 and older need the picker once.

## 5. Remove the password rules

Delete every guard that refuses to put text into a password field. Search the
companion for:

- `"Pasting into password fields is blocked"` — remove the `isPassword` check
  in the `Paste` handler.
- `isPassword` / `inputType and TYPE_TEXT_VARIATION_PASSWORD` checks in the
  `SetText`, `SetClipboard` and `Paste` handlers.
- Any `SafetyLevel` / `CONFIRMATION_REQUIRED` raised because the target node
  is a password field.

Keep masking the password's **value** in logs and in the UI tree sent to the
server (show `••••`), so passwords never end up in run exports.

## 6. Version

Bump `appVersion` (e.g. `0.29.0`) so the fleet list shows which phones have it.
