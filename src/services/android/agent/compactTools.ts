/**
 * Short tool definitions for the Lite engine (Vector in compact mode).
 *
 * The agent's 23 tool schemas are ~14k characters (~3.5k tokens) and are sent
 * with every model call; most of it is long explanations and per-parameter
 * prose. Lite sends the same tools with the same names, parameters, types,
 * enums and required fields, and a one-line description that keeps the rule
 * that matters for each tool. Behaviour stays Vector's; only the input shrinks.
 */

export interface ToolSpec {
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
}

/** One line per tool: what it does and the rule that keeps it from being misused. */
export const SHORT_DESCRIPTIONS: Record<string, string> = {
  read_ui_tree: 'Read the current screen: every element with its idx and tap_at.',
  capture_screen: 'Screenshot for the model. Expensive: only when the element list cannot describe the screen.',
  tap_element: 'Tap an element by idx from the latest screen list. Preferred way to tap.',
  tap_coordinate: 'Tap x,y on the 0–1000 grid (tap_at). Only for points the list does not name.',
  click_node: 'Click by exact visible text or viewId. Fallback when a tap changed nothing.',
  type_text:
    'Type into the focused field (tap it first). Does not submit: then press_key ENTER, or tap Search/Go/Send if ENTER is refused. For web/YouTube searches open_url with the results URL is quicker.',
  swipe: 'Last resort scroll (use scroll_element first). Direction is the finger: UP shows content below. Not more than twice the same way without change.',
  open_app: 'Launch an app by package name; the result says if it reached the foreground. To search inside an app, open_url its search URL instead.',
  open_url: 'Open a web URL (may open a new tab; some domains open their own app — BACK returns).',
  global_action: 'System navigation. To reboot: POWER_DIALOG then tap Restart; never power off.',
  press_key: 'Key on the focused field. ENTER submits (needs Android 11+; if refused tap the on-screen Search/Go).',
  scroll_element: 'Scroll a list or container (preferred over swipe). Refused = already at that end.',
  long_press: 'Press and hold (context menus, text selection). Selector, or x,y on the 0–1000 grid.',
  list_apps: 'List launchable apps with package names. Use before open_app when unsure of the package.',
  install_app:
    'Install from Google Play and check it installed (waits up to 3 min). Always use this for "install X". Still downloading: call again. Never buy anything.',
  set_clipboard: 'Put text on the clipboard (then paste). For long text or fields that refuse typing.',
  paste: 'Paste the clipboard into the focused field.',
  use_vector_keyboard: 'Switch to the Vector Keyboard (true) or back (false). Only when the task asks for it.',
  read_clipboard: 'Read the clipboard text.',
  open_settings: 'Open a Settings screen directly. Always prefer this over navigating the Settings app.',
  read_notifications: 'Read notifications received since the Vector app started (codes, alerts).',
  wait_for_element: 'Wait until an element with this text appears (e.g. "Open" after an install starts).',
  wait: 'Wait until the screen stops changing (loading), up to durationMillis.',
};

/** Parameter hints that are needed to call a tool correctly; every other parameter description is dropped. */
const PARAM_HINTS: Record<string, Record<string, string>> = {
  tap_element: { idx: 'idx from the latest screen list, e.g. "12" or "v3"' },
  scroll_element: { direction: 'FORWARD = down/right, BACKWARD = up/left' },
  swipe: { direction: 'finger direction: UP shows content below' },
  wait_for_element: { timeoutMillis: '250–15000' },
  wait: { durationMillis: 'max 15000' },
  install_app: { packageName: 'e.g. "com.whatsapp"' },
};

function compactParameters(toolName: string, parameters: Record<string, unknown>): Record<string, unknown> {
  const props = (parameters?.properties ?? {}) as Record<string, Record<string, unknown>>;
  const hints = PARAM_HINTS[toolName] ?? {};
  const out: Record<string, Record<string, unknown>> = {};
  for (const [key, schema] of Object.entries(props)) {
    const { description: _drop, ...rest } = schema ?? {};
    out[key] = hints[key] ? { ...rest, description: hints[key] } : rest;
  }
  return { ...parameters, properties: out };
}

/** Same tool, short text. Tools without a short description keep their first sentence. */
export function compactTool(tool: ToolSpec): ToolSpec {
  const description =
    SHORT_DESCRIPTIONS[tool.name] ??
    String(tool.description ?? '')
      .split(/(?<=\.)\s/)[0]
      .slice(0, 160);
  return { name: tool.name, description, parameters: compactParameters(tool.name, tool.parameters ?? { type: 'object', properties: {} }) };
}
