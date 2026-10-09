import { Agent } from '@eko-ai/eko';
import { sightOfResult, type Sight } from '../screenSight';
import { wrongPackageHint } from './playStoreLookup';
import type { AgentContext } from '@eko-ai/eko';
import type { Tool, ToolResult } from '@eko-ai/eko';
import type { AndroidGatewayService } from '../AndroidGatewayService';
import type { ActionResult, AutomationAction, UiNodeSnapshot, UiTreeSnapshot } from '../AndroidProtocol';
import { parseAppList } from '../agent/successVerifier';
import { keepOnlyFreshImage, pruneStaleScreens } from './contextPruning';
import { findObstacle, type ObstacleId } from './obstacles';
import { compactSystemPrompt } from './compactPrompt';
import type { ScreenshotMode } from './screenshotMode';
import {
  GRID,
  buildScreenModel,
  elementAt,
  formatScreen,
  isThin,
  screenKey,
  toPixels,
  withSeenElements,
  type ScreenElement,
  type ScreenModel,
} from './screenModel';

/** Elements a vision model read off a screenshot, positions on the 0–1000 grid. */
export type SeenElement = { label: string; x: number; y: number; kind?: string };
/** Reads a screenshot for a model that cannot see images (see AndroidPlannerService). */
export type ScreenGrounder = (screenshotBase64: string) => Promise<SeenElement[]>;

/** Vision-helper reads per run: each is one small image call. */
const GROUNDING_BUDGET = 25;
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
  const inFront = BROWSERS.find(([, pkg]) => foreground === pkg);
  if (inFront) return inFront[1];
  const named = BROWSERS.find(([name]) => name.test(task ?? ''));
  return named?.[1];
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
  private readonly screenshotBudget = 3;

  /** Separate cap for automatic fallback vision on accessibility-blind screens. */
  private autoVisionUsed = 0;
  private readonly autoVisionBudget = 8;

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
  /** A coordinate tap on nothing in the list is questioned once per screen and point. */
  private blindTapWarned = '';

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
          const res = await this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'ObserveScreen' });
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
          'Type text into a focused input field. Always tap the input field first. This only puts the text in the field; it does not submit it. To submit (search, send, go), call press_key with ENTER next — on Android 11+ that fires the keyboard\'s own Search/Go/Done action. If press_key is refused (older Android or the field ignores it), tap the Search, Go, Send or Done button on screen. For a web or YouTube search, opening the results URL with open_url is a quicker shortcut (e.g. https://www.google.com/search?q=... or https://www.youtube.com/results?search_query=...). If the field refuses the text (one-time code boxes, PIN pads), this retries through the Vector Keyboard by itself — do not fall back to tapping keyboard keys.',
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
          return idx ? this.withNote(result, `("${idx}" is an idx from the screen list: element ${idx} was tapped first, then the text typed into it.)`) : result;
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
              content: [{ type: 'text', text: `Blocked: already scrolled ${recentScrolls} times in this direction without finding it. Stop scrolling — read the screen, work with the elements that are visible, or reach the target another way (for example open_url).` }],
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

          return this.runDeviceAction(
            {
              type: 'Swipe',
              direction: gesture,
              durationMillis: args.durationMillis ? Number(args.durationMillis) : 400,
            },
            'swipe',
            args,
          );
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
          return this.runDeviceAction(
            {
              type: 'OpenUrl',
              url: String(args.url || ''),
              sameTab: USE_IN_APP_BROWSER,
              ...(browser ? { packageName: browser } : {}),
            },
            'open_url',
            args,
          );
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
          'Press a key on the text field that currently has focus. Use ENTER to submit a search or form after set_text — it triggers the field\'s own Search/Go/Done action. BACKSPACE deletes one character, CLEAR empties the field. ENTER needs Android 11 or newer; if it is refused, tap the on-screen Search or Go button instead.',
        parameters: {
          type: 'object',
          properties: {
            key: {
              type: 'string',
              enum: ['ENTER', 'BACKSPACE', 'CLEAR'],
              description: 'ENTER = submit, BACKSPACE = delete one character, CLEAR = empty the field',
            },
          },
          required: ['key'],
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          return this.runDeviceAction(
            {
              type: 'PressKey',
              key: args.key as 'ENTER' | 'BACKSPACE' | 'CLEAR',
            },
            'press_key',
            args,
          );
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
        name: 'read_notifications',
        description:
          'Read notifications the phone has received. Use this for one-time codes, delivery alerts, or to check whether a message arrived. Only notifications posted since the Vector app started are visible — it cannot read what was already in the shade.',
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
      tools: options.vision && options.screenshots !== 'off' ? tools : tools.filter((tool) => tool.name !== 'capture_screen'),
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
    const res = await this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'ObserveScreen' });
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
    const res = await this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'ObserveScreen' });
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
    let res: Awaited<ReturnType<AndroidGatewayService['executeAction']>>;
    if (action.type === 'Wait') {
      // Not a blind pause: watch the screen and return once it is still.
      const settled = await this.waitUntilSettled(Number(action.durationMillis) || 4000);
      res = { status: 'SUCCESS', summary: settled.settled ? `Screen settled after ${(settled.ms / 1000).toFixed(1)}s` : `Screen was still changing after ${(settled.ms / 1000).toFixed(1)}s (something is loading or downloading)` } as typeof res;
    } else {
      res = await this.gatewayService.executeAction(this.hardwareDeviceId, action);
    }

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
      summary =
        `${summary}${alsoTried} Do NOT guess more package names — none of the usual ones exist here. ` +
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
      const observation = await this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'ObserveScreen' });
      this.absorb(observation);
      freshShot = observation.status === 'SUCCESS' ? observation.screenCapture?.base64Data : undefined;
    } catch {
      // Best-effort post-action snapshot
    }

    // Did the action do anything? Checked against the phone, not the model's word.
    const keyAfter = this.currentKey();
    const meantToChange = ['Tap', 'ClickNode', 'LongPress'].includes(action.type);
    let checkNote = '';
    if (!isError && meantToChange && keyAfter === keyBefore) {
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

    const textPart = {
      type: 'text' as const,
      text: isError
        ? `Action failed: ${summary}${stuckHint}`
        : `Action succeeded: ${summary}${checkNote}${cleared ? `\n\n${cleared.trim()}` : ''}${this.lastForegroundApp ? `\n\nCURRENT APP: ${this.lastForegroundApp}` : ''}${this.lastUiTree ? `\n\nUPDATED SCREEN ELEMENTS:\n${this.lastUiTree}` : ''}${extra.note}`,
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

    // Screenshot is intentionally NOT attached to regular action results.
    // The text UI tree already contains everything needed (elements + center
    // coordinates). Images on every step multiply tokens/latency/cost.
    // The model can call read_ui_tree or capture_screen whenever it
    // genuinely needs visual context.
    //
    // The exception is a second consecutive wait: at that point the model is
    // waiting because the tree is not telling it whether the page loaded, and
    // more waiting will not fix that. Show it the screen once.
    if (
      this.imagesToAi &&
      action.type === 'Wait' &&
      this.consecutiveWaits >= 2 &&
      this.lastScreenshotBase64 &&
      this.autoVisionUsed < this.autoVisionBudget
    ) {
      this.autoVisionUsed += 1;
      return {
        content: [
          {
            type: 'text',
            text: `${textPart.text}\n\nNOTE: you have waited twice in a row. A screenshot of the current screen is attached — read it directly instead of waiting again. If the content is already there, continue with the task.`,
          },
          { type: 'image', data: this.lastScreenshotBase64, mimeType: 'image/jpeg' },
        ],
        isError,
      };
    }

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

  /** "Has the screen changed": the app in front plus the list as the phone reported it. */
  private currentKey(): string {
    return screenKey(this.lastForegroundApp, this.baseTable ?? this.lastUiTree);
  }

  /** Takes in an observation: the element list, the app in front and the latest frame. */
  private absorb(observation: Awaited<ReturnType<AndroidGatewayService['executeAction']>>): void {
    if (observation.status !== 'SUCCESS') return;
    if (observation.screenCapture?.base64Data) this.lastScreenshotBase64 = observation.screenCapture.base64Data;
    const tree = observation.uiTree as UiTreeSnapshot | undefined;
    if (!tree) return;
    const capture = observation.screenCapture as { width?: number; height?: number } | undefined;
    this.screen = buildScreenModel(tree.root, { width: capture?.width, height: capture?.height });
    this.lastUiTree = formatScreen(this.screen);
    this.baseTable = this.lastUiTree;
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
    if (!this.screen) return { note: '' };
    const sensor = this.sensorNote();
    if (sensor) return { note: sensor };
    const thin = isThin(this.screen);
    if (!thin && !stuck) return { note: '' };
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
    if (reader && image) {
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
  private async tapAt(grid: { x: number; y: number }, target: ScreenElement | null, toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
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
    // The same spot again on a screen that did not react last time.
    if (this.noEffect && this.noEffect.key === this.currentKey() && Math.hypot(this.noEffect.grid.x - grid.x, this.noEffect.grid.y - grid.y) < 40) {
      return refuse('Not tapped: you tapped here a moment ago and the screen did not change. Try a different way — click_node with the visible text, a different element, scroll_element, or global_action BACK.');
    }
    const width = this.screen?.size.width ?? 1080;
    const height = this.screen?.size.height ?? 2400;
    const px = target && Math.hypot(target.grid.x - grid.x, target.grid.y - grid.y) < 1 ? target.px : { x: toPixels(grid.x, width), y: toPixels(grid.y, height) };
    const actionKey = `tap_${grid.x}_${grid.y}`;
    this.actionHistory.push(actionKey);
    if (this.actionHistory.length > 10) this.actionHistory.shift();
    return this.runDeviceAction({ type: 'Tap', x: px.x, y: px.y }, toolName, args, { grid, px, label });
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
        this.absorb(await this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'ObserveScreen' }));
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
        this.absorb(await this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'ObserveScreen' }));
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
        this.absorb(await this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'ObserveScreen' }));
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
