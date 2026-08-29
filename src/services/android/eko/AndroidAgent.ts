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

  constructor(
    private gatewayService: AndroidGatewayService,
    private hardwareDeviceId: string,
    private callbacks?: AndroidAgentCallbacks,
  ) {
    const tools: Tool[] = [
      {
        name: 'read_ui_tree',
        description: 'Inspect the current screen to read the visible UI hierarchy and foreground application package.',
        parameters: {
          type: 'object',
          properties: {},
          additionalProperties: false,
        },
        execute: async (_args: Record<string, unknown>, _context: AgentContext): Promise<ToolResult> => {
          const res = await this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'ReadUiTree' });
          if (res.status !== 'SUCCESS') {
            const errorMsg = res.status === 'FAILURE' ? `${res.code}: ${res.message}` : 'Inspection cancelled';
            return { content: [{ type: 'text', text: `Failed to read UI tree: ${errorMsg}` }], isError: true };
          }

          const tree = res.uiTree as UiTreeSnapshot | undefined;
          const formatted = this.formatUiTree(tree?.root);
          const pkg = this.detectPackageName(tree?.root, tree?.packageName || 'unknown');
          this.lastUiTree = formatted;
          this.lastForegroundApp = pkg;

          this.callbacks?.onStepExecuted?.({
            toolName: 'read_ui_tree',
            args: {},
            result: `Inspected UI for ${pkg}`,
            foregroundApp: pkg,
            uiTree: formatted,
          });

          return {
            content: [
              {
                type: 'text',
                text: `CURRENT VISIBLE APP: ${pkg}\n\nVISIBLE UI NODES:\n${formatted}`,
              },
            ],
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
              { type: 'image', data: base64, mimeType: 'image/png' },
            ],
          };
        },
      },
      {
        name: 'click_node',
        description: 'Click an element identified by its nodePath (e.g. "0/1/2"), resource viewId, or exact visible text.',
        parameters: {
          type: 'object',
          properties: {
            nodePath: { type: 'string', description: 'Path index in the UI tree (e.g. "0/1/3")' },
            viewId: { type: 'string', description: 'Resource ID of the target view (e.g. "com.app:id/btn")' },
            text: { type: 'string', description: 'Exact text or description of the button/view' },
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
        description: 'Type text into an input field or currently focused editable node.',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Text string to type into the input field' },
            nodePath: { type: 'string', description: 'Optional target node path in the UI tree' },
          },
          required: ['text'],
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          return this.runDeviceAction(
            {
              type: 'SetText',
              text: String(args.text || ''),
              nodePath: args.nodePath as string | undefined,
            },
            'type_text',
            args,
          );
        },
      },
      {
        name: 'tap_coordinate',
        description: 'Tap directly on exact screen X and Y pixel coordinates.',
        parameters: {
          type: 'object',
          properties: {
            x: { type: 'number', description: 'X pixel coordinate on screen' },
            y: { type: 'number', description: 'Y pixel coordinate on screen' },
          },
          required: ['x', 'y'],
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
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
        name: 'swipe',
        description: 'Swipe across the screen (direction: UP to scroll down and reveal content below, DOWN to scroll up, LEFT to scroll right, RIGHT to scroll left).',
        parameters: {
          type: 'object',
          properties: {
            direction: {
              type: 'string',
              enum: ['UP', 'DOWN', 'LEFT', 'RIGHT'],
              description: 'Direction to swipe (UP = scroll down to see more items below, DOWN = scroll up)',
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
        description: 'Launch an Android application by its package name (e.g. "com.google.android.youtube", "com.android.settings", "com.android.chrome").',
        parameters: {
          type: 'object',
          properties: {
            packageName: { type: 'string', description: 'Full package name of the app to launch' },
          },
          required: ['packageName'],
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
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
            url: { type: 'string', description: 'Full URL to navigate to (e.g. "https://google.com")' },
          },
          required: ['url'],
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
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
        description: 'Trigger a global Android system navigation action: BACK, HOME, RECENTS, or NOTIFICATIONS.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['BACK', 'HOME', 'RECENTS', 'NOTIFICATIONS'],
              description: 'Global system key to press',
            },
          },
          required: ['action'],
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
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
        name: 'wait',
        description: 'Wait for a specified duration in milliseconds to allow animations or pages to load.',
        parameters: {
          type: 'object',
          properties: {
            durationMillis: { type: 'number', description: 'Duration to wait in milliseconds (default: 1000)' },
          },
          additionalProperties: false,
        },
        execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
          return this.runDeviceAction(
            {
              type: 'Wait',
              durationMillis: args.durationMillis ? Number(args.durationMillis) : 1000,
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

WORKFLOW & PRINCIPLES:
1. Always call read_ui_tree (and optionally capture_screen) to inspect the screen hierarchy and find interactable UI elements.
2. If the target application is not currently active, launch it using open_app with its package name, or open_url for web destinations.
3. If an overlay, permission prompt, onboarding modal, or notification banner obscures the screen, dismiss or accept it using click_node to reach the main interface.
4. When performing search or text input:
   - Use type_text to enter the required string into the input field.
   - Submit the search by clicking the search/submit button or selecting a suggestion item.
5. Interact with UI elements using click_node (prefer nodePath, viewId, or exact visible text) or tap_coordinate.
6. If the target content is off-screen, swipe with direction="UP" to scroll down and bring it into view.
7. Use wait if a screen or network request is loading.
8. Verify that the requested goal is reached on screen, then finish with a clear success summary.`;
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

    // Automatically capture updated screen frame and UI tree after each interaction
    try {
      const [screenRes, treeRes] = await Promise.all([
        this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'CaptureScreen' }),
        this.gatewayService.executeAction(this.hardwareDeviceId, { type: 'ReadUiTree' }),
      ]);
      if (screenRes.status === 'SUCCESS' && screenRes.screenCapture?.base64Data) {
        this.lastScreenshotBase64 = screenRes.screenCapture.base64Data;
      }
      if (treeRes.status === 'SUCCESS' && treeRes.uiTree) {
        this.lastUiTree = this.formatUiTree(treeRes.uiTree.root);
        this.lastForegroundApp = this.detectPackageName(treeRes.uiTree.root, treeRes.uiTree.packageName || 'unknown');
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

    const textPart = {
      type: 'text' as const,
      text: isError
        ? `Action failed: ${summary}`
        : `Action succeeded: ${summary}${this.lastForegroundApp ? `\n\nCURRENT VISIBLE APP: ${this.lastForegroundApp}` : ''}${this.lastUiTree ? `\n\nUPDATED VISIBLE UI NODES:\n${this.lastUiTree}` : ''}`,
    };

    const content: ToolResult['content'] = this.lastScreenshotBase64
      ? [
          textPart,
          {
            type: 'image' as const,
            data: this.lastScreenshotBase64,
            mimeType: 'image/png',
          },
        ]
      : [textPart];

    return {
      content,
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

  private formatUiTree(node?: UiNodeSnapshot, depth = 0): string {
    if (!node) return 'No visible UI elements found.';
    const lines: string[] = [];

    const traverse = (current: UiNodeSnapshot, currentDepth: number) => {
      const indent = '  '.repeat(currentDepth);
      const parts: string[] = [];

      if (current.path) parts.push(`[${current.path}]`);
      if (current.viewId) parts.push(`id=${current.viewId}`);
      if (current.text) parts.push(`text="${current.text}"`);
      if (current.contentDescription) parts.push(`desc="${current.contentDescription}"`);
      if (current.clickable) parts.push('(clickable)');
      if (current.editable) parts.push('(editable)');
      if (current.bounds) {
        parts.push(`bounds=[${current.bounds.left},${current.bounds.top},${current.bounds.right},${current.bounds.bottom}]`);
      }

      const meaningful = current.text || current.contentDescription || current.clickable || current.editable || current.viewId;
      if (meaningful || currentDepth === 0) {
        lines.push(`${indent}- ${current.className || 'Node'} ${parts.join(' ')}`);
      }

      if (current.children) {
        for (const child of current.children) {
          traverse(child, currentDepth + 1);
        }
      }
    };

    traverse(node, depth);
    return lines.slice(0, 120).join('\n');
  }
}

