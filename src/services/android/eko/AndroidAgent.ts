import { Agent } from '@eko-ai/eko';
import { sightOfResult, type Sight } from '../screenSight';
import { wrongPackageHint } from './playStoreLookup';
import type { AgentContext } from '@eko-ai/eko';
import type { Tool, ToolResult } from '@eko-ai/eko';
import type { AndroidGatewayService } from '../AndroidGatewayService';
import type { ActionResult, AutomationAction, CompanionFeature, DeviceKey, UiEvent, UiNodeSnapshot, UiTreeSnapshot } from '../AndroidProtocol';
import { parseAppList } from '../agent/successVerifier';
import { keepOnlyFreshImage, pruneStaleScreens } from './contextPruning';
import { findObstacle, type ObstacleId } from './obstacles';
import { compactSystemPrompt } from './compactPrompt';
import type { ScreenshotMode } from './screenshotMode';
import { createHash } from 'crypto';
import {
  GRID,
  buildScreenModel,
  buttonChange,
  eventsLine,
  sameButton,
  stateWords,
  submitTarget,
  elementAt,
  formatScreen,
  isThin,
  screenKey,
  toPixels,
  uncoveredPoint,
  withSeenElements,
  type ScreenElement,
  type ScreenModel,
  cutText,
} from './screenModel';

/** Elements a vision model read off a screenshot, positions on the 0–1000 grid. */
export type SeenElement = { label: string; x: number; y: number; kind?: string };
/** Reads a screenshot for a model that cannot see images (see AndroidPlannerService). */
export type ScreenGrounder = (screenshotBase64: string) => Promise<SeenElement[]>;

/** Vision-helper reads per run: each is one small image call. */
const GROUNDING_BUDGET = 25;
/** On-device OCR reads per run (companion 0.32): free, but each is a capture on the phone. */
const OCR_BUDGET = 30;
/** A button that turns into its opposite right after a tap (Install → Cancel). */
const STARTS_SOMETHING = /\b(install|update|download|get|buy|enable|turn on|start|subscribe)\b/i;
const UNDOES_IT = /^(cancel|stop|uninstall|remove|delete|disable|turn off|unsubscribe)\b/i;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Popups cleared by rule per run; past this the model deals with them. */
const OBSTACLE_BUDGET = 10;
/** How long install_app waits for the phone to report the app installed. */
const INSTALL_WAIT_MS = 180_000;
const PLAY_STORE = 'com.android.vending';
const PACKAGE_NAME = /^[a-zA-Z][\w]*(\.[\w]+)+$/;
const PRICE = /^(₹|\$|€|£|rs\.?\s?)\s?\d|^\d+([.,]\d{2})\s?(₹|\$|€|£)?$/i;
const INSTALL_FAILED = /(can['’]t install|couldn['’]t install|can['’]t download|not enough (storage|space)|insufficient storage|isn['’]t compatible|not compatible with your device|not available (in your country|for your device|in your region)|item not found|this item isn['’]t available)/i;
/** Xiaomi's full-screen pocket-mode warning: nothing opens until the sensor is uncovered. */
const SENSOR_COVERED = /don['’]t cover the earphone area|do not cover the earpiece|proximity sensor (is )?covered/i;
/**
 * Play's "Complete account setup" sheet (Continue → a payment page with Skip)
 * shows up on the first install on an account. It is not a sign-in: Continue,
 * then Skip, and the install goes on (seen on real phones, Oct 2026). It used
 * to stop install_app as "needs the user", which failed 37 of 74 runs in one
 * day's export.
 */
const ACCOUNT_SETUP = /complete account setup|review your account/i;
const PAYMENT_PAGE = /add (a )?payment method|add card|add paypal|redeem code/i;

/**
 * Which browser open_url uses.
 *
 * false sends sameTab:false, so Android resolves the URL normally and the
 * user's real browser (Chrome) handles it, with their own cookies and logins.
 * true routes every page through the companion app's built-in browser, which
 * reuses one surface and reads more cleanly, but is not Chrome — and the agent
 * kept telling users it was.
 */
const USE_IN_APP_BROWSER = false;

const BROWSERS: [RegExp, string][] = [
  [/\bchrome\b/i, 'com.android.chrome'],
  [/\bfirefox\b/i, 'org.mozilla.firefox'],
  [/\bsamsung\s+internet\b/i, 'com.sec.android.app.sbrowser'],
  [/\bbrave\b/i, 'com.brave.browser'],
  [/\bedge\b/i, 'com.microsoft.emmx'],
  [/\bopera\b/i, 'com.opera.browser'],
];

/**
 * The browser a URL should open in: the one already in front, else the one the
 * task names, else none (the phone's default).
 */
export function browserFor(foreground: string | null | undefined, task: string | undefined): string | undefined {
  const named = BROWSERS.find(([name]) => name.test(task ?? ''));
  if (named) return named[1];
  const inFront = BROWSERS.find(([, pkg]) => foreground === pkg);
  if (inFront) return inFront[1];
  // No browser named: Chrome. Phone makers' own browsers (OPPO/heytap, MIUI, Vivo)
  // show the agent almost nothing of a page and add their own overlays; Oct 12, #3858
  // and #3860 spent 50 steps on heytap's "Page protection" screen. Without Chrome
  // installed, the open falls back to the phone's default browser.
  return DEFAULT_BROWSER;
}

const DEFAULT_BROWSER = 'com.android.chrome';

/** A sign-in the agent cannot get past on its own: a wrong password, a challenge, account recovery. */
const SIGN_IN_WALL =
  /wrong password|incorrect password|couldn['’]t sign you in|verify (?:it['’]s|that it['’]s) you|try another way|account recovery|recover your account|enter the last password|confirm (?:it['’]s|that it['’]s) you|unusual activity|this browser or app may not be secure/i;

/** The wall's text on this screen, if any. */
export function signInWall(screen: { elements: { label: string }[] } | null): string | null {
  const hit = screen?.elements.find((e) => e.label.length <= 160 && SIGN_IN_WALL.test(e.label));
  return hit ? hit.label : null;
}


/**
 * Below this many usable rows we assume the app is not exposing its content to
 * the accessibility tree (web views, canvas UIs, games) and fall back to vision.
 */
const MIN_INFORMATIVE_ROWS = 8;

/** Pause between foreground checks after launching an app or URL. */
const LAUNCH_SETTLE_MS = 900;

/**
 * Package names for the same stock app differ across Android builds — the
 * emulator ships Clock as com.google.android.deskclock, Samsung as
 * com.sec.android.app.clockpackage, Xiaomi as com.android.deskclock. The model
 * cannot list what is installed, so it guesses, and every wrong guess costs a
 * step. Each family below is tried in order after an APP_NOT_FOUND, matched on
 * a keyword in whatever package the model asked for.
 */
const PACKAGE_FAMILIES: { keywords: string[]; packages: string[] }[] = [
  {
    keywords: ['clock', 'alarm'],
    packages: [
      'com.google.android.deskclock',
      'com.android.deskclock',
      'com.sec.android.app.clockpackage',
      'com.miui.clock',
    ],
  },
  {
    keywords: ['camera'],
    packages: ['com.android.camera2', 'com.android.camera', 'com.sec.android.app.camera', 'com.oplus.camera'],
  },
  {
    keywords: ['contact', 'people'],
    packages: ['com.google.android.contacts', 'com.android.contacts', 'com.samsung.android.app.contacts'],
  },
  {
    keywords: ['message', 'sms', 'mms'],
    packages: ['com.google.android.apps.messaging', 'com.android.mms', 'com.samsung.android.messaging'],
  },
  {
    keywords: ['photo', 'gallery'],
    packages: [
      'com.google.android.apps.photos',
      'com.miui.gallery',
      'com.sec.android.gallery3d',
      'com.android.gallery3d',
    ],
  },
  {
    keywords: ['calculator'],
    packages: ['com.google.android.calculator', 'com.android.calculator2', 'com.miui.calculator'],
  },
  {
    keywords: ['calendar'],
    packages: ['com.google.android.calendar', 'com.android.calendar', 'com.samsung.android.calendar'],
  },
  {
    keywords: ['dialer', 'phone'],
    packages: ['com.google.android.dialer', 'com.android.dialer', 'com.samsung.android.dialer'],
  },
  {
    keywords: ['file', 'document'],
    packages: ['com.google.android.documentsui', 'com.android.documentsui', 'com.mi.android.globalFileexplorer'],
  },
  { keywords: ['setting'], packages: ['com.android.settings'] },
];

/** How many alternates to try before handing the failure back to the model. */
const MAX_PACKAGE_RETRIES = 4;

function packageAlternatives(requested: string): string[] {
  const wanted = requested.toLowerCase();
  const family = PACKAGE_FAMILIES.find((entry) => entry.keywords.some((keyword) => wanted.includes(keyword)));
  if (!family) return [];
  return family.packages.filter((candidate) => candidate.toLowerCase() !== wanted).slice(0, MAX_PACKAGE_RETRIES);
}

export interface AndroidAgentCallbacks {
  onStepExecuted?: (info: {
    toolName: string;
    args: Record<string, unknown>;
    result: string;
    screenshotBase64?: string;
    foregroundApp?: string;
    uiTree?: string;
    /** Where a tap actually landed, in device pixels (kept so a recorded flow can replay it). */
    tapPx?: { x: number; y: number };
  }) => void;
  /** A known obstacle was cleared by rule (counted as a recovery in the run's outcome). */
  onRecovery?: (id: ObstacleId, detail: string) => void;
  /** A long tool (install_app) is still working: proof the phone is alive. */
  onHeartbeat?: () => void;
}

/**
 * "bbc.com" or "www.reddit.com/r/news" → with https:// in front. The phone opens
 * only http(s) links; Oct 9, 20 of 21 failed open_url calls were a bare address.
 * Anything with its own scheme or with spaces is left as it is.
 */
const ANNOUNCED_ON = /^(?:liked|saved|bookmarked|followed|following|subscribed|starred|favou?rited|joined|added\b)/i;
const ANNOUNCED_OFF = /^(?:unliked|unsaved|un-?bookmarked|unfollowed|unsubscribed|unstarred|unfavou?rited|left\b|removed\b|like removed)/i;

/** What the phone announced about a toggle just tapped ("Liked" → on, "Unliked" → off), else null. */
export function announcedToggle(events: UiEvent[]): { on: boolean; text: string } | null {
  for (const e of [...events].reverse()) {
    if (e.kind !== 'announcement' && e.kind !== 'toast') continue;
    const text = (e.text ?? '').trim();
    if (ANNOUNCED_OFF.test(text)) return { on: false, text: text.slice(0, 40) };
    if (ANNOUNCED_ON.test(text)) return { on: true, text: text.slice(0, 40) };
  }
  return null;
}

/** The text in the field that has the cursor (else the only editable field); null when none can be read. */
export function focusedFieldText(screen: { elements: { editable: boolean; focused?: boolean; password?: boolean; label: string }[] } | null): string | null {
  if (!screen) return null;
  const fields = screen.elements.filter((e) => e.editable && !e.password);
  const field = fields.find((e) => e.focused) ?? (fields.length === 1 ? fields[0] : undefined);
  if (!field) return null;
  return field.label.split(' · ')[0].replace(/…$/, '').trim();
}

/** The field shows what was typed (labels are cut at 60 characters; spacing and case aside). */
export function sameTyped(shown: string, typed: string): boolean {
  const a = shown.replace(/\s+/g, ' ').trim().toLowerCase();
  const b = typed.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!a) return !b;
  // Formatting the field adds ("98765 43210", "+44 (0)…") is not a different value.
  const bare = (t: string) => t.replace(/[\s()+\-.]/g, '');
  return a === b || bare(a) === bare(b) || (a.length >= 50 && b.startsWith(a));
}

/**
 * The field kept only the start of what was typed: it has a length limit. Typing the
 * same value again keeps the same start, so this is not a typing slip to retry.
 * Returns how many characters it kept, else null. Labels are cut near 60 characters,
 * so a longer field cannot be told apart from a cut label.
 */
export function fieldKept(shown: string, typed: string): number | null {
  const a = shown.trim();
  const b = typed.trim();
  if (!a || a.length >= 50 || a.length >= b.length) return null;
  return b.toLowerCase().startsWith(a.toLowerCase()) ? a.length : null;
}

/** Messages forms show next to a field ("This blog address is invalid", "Already taken"). */
const FIELD_MESSAGE =
  /\b(invalid|not (?:supported|available|valid|allowed)|already (?:taken|in use|exists|registered)|is required|required field|too (?:short|long)|must (?:be|contain|have|include)|try another|unavailable|doesn't match|does not match|incorrect|character limit|(?:up to|at most|maximum(?: of)?|max|no more than|less than|fewer than|between \d+ and) \d+ (?:characters|chars|letters)|\d+ (?:characters|chars|letters) (?:max(?:imum)?|or (?:less|fewer)))\b/i;

/** Field messages on the new screen that were not on the old one. */
export function newFieldMessages(before: { elements: { label: string }[] } | null, after: { elements: { label: string; tappable: boolean }[] } | null): string[] {
  if (!after) return [];
  const old = new Set((before?.elements ?? []).map((e) => e.label));
  return after.elements
    .filter((e) => !e.tappable && e.label.length <= 160 && FIELD_MESSAGE.test(e.label) && !old.has(e.label))
    .map((e) => e.label)
    .slice(0, 2);
}

/** Playback controls: an accessibility click works while a player hides its controls; a tap only shows them. */
// Bare "Next" is a wizard button, not a player: only Next/Previous with what they move to.
const MEDIA_CONTROL = /^(?:(?:pause|play|resume)(?: (?:video|song|track|music|episode))?|(?:next|previous) (?:video|song|track|episode)|skip ads?|skip (?:forward|back)(?:ward)?|(?:un)?mute(?: video)?)$/i;

/** The task itself asks for an install (any language the user writes in, roughly). */
export function asksToInstall(task?: string): boolean {
  return /\b(install|download|update|re-?install|get\s+the\s+app|daal(?:o|do|na)?|dalo|laga(?:o|do|na)?)\b|इंस्टॉल|डाउनलोड/i.test(task ?? '');
}

const INTENT_ACTIONS: Record<string, string> = {
  VIEW: 'android.intent.action.VIEW',
  SENDTO: 'android.intent.action.SENDTO',
  SEND: 'android.intent.action.SEND',
  DIAL: 'android.intent.action.DIAL',
  WEB_SEARCH: 'android.intent.action.WEB_SEARCH',
};
const INTENT_EXTRAS: Record<string, string> = {
  subject: 'android.intent.extra.SUBJECT',
  text: 'android.intent.extra.TEXT',
  query: 'query',
};

/**
 * open_intent's arguments as the phone's OpenIntent. Short names for the
 * common actions and extras; "body" goes where each app reads it (sms_body for
 * texts, EXTRA_TEXT otherwise). Anything that is not a plain intent or settings
 * action, or that would place a call or delete something, is refused here.
 */
export function intentFor(args: Record<string, unknown>): Extract<AutomationAction, { type: 'OpenIntent' }> | { error: string } {
  const raw = String(args.action ?? '').trim();
  const action = INTENT_ACTIONS[raw.toUpperCase()] ?? raw;
  if (!/^android\.(intent\.action|settings)\.[A-Z_]+$/.test(action)) return { error: `Unknown intent action "${raw}". Use VIEW, SENDTO, SEND, DIAL or WEB_SEARCH.` };
  if (/\.(CALL|DELETE|UNINSTALL_PACKAGE|FACTORY_RESET|MASTER_CLEAR|REBOOT|SHUTDOWN)$/.test(action)) return { error: `${raw} is not allowed through open_intent; do it on screen if the task really asks for it.` };
  const data = typeof args.data === 'string' && args.data.trim() ? args.data.trim() : undefined;
  const extras: Record<string, string> = {};
  const given = args.extras && typeof args.extras === 'object' ? (args.extras as Record<string, unknown>) : {};
  for (const [key, value] of Object.entries(given)) {
    if (value === undefined || value === null) continue;
    const text = String(value);
    if (key === 'body') {
      if (data?.startsWith('smsto:') || data?.startsWith('sms:')) extras.sms_body = text;
      else extras['android.intent.extra.TEXT'] = text;
    } else extras[INTENT_EXTRAS[key] ?? key] = text;
  }
  let packageName = typeof args.packageName === 'string' && args.packageName.trim() ? args.packageName.trim() : undefined;
  // Store links straight to the Play Store: on phones with a second store (Samsung's
  // Galaxy Store) Android asks which app to use, a step the agent then has to answer.
  if (!packageName && data && /^(market:\/\/|https?:\/\/play\.google\.com\/store\/)/i.test(data)) packageName = 'com.android.vending';
  return {
    type: 'OpenIntent',
    action,
    ...(data ? { data } : {}),
    ...(packageName ? { packageName } : {}),
    ...(action.endsWith('.SEND') ? { mimeType: 'text/plain' } : {}),
    ...(Object.keys(extras).length ? { extras } : {}),
  };
}

export function withScheme(url: string): string {
  const trimmed = url.trim();
  if (!trimmed || /^[a-z][a-z0-9+.-]*:/i.test(trimmed) || /\s/.test(trimmed)) return trimmed;
  const bare = trimmed.replace(/^\/\//, '');
  return /^[\w-]+(\.[\w-]+)+(:\d+)?([/?#].*)?$/.test(bare) ? `https://${bare}` : trimmed;
}

/** Buttons that switch on and off in place, whose label often stays the same (Instagram's heart stays "Like"). */
/** Actions after which the screen is read again; with companion 0.31+ it comes back with the result. */
const SCREEN_CHANGING = new Set<AutomationAction['type']>([
  'Tap', 'ClickNode', 'LongPress', 'Swipe', 'ScrollNode', 'ScrollUntil', 'Global', 'OpenApp', 'OpenUrl', 'OpenIntent', 'OpenSettings', 'PressKey', 'SetText', 'KeyboardType', 'Paste', 'Gesture', 'NotificationAction', 'DismissNotification',
]);
const TOGGLE = /^(?:like|liked|unlike|love|heart|save|saved|unsave|bookmark|favou?rite|star|upvote|downvote|vote|repost|subscribe|subscribed|join|joined)\b/i;
/** Actions that move to another item or screen: after one, the same toggle is a new item. */
const MOVES_ON = new Set(['Swipe', 'ScrollNode', 'ScrollUntil', 'Global', 'OpenApp', 'OpenUrl', 'OpenIntent']);

export class AndroidAgent extends Agent {
  /**
   * Lite: shorter wording where the model reads it every call (the system prompt,
   * read_ui_tree's heading). Same rules and the same screen list; set by the engine.
   */
  compactText = false;
  private lastUiTree: string | null = null;
  /** Whether the AI saw the screen as an image on the latest step. */
  sight: Sight | null = null;
  private lastForegroundApp: string | null = null;
  private lastScreenshotBase64: string | null = null;
  /** The latest screen as elements, for tap_element and "what is at this point". */
  private screen: ScreenModel | null = null;
  private fullScreen: { width: number; height: number } | null = null;
  /** The text type_text last put in a field: a suggestion row with the same text submits it when Enter cannot. */
  private lastTypedText: string | null = null;
  /** The last tap: what it hit, so a button that turns into Cancel is not tapped again. */
  private lastTap: { grid: { x: number; y: number }; label: string; at: number } | null = null;
  /** A tap that changed nothing, on the screen it left behind. */
  private noEffect: { grid: { x: number; y: number }; key: string } | null = null;
  private groundingUsed = 0;
  private groundedKey = '';
  private groundedSeen: SeenElement[] = [];
  /** The element list as the phone reported it, before any rows read from a screenshot. */
  private baseTable: string | null = null;
  private obstaclesCleared = 0;
  /** rule|screen pairs already tried, so a rule that did not work is not repeated. */
  private obstacleTried = new Set<string>();

  // Loop prevention tracking
  private actionHistory: string[] = [];
  private consecutiveFailures = 0;
  private lastFailedAction = '';

  /** Vision spend cap: images cost roughly 1k tokens each, so cap them per run. */
  private screenshotsUsed = 0;
  /** capture_screen calls the model may make itself (thin screens also get one look each by themselves). */
  private readonly screenshotBudget = 6;

  /** Separate cap for automatic fallback vision on accessibility-blind screens. */
  private autoVisionUsed = 0;
  private readonly autoVisionBudget = 12;

  /**
   * Repeated waits mean the model cannot tell whether the screen changed —
   * usually a web page whose content never reaches the accessibility tree.
   */
  private consecutiveWaits = 0;

  /**
   * Stuck detection. The last few screens after real actions, and how many
   * actions in a row changed nothing. A run that bounces between two screens
   * (tap → menu → BACK → tap …) never repeats an identical step, so the old
   * guards missed it; in one run it went round 28 times.
   */
  private recentKeys: string[] = [];
  private noEffectStreak = 0;
  /** The screen a forced look was last spent on, so one screen is not looked at twice. */
  private lastStuckLookKey = '';
  /** The last thin screen shown as an image without being asked: list and picture. */
  private thinLookKey = '';
  private thinLookFrame = '';
  private stepsSinceThinLook = 0;
  /** A coordinate tap on nothing in the list is questioned once per screen and point. */
  private blindTapWarned = '';
  /** Swipes, scrolls, BACK/HOME and app or page opens so far: "has the agent moved on since". */
  private moves = 0;
  /** The last toggle tapped (Like, Save…): a second tap on it before moving on would undo it. */
  private lastToggle: { grid: { x: number; y: number }; label: string; moves: number } | null = null;
  private toggleWarned = '';
  /** Taps per spot (25-unit grid cells) in this run, for "you keep tapping here". */
  private spotTaps = new Map<string, number>();
  /** Values that did not end up in their field as typed, and what the field showed. */
  private typedMisses = new Map<string, { times: number; shown: string }>();
  /** What the phone reported between reads (toasts, scrolls, new screens), shown once with the next result. */
  private phoneSaw = '';
  /** The events that came with the latest read (toasts, announcements…). */
  private lastEvents: UiEvent[] = [];

  constructor(
    private gatewayService: AndroidGatewayService,
    private hardwareDeviceId: string,
    private callbacks?: AndroidAgentCallbacks,
    /**
     * vision: the model can read images (see modelVision). Without it the agent
     * is never offered a screenshot — a text-only model cannot read one, and
     * each capture cost ~80k tokens of base64 on every later call.
     */
    private readonly options: { vision?: boolean; grounder?: ScreenGrounder; task?: string; screenshots?: ScreenshotMode; deviceFacts?: string } = {},
  ) {
    // Companion 0.32 options, decided per phone (an older build drops what it cannot parse).
    const keys2 = Boolean(gatewayService.hasFeature?.(hardwareDeviceId, 'keys2'));
    const scrollById = Boolean(gatewayService.hasFeature?.(hardwareDeviceId, 'scroll_until_id'));
    const tools: Tool[] = [
      {
        name: 'read_ui_tree',
        description: 'Read the current screen: every visible element with its idx (for tap_element) and position on the 0–1000 grid.',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        execute: async (_args: Record<string, unknown>, _context: AgentContext): Promise<ToolResult> => {
          const res = await this.observe();
          if (res.status !== 'SUCCESS') {
            const errorMsg = res.status === 'FAILURE' ? `${res.code}: ${res.message}` : 'Inspection cancelled';
            return { content: [{ type: 'text', text: `Failed to read UI tree: ${errorMsg}` }], isError: true };
          }

          this.absorb(res);
          const cleared = await this.clearObstacles();
          const pkg = this.lastForegroundApp || 'unknown';
          const extra = await this.screenExtras(cleared ? undefined : res.screenCapture?.base64Data);

          this.callbacks?.onStepExecuted?.({
            toolName: 'read_ui_tree',
            args: {},
            result: `Inspected UI for ${pkg}`,
            foregroundApp: pkg,
            uiTree: this.lastUiTree ?? undefined,
            screenshotBase64: this.lastScreenshotBase64 || undefined,
          });

          // Lite: the columns are explained in its system prompt, so the heading is the short one action results use.
          const text = this.compactText
            ? `${cleared}CURRENT APP: ${pkg}\n\nUPDATED SCREEN ELEMENTS:\n${this.lastUiTree}${extra.note}`
            : `${cleared}CURRENT VISIBLE APP: ${pkg}\n\nVISIBLE UI ELEMENTS (columns: idx|type|label|flags|tap_at — flags: t=tappable, e=editable, d=disabled; tap_at is x,y on a 0–1000 grid):\n${this.lastUiTree}${extra.note}`;
          return { content: extra.image ? [{ type: 'text', text }, { type: 'image', data: extra.image, mimeType: 'image/jpeg' }] : [{ type: 'text', text }] };
        },
      },
      {
        name: 'capture_screen',
        description:
          'EXPENSIVE — sends a real image to the model and costs far more than read_ui_tree. Only use when the UI tree cannot describe what you need (photos, video thumbnails, maps, games, charts). For buttons, text, fields and menus always use read_ui_tree instead. Limited to a few uses per task.',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        execute: async (_args: Record<string, unknown>, _context: AgentContext): Promise<ToolResult> => {
          if (!this.imagesToAi) {
            return { content: [{ type: 'text', text: 'Screenshots are off for this account: the screen is never sent as an image. Use read_ui_tree — it lists every visible element with its tap coordinates.' }] };
          }
          // Weak models ask for screenshots compulsively; cap the spend instead
          // of refusing outright so the run keeps moving.
          if (this.screenshotsUsed >= this.screenshotBudget) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Screenshot budget for this task is used up (${this.screenshotBudget}). Use read_ui_tree instead — it lists every visible element with its tap coordinates.`,
                },
              ],
            };
          }

          const res = await this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'CaptureScreen' });
          if (res.status !== 'SUCCESS' || !res.screenCapture?.base64Data) {
            const errorMsg = res.status === 'FAILURE' ? `${res.code}: ${res.message}` : 'Screen capture failed';
            return { content: [{ type: 'text', text: `Failed to capture screen: ${errorMsg}` }], isError: true };
          }

          const base64 = res.screenCapture.base64Data;
          this.lastScreenshotBase64 = base64;
          this.screenshotsUsed += 1;

          this.callbacks?.onStepExecuted?.({
            toolName: 'capture_screen',
            args: {},
            result: 'Screen captured',
            screenshotBase64: base64,
          });

          return {
            content: [
              { type: 'text', text: 'Screenshot captured successfully.' },
              { type: 'image', data: base64, mimeType: 'image/jpeg' },
            ],
          };
        },
      },
      {
        name: 'tap_element',
        description:
          'Tap an element from the latest screen list by its idx (the first column: 12, or v3 for one read from a screenshot). The PREFERRED way to tap: it always hits the element as it is on this phone.',
        parameters: {
          type: 'object',
          properties: {
            idx: { type: 'string', description: 'The idx of the element in the latest screen list, e.g. "12" or "v3"' },
          },
          required: ['idx'],
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          const idx = String(args.idx ?? '').trim();
          const target = this.screen?.elements.find((e) => e.idx === idx) ?? null;
          if (!target) {
            return {
              content: [{ type: 'text', text: `There is no element ${idx || '(none)'} on the current screen. Use an idx from the latest screen list, or click_node with the element's visible text.` }],
              isError: true,
            };
          }
          // Its middle under a floating control (a mini player): tap the part that shows.
          const free = uncoveredPoint(this.screen, target);
          if (free) {
            const result = await this.tapAt(free.grid, { ...target, grid: free.grid }, 'tap_element', args, true);
            return result.isError ? result : this.withNote(result, `(The middle of "${target.label.slice(0, 40)}" is under "${free.cover.label.slice(0, 40) || free.cover.type}", so its uncovered part was tapped.)`);
          }
          return this.tapAt(target.grid, target, 'tap_element', args);
        },
      },
      {
        name: 'tap_coordinate',
        description:
          'Tap a point on the screen. x and y are on a 0–1000 grid over the CURRENT screen (0,0 top-left, 1000,1000 bottom-right, 500,500 the middle) — the same numbers as tap_at in the screen list. Prefer tap_element or click_node; use this for a point the list does not name (on a screenshot, a map, a game).',
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'Horizontal position, 0–1000 across the screen' },
            y: { type: 'number', description: 'Vertical position, 0–1000 down the screen' },
            description: { type: 'string', description: 'What you are tapping (e.g. "search box", "Google search button")' },
          },
          required: ['x', 'y'],
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          const x = Number(args.x);
          const y = Number(args.y);
          if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > GRID || y > GRID) {
            return {
              content: [{ type: 'text', text: `x and y must be on the 0–1000 grid (got ${args.x}, ${args.y}). Use the tap_at numbers from the latest screen list, or tap_element with its idx.` }],
              isError: true,
            };
          }
          const grid = { x: Math.round(x), y: Math.round(y) };
          const target = elementAt(this.screen, grid.x, grid.y);
          // A point with nothing under it on a screen the list does describe is
          // a guess ("the tab button is usually here"), which opened Google Lens
          // twice in one run. Question it once; the same call again goes through.
          if (!target && this.screen && !isThin(this.screen)) {
            const warnKey = `${this.currentKey()}|${grid.x},${grid.y}`;
            if (this.blindTapWarned !== warnKey) {
              this.blindTapWarned = warnKey;
              const look = this.imagesToAi
                ? ' If what you want is not in the list, call capture_screen and look first.'
                : '';
              return {
                content: [{ type: 'text', text: `Not tapped: nothing in the screen list is at ${grid.x},${grid.y}, so this is a guess. Pick the element from the list with tap_element or click_node.${look} If you are sure about this point, call tap_coordinate again with the same x and y.` }],
                isError: true,
              };
            }
          }
          return this.tapAt(grid, target, 'tap_coordinate', args);
        },
      },
      {
        name: 'click_node',
        description: 'Click an element by its exact visible text or viewId. A good first choice when you know the text on the button; also the fallback when a tap did not change the screen.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Exact visible text of the element to click' },
            viewId: { type: 'string', description: 'Resource ID of the target view (e.g. "com.app:id/btn")' },
            nodePath: { type: 'string', description: 'Path index in the UI tree (e.g. "0/1/3") - use as last resort' },
          },
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          // An idx from the screen list passed as a viewId or node path: tap that element.
          const idx = this.idxInSelector(args);
          if (idx) return this.withNote(await this.runTool('tap_element', { idx }), `("${idx}" is an idx from the screen list, so element ${idx} was tapped.)`);
          const result = await this.runDeviceAction(
            {
              type: 'ClickNode',
              nodePath: args.nodePath as string | undefined,
              viewId: args.viewId as string | undefined,
              text: args.text as string | undefined,
            },
            'click_node',
            args,
          );
          // The phone matches text exactly; a curly apostrophe or different case misses
          // a label that is on screen. Tap the one element whose label matches loosely.
          const text = typeof args.text === 'string' ? args.text : '';
          if (result.isError && text && /NODE_NOT_FOUND/.test((result.content ?? []).map((c) => ('text' in c ? c.text : '')).join(' '))) {
            const match = this.uniqueLabelMatch(text);
            if (match) return this.withNote(await this.runTool('tap_element', { idx: match.idx }), `(No exact match for "${text.slice(0, 60)}"; tapped "${match.label.slice(0, 60)}", element ${match.idx}.)`);
          }
          return result;
        },
      },
      {
        name: 'type_text',
        description:
          'Type text into a focused input field. Always tap the input field first. It REPLACES everything in the field with this text (to add to what is there, type the whole new value). The result says what the field shows afterwards. This only puts the text in the field; it does not submit it. To submit (search, send, go), call press_key with ENTER next — on Android 11+ that fires the keyboard\'s own Search/Go/Done action. If press_key is refused (older Android or the field ignores it), tap the Search, Go, Send or Done button on screen. For a web or YouTube search, opening the results URL with open_url is a quicker shortcut (e.g. https://www.google.com/search?q=... or https://www.youtube.com/results?search_query=...). If the field refuses the text (one-time code boxes, PIN pads), this retries through the Vector Keyboard by itself — do not fall back to tapping keyboard keys.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text string to type into the input field' },
            nodePath: { type: 'string', description: 'Optional target node path in the UI tree' },
            viewId: { type: 'string', description: 'Optional stable resource ID of the target input' },
          },
          required: ['text'],
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          // Reset loop counter on new text input
          this.consecutiveFailures = 0;
          // An idx from the screen list passed as a viewId or node path never matches a
          // view: tap that element so it has focus, then type into the focused field.
          const idx = this.idxInSelector(args);
          if (idx) {
            const tapped = await this.runTool('tap_element', { idx });
            if (tapped.isError) return tapped;
          }
          const result = await this.runDeviceAction(
            {
              type: 'SetText',
              text: String(args.text || ''),
              nodePath: idx ? undefined : (args.nodePath as string | undefined),
              viewId: idx ? undefined : (args.viewId as string | undefined),
            },
            'type_text',
            args,
          );
          if (!result.isError) this.lastTypedText = String(args.text || '');
          const checked = result.isError ? result : await this.checkTyped(String(args.text || ''), result);
          return idx ? this.withNote(checked, `("${idx}" is an idx from the screen list: element ${idx} was tapped first, then the text typed into it.)`) : checked;
        },
      },
      {
        name: 'swipe',
        description:
          'LAST RESORT scrolling — try scroll_element first, which asks the list itself to scroll and always moves the right container. Use swipe only when scroll_element reports that nothing on screen is scrollable, or for a horizontal drag such as a carousel or an image gallery. Direction is the direction your FINGER drags: UP reveals what is further down the page, DOWN goes back towards the top. (This wording used to be inverted, which sent the agent swinging up and down without getting anywhere.) Do not swipe more than twice in the same direction without something changing.',
        parameters: {
          type: 'object',
          properties: {
            direction: {
              type: 'string',
              enum: ['UP', 'DOWN', 'LEFT', 'RIGHT'],
              description:
                'UP = drag upward, which reveals content below. DOWN = drag downward, which goes back towards the top.',
            },
            durationMillis: {
              type: 'number',
              description: 'Swipe duration in milliseconds (default: 400)',
            },
          },
          required: ['direction'],
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          // Block excessive scrolling
          const scrollKey = `scroll_${args.direction}`;
          const recentScrolls = this.actionHistory.filter(a => a === scrollKey).length;
          if (recentScrolls >= 4) {
            return {
              content: [{ type: 'text', text: `Blocked: already scrolled ${recentScrolls} times in this direction with nothing changing. Stop scrolling — read the screen, work with the elements that are visible, or reach the target another way (for example open_url).` }],
              isError: true,
            };
          }
          this.actionHistory.push(scrollKey);
          if (this.actionHistory.length > 10) this.actionHistory.shift();

          // The tool speaks in content terms ("show me what is below"), while
          // the device expects the finger's direction — which is the opposite.
          // Exposing the raw gesture was making the model scroll the wrong way
          // and then bounce back and forth hunting for the item.
          const requested = args.direction as 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';
          const gesture =
            requested === 'DOWN' ? 'UP' : requested === 'UP' ? 'DOWN' : requested === 'RIGHT' ? 'LEFT' : 'RIGHT';

          const before = this.currentKey();
          const frameBefore = this.frameKey();
          const result = await this.runDeviceAction(
            {
              type: 'Swipe',
              direction: gesture,
              durationMillis: args.durationMillis ? Number(args.durationMillis) : 400,
            },
            'swipe',
            args,
          );
          // Only swipes that changed nothing count towards the block above. A swipe
          // that brought new content (the next reel, more of a list) is progress:
          // "scroll Reels 5 times" was blocked at the 5th on Oct 9 (run #3229).
          // Changed = the element list or the picture changed. A feed of videos or
          // photos (Reels, Shorts, a gallery) can show the same list for every
          // item, so the list alone called real scrolls "nothing changing".
          const frameAfter = this.frameKey();
          const pictureChanged = Boolean(frameBefore && frameAfter && frameBefore !== frameAfter);
          if (!result.isError && (this.currentKey() !== before || pictureChanged)) {
            const at = this.actionHistory.lastIndexOf(scrollKey);
            if (at >= 0) this.actionHistory.splice(at, 1);
          }
          return result;
        },
      },
      {
        name: 'open_app',
        description:
          'Launch an Android application by its package name. The result confirms whether the app actually reached the foreground, so trust what it says instead of re-checking by tapping icons. Do NOT use this when the goal is to search inside the app — open_url with the app\'s search results URL (e.g. https://www.youtube.com/results?search_query=...) launches the app straight onto the results screen and saves several steps.',
        parameters: {
          type: 'object',
          properties: {
            packageName: { type: 'string', description: 'Full package name (e.g. "com.android.chrome", "com.google.android.youtube")' },
          },
          required: ['packageName'],
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          this.actionHistory = []; // Reset history on app open
          this.consecutiveFailures = 0;
          return this.runDeviceAction(
            {
              type: 'OpenApp',
              packageName: String(args.packageName || ''),
            },
            'open_app',
            args,
          );
        },
      },
      {
        name: 'open_url',
        description:
          'Open an HTTP or HTTPS web URL in the device browser. Each call may open a new tab, so never tell the user that pages stayed in one tab. Some domains (youtube.com, maps.google.com) are captured by their own app instead of the browser — if that happens, use global_action BACK to return to the browser.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Full URL (e.g. "https://google.com")' },
          },
          required: ['url'],
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          this.actionHistory = []; // Reset history on URL open
          this.consecutiveFailures = 0;
          // Stay in the browser the task is about. Without this the phone's
          // default browser took the link: a Chrome task landed in Firefox.
          const browser = browserFor(this.lastForegroundApp, this.options.task);
          const open = (packageName?: string) =>
            this.runDeviceAction({ type: 'OpenUrl', url: withScheme(String(args.url || '')), sameTab: USE_IN_APP_BROWSER, ...(packageName ? { packageName } : {}) }, 'open_url', args);
          const opened = await open(browser);
          // Chrome by default, but this phone may not have it: the phone's own browser then.
          if (opened.isError && browser === DEFAULT_BROWSER && !BROWSERS[0][0].test(this.options.task ?? '')) return open();
          return opened;
        },
      },
      {
        name: 'global_action',
        description:
          'Trigger Android system navigation. BACK = go back, HOME = home screen, RECENTS = recents, NOTIFICATIONS = pull down the shade, POWER_DIALOG = open the power menu. To reboot the phone, call POWER_DIALOG then tap Restart in the menu that appears — there is no power-off action, and never turn the phone off, only restart it.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['BACK', 'HOME', 'RECENTS', 'NOTIFICATIONS', 'POWER_DIALOG'],
              description: 'BACK = go back one screen, HOME = go to home screen, POWER_DIALOG = open the power menu (then tap Restart to reboot)',
            },
          },
          required: ['action'],
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          this.actionHistory = []; // Reset on navigation
          return this.runDeviceAction(
            {
              type: 'Global',
              action: args.action as 'BACK' | 'HOME' | 'RECENTS' | 'NOTIFICATIONS' | 'POWER_DIALOG',
            },
            'global_action',
            args,
          );
        },
      },
      {
        name: 'press_key',
        description:
          'Press a key on the text field that currently has focus. Use ENTER to submit a search or form after set_text — it triggers the field\'s own Search/Go/Done action. BACKSPACE deletes one character, CLEAR empties the field. Where Enter does not work (Android 10 and older, or a field that ignores it), the on-screen Search/Go/Send button or the suggestion matching the typed text is tapped for you; the result says which.',
        parameters: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              enum: keys2 ? ['ENTER', 'BACKSPACE', 'CLEAR', 'TAB', 'ESCAPE', 'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT', 'SEARCH', 'FORWARD_DEL', 'SPACE'] : ['ENTER', 'BACKSPACE', 'CLEAR'],
              description: keys2
                ? 'ENTER = submit, BACKSPACE = delete one character, CLEAR = empty the field. TAB = next field, ESCAPE, DPAD_* = arrow keys, SEARCH, FORWARD_DEL, SPACE are real key presses: they need the Vector Keyboard active (use_vector_keyboard first)'
                : 'ENTER = submit, BACKSPACE = delete one character, CLEAR = empty the field',
            },
          },
          required: ['key'],
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          const result = await this.runDeviceAction(
            {
              type: 'PressKey',
              key: args.key as DeviceKey,
            },
            'press_key',
            args,
          );
          if (!result.isError || args.key !== 'ENTER') return result;
          // Enter needs Android 11 and some fields ignore it. The screen nearly
          // always has another way to submit: a Search/Go/Send button, or the
          // suggestion row that repeats the typed text. Oct 9, #3273 (Android 10):
          // Enter was refused, and the agent spent two more calls finding that row.
          const submit = submitTarget(this.screen, this.lastTypedText);
          if (!submit) return result;
          const tapped = await this.tapAt(submit.grid, submit, 'tap_element', { idx: submit.idx });
          if (tapped.isError) return result;
          return this.withNote(tapped, `(Enter does not work in this field on this phone, so "${submit.label.slice(0, 40)}" (row ${submit.idx}) was tapped instead to submit.)`);
        },
      },
      {
        name: 'scroll_element',
        description:
          'Scroll a specific list or container. Prefer this over swipe whenever the screen has a list inside a page — swipe drags whatever sits under the middle of the display and often moves the wrong thing. With no selector it scrolls the innermost scrollable container on screen. A refusal means the list is already at that end.',
        parameters: {
          type: 'object',
          properties: {
            nodePath: { type: 'string', description: 'Optional node path of an element inside the list' },
            viewId: { type: 'string', description: 'Optional stable resource ID' },
            text: { type: 'string', description: 'Optional visible text of an element inside the list' },
            direction: { type: 'string', enum: ['FORWARD', 'BACKWARD'], description: 'FORWARD = down or right, BACKWARD = up or left' },
          },
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          return this.runDeviceAction(
            {
              type: 'ScrollNode',
              nodePath: args.nodePath as string | undefined,
              viewId: args.viewId as string | undefined,
              text: args.text as string | undefined,
              direction: (args.direction as 'FORWARD' | 'BACKWARD') || 'FORWARD',
            },
            'scroll_element',
            args,
          );
        },
      },
      {
        name: 'scroll_until',
        description:
          'Scroll the main list until an item with this text is on screen, in one step (up to 30 scrolls). Use it to find a named item further down a list (a setting, a contact, an app, a song). The result says found, or that the list ended without it.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Visible text (or content description) of the item to bring on screen' },
            ...(scrollById ? { viewId: { type: 'string', description: 'Or the resource id of the item (e.g. app:id/save), when it has no text' } } : {}),
            direction: { type: 'string', enum: ['FORWARD', 'BACKWARD'], description: 'FORWARD = down or right, BACKWARD = up or left' },
            maxScrolls: { type: 'number', description: 'Give up after this many scrolls, 1 to 30 (default 10)' },
          },
          required: scrollById ? [] : ['text'],
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          const text = String(args.text ?? '').trim();
          const viewId = scrollById && typeof args.viewId === 'string' && args.viewId.trim() ? args.viewId.trim() : undefined;
          if (!text && !viewId) return { content: [{ type: 'text', text: 'Say which text to scroll to.' }], isError: true };
          return this.runDeviceAction(
            {
              type: 'ScrollUntil',
              text,
              ...(viewId ? { viewId } : {}),
              direction: (args.direction as 'FORWARD' | 'BACKWARD') || 'FORWARD',
              maxScrolls: Math.max(1, Math.min(30, Math.round(Number(args.maxScrolls) || 10))),
            },
            'scroll_until',
            args,
          );
        },
      },
      {
        name: 'long_press',
        description:
          'Press and hold. Use for context menus, selecting text, app icon menus, and anything that a normal tap does not open. Give a selector, or x and y for a raw coordinate.',
        parameters: {
          type: 'object',
          properties: {
            nodePath: { type: 'string', description: 'Optional node path from the latest UI snapshot' },
            viewId: { type: 'string', description: 'Optional stable resource ID' },
            text: { type: 'string', description: 'Optional visible text or content description' },
            x: { type: 'number', description: 'Optional x on the 0–1000 grid, used when no selector is given' },
            y: { type: 'number', description: 'Optional y on the 0–1000 grid, used when no selector is given' },
            durationMillis: { type: 'number', description: 'Hold time, 400 to 3000 ms (default 700)' },
          },
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          return this.runDeviceAction(
            {
              type: 'LongPress',
              nodePath: args.nodePath as string | undefined,
              viewId: args.viewId as string | undefined,
              text: args.text as string | undefined,
              x: typeof args.x === 'number' ? toPixels(args.x, this.screen?.size.width ?? 1080) : undefined,
              y: typeof args.y === 'number' ? toPixels(args.y, this.screen?.size.height ?? 2400) : undefined,
              durationMillis: typeof args.durationMillis === 'number' ? args.durationMillis : undefined,
            },
            'long_press',
            args,
          );
        },
      },
      {
        name: 'drag',
        description:
          'Drag a finger from one point to another, following the path at the speed given: move a slider, drag and drop, pull a map, draw. Start from an element (idx) or a point; points are on the 0–1000 grid. For scrolling lists use scroll_element instead.',
        parameters: {
          type: 'object',
          properties: {
            idx: { type: 'string', description: 'Start on this element from the screen list (or give from_x/from_y)' },
            from_x: { type: 'number', description: 'Start x on the 0–1000 grid' },
            from_y: { type: 'number', description: 'Start y on the 0–1000 grid' },
            to_x: { type: 'number', description: 'End x on the 0–1000 grid' },
            to_y: { type: 'number', description: 'End y on the 0–1000 grid' },
            durationMillis: { type: 'number', description: 'How long the drag takes, 100 to 3000 ms (default 500); slower for drag-and-drop' },
          },
          required: ['to_x', 'to_y'],
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          const start = this.gridPoint(args.idx, args.from_x, args.from_y);
          if (!start) return { content: [{ type: 'text', text: 'Give idx, or from_x and from_y, for where the drag starts.' }], isError: true };
          const end = { x: Number(args.to_x), y: Number(args.to_y) };
          const w = this.screen?.size.width ?? 1080;
          const h = this.screen?.size.height ?? 2400;
          const steps = 8;
          const points = Array.from({ length: steps + 1 }, (_, i) => ({
            x: toPixels(start.x + ((end.x - start.x) * i) / steps, w),
            y: toPixels(start.y + ((end.y - start.y) * i) / steps, h),
          }));
          const duration = Math.max(100, Math.min(3000, Math.round(Number(args.durationMillis) || 500)));
          return this.runDeviceAction({ type: 'Gesture', strokes: [{ points, durationMillis: duration }] }, 'drag', args);
        },
      },
      {
        name: 'double_tap',
        description: 'Tap twice quickly on one spot: like a photo or video (Instagram), zoom in on a map or an image. Give idx or x and y on the 0–1000 grid.',
        parameters: {
          type: 'object',
          properties: {
            idx: { type: 'string', description: 'Element from the screen list' },
            x: { type: 'number', description: 'x on the 0–1000 grid' },
            y: { type: 'number', description: 'y on the 0–1000 grid' },
          },
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          const at = this.gridPoint(args.idx, args.x, args.y);
          if (!at) return { content: [{ type: 'text', text: 'Give idx, or x and y, for where to double tap.' }], isError: true };
          const p = { x: toPixels(at.x, this.screen?.size.width ?? 1080), y: toPixels(at.y, this.screen?.size.height ?? 2400) };
          return this.runDeviceAction(
            { type: 'Gesture', strokes: [{ points: [p], startMillis: 0, durationMillis: 60 }, { points: [p], startMillis: 160, durationMillis: 60 }] },
            'double_tap',
            args,
          );
        },
      },
      {
        name: 'pinch',
        description: 'Two-finger pinch around a point: OUT zooms in (fingers spread), IN zooms out. For maps, photos and documents. Point on the 0–1000 grid (default the middle).',
        parameters: {
          type: 'object',
          properties: {
            direction: { type: 'string', enum: ['IN', 'OUT'], description: 'OUT = zoom in, IN = zoom out' },
            x: { type: 'number', description: 'Centre x on the 0–1000 grid (default 500)' },
            y: { type: 'number', description: 'Centre y on the 0–1000 grid (default 500)' },
          },
          required: ['direction'],
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          const w = this.screen?.size.width ?? 1080;
          const h = this.screen?.size.height ?? 2400;
          const cx = toPixels(typeof args.x === 'number' ? args.x : 500, w);
          const cy = toPixels(typeof args.y === 'number' ? args.y : 500, h);
          const near = Math.round(w * 0.06);
          const far = Math.round(w * 0.3);
          const [a, b] = args.direction === 'IN' ? [far, near] : [near, far];
          const finger = (sign: number) => ({ points: [{ x: cx + sign * a, y: cy + sign * a }, { x: cx + sign * b, y: cy + sign * b }], durationMillis: 450 });
          return this.runDeviceAction({ type: 'Gesture', strokes: [finger(-1), finger(1)] }, 'pinch', args);
        },
      },
      {
        name: 'notification_action',
        description:
          'Use a notification from read_notifications by its key: press one of its buttons (button = its number, e.g. "Mark as read"), reply inline (button of a reply button plus reply_text), or open it (no button).',
        parameters: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'The notification key from read_notifications' },
            button: { type: 'number', description: 'Button number from read_notifications; leave out to open the notification' },
            reply_text: { type: 'string', description: 'Text to send with a reply button' },
          },
          required: ['key'],
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          return this.runDeviceAction(
            {
              type: 'NotificationAction',
              key: String(args.key ?? ''),
              actionIndex: typeof args.button === 'number' ? args.button : undefined,
              replyText: typeof args.reply_text === 'string' ? args.reply_text : undefined,
            },
            'notification_action',
            args,
          );
        },
      },
      {
        name: 'dismiss_notification',
        description: 'Clear one notification by its key from read_notifications.',
        parameters: {
          type: 'object',
          properties: { key: { type: 'string', description: 'The notification key' } },
          required: ['key'],
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          return this.runDeviceAction({ type: 'DismissNotification', key: String(args.key ?? '') }, 'dismiss_notification', args);
        },
      },
      {
        name: 'list_downloads',
        description: "List the newest files in the phone's Download folder (name, size, date).",
        parameters: {
          type: 'object',
          properties: { limit: { type: 'number', description: 'How many, 1 to 100 (default 20)' } },
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          return this.runDeviceAction({ type: 'ListDownloads', limit: typeof args.limit === 'number' ? args.limit : undefined }, 'list_downloads', args);
        },
      },
      {
        name: 'upload_file',
        description:
          "Send a file from the phone to the user (it appears under Android Devices → Files from phones): a file from the Download folder by name, the newest download, or a full-size screenshot of the screen now. Up to 50 MB.",
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'File name in the Download folder (from list_downloads)' },
            latest: { type: 'boolean', description: 'The newest file in Download' },
            screenshot: { type: 'boolean', description: 'A full-size screenshot of the screen now' },
          },
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          return this.runDeviceAction(
            { type: 'UploadFile', name: typeof args.name === 'string' ? args.name : undefined, latest: args.latest === true, screenshot: args.screenshot === true },
            'upload_file',
            args,
          );
        },
      },
      {
        name: 'list_apps',
        description:
          'List every launchable app on the device with its package name. Use this before open_app when unsure of the exact package, instead of going to the home screen and reading icon labels.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          return this.runDeviceAction({ type: 'ListApps' }, 'list_apps', args);
        },
      },
      {
        name: 'install_app',
        description:
          'Install an app from the Google Play Store and CHECK that it is really installed. Pass the package name (e.g. "com.whatsapp"; if unsure, find it first with open_url on a web search). Opens the app\'s Play Store page directly, taps Install, and waits until the phone reports the app installed (up to 3 minutes). Always use this for "install X" instead of searching the Play Store by hand. If it says the download is still running, call it again to keep waiting. Paid apps and sign-in or payment screens are handed back to you — never buy anything.',
        parameters: {
          type: 'object',
          properties: {
            packageName: { type: 'string', description: 'The app\'s package name, e.g. "com.whatsapp"' },
            appName: { type: 'string', description: 'The app\'s name as the user said it (for messages only)' },
          },
          required: ['packageName'],
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => this.installApp(String(args.packageName ?? '').trim(), args),
      },
      {
        name: 'set_clipboard',
        description:
          'Put text on the device clipboard, then use paste to drop it into a focused field. Faster than set_text for long text, and it works in fields that refuse set_text.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text to copy' },
          },
          required: ['text'],
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          return this.runDeviceAction(
            { type: 'SetClipboard', text: String(args.text || '') },
            'set_clipboard',
            args,
          );
        },
      },
      {
        name: 'paste',
        description: 'Paste the clipboard into the field that currently has focus. Call set_clipboard first.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          return this.runDeviceAction({ type: 'Paste' }, 'paste', args);
        },
      },
      {
        name: 'use_vector_keyboard',
        description:
          "Make the Vector Keyboard the phone's active keyboard (on: true), or go back to the phone's usual keyboard (on: false). type_text already switches to it by itself when a field refuses text, so call this only when the task asks for the Vector Keyboard.",
        parameters: {
          type: 'object',
          properties: { on: { type: 'boolean', description: 'true: Vector Keyboard; false: the usual keyboard' } },
          required: ['on'],
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          const on = args.on !== false;
          const state = this.gatewayService.vectorKeyboard?.(this.hardwareDeviceId) ?? null;
          const refuse = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true });
          if (!state) return refuse('This phone runs a Vector app without the Vector Keyboard. It needs the updated Vector app; tell the user.');
          if (on && state === 'active') return { content: [{ type: 'text', text: 'The Vector Keyboard is already the active keyboard.' }], isError: false };
          if (on && state === 'off') {
            return refuse('The Vector Keyboard is not switched on on this phone. It has to be enabled once from the Vector app setup (Enable Vector Keyboard); tell the user.');
          }
          const result = await this.runDeviceAction({ type: 'SetKeyboard', keyboard: on ? 'VECTOR' : 'DEFAULT' }, 'use_vector_keyboard', args);
          if (!result.isError) this.gatewayService.keyboardSwitched?.(this.hardwareDeviceId, on);
          return result;
        },
      },
      {
        name: 'read_clipboard',
        description:
          'Read the current text on the device clipboard. Use this after copying something in one app (a code, a link, a reference number) to carry it into another, or to confirm what set_clipboard put there.',
        parameters: { type: 'object', properties: {}, additionalProperties: false },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          return this.runDeviceAction({ type: 'ReadClipboard' }, 'read_clipboard', args);
        },
      },
      {
        name: 'open_settings',
        description:
          'Open a Settings screen directly. Always prefer this over launching the Settings app and navigating: manufacturers nest and rename these pages differently, so navigating costs several steps and often fails, while this lands on the same screen on every phone.',
        parameters: {
          type: 'object',
          properties: {
            screen: {
              type: 'string',
              enum: [
                'DATE_TIME', 'LANGUAGE', 'WIFI', 'MOBILE_NETWORK', 'DISPLAY', 'SOUND',
                'LOCATION', 'BATTERY', 'STORAGE', 'APPS', 'ACCESSIBILITY', 'DEVELOPER',
                'ABOUT', 'SECURITY', 'LOCK_SCREEN', 'ROOT',
              ],
              description: 'DATE_TIME for time and timezone, LANGUAGE for language and region, SECURITY for the security page, LOCK_SCREEN for screen lock and PIN, ROOT for the Settings home page',
            },
          },
          required: ['screen'],
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          this.actionHistory = [];
          return this.runDeviceAction(
            { type: 'OpenSettings', screen: args.screen as any },
            'open_settings',
            args,
          );
        },
      },
      {
        name: 'open_intent',
        description:
          'Do a common job in one step by Android intent instead of tapping through screens: VIEW a link or app page (market://details?id=PKG for its Play Store page, geo:0,0?q=PLACE for maps), SENDTO mailto:ADDR or smsto:NUMBER to start an email or text (extras subject, body), SEND to share text (extras text; packageName picks the app), DIAL tel:NUMBER, WEB_SEARCH (extras query). The result says which app opened; if nothing handles it, do it through the screens.',
        parameters: {
          type: 'object',
          properties: {
            action: { type: 'string', description: 'VIEW, SENDTO, SEND, DIAL, WEB_SEARCH, or a full android.intent.action.* / android.settings.* name' },
            data: { type: 'string', description: 'URI, e.g. "mailto:a@b.com", "smsto:+441234", "tel:+441234", "geo:0,0?q=Big Ben", "market://details?id=com.whatsapp"' },
            packageName: { type: 'string', description: 'Optional app to handle it, e.g. "com.whatsapp"' },
            extras: {
              type: 'object',
              description: 'Optional text extras: subject, body, text, query (other keys are passed as given)',
              additionalProperties: { type: 'string' },
            },
          },
          required: ['action'],
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          const intent = intentFor(args);
          if ('error' in intent) return { content: [{ type: 'text', text: intent.error }], isError: true };
          this.actionHistory = [];
          return this.runDeviceAction(intent, 'open_intent', args);
        },
      },
      {
        name: 'open_app_info',
        description:
          "Open an app's own info page in Settings (Force stop, Storage and cache, Permissions, Enable for a disabled app). Use for \"force stop X\", \"clear X's cache\", or to enable a disabled app.",
        parameters: {
          type: 'object',
          properties: { packageName: { type: 'string', description: 'e.g. "com.android.chrome"' } },
          required: ['packageName'],
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          const pkg = String(args.packageName ?? '').trim();
          if (!/^[a-zA-Z][\w]*(\.[\w]+)+$/.test(pkg)) return { content: [{ type: 'text', text: 'packageName must be a package like com.android.chrome (see list_apps).' }], isError: true };
          this.actionHistory = [];
          return this.runDeviceAction({ type: 'OpenIntent', action: 'android.settings.APPLICATION_DETAILS_SETTINGS', data: `package:${pkg}` }, 'open_app_info', args);
        },
      },
      {
        name: 'read_notifications',
        description:
          'Read notifications the phone has received. Use this for one-time codes, delivery alerts, or to check whether a message arrived. With Notification access on (companion 0.32) it lists everything in the shade, each with a key and its buttons for notification_action; otherwise only notifications posted since the Vector app started.',
        parameters: {
          type: 'object',
          properties: {
            packageName: { type: 'string', description: 'Optional package to filter by, e.g. com.google.android.apps.messaging' },
            limit: { type: 'number', description: 'How many to return, 1 to 50 (default 20)' },
          },
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          return this.runDeviceAction(
            {
              type: 'ReadNotifications',
              packageName: args.packageName as string | undefined,
              limit: typeof args.limit === 'number' ? args.limit : undefined,
            },
            'read_notifications',
            args,
          );
        },
      },
      {
        name: 'wait_for_element',
        description: 'Wait until a UI element appears instead of guessing a fixed loading delay.',
        parameters: {
          type: 'object',
          properties: {
            nodePath: { type: 'string', description: 'Optional node path from the latest UI snapshot' },
            viewId: { type: 'string', description: 'Optional stable resource ID' },
            text: { type: 'string', description: 'Optional visible text or content description' },
            timeoutMillis: { type: 'number', description: 'Maximum wait, from 250 to 15000 ms (default: 8000)' },
          },
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          if (!args.nodePath && !args.viewId && !args.text) {
            return {
              content: [{ type: 'text', text: 'wait_for_element requires nodePath, viewId, or text' }],
              isError: true,
            };
          }
          // Long waits (an app download, a slow page) go to the phone in 10 s
          // pieces, so one wait can cover a whole install without the phone
          // holding a single request open for minutes.
          const total = Math.min(Math.max(Number(args.timeoutMillis) || 8000, 1000), 120_000);
          const started = Date.now();
          let result: ToolResult | null = null;
          do {
            const slice = Math.min(10_000, total - (Date.now() - started));
            result = await this.runDeviceAction(
              {
                type: 'WaitForNode',
                nodePath: args.nodePath as string | undefined,
                viewId: args.viewId as string | undefined,
                text: args.text as string | undefined,
                timeoutMillis: Math.max(slice, 1000),
              },
              'wait_for_element',
              args,
            );
          } while (result.isError && Date.now() - started < total - 1000);
          return result;
        },
      },
      {
        name: 'wait',
        description:
          'Wait until the screen stops changing (a page or app still loading), up to durationMillis, and get the settled screen back. It returns as soon as the screen is still, so there is no need to guess a length. To wait for something specific (a download finishing, a button appearing) use wait_for_element with that text instead.',
        parameters: {
          type: 'object',
          properties: {
            durationMillis: { type: 'number', description: 'Longest to wait in milliseconds (default 4000, max 15000)' },
          },
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          return this.runDeviceAction(
            {
              type: 'Wait',
              durationMillis: args.durationMillis ? Number(args.durationMillis) : 4000,
            },
            'wait',
            args,
          );
        },
      },
    ];

    // Every tool's result says whether the AI saw the screen as an image on
    // this step (screenSight.ts); the run records it per step.
    for (const tool of tools) {
      const run = tool.execute.bind(tool);
      tool.execute = async (...args: Parameters<typeof run>) => {
        const result = await run(...args);
        this.sight = sightOfResult(result as never, {
          vision: Boolean(this.options.vision),
          grounder: Boolean(this.options.grounder),
          screenshots: this.options.screenshots,
          hasFrame: Boolean(this.lastScreenshotBase64),
        });
        return result;
      };
    }

    super({
      name: 'AndroidAgent',
      description: 'An expert AI agent that inspects and interacts with an Android mobile device to accomplish user tasks step-by-step.',
      // A model that cannot see images gets no screenshot tool at all.
      // No screenshot tool for a model that cannot see images, or when the
      // account turned screenshots off (off means none at all).
      tools: tools.filter(
        (tool) =>
          (tool.name !== 'capture_screen' || (options.vision && options.screenshots !== 'off')) &&
          // Only phones whose companion can start intents (0.30+) get these; an older build drops the action.
          ((tool.name !== 'open_intent' && tool.name !== 'open_app_info') || Boolean(gatewayService.hasFeature?.(hardwareDeviceId, 'intent'))) &&
          (tool.name !== 'scroll_until' || Boolean(gatewayService.hasFeature?.(hardwareDeviceId, 'scroll_until'))) &&
          // Companion 0.32 tools, only for builds that have them.
          (!['drag', 'double_tap', 'pinch'].includes(tool.name) || Boolean(gatewayService.hasFeature?.(hardwareDeviceId, 'gesture'))) &&
          (!['notification_action', 'dismiss_notification'].includes(tool.name) || Boolean(gatewayService.hasFeature?.(hardwareDeviceId, 'notif_actions'))) &&
          (!['list_downloads', 'upload_file'].includes(tool.name) || Boolean(gatewayService.hasFeature?.(hardwareDeviceId, 'upload'))),
      ),
      // The backup model (when the account set one) takes over if the main one fails.
      llms: ['default', 'fallback'],
    });
  }

  /**
   * Runs before every model call. Eko's default trims images and multi-part
   * results; ours also drops every screen dump but the newest, which is what
   * kept input around 100k tokens per step on ordinary tasks.
   */
  protected async handleMessages(
    agentContext: AgentContext,
    messages: Parameters<Agent['handleMessages']>[1],
    tools: Tool[],
  ): Promise<void> {
    await super.handleMessages(agentContext, messages, tools);
    pruneStaleScreens(messages as unknown as Parameters<typeof pruneStaleScreens>[0]);
    keepOnlyFreshImage(messages as unknown as Parameters<typeof keepOnlyFreshImage>[0], Boolean(this.options.vision));
  }

  /**
   * Whether a screenshot may reach the AI at all. "Off" in Settings means
   * never: no thin-screen image, no stuck look, no vision helper, no
   * capture_screen (Oct 7: "Off" still sent images on unreadable screens).
   */
  private get imagesToAi(): boolean {
    return Boolean(this.options.vision) && this.options.screenshots !== 'off';
  }

  private get screenReader(): ScreenGrounder | undefined {
    return this.options.screenshots === 'off' ? undefined : this.options.grounder;
  }

  /**
   * The prompt this agent runs with; the Vector engine sends the same one.
   * withFacts=false leaves out this phone's network and locale facts (Lite
   * sends them after the task instead, so every phone shares one cached prompt).
   */
  async systemPrompt(options: { withFacts?: boolean } = {}): Promise<string> {
    if (this.compactText) return compactSystemPrompt(this.screenshotMode());
    if (options.withFacts === false) return this.baseSystemPrompt() + this.screenshotRule();
    return this.buildSystemPrompt();
  }

  /** Which screenshot rule applies: images reach the AI, are switched off, or the model cannot see them. */
  private screenshotMode(): 'on' | 'off' | 'blind' {
    return this.imagesToAi ? 'on' : this.options.vision ? 'off' : 'blind';
  }

  /**
   * What this phone last reported about its network and locale, as sent to the
   * model: a task that only asks for its IP, DNS, language or timezone is
   * answered from here. Null when there are none.
   */
  deviceFactsText(): string | null {
    const facts = this.options.deviceFacts;
    if (!facts) return null;
    return `THIS PHONE (read by the phone itself, ${facts.split('\n')[0]}):\n${facts.split('\n').slice(1).join('\n')}\nIf the task only asks for any of these (IP, proxy, DNS, language, region, timezone, time), answer from this and finish at once — do not open Settings or a website for it.`;
  }

  /**
   * Reads the screen for a system check (verification, an unconfirmed action)
   * without it counting as an agent step. Returns the element list in the same
   * format the model sees.
   */
  async observeForCheck(): Promise<{ packageName: string | null; tree: string } | null> {
    const res = await this.observe();
    if (res.status !== 'SUCCESS' || !res.uiTree) return null;
    this.absorb(res);
    const packageName = this.lastForegroundApp;
    return { packageName: packageName && packageName !== 'unknown' ? packageName : null, tree: this.lastUiTree ?? '' };
  }

  /**
   * For flow replay (no model): read the screen and clear known popups by
   * rule, without screenshots, a vision helper or a step being counted.
   */
  async observeForReplay(): Promise<{ packageName: string | null; tree: string | null; key: string } | null> {
    const res = await this.observe();
    if (res.status !== 'SUCCESS' || !res.uiTree) return null;
    this.absorb(res);
    await this.clearObstacles();
    const packageName = this.lastForegroundApp && this.lastForegroundApp !== 'unknown' ? this.lastForegroundApp : null;
    return { packageName, tree: this.lastUiTree, key: this.currentKey() };
  }

  /** An idx from the current screen list that the model put in viewId or nodePath (real ones contain ":" or "/"). */
  private idxInSelector(args: Record<string, unknown>): string | null {
    for (const value of [args.viewId, args.nodePath]) {
      const v = typeof value === 'string' ? value.trim() : '';
      if (/^v?\d+$/.test(v) && this.screen?.elements.some((e) => e.idx === v)) return v;
    }
    return null;
  }

  /** The single element on screen whose label matches text once case, quotes and spacing are ignored. */
  private uniqueLabelMatch(text: string): { idx: string; label: string } | null {
    const norm = (t: string) =>
      t
        .normalize('NFKC')
        .replace(/[\u2018\u2019\u201B\u2032`´]/g, "'")
        .replace(/[\u201C\u201D\u2033]/g, '"')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
    const want = norm(text);
    if (want.length < 2) return null;
    const elements = (this.screen?.elements ?? []).filter((e) => e.label && !e.disabled);
    const exact = elements.filter((e) => norm(e.label) === want);
    const pick = exact.length ? exact : elements.filter((e) => norm(e.label).startsWith(want) && (e.tappable || e.editable));
    return pick.length === 1 ? { idx: pick[0].idx, label: pick[0].label } : null;
  }

  private withNote(result: ToolResult, note: string): ToolResult {
    const content = [...(result.content ?? [])];
    const first = content.findIndex((c) => c.type === 'text');
    if (first >= 0) content[first] = { ...content[first], text: `${(content[first] as { text: string }).text}\n\n${note}` } as never;
    else content.unshift({ type: 'text', text: note });
    return { ...result, content } as ToolResult;
  }

  /** Runs one of the agent's own tools, exactly as the model would call it (flow replay). */
  async runTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = (this as unknown as { tools: Tool[] }).tools.find((t) => t.name === name);
    if (!tool) return { content: [{ type: 'text', text: `No tool ${name}` }], isError: true };
    return tool.execute(args, {} as AgentContext, {} as never);
  }

  /** The phone's launchable apps as "Label | package" text (ListApps). */
  async launcherAppsText(): Promise<string> {
    const res = await this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'ListApps' });
    return res.status === 'SUCCESS' ? res.summary ?? '' : '';
  }

  protected async buildSystemPrompt(): Promise<string> {
    const facts = this.deviceFactsText();
    return this.baseSystemPrompt() + this.screenshotRule() + (facts ? `\n\n${facts}` : '');
  }

  private screenshotRule(): string {
    return this.imagesToAi
      ? '\n\nSCREENSHOTS: capture_screen shows you the screen as an image. It is expensive; use it only when the element list cannot describe what you need.'
      : this.options.vision
        ? '\n\nSCREENSHOTS: screenshots are off for this account, so there is no screenshot tool and you never see the screen as an image. Everything you know about the screen comes from the element list in each result — never plan to "take a screenshot".'
        : '\n\nSCREENSHOTS: this model cannot see images, so there is no screenshot tool. Everything you know about the screen comes from the element list in each result — never plan to "take a screenshot".';
  }

  private baseSystemPrompt(): string {
    return `You are Vector-Brain, an expert autonomous AI agent controlling an Android mobile device.
Your goal is to accomplish the user's task step-by-step using available tools.

WORKFLOW:
1. Call read_ui_tree ONLY on your very first turn or after global_action/open_app/open_url.
   Every other action's result already includes "UPDATED SCREEN ELEMENTS" — use that
   directly instead of calling read_ui_tree again. Redundant read_ui_tree calls waste
   time and steps.
2. To tap, use tap_element with the element's idx from the latest screen list (or
   click_node with its exact visible text). Use tap_coordinate only for a point the
   list does not name.
3. For text input: tap the input field (tap_element), then type_text.
4. Use open_app to launch apps, open_url to open websites directly. To install an
   app use install_app with its package name — it opens the Play Store page, taps
   Install and checks the app is really on the phone.
5. To scroll, use scroll_element with direction FORWARD to move down a list and
   BACKWARD to move back up. Fall back to swipe only when scroll_element says
   nothing is scrollable, or for horizontal carousels.
6. Use global_action BACK to go back to previous screen.
7. When something is loading, use wait (it returns as soon as the screen is still)
   or wait_for_element with the text you expect.

CRITICAL RULES:
- Only tap what is on the CURRENT screen list. Never reuse coordinates from memory,
  an earlier screen or another phone; positions change between screens and phones.
- After every action, check its result. If it says the screen did not change, do NOT
  repeat the same tap — try click_node, another element, scroll_element or BACK.
- A button can change after you tap it (Install becomes Cancel, Follow becomes
  Unfollow). Never tap the same spot again to "confirm"; wait for the next state
  instead (for an app install: wait_for_element "Open", timeoutMillis 120000).
- Avoid scrolling in the same direction more than 7 times in a row, counting
  scroll_element and swipe together - if content still isn't found, try a
  different approach instead of scrolling further.
- After typing text, submit it (press_key ENTER, or tap the Search/Go button).
- open_url reuses the current browser tab by default. Only pass newTab: true when
  the user explicitly asked for separate tabs or to compare pages side by side;
  visiting many sites "one by one" should stay in a single tab.
- Visiting several websites: a page counts as visited once it has opened. If a site's
  cookie or consent pop-up does not close after 2 tries, leave it and open the next
  site; do not spend more steps on it (Oct 11: two runs spent 15+ steps on one banner).
- Signing in: use the account already signed in on THIS phone. On an account chooser pick
  the account it lists ("Continue as …"). Never tap "Add another account" / "Use another
  account" and never type an email or password unless the task itself gives that exact
  email or password. A wrong password, a code, "Verify it's you" or account recovery is a
  blocker: never use "Try another way" or "Forgot password"; call task_done success=false
  and say the user has to sign in on this phone.
- For research tasks: visit multiple sources, read content from each, summarize at the end.
- Only mark task complete when ALL requested information has been collected.
- Lines starting "AUTO-CLEARED:" mean the system already dismissed a popup (a
  permission request, "rate this app", an update prompt, a network retry). Do not
  go looking for it; carry on from the screen shown.
- task_snapshot is requested by the framework, not by the user. When it is asked
  for, answer it briefly and move on; never call it yourself as a checkpoint.
- If you already have enough information to answer the user's question, STOP
  and give the answer immediately instead of gathering more.
SCREEN LIST FORMAT:
idx|type|label|flags|tap_at — one row per element. flags: t=tappable, e=editable,
d=disabled. tap_at is x,y on a 0–1000 grid over the current screen (500,500 is the
middle), the same scale tap_coordinate takes. Example: 5|input|Search Google|te|500,190
→ tap_element idx "5". A tappable row's label includes the text shown inside it.`;
  }

  /**
   * Types through the Vector Keyboard after accessibility SetText was refused,
   * switching to it first if it is enabled but not the current keyboard.
   * result is set only when the keyboard typed the text; note explains what
   * happened otherwise, so the model does not try paste or key taps blindly.
   */
  /**
   * What the field shows after typing. Web forms run their own scripts and the
   * keyboard can slip a suggestion in: Blogger's address box read "iderlustjourneys742 by"
   * after typing "wanderlustjourneys742" (Oct 12, 17 tries). When it differs, the field is
   * cleared and the text put in another way (the Vector Keyboard, else the clipboard),
   * and the result says what the field shows now.
   */
  private async checkTyped(typed: string, result: ToolResult): Promise<ToolResult> {
    const shown = () => focusedFieldText(this.screen);
    const first = shown();
    if (first === null || sameTyped(first, typed)) return result;
    const key = typed.replace(/\s+/g, ' ').trim().toLowerCase();
    const before = this.typedMisses.get(key);
    const times = (before?.times ?? 0) + 1;
    // The same value, the same field result as last time: saying so is what breaks the loop.
    const again =
      before && before.shown === first
        ? `\n\nTYPED AGAIN: this exact text has now been typed ${times} times and the field showed "${cutText(first, 60)}" every time. Typing it again will not change that: use a different value, or say what blocks you.`
        : '';
    // A field with a length limit keeps the start (Blogger's address box: 16 typed, 15 kept, Oct 12).
    const kept = fieldKept(first, typed);
    if (kept !== null) {
      this.typedMisses.set(key, { times, shown: first });
      const note = `FIELD LIMIT: this field holds at most ${kept} characters. It kept "${cutText(first, 60)}" and dropped "${cutText(typed.trim().slice(kept), 40)}". Typing the same value again keeps the same ${kept}. Pick a value of ${kept} characters or fewer (shorten it sensibly, e.g. drop words or digits), then type that.`;
      return this.withNote(result, `${note}${again}`);
    }
    let how = '';
    const viaKeyboard = await this.typeWithVectorKeyboard(typed);
    if (viaKeyboard.result) how = 'with the Vector Keyboard';
    else {
      const clip = await this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'SetClipboard', text: typed });
      if (clip.status === 'SUCCESS') {
        await this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'PressKey', key: 'CLEAR' });
        const pasted = await this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'Paste' });
        if (pasted.status === 'SUCCESS') how = 'by pasting it';
      }
    }
    this.absorb(await this.observe());
    const now = shown();
    const fixed = now !== null && sameTyped(now, typed);
    if (fixed) this.typedMisses.delete(key);
    else this.typedMisses.set(key, { times, shown: first });
    const note = fixed
      ? `\n\nTYPED CHECK: the field first showed "${cutText(first, 60)}" (not what was typed), so it was cleared and the text put in ${how}. It now shows "${cutText(now ?? '', 60)}".`
      : `\n\nTYPED CHECK: the field shows "${cutText(now ?? first, 60)}", not "${cutText(typed, 60)}"${how ? ` (retried ${how})` : ''}. Do not type pieces to patch it: press_key CLEAR, then type the whole value once.`;
    return this.withNote(result, `${note.trim()}${fixed ? '' : again}${this.lastUiTree ? `\n\nUPDATED SCREEN ELEMENTS:\n${this.lastUiTree}` : ''}`);
  }

  private async typeWithVectorKeyboard(text: string): Promise<{ result?: ActionResult; note: string }> {
    const state = this.gatewayService.vectorKeyboard?.(this.hardwareDeviceId) ?? null;
    if (!state) return { note: '' };
    if (state === 'off') {
      return { note: 'The Vector Keyboard would type this, but it is not switched on on this phone: it has to be enabled once in the Vector app setup (Enable Vector Keyboard). Tell the user instead of trying other ways.' };
    }
    if (state === 'enabled') {
      const switched = await this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'SetKeyboard', keyboard: 'VECTOR' });
      if (switched.status !== 'SUCCESS') {
        return { note: `Could not switch to the Vector Keyboard (${switched.status === 'FAILURE' ? switched.message : 'cancelled'}).` };
      }
      this.gatewayService.keyboardSwitched?.(this.hardwareDeviceId, true);
    }
    const typed = await this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'KeyboardType', text, replace: true });
    if (typed.status === 'SUCCESS') return { result: { ...typed, summary: `Typed with the Vector Keyboard (the field refused direct text): ${typed.summary}` }, note: '' };
    return { note: `The Vector Keyboard could not type it either (${typed.status === 'FAILURE' ? typed.message : 'cancelled'}) — tap the field so it has focus, then type_text again.` };
  }

  private async runDeviceAction(
    action: AutomationAction,
    toolName: string,
    args: Record<string, unknown>,
    tap?: { grid: { x: number; y: number }; px: { x: number; y: number }; label: string },
  ): Promise<ToolResult> {
    const keyBefore = this.currentKey();
    const screenBefore = this.screen;
    const frameBefore = this.frameKey();
    let res: Awaited<ReturnType<AndroidGatewayService['executeAction']>>;
    if (action.type === 'Wait') {
      // Not a blind pause: watch the screen and return once it is still.
      const settled = await this.waitUntilSettled(Number(action.durationMillis) || 4000);
      res = { status: 'SUCCESS', summary: settled.settled ? `Screen settled after ${(settled.ms / 1000).toFixed(1)}s` : `Screen was still changing after ${(settled.ms / 1000).toFixed(1)}s (something is loading or downloading)` } as typeof res;
    } else {
      // Companion 0.31+: the new screen comes back with the result, one round trip instead of two.
      const observeAfter = SCREEN_CHANGING.has(action.type) && Boolean(this.gatewayService.hasFeature?.(this.hardwareDeviceId, 'observe_after'));
      res = observeAfter
        ? await this.gatewayService.executeAction(this.hardwareDeviceId, action, 15000, 'LOW', { observeAfter })
        : await this.gatewayService.executeAction(this.hardwareDeviceId, action);
    }
    const bundled = res;

    // The model guessed a package name that does not exist on this build. Try
    // the known equivalents before handing back a failure — three wasted steps
    // guessing clock package names is what this avoids.
    let launchedPackage = action.type === 'OpenApp' ? String(action.packageName || '') : '';
    let triedAlternatives: string[] = [];
    if (action.type === 'OpenApp' && res.status === 'FAILURE' && res.code === 'APP_NOT_FOUND') {
      triedAlternatives = packageAlternatives(launchedPackage);
      for (const candidate of triedAlternatives) {
        const retry = await this.gatewayService.executeAction(this.hardwareDeviceId, {
          type: 'OpenApp',
          packageName: candidate,
        });
        if (retry.status === 'SUCCESS') {
          res = retry;
          launchedPackage = candidate;
          break;
        }
      }
    }

    // A field that refuses accessibility text (one-time code boxes, PIN pads,
    // custom editors) takes real keyboard input: retry through the Vector
    // Keyboard when this phone has one.
    let keyboardNote = '';
    if (action.type === 'SetText' && res.status === 'FAILURE' && res.code !== 'TIMEOUT' && res.code !== 'ACCESSIBILITY_DISABLED') {
      const viaKeyboard = await this.typeWithVectorKeyboard(action.text);
      if (viaKeyboard.result) res = viaKeyboard.result;
      keyboardNote = viaKeyboard.note;
    }

    let summary =
      res.status === 'SUCCESS'
        ? res.summary
        : res.status === 'FAILURE'
        ? `${res.code}: ${res.message}`
        : 'Action cancelled';
    if (keyboardNote) summary = `${summary} ${keyboardNote}`;
    const isError = res.status !== 'SUCCESS';

    // Say what a coordinate tap actually hit, so a wrong guess is noticed at once.
    if (!isError && toolName === 'tap_coordinate' && tap?.label) {
      summary = `${summary} — the point tapped is "${tap.label.slice(0, 60)}"`;
    }

    if (action.type === 'OpenApp' && !isError && launchedPackage !== String(action.packageName || '')) {
      summary = `${summary} (resolved to ${launchedPackage} on this device)`;
    }

    // Guessing further package names never works — the model has no way to see
    // what is installed. Point it at the one method that does.
    if (action.type === 'OpenApp' && isError && res.status === 'FAILURE' && res.code === 'APP_NOT_FOUND') {
      const alsoTried = triedAlternatives.length > 0 ? ` Also tried: ${triedAlternatives.join(', ')}.` : '';
      // Look it up on the phone instead of letting the model search the launcher for an app
      // that is not there (Oct 11, #3576: 24 steps, ending in a Play Store sign-in).
      const missing = await this.missingApp(String(action.packageName || ''));
      summary =
        missing && !asksToInstall(this.options.task)
          ? `${summary}${alsoTried} ${missing}`
          : `${summary}${alsoTried} Do NOT guess more package names — none of the usual ones exist here. ` +
            'Use global_action HOME, then read_ui_tree to find the app by the name shown under its icon, ' +
            'and open it with click_node instead.';
    }

    // Android refused to bring the app forward from the background. Calling open_app
    // again is refused the same way; the home-screen icon or a link is what works.
    if (action.type === 'OpenApp' && isError && res.status === 'FAILURE' && /from the background/i.test(String(res.message ?? ''))) {
      summary +=
        ' Do not call open_app for it again — it will be blocked the same way. Press HOME (global_action) and tap the app\'s icon, or open its website or a deep link with open_url.';
    }

    // A launch only reports that the intent was dispatched, not that the app is
    // on screen. Observing immediately catches the old screen, so the model is
    // told "opened" while still looking at the launcher and wastes several
    // steps hunting for the icon. Give the app time to come to the front and
    // report what actually happened.
    if (!isError && (action.type === 'OpenApp' || action.type === 'OpenUrl')) {
      const wanted = action.type === 'OpenApp' ? launchedPackage : '';
      const settled = await this.waitForForeground(wanted);
      if (wanted) {
        summary = settled
          ? `${summary} (now in the foreground)`
          : `Launch was dispatched for ${wanted}, but it is not in the foreground yet` +
            `${this.lastForegroundApp ? ` — the current app is ${this.lastForegroundApp}` : ''}.` +
            ' Wait a moment and read the screen again before trying another approach.';
      }
    }

    // Track consecutive failures
    if (isError) {
      if (toolName === this.lastFailedAction) {
        this.consecutiveFailures++;
      } else {
        this.consecutiveFailures = 1;
        this.lastFailedAction = toolName;
      }
    } else {
      this.consecutiveFailures = 0;
      this.lastFailedAction = '';
    }

        // Automatically capture updated screen frame and UI tree after each interaction.
    // Skip for pure wait actions — the screen state is captured by the next real action.
    if (action.type === 'Wait') {
      this.consecutiveWaits += 1;
    } else {
      this.consecutiveWaits = 0;
    }

    // Waits normally skip observation to save a round-trip. But once the model
    // waits twice in a row it has stopped being able to tell what is on screen,
    // so refresh properly instead of handing back the same stale tree.
    // A wait has already watched the screen until it settled.
    const skipObservation = action.type === 'Wait';
    let freshShot: string | undefined;
    try {
      if (skipObservation) throw new Error('skip');
      // The screen already came with the action's result (and no fallback action ran since): use it.
      const observation = res === bundled && res.status === 'SUCCESS' && res.uiTree ? res : await this.observe();
      this.absorb(observation);
      freshShot = observation.status === 'SUCCESS' ? observation.screenCapture?.base64Data : undefined;
    } catch {
      // Best-effort post-action snapshot
    }

    // Did the action do anything? Checked against the phone, not the model's word.
    const keyAfter = this.currentKey();
    const meantToChange = ['Tap', 'ClickNode', 'LongPress'].includes(action.type);
    let checkNote = '';
    if (!isError && MOVES_ON.has(action.type)) this.moves += 1;
    const toggle = Boolean(tap && TOGGLE.test(tap.label.trim()));
    const frameAfter = this.frameKey();
    // Companion 0.30+ reports a button's on/off state: what changed is then known, not guessed.
    const stateBefore = tap ? stateWords(elementAt(screenBefore, tap.grid.x, tap.grid.y)) : null;
    const stateAfter = tap ? stateWords(elementAt(this.screen, tap.grid.x, tap.grid.y)) : null;
    const sameSpot = Boolean(tap && sameButton(screenBefore, this.screen, tap.grid, tap.label));
    const stateKnown = Boolean(stateBefore && stateAfter && sameSpot);
    // Apps that keep the label ("Like") often announce the change instead: "Liked", "Unliked".
    const announced = tap && toggle && !isError ? announcedToggle(this.lastEvents) : null;
    if (!isError && toggle && tap && !(stateKnown && stateBefore === stateAfter)) this.lastToggle = { grid: tap.grid, label: tap.label.trim(), moves: this.moves };
    if (!isError && meantToChange && toggle && tap && announced?.on === false) {
      // The tap took it away: it was already on. Not counted, and putting it back is not refused.
      this.lastToggle = null;
      // Counted back: the like this tap removed no longer counts (Oct 11, #3718 trusted a tally of 9).
      summary = `${summary}\nUNTOGGLED: "${tap.label.trim().slice(0, 30)}"`;
      checkNote = `\n\nCHECK: the phone announced "${announced.text}", so this tap turned "${tap.label.trim().slice(0, 30)}" OFF (it was already on). Tap it once more to turn it back on, then move on.`;
    } else if (!isError && meantToChange && toggle && tap && announced?.on && !(stateKnown && stateBefore !== stateAfter)) {
      summary = `${summary}\nTOGGLED: "${tap.label.trim().slice(0, 30)}"\nSTATE: "${tap.label.trim().slice(0, 30)}" → on (the phone announced "${announced.text}")`;
      checkNote = `\n\nNOTE: the phone announced "${announced.text}": it is done. Do NOT tap it again here (that undoes it). Move on to the next item.`;
    } else if (!isError && meantToChange && toggle && tap && stateKnown && stateBefore === stateAfter) {
      // The phone says the button is as it was: the tap missed. Not counted, and a retry is not refused.
      checkNote = `\n\nCHECK: "${tap.label.trim().slice(0, 30)}" is still ${stateAfter} (the phone reports it), so this tap did not register. Tap it once more, or use click_node with its text.`;
    } else if (!isError && meantToChange && toggle && tap && stateKnown) {
      summary = `${summary}\nTOGGLED: "${tap.label.trim().slice(0, 30)}"\nSTATE: "${tap.label.trim().slice(0, 30)}" ${stateBefore} → ${stateAfter}`;
      checkNote = `\n\nNOTE: the phone reports "${tap.label.trim().slice(0, 30)}" is now ${stateAfter}. It is done; do NOT tap it again here (that undoes it). Move on to the next item.`;
    } else if (!isError && meantToChange && toggle && tap && (keyAfter === keyBefore || sameSpot)) {
      // Like, Save, heart…: many apps change only the icon, never the label, so the
      // list looks the same after a tap that worked. Saying "did NOT change" here
      // made agents tap again and undo it (Oct 10, mission 256: 15 of 15 runs).
      summary = `${summary}\nTOGGLED: "${tap.label.trim().slice(0, 30)}"`;
      checkNote = `\n\nNOTE: "${tap.label.trim().slice(0, 30)}" is a toggle; apps often change only its icon, so the list looks the same. Count it as done and do NOT tap it again here (a second tap undoes it). Move on to the next item.`;
    } else if (!isError && meantToChange && keyAfter === keyBefore && frameBefore && frameAfter && frameBefore !== frameAfter) {
      // The list is the same but the picture is not: something changed that the list does not show.
      checkNote =
        '\n\nNOTE: the element list is the same, but the screen image changed, so the tap probably did something the list does not show (an icon, a colour). Do not repeat it blindly; carry on, and check the result if it matters.';
    } else if (!isError && meantToChange && keyAfter === keyBefore) {
      this.noEffectStreak += 1;
      if (tap) this.noEffect = { grid: tap.grid, key: keyAfter };
      checkNote =
        '\n\nCHECK: the screen did NOT change after this. Do not tap the same spot again. Try a different way: click_node with the visible text, tap_element on the element that holds it, scroll_element to bring it fully on screen, or global_action BACK. If something may still be loading, use wait once.';
    } else if (keyAfter !== keyBefore) {
      this.noEffect = null;
      this.noEffectStreak = 0;
    }
    if (!skipObservation && !isError) {
      this.recentKeys.push(keyAfter);
      if (this.recentKeys.length > 6) this.recentKeys.shift();
    }
    const stuck = isError ? null : this.stuckReason();
    if (tap && !isError) this.lastTap = { grid: tap.grid, label: tap.label, at: Date.now() };
    // The button under the finger turned into something else on the same screen
    // (Follow → Following, Like → Unlike, Subscribe → Subscribed): said in the
    // result in a fixed form, so the system can count it (contextBuilder.countActions).
    if (tap && !isError && meantToChange) {
      const change = buttonChange(screenBefore, this.screen, tap.grid, tap.label);
      if (change) summary = `${summary}\nCHANGED: "${change.from}" → "${change.to}"`;
    }
    // A form's own message next to a field ("This blog address is invalid or not supported").
    if (!isError && ['Tap', 'ClickNode', 'SetText', 'PressKey', 'KeyboardType', 'Paste'].includes(action.type)) {
      for (const message of newFieldMessages(screenBefore, this.screen)) summary = `${summary}\nFIELD MESSAGE: "${cutText(message, 140)}"`;
    }
    // A sign-in it cannot pass: say so once per screen, before it wanders into account recovery
    // (Oct 12, #3857 and #3861: "Wrong password", then "Try another way" for 20 steps).
    const wall = isError ? null : signInWall(this.screen);
    if (wall && !signInWall(screenBefore)) {
      summary = `${summary}\n\nSIGN-IN BLOCKED: the screen says "${cutText(wall, 100)}". Do not try other passwords, "Try another way", "Forgot password" or account recovery, and do not add another account. Call task_done with success=false: the user has to sign in on this phone themselves.`;
    }

    const cleared = isError ? '' : await this.clearObstacles();
    if (cleared) freshShot = undefined;
    // A failed action still says when the phone is blocked (Xiaomi pocket mode).
    const extra = skipObservation ? { note: '' } : isError ? { note: this.sensorNote() } : await this.screenExtras(freshShot, stuck);

    this.callbacks?.onStepExecuted?.({
      toolName,
      args,
      result: summary,
      foregroundApp: this.lastForegroundApp || undefined,
      uiTree: this.lastUiTree || undefined,
      screenshotBase64: this.lastScreenshotBase64 || undefined,
      tapPx: tap && !isError ? tap.px : undefined,
    });

    // Add failure hint if stuck
    const stuckHint = this.consecutiveFailures >= 3
      ? `\n\nWARNING: ${this.consecutiveFailures} consecutive failures. Try a completely different approach - use global_action BACK, click_node with the visible text, a different element, or open_url to navigate directly.`
      : '';

    const phoneSaw = this.phoneSaw;
    this.phoneSaw = '';
    const textPart = {
      type: 'text' as const,
      text: isError
        ? `Action failed: ${summary}${stuckHint}`
        : `Action succeeded: ${summary}${checkNote}${cleared ? `\n\n${cleared.trim()}` : ''}${phoneSaw ? `\n\n${phoneSaw}` : ''}${this.lastForegroundApp ? `\n\nCURRENT APP: ${this.lastForegroundApp}` : ''}${this.lastUiTree ? `\n\nUPDATED SCREEN ELEMENTS:\n${this.lastUiTree}` : ''}${extra.note}`,
    };
    if (extra.image) {
      return { content: [textPart, { type: 'image', data: extra.image, mimeType: 'image/jpeg' }], isError };
    }

    // "Every step" in settings: the frame the phone already sent with this
    // observation goes to the model too. Only the newest image stays in the
    // context, so the cost is one image per call, not a growing pile.
    const everyStepShot = freshShot ?? this.lastScreenshotBase64 ?? undefined;
    if (this.imagesToAi && this.options.screenshots === 'every_step' && !skipObservation && everyStepShot) {
      return { content: [textPart, { type: 'image', data: everyStepShot, mimeType: 'image/jpeg' }], isError };
    }

    // No other automatic screenshot: "When stuck" means stuck (screenExtras), and
    // "Every step" is handled above. (A second wait in a row used to attach one too.)
    return {
      content: [textPart],
      isError,
    };
  }

  /**
   * Poll the screen until a freshly launched app reaches the foreground.
   *
   * `wantedPackage` empty means "just let the screen settle" (used for URL
   * loads, where the browser is already in front). Returns true when the app
   * was confirmed on screen.
   */
  private async waitForForeground(wantedPackage: string): Promise<boolean> {
    const attempts = wantedPackage ? 4 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, LAUNCH_SETTLE_MS));
      try {
        const observation = await this.gatewayService.executeAction(this.hardwareDeviceId, {
          type: 'ObserveScreen',
        });
        if (observation.status !== 'SUCCESS') continue;
        this.absorb(observation);
        if (!wantedPackage) return true;
        if (this.lastForegroundApp && wantedPackage.startsWith(this.lastForegroundApp)) return true;
        if (this.lastForegroundApp && this.lastForegroundApp.startsWith(wantedPackage)) return true;
      } catch {
        // Best-effort: keep polling until the attempts run out.
      }
    }
    return false;
  }

  private detectPackageName(root?: UiNodeSnapshot, defaultPkg = 'unknown'): string {
    if (!root) return defaultPkg;
    let detected = defaultPkg;

    const findViewIdPkg = (node: UiNodeSnapshot) => {
      if (node.viewId && node.viewId.includes(':id/')) {
        const pkgFromId = node.viewId.split(':id/')[0];
        if (pkgFromId && pkgFromId !== 'android' && pkgFromId !== 'dev.tarung.androidautomation') {
          detected = pkgFromId;
          return;
        }
      }
      for (const child of node.children || []) {
        findViewIdPkg(child);
        if (detected !== defaultPkg && detected !== 'dev.tarung.androidautomation') return;
      }
    };

    findViewIdPkg(root);
    return detected;
  }

  /**
   * The screen now. When the phone could not take a screenshot (capture timed
   * out, often on Android 10), the element list alone is still read: without
   * it the agent was blind for that step (Oct 11: 19 times in one day).
   */
  private async observe(): Promise<ActionResult> {
    const res = await this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'ObserveScreen' });
    if (res.status === 'FAILURE' && /frame|captur|screenshot|projection/i.test(res.message)) {
      const tree = await this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'ReadUiTree' });
      if (tree.status === 'SUCCESS' && tree.uiTree) return tree;
    }
    return res;
  }

  /** A fingerprint of the latest frame the phone sent (identical pixels give identical JPEG bytes), or null without one. */
  private frameKey(): string | null {
    return this.lastScreenshotBase64 ? createHash('sha1').update(this.lastScreenshotBase64).digest('hex') : null;
  }

  /** "Has the screen changed": the app in front plus the list as the phone reported it. */
  private currentKey(): string {
    return screenKey(this.lastForegroundApp, this.baseTable ?? this.lastUiTree);
  }

  /**
   * The phone's full screen size, from a window that starts at the top-left
   * corner. A dialog's window is smaller; knowing the full size is how the list
   * can say a pop-up is in front. A turn of the phone (wider than tall, or back)
   * replaces it; a smaller window at the corner (a top sheet) does not.
   */
  private learnFullScreen(root?: UiNodeSnapshot): void {
    if (!root) return;
    const b = root.bounds;
    if (b.left > 0 || b.top > 0) return;
    const width = b.right - b.left;
    const height = b.bottom - b.top;
    if (width < 200 || height < 200) return;
    const known = this.fullScreen;
    const turned = known && width > height !== known.width > known.height;
    if (!known || turned || width * height >= known.width * known.height * 0.9) this.fullScreen = { width, height };
  }

  /** Takes in an observation: the element list, the app in front and the latest frame. */
  private absorb(observation: Awaited<ReturnType<AndroidGatewayService['executeAction']>>): void {
    if (observation.status !== 'SUCCESS') return;
    if (observation.screenCapture?.base64Data) this.lastScreenshotBase64 = observation.screenCapture.base64Data;
    const tree = observation.uiTree as UiTreeSnapshot | undefined;
    if (!tree) return;
    const capture = observation.screenCapture as { width?: number; height?: number } | undefined;
    this.learnFullScreen(tree.root);
    this.screen = buildScreenModel(tree.root, { width: capture?.width, height: capture?.height }, this.fullScreen ?? undefined, { windows: tree.windows, activity: tree.activity });
    this.lastUiTree = formatScreen(this.screen);
    this.baseTable = this.lastUiTree;
    this.lastEvents = (observation as { events?: UiEvent[] }).events ?? [];
    const seen = eventsLine(this.lastEvents);
    if (seen) this.phoneSaw = this.phoneSaw ? `${this.phoneSaw}\n${seen}` : seen;
    this.lastForegroundApp = this.detectPackageName(tree.root, tree.packageName || 'unknown');
  }

  /**
   * On a screen the element list does not describe (canvas, web view, many
   * unlabelled buttons): a model that sees images gets the screenshot; a
   * text-only model gets the elements a vision helper read off it, as rows
   * v1, v2… it can tap. Without either it is told so plainly.
   */
  /** Set when Xiaomi's pocket-mode warning covers the screen: nothing works until it goes. */
  private sensorNote(): string {
    if (!this.screen || !SENSOR_COVERED.test(this.screen.elements.map((e) => e.label).join('\n'))) return '';
    return '\n\nBLOCKED: the phone shows "Don\'t cover the earphone area" — its proximity sensor is covered (Xiaomi pocket mode). Nothing can be opened or tapped until the top of the phone is uncovered, or the user turns off Settings > Lock screen > Pocket mode / "Prevent accidental touches". Do not keep trying: finish, report this reason, and ask the user to fix it.';
  }

  private async screenExtras(shot?: string, stuck: 'loop' | 'no_effect' | null = null): Promise<{ note: string; image?: string }> {
    this.readNote = '';
    const extras = await this.screenExtrasInner(shot, stuck);
    return this.readNote && !extras.note.includes(this.readNote) ? { ...extras, note: `${this.readNote}${extras.note}` } : extras;
  }

  /** A point on the 0–1000 grid: an element's centre by idx, else x and y as given. */
  private gridPoint(idx: unknown, x: unknown, y: unknown): { x: number; y: number } | null {
    if (idx !== undefined && idx !== null && String(idx).trim()) {
      const key = String(idx).replace(/["']/g, '').trim();
      const el = this.screen?.elements.find((e) => e.idx === key);
      if (el) return el.grid;
    }
    if (typeof x === 'number' && typeof y === 'number' && Number.isFinite(x) && Number.isFinite(y)) {
      return { x: Math.max(0, Math.min(1000, x)), y: Math.max(0, Math.min(1000, y)) };
    }
    return null;
  }

  /** What readMoreOfScreen added this time, said once with the screen. */
  private readNote = '';
  /** Screens already given their extra read (hidden views, OCR), so each costs at most one try. */
  private readMoreKeys = new Set<string>();
  private ocrReads = 0;
  /** The screen whose rows v1… came from OCR: the paid vision reader is not asked about it. */
  private ocrKey = '';
  /** Hidden views made a thin screen readable once in this run: they stay on for it. */
  private hiddenHelped = false;
  private hiddenTried = new Set<string>();

  /**
   * A thin screen, once per screen: (1) re-read it with views apps mark "not
   * important" (React Native, Flutter, some web buttons), and keep that on for the
   * run if it helped; (2) companion 0.32: read its text on the phone (OCR) and add
   * the lines as rows v1, v2… that can be tapped. Both are free; images cost.
   */
  private async readMoreOfScreen(): Promise<string> {
    const key = this.currentKey();
    if (this.readMoreKeys.has(key) || this.readMoreKeys.size > 40) return '';
    this.readMoreKeys.add(key);
    const has = (f: CompanionFeature) => Boolean(this.gatewayService.hasFeature?.(this.hardwareDeviceId, f));
    try {
      // Hidden views: one try per app per run (two extra round trips), kept on if it helped.
      const app = this.lastForegroundApp ?? '';
      if (has('options') && !this.hiddenHelped && !this.hiddenTried.has(app)) {
        this.hiddenTried.add(app);
        await this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'SetOptions', includeHidden: true }, 5000);
        const before = this.screen?.labelledCount ?? 0;
        const res = await this.observe();
        this.absorb(res);
        if (this.screen && !isThin(this.screen) && this.screen.labelledCount > before) {
          this.hiddenHelped = true;
          this.readNote = '\n\nNOTE: this screen hid its controls from the list; they were read again with hidden views included.';
          return this.readNote;
        }
        await this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'SetOptions', includeHidden: false }, 5000);
      }
      if (has('ocr') && this.screen && this.ocrReads < OCR_BUDGET) {
        this.ocrReads += 1;
        const res = await this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'ReadText' }, 10000);
        const lines = res.status === 'SUCCESS' ? res.textLines ?? [] : [];
        if (lines.length) {
          const { width, height } = this.screen.size;
          const seen: SeenElement[] = lines
            .filter((l) => l.text.trim().length > 1)
            .map((l) => ({
              label: l.text,
              x: (((l.bounds.left + l.bounds.right) / 2) / Math.max(1, width)) * 1000,
              y: (((l.bounds.top + l.bounds.bottom) / 2) / Math.max(1, height)) * 1000,
              kind: 'text',
            }));
          if (seen.length) {
            this.screen = withSeenElements(this.screen, seen);
            this.lastUiTree = formatScreen(this.screen);
            this.ocrKey = key;
            this.readNote = `\n\nNOTE: this screen tells the list little, so the phone read its text (OCR): rows v1, v2… are text on screen at their real place — tap them with tap_element (e.g. idx "v2").`;
            return this.readNote;
          }
        }
      }
    } catch {
      // Extra reads are a bonus; the list as it was still works.
    }
    return '';
  }

  private async screenExtrasInner(shot?: string, stuck: 'loop' | 'no_effect' | null = null): Promise<{ note: string; image?: string }> {
    if (!this.screen) return { note: '' };
    const sensor = this.sensorNote();
    if (sensor) return { note: sensor };
    let thin = isThin(this.screen);
    // Cheaper than any image: ask the phone for more of this screen first (hidden views,
    // then on-device OCR on 0.32). Often that alone makes the list usable.
    const read = thin ? await this.readMoreOfScreen() : '';
    if (read) thin = isThin(this.screen);
    if (!thin && !stuck) return { note: read };
    const stuckNote =
      stuck === 'loop'
        ? '\n\nSTUCK: you are going back and forth between the same two screens. Repeating it will not work. Take a completely different route (another element, the ⋮ menu, open_url or a deep link), or finish and report the reason.'
        : stuck === 'no_effect'
        ? '\n\nSTUCK: your last actions changed nothing on the screen. Do not repeat them. Take a completely different route, or finish and report the reason.'
        : '';
    // "Off" in settings: never an image or a helper reading; say so in words.
    if (this.options.screenshots === 'off') {
      if (stuck) return { note: stuckNote };
      return {
        note: '\n\nNOTE: this screen exposes very little to the element list, and screenshots are off for this account. Do not tap by guessing: use click_node with text you expect, wait_for_element for it, open_url or a deep link, or scroll_element — or finish and report that the screen could not be read.',
      };
    }
    // "When stuck" in settings: the AI sees the screen only when it is stuck (a loop,
    // actions that change nothing). A thin list alone is not stuck — on Oct 9 this
    // sent an image after nearly every open_url. (A text-only model still gets the
    // screen reader below; that is its own setting.)
    if (this.options.screenshots !== 'every_step' && !stuck && this.imagesToAi) {
      // One look at each new screen the list cannot describe, when it arrives: waiting
      // for "stuck" left the agent tapping blind first (Oct 12, Blogger's consent page:
      // 3 of its own screenshots spent, then blind). Not again while the list and the
      // picture stay the same, so a loading page is not paid for every step.
      const image = shot ?? this.lastScreenshotBase64 ?? undefined;
      const key = this.currentKey();
      const frame = this.frameKey() ?? '';
      if (image && this.autoVisionUsed < this.autoVisionBudget && (key !== this.thinLookKey || (frame && frame !== this.thinLookFrame && this.stepsSinceThinLook >= 2))) {
        this.thinLookKey = key;
        this.thinLookFrame = frame;
        this.stepsSinceThinLook = 0;
        this.autoVisionUsed += 1;
        return {
          note: '\n\nNOTE: this screen exposes little to the element list, so a screenshot is attached. Look at it for the button you need and tap it with tap_coordinate on the 0–1000 grid (500,500 is the middle of the screen).',
          image,
        };
      }
      this.stepsSinceThinLook += 1;
      return {
        note: '\n\nNOTE: this screen exposes little to the element list. Do not tap by guessing: use click_node with text you expect, wait_for_element for it, open_url or a deep link, or scroll_element. If you get stuck, you will be shown a screenshot.',
      };
    }
    // Stuck on a screen the list does describe: one look per screen, not per step.
    if (stuck && !thin) {
      const key = this.currentKey();
      if (key === this.lastStuckLookKey) return { note: stuckNote };
      this.lastStuckLookKey = key;
    }
    const image = shot ?? this.lastScreenshotBase64 ?? undefined;
    if (this.imagesToAi && image && this.autoVisionUsed < this.autoVisionBudget) {
      this.autoVisionUsed += 1;
      return {
        note: stuck
          ? `${stuckNote} A screenshot of the screen is attached: look at it to see what the element list is missing, then choose.`
          : '\n\nNOTE: this screen exposes little to the element list, so a screenshot is attached. Read it, and tap with tap_coordinate on the 0–1000 grid (500,500 is the middle of the screen).',
        image,
      };
    }
    const reader = this.screenReader;
    if (reader && image && this.ocrKey !== this.currentKey()) {
      const key = this.currentKey();
      if (key !== this.groundedKey && this.groundingUsed < GROUNDING_BUDGET) {
        this.groundedKey = key;
        this.groundingUsed += 1;
        this.groundedSeen = [];
        try {
          this.groundedSeen = await reader(image);
        } catch {
          // The helper is a bonus; the list alone still works.
        }
      }
      // Same screen as the last reading: reuse it rather than paying again.
      if (key === this.groundedKey && this.groundedSeen.length) {
        this.screen = withSeenElements(this.screen, this.groundedSeen);
        this.lastUiTree = formatScreen(this.screen);
      }
      if (this.screen.elements.some((e) => e.seen)) {
        return { note: `${stuckNote}\n\nNOTE: ${stuck ? 'rows' : 'this screen exposes little to the element list. Rows'} v1, v2… were read from a screenshot by a vision model — tap them with tap_element (e.g. idx "v2").` };
      }
    }
    if (stuck) return { note: stuckNote };
    return {
      note: '\n\nNOTE: this screen exposes very little to the element list (web pages, games), and no screenshot reader is available. Do not tap by guessing: use click_node with text you expect, wait_for_element for it, open_url or a deep link, or scroll_element.',
    };
  }

  /**
   * "loop": the last four screens after real actions went A, B, A, B.
   * "no_effect": two actions in a row changed nothing. Otherwise null.
   */
  private stuckReason(): 'loop' | 'no_effect' | null {
    const k = this.recentKeys;
    const n = k.length;
    if (n >= 4 && k[n - 1] === k[n - 3] && k[n - 2] === k[n - 4] && k[n - 1] !== k[n - 2]) return 'loop';
    if (this.noEffectStreak >= 2) return 'no_effect';
    return null;
  }

  /** Every tap goes through here: guards first, then the phone, then the check. */
  private async tapAt(grid: { x: number; y: number }, target: ScreenElement | null, toolName: string, args: Record<string, unknown>, atGrid = false): Promise<ToolResult> {
    const refuse = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true });
    const label = target?.label ?? '';
    const now = Date.now();
    // A button that turned into its opposite under the finger (Install → Cancel).
    if (
      this.lastTap &&
      now - this.lastTap.at < 120_000 &&
      Math.hypot(this.lastTap.grid.x - grid.x, this.lastTap.grid.y - grid.y) < 60 &&
      STARTS_SOMETHING.test(this.lastTap.label) &&
      UNDOES_IT.test(label)
    ) {
      return refuse(
        `Not tapped: this spot was "${this.lastTap.label}" and is now "${label}" — your last tap worked and it is in progress. Tapping it would undo it. Wait for it to finish: wait_for_element with the text you expect next (for an app install, "Open") and timeoutMillis up to 120000.`,
      );
    }
    // A toggle tapped a moment ago, nothing scrolled since: a second tap undoes it.
    // Asked once; the same tap again goes through (the first may really have missed).
    const t = this.lastToggle;
    if (t && TOGGLE.test(label.trim()) && t.label === label.trim() && t.moves === this.moves && Math.hypot(t.grid.x - grid.x, t.grid.y - grid.y) < 60) {
      const warnKey = `${this.moves}|${label.trim()}|${grid.x},${grid.y}`;
      if (this.toggleWarned !== warnKey) {
        this.toggleWarned = warnKey;
        return refuse(
          `Not tapped: you already tapped "${label.trim().slice(0, 30)}" here and have not moved on since. A second tap would undo it (unlike, unsave). Count it as done and move to the next item (swipe or scroll). If you are sure the first tap missed, call the same tap again.`,
        );
      }
    }
    // The same spot again on a screen that did not react last time.
    if (this.noEffect && this.noEffect.key === this.currentKey() && Math.hypot(this.noEffect.grid.x - grid.x, this.noEffect.grid.y - grid.y) < 40) {
      return refuse('Not tapped: you tapped here a moment ago and the screen did not change. Try a different way — click_node with the visible text, a different element, scroll_element, or global_action BACK.');
    }
    const width = this.screen?.size.width ?? 1080;
    const height = this.screen?.size.height ?? 2400;
    const px = !atGrid && target && Math.hypot(target.grid.x - grid.x, target.grid.y - grid.y) < 1 ? target.px : { x: toPixels(grid.x, width), y: toPixels(grid.y, height) };
    const actionKey = `tap_${grid.x}_${grid.y}`;
    this.actionHistory.push(actionKey);
    if (this.actionHistory.length > 10) this.actionHistory.shift();
    // The same spot again and again in one run, whatever happened in between (Oct 11:
    // Blogger's sign-in button and account row tapped 4+ times each, 77 steps in a circle).
    const spot = `${Math.round(grid.x / 25)}_${Math.round(grid.y / 25)}`;
    const hits = (this.spotTaps.get(spot) ?? 0) + 1;
    this.spotTaps.set(spot, hits);
    const circling =
      hits >= 4 && !TOGGLE.test(label.trim())
        ? `\n\nCIRCLING: this is tap number ${hits} on this same spot${label ? ` ("${label.slice(0, 30)}")` : ''} in this run. Tapping it has not moved the task forward; take a different route (another button, a menu, open_url to the page you need), or finish and say what blocks you.`
        : '';
    // Play, Pause, Next…: players hide their controls, and a tap then only shows them.
    // An accessibility click presses the control itself, shown or not (Oct 11: 8 phones
    // tapped YouTube's Pause 10–20 times).
    if (target && !target.seen && MEDIA_CONTROL.test(label.split(' · ')[0].trim())) {
      const clicked = await this.runDeviceAction({ type: 'ClickNode', text: label.split(' · ')[0].trim() }, toolName, args, { grid, px, label });
      if (!clicked.isError) return circling ? this.withNote(clicked, circling.trim()) : clicked;
    }
    const tapped = await this.runDeviceAction({ type: 'Tap', x: px.x, y: px.y }, toolName, args, { grid, px, label });
    return circling ? this.withNote(tapped, circling.trim()) : tapped;
  }

  /**
   * Clears known popups by rule before the model sees the screen (see
   * obstacles.ts). Each press is checked: the screen must change, and a rule
   * that did not work on a screen is not tried there again. Returns lines for
   * the model ("AUTO-CLEARED: …"), or '' when nothing was done.
   */
  private async clearObstacles(): Promise<string> {
    const notes: string[] = [];
    for (let round = 0; round < 3 && this.obstaclesCleared < OBSTACLE_BUDGET; round += 1) {
      const match = findObstacle(this.screen, this.lastForegroundApp, this.options.task ?? '');
      if (!match) break;
      const before = this.currentKey();
      const attempt = `${match.rule.id}|${before}`;
      if (this.obstacleTried.has(attempt)) break;
      this.obstacleTried.add(attempt);
      const res = await this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'Tap', x: match.element.px.x, y: match.element.px.y });
      if (res.status !== 'SUCCESS') break;
      await sleep(700);
      try {
        this.absorb(await this.observe());
      } catch {
        break;
      }
      if (this.currentKey() === before) {
        notes.push(`NOTE: a ${match.rule.label} is on screen; the system pressed "${match.element.label}" but nothing changed — deal with it yourself.`);
        break;
      }
      this.obstaclesCleared += 1;
      this.noEffect = null;
      notes.push(`AUTO-CLEARED: ${match.rule.label} (pressed "${match.element.label}").`);
      this.callbacks?.onRecovery?.(match.rule.id, match.element.label);
    }
    return notes.length ? `${notes.join('\n')}\n\n` : '';
  }

  /** Packages of the phone's launchable apps (ListApps). Null when the phone could not say. */
  private async installedPackages(): Promise<Set<string> | null> {
    const res = await this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'ListApps' });
    if (res.status !== 'SUCCESS') return null;
    return new Set(parseAppList(res.summary ?? '').map((a) => a.packageName));
  }

  private findButton(labels: RegExp): ScreenElement | null {
    return this.screen?.elements.find((e) => e.tappable && !e.disabled && !e.seen && labels.test(e.label.trim())) ?? null;
  }

  /**
   * "Install X", done as a direct action with a check at the end: the Play
   * Store page by link (no searching), Install pressed once, then the phone's
   * own app list polled until the package is there. The model never has to
   * judge "is it installed" from a screen.
   */
  /**
   * When open_app found nothing: the phone's own app list says whether the app
   * is there under another package (then which one to open) or not installed at
   * all (then the task cannot be done here). Null when the list cannot be read.
   */
  private async missingApp(packageName: string): Promise<string | null> {
    const key = packageName.split('.').filter((p) => !['com', 'org', 'net', 'android', 'app', 'apps', 'google', 'mobile'].includes(p.toLowerCase())).pop()?.toLowerCase() ?? '';
    if (key.length < 3) return null;
    const res = await this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'ListApps' }).catch(() => null);
    if (!res || res.status !== 'SUCCESS') return null;
    const apps = parseAppList(res.summary ?? '');
    if (!apps.length) return null;
    const near = apps.find((a) => a.packageName.toLowerCase().includes(key) || a.label.toLowerCase().replace(/\s+/g, '').includes(key));
    if (near) return `This phone has "${near.label}" (${near.packageName}): open that package instead.`;
    return `The phone's app list has no app like "${key}": it is NOT installed on this phone, and the task does not ask to install it. Finish now with task_done (success false) and say "${key} is not installed on this phone" — do not search the launcher or the Play Store for it.`;
  }

  private async installApp(packageName: string, args: Record<string, unknown>): Promise<ToolResult> {
    const started = Date.now();
    const finish = (ok: boolean, text: string): ToolResult => {
      this.callbacks?.onStepExecuted?.({
        toolName: 'install_app',
        args,
        result: text.split('\n')[0],
        foregroundApp: this.lastForegroundApp || undefined,
        uiTree: this.lastUiTree || undefined,
        screenshotBase64: this.lastScreenshotBase64 || undefined,
      });
      const screen = this.lastUiTree ? `\n\nCURRENT APP: ${this.lastForegroundApp ?? 'unknown'}\n\nUPDATED SCREEN ELEMENTS:\n${this.lastUiTree}` : '';
      return { content: [{ type: 'text', text: `${ok ? 'Action succeeded' : 'Action failed'}: ${text}${screen}` }], isError: !ok };
    };
    if (!PACKAGE_NAME.test(packageName)) {
      return finish(false, `"${packageName}" is not a package name (it looks like "com.whatsapp"). Find the app's package name first (for example open_url on a web search for "<app> play store"), then call install_app again.`);
    }
    const name = String(args.appName ?? '').trim() || packageName;

    const before = await this.installedPackages();
    if (before?.has(packageName)) return finish(true, `VERIFIED: ${name} (${packageName}) is already installed on this phone.`);
    // A guessed package (com.openai.chat for ChatGPT) is caught here, before
    // the phone opens a page that does not exist.
    const wrong = await wrongPackageHint(packageName, name);
    if (wrong) return finish(false, wrong);

    const opened = await this.gatewayService.executeAction(this.hardwareDeviceId, {
      type: 'OpenUrl',
      url: `https://play.google.com/store/apps/details?id=${encodeURIComponent(packageName)}`,
      sameTab: false,
    });
    if (opened.status !== 'SUCCESS' || !(await this.waitForForeground(PLAY_STORE))) {
      return finish(
        false,
        `The Play Store page for ${packageName} did not open in the Play Store (the current app is ${this.lastForegroundApp ?? 'unknown'}). Open the Play Store with open_app "${PLAY_STORE}", search for ${name}, open its page, then call install_app "${packageName}" again — it will press Install and check it.`,
      );
    }
    await this.waitUntilSettled(6000);
    await this.clearObstacles();

    const pageText = () => (this.screen?.elements ?? []).map((e) => e.label).join('\n');
    const failure = INSTALL_FAILED.exec(pageText());
    if (failure) return finish(false, `The Play Store says: "${failure[0]}". ${name} cannot be installed on this phone as it is.`);

    const downloading = this.findButton(/^cancel$/i) || /\b\d{1,3}\s?%|pending|downloading|installing/i.test(pageText());
    if (!downloading) {
      if (this.findButton(/^(open|play|uninstall)$/i)) {
        return finish(true, `VERIFIED: the Play Store shows ${name} (${packageName}) as installed ("Open").`);
      }
      const price = this.findButton(PRICE);
      if (price) return finish(false, `${name} is a paid app ("${price.label}"). Buying needs the user's approval — do not press it; tell the user.`);
      const install = this.findButton(/^install$/i);
      if (!install) {
        const wrongPackage = await wrongPackageHint(packageName, name);
        if (wrongPackage) return finish(false, wrongPackage);
        return finish(false, `The Play Store page for ${packageName} has no Install button. Read the screen: the app may not exist under that package name, or the page shows something to deal with first.`);
      }
      const tapped = await this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'Tap', x: install.px.x, y: install.px.y });
      if (tapped.status !== 'SUCCESS') return finish(false, `Could not press Install: ${tapped.status === 'FAILURE' ? tapped.message : 'cancelled'}.`);
    }

    // Wait on the outcome, not on a guess: the phone's own app list.
    let retappedInstall = false;
    let lastProgress = '';
    // Each step of the account-setup sheet is pressed at most twice per install.
    let setupTaps = 0;
    let skipTaps = 0;
    for (let poll = 0; Date.now() - started < INSTALL_WAIT_MS; poll += 1) {
      await sleep(4000);
      this.callbacks?.onHeartbeat?.();
      try {
        this.absorb(await this.observe());
      } catch {
        // keep polling
      }
      await this.clearObstacles();
      const text = pageText();
      const failed = INSTALL_FAILED.exec(text);
      if (failed) return finish(false, `The Play Store says: "${failed[0]}". ${name} was not installed.`);
      if (ACCOUNT_SETUP.test(text) && setupTaps < 2) {
        const go = this.findButton(/^continue$/i);
        if (go) {
          setupTaps += 1;
          await this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'Tap', x: go.px.x, y: go.px.y });
          continue;
        }
      }
      if (PAYMENT_PAGE.test(text) && skipTaps < 2) {
        const skip = this.findButton(/^skip$/i);
        if (skip) {
          skipTaps += 1;
          await this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'Tap', x: skip.px.x, y: skip.px.y });
          continue;
        }
      }
      const progress = /\b\d{1,3}\s?%/.exec(text)?.[0] ?? '';
      if (progress) lastProgress = progress;
      if (poll % 2 === 1 || this.findButton(/^(open|play)$/i)) {
        const now = await this.installedPackages();
        if (now?.has(packageName)) return finish(true, `VERIFIED: ${name} (${packageName}) is installed — the phone lists it (took ${Math.round((Date.now() - started) / 1000)}s).`);
        if (this.findButton(/^(open|play)$/i)) return finish(true, `VERIFIED: the Play Store shows ${name} (${packageName}) as installed ("Open").`);
      }
      // The first press did not register (the page was still loading): once more, never twice.
      const busy = progress || /pending|downloading|installing|waiting for/i.test(text);
      if (!retappedInstall && Date.now() - started > 20_000 && !this.findButton(/^cancel$/i) && !busy) {
        const again = this.lastForegroundApp === PLAY_STORE ? this.findButton(/^install$/i) : null;
        if (again) {
          retappedInstall = true;
          await this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'Tap', x: again.px.x, y: again.px.y });
        }
      }
    }
    return finish(
      false,
      `${name} is not installed yet after ${Math.round(INSTALL_WAIT_MS / 1000)}s${lastProgress ? ` (last progress ${lastProgress})` : ''}. If the download is still running, call install_app "${packageName}" again to keep waiting — do not press Cancel.`,
    );
  }

  /** Watches the screen until two looks in a row match, up to maxMs (15 s at most). */
  private async waitUntilSettled(maxMs: number): Promise<{ settled: boolean; ms: number }> {
    const started = Date.now();
    const deadline = started + Math.min(Math.max(maxMs, 1000), 15_000);
    let previous = this.currentKey();
    while (Date.now() < deadline) {
      await sleep(700);
      try {
        this.absorb(await this.observe());
      } catch {
        continue;
      }
      const key = this.currentKey();
      if (key === previous && Date.now() - started >= 1200) return { settled: true, ms: Date.now() - started };
      previous = key;
    }
    return { settled: false, ms: Date.now() - started };
  }
}
