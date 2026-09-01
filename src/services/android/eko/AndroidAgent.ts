import { Agent } from '@eko-ai/eko';
import type { AgentContext } from '@eko-ai/eko';
import type { Tool, ToolResult } from '@eko-ai/eko';
import type { AndroidGatewayService } from '../AndroidGatewayService';
import type { AutomationAction, UiNodeSnapshot, UiTreeSnapshot } from '../AndroidProtocol';

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
            text: `CURRENT VISIBLE APP: ${pkg}\n\nVISIBLE UI ELEMENTS (use center coordinates to tap):\n${formatted}`,
          };
          const content: ToolResult['content'] = this.lastScreenshotBase64
            ? [textContent, { type: 'image', data: this.lastScreenshotBase64, mimeType: 'image/jpeg' }]
            : [textContent];
          return {
            content,
          };
        },
      },
      {
        name: 'capture_screen',
        description: 'Capture the live screen frame image of the mobile device as visual context.',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        execute: async (_args: Record<string, unknown>, _context: AgentContext): Promise<ToolResult> => {
          const res = await this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'CaptureScreen' });
          if (res.status !== 'SUCCESS' || !res.screenCapture?.base64Data) {
            const errorMsg = res.status === 'FAILURE' ? `${res.code}: ${res.message}` : 'Screen capture failed';
            return { content: [{ type: 'text', text: `Failed to capture screen: ${errorMsg}` }], isError: true };
          }

          const base64 = res.screenCapture.base64Data;
          this.lastScreenshotBase64 = base64;

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
        description: 'Type text into a focused input field. Always tap the input field first before typing.',
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
          if (recentScrolls >= 4) {
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
        description: 'Launch an Android application by its package name.',
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
        description: 'Open an HTTP or HTTPS web URL directly in the device default browser.',
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
          return this.runDeviceAction(
            {
              type: 'OpenUrl',
              url: String(args.url || ''),
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
- NEVER scroll in the same direction more than 3 times - work with visible elements.
- If tap_coordinate fails, try click_node with the element's visible text as fallback.
- After typing text, always tap the search/submit button to execute.
- For research tasks: visit multiple sources, read content from each, summarize at the end.
- Only mark task complete when ALL requested information has been collected.

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
    const summary =
      res.status === 'SUCCESS'
        ? res.summary
        : res.status === 'FAILURE'
        ? `${res.code}: ${res.message}`
        : 'Action cancelled';
    const isError = res.status !== 'SUCCESS';

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

  private formatUiTree(node?: UiNodeSnapshot): string {
    if (!node) return 'No visible UI elements found.';
    const lines: string[] = [];
    let index = 0;

    const traverse = (current: UiNodeSnapshot) => {
      const hasText = current.text && current.text.trim().length > 0;
      const hasDesc = current.contentDescription && current.contentDescription.trim().length > 0;
      const isInteractive = current.clickable || current.editable;
      const hasChildren = (current.children?.length || 0) > 0;

      // Skip useless container nodes
      if (!hasText && !hasDesc && !isInteractive && !hasChildren) {
        if (current.children) {
          for (const child of current.children) traverse(child);
        }
        return;
      }

      // Calculate center coordinates
      let centerStr = '';
      if (current.bounds) {
        const centerX = Math.round((current.bounds.left + current.bounds.right) / 2);
        const centerY = Math.round((current.bounds.top + current.bounds.bottom) / 2);
        centerStr = ` center:(${centerX},${centerY})`;
      }

      // Simplify class name
      let type = (current.className || 'View').split('.').pop() || 'View';
      if (type === 'TextView') type = 'text';
      else if (type === 'Button') type = 'btn';
      else if (type === 'EditText') type = 'input';
      else if (type === 'ImageView') type = 'img';
      else if (type === 'ImageButton') type = 'imgbtn';
      else if (type.includes('Layout') || type.includes('View')) type = 'view';
      else type = type.toLowerCase();

      // Build display text
      let displayText = current.text?.trim() || current.contentDescription?.trim() || '';
      if (displayText.length > 60) displayText = displayText.substring(0, 60) + '...';

      // Build action tags
      const tags: string[] = [];
      if (current.clickable) tags.push('tap');
      if (current.editable) tags.push('edit');

      const label = displayText ? ` "${displayText}"` : '';
      const tagStr = tags.length > 0 ? ` [${tags.join(',')}]` : '';

      lines.push(`[${index}] ${type}${label}${tagStr}${centerStr}`);
      index++;

      if (current.children) {
        for (const child of current.children) traverse(child);
      }
    };

    traverse(node);
    return lines.slice(0, 60).join('\n');
  }
}
