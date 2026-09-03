import { Agent } from '@eko-ai/eko';
import type { AgentContext } from '@eko-ai/eko';
import type { Tool, ToolResult } from '@eko-ai/eko';
import type { AndroidGatewayService } from '../AndroidGatewayService';
import type { AutomationAction, UiNodeSnapshot, UiTreeSnapshot } from '../AndroidProtocol';

/**
 * Below this many usable rows we assume the app is not exposing its content to
 * the accessibility tree (web views, canvas UIs, games) and fall back to vision.
 */
const MIN_INFORMATIVE_ROWS = 8;

/** Pause between foreground checks after launching an app or URL. */
const LAUNCH_SETTLE_MS = 900;

export interface AndroidAgentCallbacks {
  onStepExecuted?: (info: {
    toolName: string;
    args: Record<string, unknown>;
    result: string;
    screenshotBase64?: string;
    foregroundApp?: string;
    uiTree?: string;
  }) => void;
}

export class AndroidAgent extends Agent {
  private lastUiTree: string | null = null;
  private lastForegroundApp: string | null = null;
  private lastScreenshotBase64: string | null = null;

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

  constructor(
    private gatewayService: AndroidGatewayService,
    private hardwareDeviceId: string,
    private callbacks?: AndroidAgentCallbacks,
  ) {
    const tools: Tool[] = [
      {
        name: 'read_ui_tree',
        description: 'Inspect the current screen to read the visible UI elements with their center coordinates for tapping.',
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

          const tree = res.uiTree as UiTreeSnapshot | undefined;
          const formatted = this.formatUiTree(tree?.root);
          const pkg = this.detectPackageName(tree?.root, tree?.packageName || 'unknown');
          this.lastUiTree = formatted;
          this.lastForegroundApp = pkg;
          this.lastScreenshotBase64 = res.screenCapture?.base64Data || this.lastScreenshotBase64;

          this.callbacks?.onStepExecuted?.({
            toolName: 'read_ui_tree',
            args: {},
            result: `Inspected UI for ${pkg}`,
            foregroundApp: pkg,
            uiTree: formatted,
            screenshotBase64: this.lastScreenshotBase64 || undefined,
          });

          const textContent = {
            type: 'text' as const,
            text: `CURRENT VISIBLE APP: ${pkg}\n\nVISIBLE UI ELEMENTS (columns: idx|type|label|flags|tap_at — flags: t=tappable, e=editable, d=disabled; tap_at is the x,y to pass to tap_coordinate):\n${formatted}`,
          };

          // Normally the tree describes everything and an image would just burn
          // tokens. But web views and canvas-drawn apps expose almost nothing to
          // accessibility — there the model is blind without a picture, so fall
          // back to vision exactly in that case.
          const rowCount = formatted.split('\n').length - 1;
          const treeIsThin = rowCount < MIN_INFORMATIVE_ROWS;
          const freshShot = res.screenCapture?.base64Data;

          if (treeIsThin && freshShot && this.autoVisionUsed < this.autoVisionBudget) {
            this.autoVisionUsed += 1;
            return {
              content: [
                {
                  type: 'text',
                  text: `${textContent.text}\n\nNOTE: this screen exposes very little to the accessibility tree (typical for web pages and games). A screenshot is attached — read the screen from the image and tap using coordinates.`,
                },
                { type: 'image', data: freshShot, mimeType: 'image/jpeg' },
              ],
            };
          }

          return {
            content: [textContent],
          };
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
        name: 'tap_coordinate',
        description: 'Tap directly on screen coordinates. PREFERRED method - use center coordinates from read_ui_tree output.',
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X pixel coordinate (center X from UI tree)' },
            y: { type: 'number', description: 'Y pixel coordinate (center Y from UI tree)' },
            description: { type: 'string', description: 'What you are tapping (e.g. "search box", "Google search button")' },
          },
          required: ['x', 'y'],
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          // Loop prevention - check if same coordinates tapped 3 times
          const actionKey = `tap_${args.x}_${args.y}`;
          const recentSame = this.actionHistory.filter(a => a === actionKey).length;
          if (recentSame >= 3) {
            return {
              content: [{ type: 'text', text: `Blocked: Same coordinate tapped ${recentSame} times. Try a different approach - scroll, go back, or tap a different element.` }],
              isError: true,
            };
          }
          this.actionHistory.push(actionKey);
          if (this.actionHistory.length > 10) this.actionHistory.shift();

          return this.runDeviceAction(
            {
              type: 'Tap',
              x: Number(args.x),
              y: Number(args.y),
            },
            'tap_coordinate',
            args,
          );
        },
      },
      {
        name: 'click_node',
        description: 'Click an element by its exact visible text or viewId. Use this when tap_coordinate is not working.',
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
          return this.runDeviceAction(
            {
              type: 'ClickNode',
              nodePath: args.nodePath as string | undefined,
              viewId: args.viewId as string | undefined,
              text: args.text as string | undefined,
            },
            'click_node',
            args,
          );
        },
      },
      {
        name: 'type_text',
        description:
          'Type text into a focused input field. Always tap the input field first. IMPORTANT: this only sets the text — it CANNOT submit the field, and there is no way to press Enter or the keyboard search key on this device. Adding "\\n" does nothing. To run a search, do not fight the search box: use open_url with the site\'s search results URL instead (e.g. https://www.youtube.com/results?search_query=... or https://www.google.com/search?q=...).',
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
          return this.runDeviceAction(
            {
              type: 'SetText',
              text: String(args.text || ''),
              nodePath: args.nodePath as string | undefined,
              viewId: args.viewId as string | undefined,
            },
            'type_text',
            args,
          );
        },
      },
      {
        name: 'swipe',
        description: 'Swipe/scroll the screen. Use UP to scroll down (reveal content below), DOWN to scroll up.',
        parameters: {
          type: 'object',
          properties: {
            direction: {
              type: 'string',
              enum: ['UP', 'DOWN', 'LEFT', 'RIGHT'],
              description: 'UP = scroll down to see more, DOWN = scroll up to go back',
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
          if (recentScrolls >= 8) {
            return {
              content: [{ type: 'text', text: `Blocked: Scrolled ${recentScrolls} times in same direction. Stop scrolling and work with visible elements or try a different approach.` }],
              isError: true,
            };
          }
          this.actionHistory.push(scrollKey);
          if (this.actionHistory.length > 10) this.actionHistory.shift();

          return this.runDeviceAction(
            {
              type: 'Swipe',
              direction: args.direction as 'UP' | 'DOWN' | 'LEFT' | 'RIGHT',
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
          'Launch an Android application by its package name. The result confirms whether the app actually reached the foreground, so trust what it says instead of re-checking by tapping icons.',
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
          'Open an HTTP or HTTPS web URL in the device browser. By default it replaces the current page in the SAME tab.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Full URL (e.g. "https://google.com")' },
            newTab: {
              type: 'boolean',
              description:
                'Leave this out to reuse the current tab (default). Set true ONLY when the user explicitly wants the pages side by side in separate tabs.',
            },
          },
          required: ['url'],
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          this.actionHistory = []; // Reset history on URL open
          this.consecutiveFailures = 0;
          return this.runDeviceAction(
            {
              type: 'OpenUrl',
              url: String(args.url || ''),
              newTab: args.newTab === true,
            },
            'open_url',
            args,
          );
        },
      },
      {
        name: 'global_action',
        description: 'Trigger Android system navigation: BACK to go back, HOME to go home screen.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['BACK', 'HOME', 'RECENTS', 'NOTIFICATIONS'],
              description: 'BACK = go back one screen, HOME = go to home screen',
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
              action: args.action as 'BACK' | 'HOME' | 'RECENTS' | 'NOTIFICATIONS',
            },
            'global_action',
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
          return this.runDeviceAction(
            {
              type: 'WaitForNode',
              nodePath: args.nodePath as string | undefined,
              viewId: args.viewId as string | undefined,
              text: args.text as string | undefined,
              timeoutMillis: args.timeoutMillis ? Number(args.timeoutMillis) : 8000,
            },
            'wait_for_element',
            args,
          );
        },
      },
      {
        name: 'wait',
        description: 'Wait for animations or page loads to complete.',
        parameters: {
          type: 'object',
          properties: {
            durationMillis: { type: 'number', description: 'Wait duration in milliseconds (default: 2000)' },
          },
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          return this.runDeviceAction(
            {
              type: 'Wait',
              durationMillis: args.durationMillis ? Number(args.durationMillis) : 2000,
            },
            'wait',
            args,
          );
        },
      },
    ];

    super({
      name: 'AndroidAgent',
      description: 'An expert AI agent that inspects and interacts with an Android mobile device to accomplish user tasks step-by-step.',
      tools,
    });
  }

  protected async buildSystemPrompt(): Promise<string> {
    return `You are Vector-Brain, an expert autonomous AI agent controlling an Android mobile device.
Your goal is to accomplish the user's task step-by-step using available tools.

WORKFLOW:
1. Call read_ui_tree ONLY on your very first turn or after global_action/open_app/open_url.
   Every other action's result already includes "UPDATED SCREEN ELEMENTS" — use that
   directly instead of calling read_ui_tree again. Redundant read_ui_tree calls waste
   time and steps.
2. Use tap_coordinate with the center X,Y coordinates shown in the UI tree to tap elements.
3. For text input: first tap the input field using tap_coordinate, then use type_text.
4. Use open_app to launch apps, open_url to open websites directly.
5. Use swipe UP to scroll down and reveal more content.
6. Use global_action BACK to go back to previous screen.
7. Use wait_for_element or wait after actions that need loading time.

CRITICAL RULES:
- ALWAYS use tap_coordinate with center coordinates from read_ui_tree - this is the PRIMARY way to click.
- NEVER repeat the same tap coordinate more than 2 times - try a different approach.
- Avoid scrolling in the same direction more than 7 times in a row - if content
  still isn't found, try a different approach instead of scrolling further.
- If tap_coordinate fails, try click_node with the element's visible text as fallback.
- After typing text, always tap the search/submit button to execute.
- open_url reuses the current browser tab by default. Only pass newTab: true when
  the user explicitly asked for separate tabs or to compare pages side by side;
  visiting many sites "one by one" should stay in a single tab.
- For research tasks: visit multiple sources, read content from each, summarize at the end.
- Only mark task complete when ALL requested information has been collected.
- task_snapshot is requested by the framework, not by the user. When it is asked
  for, answer it briefly and move on; never call it yourself as a checkpoint.
- If you already have enough information to answer the user's question, STOP
  and give the answer immediately instead of gathering more.
UI TREE FORMAT:
Each element shows: [index] type "text" [actions] center:(X,Y)
Example: [5] input "Search Google" [tap,edit] center:(540,450)
Use the center:(X,Y) values directly in tap_coordinate.`;
  }

  private async runDeviceAction(
    action: AutomationAction,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    const res = await this.gatewayService.executeAction(this.hardwareDeviceId, action);
    let summary =
      res.status === 'SUCCESS'
        ? res.summary
        : res.status === 'FAILURE'
        ? `${res.code}: ${res.message}`
        : 'Action cancelled';
    const isError = res.status !== 'SUCCESS';

    // A launch only reports that the intent was dispatched, not that the app is
    // on screen. Observing immediately catches the old screen, so the model is
    // told "opened" while still looking at the launcher and wastes several
    // steps hunting for the icon. Give the app time to come to the front and
    // report what actually happened.
    if (!isError && (action.type === 'OpenApp' || action.type === 'OpenUrl')) {
      const wanted = action.type === 'OpenApp' ? String(action.packageName || '') : '';
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
    const skipObservation = action.type === 'Wait';
    try {
      if (skipObservation) throw new Error('skip');
      const observation = await this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'ObserveScreen' });
      if (observation.status === 'SUCCESS' && observation.screenCapture?.base64Data) {
        this.lastScreenshotBase64 = observation.screenCapture.base64Data;
      }
      if (observation.status === 'SUCCESS' && observation.uiTree) {
        this.lastUiTree = this.formatUiTree(observation.uiTree.root);
        this.lastForegroundApp = this.detectPackageName(
          observation.uiTree.root,
          observation.uiTree.packageName || 'unknown',
        );
      }
    } catch {
      // Best-effort post-action snapshot
    }

    this.callbacks?.onStepExecuted?.({
      toolName,
      args,
      result: summary,
      foregroundApp: this.lastForegroundApp || undefined,
      uiTree: this.lastUiTree || undefined,
      screenshotBase64: this.lastScreenshotBase64 || undefined,
    });

    // Add failure hint if stuck
    const stuckHint = this.consecutiveFailures >= 3
      ? `\n\nWARNING: ${this.consecutiveFailures} consecutive failures. Try a completely different approach - use global_action BACK, try tap_coordinate with different coordinates, or use open_url to navigate directly.`
      : '';

    const textPart = {
      type: 'text' as const,
      text: isError
        ? `Action failed: ${summary}${stuckHint}`
        : `Action succeeded: ${summary}${this.lastForegroundApp ? `\n\nCURRENT APP: ${this.lastForegroundApp}` : ''}${this.lastUiTree ? `\n\nUPDATED SCREEN ELEMENTS:\n${this.lastUiTree}` : ''}`,
    };

        // Screenshot is intentionally NOT attached to regular action results.
    // The text UI tree already contains everything needed (elements + center
    // coordinates). Images on every step multiply tokens/latency/cost.
    // The model can call read_ui_tree or capture_screen whenever it
    // genuinely needs visual context.
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
        if (observation.screenCapture?.base64Data) {
          this.lastScreenshotBase64 = observation.screenCapture.base64Data;
        }
        if (observation.uiTree) {
          this.lastUiTree = this.formatUiTree(observation.uiTree.root);
          this.lastForegroundApp = this.detectPackageName(
            observation.uiTree.root,
            observation.uiTree.packageName || 'unknown',
          );
        }
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
   * Compact, table-shaped view of the screen.
   *
   * Container nodes with no text, no description and no interactivity are
   * dropped entirely (their children are still walked) — they used to be
   * emitted as bare "view" rows and made up most of the payload. One row per
   * useful element keeps a busy screen near 1k characters instead of ~3k.
   */
  private formatUiTree(node?: UiNodeSnapshot): string {
    if (!node) return 'No visible UI elements found.';
    const rows: string[] = [];
    let index = 0;

    const traverse = (current: UiNodeSnapshot) => {
      const text = current.text?.trim() || '';
      const desc = current.contentDescription?.trim() || '';
      const isInteractive = current.clickable || current.editable;
      const informative = text.length > 0 || desc.length > 0 || isInteractive;

      if (informative && rows.length < 80) {
        // Simplify class name
        let type = (current.className || 'View').split('.').pop() || 'View';
        if (type === 'TextView') type = 'text';
        else if (type === 'Button') type = 'btn';
        else if (type === 'EditText') type = 'input';
        else if (type === 'ImageView') type = 'img';
        else if (type === 'ImageButton') type = 'imgbtn';
        else if (type.includes('Layout') || type.includes('View')) type = 'view';
        else type = type.toLowerCase();

        let label = text || desc;
        if (label.length > 60) label = `${label.substring(0, 60)}...`;

        // Single-character flags: t=tappable, e=editable, d=disabled
        let flags = '';
        if (current.clickable) flags += 't';
        if (current.editable) flags += 'e';
        if (!current.enabled) flags += 'd';

        const centerX = Math.round((current.bounds.left + current.bounds.right) / 2);
        const centerY = Math.round((current.bounds.top + current.bounds.bottom) / 2);

        rows.push(`${index}|${type}|${label}|${flags}|${centerX},${centerY}`);
        index++;
      }

      if (current.children) {
        for (const child of current.children) traverse(child);
      }
    };

    traverse(node);

    if (rows.length === 0) return 'No visible UI elements found.';
    return ['idx|type|label|flags|tap_at', ...rows].join('\n');
  }
}
