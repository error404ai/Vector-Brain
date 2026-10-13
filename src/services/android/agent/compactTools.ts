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
  // Wording kept from before the Oct 9 trim: the shorter one was followed by a read_ui_tree first in 8 of 8 runs.
  read_ui_tree: 'Read the screen. Only when no screen list was shown yet: every action result already includes it.',
  capture_screen: "Screenshot. Expensive; only if the list can't describe the screen.",
  tap_element: 'Tap by idx from the latest list. Preferred tap.',
  tap_coordinate: 'Tap x,y on 0–1000 grid (tap_at). Only for points not in the list.',
  click_node: 'Click by exact visible text or viewId. Fallback if a tap changed nothing.',
  type_text:
    "Type into focused field (tap it first). REPLACES the whole field (to fix text, type the whole value). Doesn't submit: then press_key ENTER. Web/YouTube search: open_url results URL is faster.",
  swipe: 'Last-resort scroll (scroll_element first). Direction = finger: UP shows content below. Max twice same way without change.',
  open_app: 'Launch by package name; result says if it reached foreground. To search in an app, open_url its search URL.',
  open_url: 'Open a URL (may open new tab; some domains open their app, BACK returns).',
  global_action: 'System navigation. Reboot: POWER_DIALOG then tap Restart. Power off: POWER_DIALOG then Power off, only when the task says so.',
  press_key: 'Key on focused field. ENTER submits (where Enter fails, the Search/Go button or matching suggestion is tapped for you). BACK/HIDE_KEYBOARD closes the keyboard; BACKSPACE deletes one letter.',
  scroll_element: 'Scroll a list/container (preferred over swipe). Refused = at that end.',
  long_press: 'Press and hold (menus, text select). Selector or x,y on 0–1000 grid.',
  list_apps: 'Launchable apps with package names. Use before open_app if unsure.',
  install_app: 'Install from Play and verify (waits up to 3 min). Always use for "install X". Still downloading: call again. Never buy.',
  set_clipboard: 'Put text on clipboard (then paste). For long text or fields that refuse typing.',
  paste: 'Paste clipboard into focused field.',
  use_vector_keyboard: 'Vector Keyboard on (true) or off (false). Only if the task asks.',
  read_clipboard: 'Read clipboard text.',
  open_settings: 'Open a Settings screen directly. Prefer over navigating Settings.',
  open_intent: 'One-step intent instead of tapping: VIEW a link/market://details?id=PKG/geo:0,0?q=PLACE, SENDTO mailto:/smsto: (extras subject, body), SEND text, DIAL tel:, WEB_SEARCH (extras query).',
  open_app_info: "An app's info page: Force stop, Storage/cache, Permissions, Enable a disabled app.",
  scroll_until: 'Scroll the list until text shows, one step (max 30). Says found or list ended.',
  drag: 'Drag from idx or from_x,from_y to to_x,to_y (0–1000 grid): sliders, drag and drop, maps.',
  double_tap: 'Double tap idx or x,y: like a photo/reel, zoom in.',
  pinch: 'Two-finger pinch at x,y: OUT zooms in, IN zooms out.',
  notification_action: 'Press a notification button / reply / open it, by key from read_notifications.',
  dismiss_notification: 'Clear a notification by key.',
  list_downloads: 'Newest files in Download.',
  upload_file: 'Send a Download file (name or latest) or a screenshot to the user.',
  read_notifications: 'Notifications since Vector app started (codes, alerts).',
  wait_for_element: 'Wait until text appears (e.g. "Open" after install starts).',
  wait: 'Wait until screen stops changing, up to durationMillis.',
};

/** Parameter hints that are needed to call a tool correctly; every other parameter description is dropped. */
const PARAM_HINTS: Record<string, Record<string, string>> = {
  tap_element: { idx: 'idx from the latest screen list, e.g. "12" or "v3"' },
  scroll_element: { direction: 'FORWARD = down/right, BACKWARD = up/left' },
  swipe: { direction: 'finger direction: UP shows content below' },
  wait_for_element: { timeoutMillis: '250–15000' },
  wait: { durationMillis: 'max 15000' },
  install_app: { packageName: 'e.g. "com.whatsapp"' },
  open_intent: { action: 'VIEW, SENDTO, SEND, DIAL or WEB_SEARCH', data: 'URI, e.g. "mailto:a@b.com", "tel:+44…", "market://details?id=com.whatsapp"' },
  open_app_info: { packageName: 'e.g. "com.android.chrome"' },
};

/**
 * Kept on every tool. Without them the model put an element's idx in viewId or
 * nodePath (type_text viewId "1"): 11 times in the first compact runs, 8 failed;
 * the full descriptions never led to it.
 */
const SELECTOR_HINTS: Record<string, string> = {
  viewId: 'resource id like "com.app:id/search", never an idx',
  nodePath: 'tree path like "0/1/3", never an idx',
};

function compactParameters(toolName: string, parameters: Record<string, unknown>): Record<string, unknown> {
  const props = (parameters?.properties ?? {}) as Record<string, Record<string, unknown>>;
  const hints = { ...SELECTOR_HINTS, ...(PARAM_HINTS[toolName] ?? {}) };
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
