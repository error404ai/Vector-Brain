import { AndroidAgent } from './AndroidAgent';
import { AndroidGatewayService } from '../AndroidGatewayService';

describe('AndroidAgent Eko Integration', () => {
  let mockGatewayService: any;
  let agent: AndroidAgent;

  beforeEach(() => {
    mockGatewayService = {
      executeAction: jest.fn().mockResolvedValue({
        status: 'SUCCESS',
        summary: 'Action completed successfully',
      }),
    };

    agent = new AndroidAgent(mockGatewayService as unknown as AndroidGatewayService, 'device-hw-123');
  });

  it('should initialize with AndroidAgent name and tools', () => {
    const rawAgent = agent as any;
    expect(rawAgent.name).toBe('AndroidAgent');
    const toolNames = rawAgent.tools.map((t: any) => t.name);
    expect(toolNames).toContain('read_ui_tree');
    // Screenshots are only offered to models that can read images.
    expect(toolNames).not.toContain('capture_screen');
    const visionAgent = new AndroidAgent(mockGatewayService as unknown as AndroidGatewayService, 'device-hw-123', undefined, { vision: true }) as any;
    expect(visionAgent.tools.map((t: any) => t.name)).toContain('capture_screen');
    expect(toolNames).toContain('click_node');
    expect(toolNames).toContain('type_text');
    expect(toolNames).toContain('tap_coordinate');
    expect(toolNames).toContain('swipe');
    expect(toolNames).toContain('open_app');
    expect(toolNames).toContain('open_url');
    expect(toolNames).toContain('global_action');
    expect(toolNames).toContain('wait_for_element');
    expect(toolNames).toContain('wait');
  });

  it('should execute open_app tool via gatewayService', async () => {
    const rawAgent = agent as any;
    const openAppTool = rawAgent.tools.find((t: any) => t.name === 'open_app');
    expect(openAppTool).toBeDefined();

    const result = await openAppTool.execute({ packageName: 'com.google.android.youtube' }, {} as any, {} as any);
    expect(mockGatewayService.executeAction).toHaveBeenCalledWith('device-hw-123', {
      type: 'OpenApp',
      packageName: 'com.google.android.youtube',
    });
    expect(result.isError).toBe(false);
    expect(result.content[0]).toEqual({ type: 'text', text: 'Action succeeded: Action completed successfully' });
  });

  it('should execute type_text tool via gatewayService', async () => {
    const rawAgent = agent as any;
    const typeTextTool = rawAgent.tools.find((t: any) => t.name === 'type_text');
    expect(typeTextTool).toBeDefined();

    const result = await typeTextTool.execute({ text: 'Hello World', nodePath: '0/1/2' }, {} as any, {} as any);
    expect(mockGatewayService.executeAction).toHaveBeenCalledWith('device-hw-123', {
      type: 'SetText',
      text: 'Hello World',
      nodePath: '0/1/2',
    });
    expect(result.isError).toBe(false);
  });

  it('should execute swipe tool with default duration', async () => {
    const rawAgent = agent as any;
    const swipeTool = rawAgent.tools.find((t: any) => t.name === 'swipe');
    expect(swipeTool).toBeDefined();

    const result = await swipeTool.execute({ direction: 'DOWN' }, {} as any, {} as any);
    expect(mockGatewayService.executeAction).toHaveBeenCalledWith('device-hw-123', {
      type: 'Swipe',
      direction: 'DOWN',
      durationMillis: 400,
    });
    expect(result.isError).toBe(false);
  });

  it('should handle action failures gracefully', async () => {
    mockGatewayService.executeAction = jest.fn().mockResolvedValue({
      status: 'FAILURE',
      code: 'NODE_NOT_FOUND',
      message: 'Node with given path was not found on screen',
    });

    const rawAgent = agent as any;
    const clickTool = rawAgent.tools.find((t: any) => t.name === 'click_node');
    const result = await clickTool.execute({ nodePath: '9/9/9' }, {} as any, {} as any);

    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual({
      type: 'text',
      text: 'Action failed: NODE_NOT_FOUND: Node with given path was not found on screen',
    });
  });

  it('should wait for a stable element selector', async () => {
    const rawAgent = agent as any;
    const waitTool = rawAgent.tools.find((t: any) => t.name === 'wait_for_element');

    const result = await waitTool.execute({ viewId: 'com.example:id/continue', timeoutMillis: 5000 });

    expect(mockGatewayService.executeAction).toHaveBeenCalledWith('device-hw-123', {
      type: 'WaitForNode',
      viewId: 'com.example:id/continue',
      nodePath: undefined,
      text: undefined,
      timeoutMillis: 5000,
    });
    expect(result.isError).toBe(false);
  });
});

describe('Vector Keyboard', () => {
  const rejected = { status: 'FAILURE', code: 'ACTION_REJECTED', message: 'The app rejected text input' };
  const ok = (summary: string) => ({ status: 'SUCCESS', summary });
  const setup = (state: string | null, replies: any[]) => {
    const executeAction = jest.fn();
    for (const r of replies) executeAction.mockResolvedValueOnce(r);
    executeAction.mockResolvedValue(ok('observed'));
    const gateway = { executeAction, vectorKeyboard: jest.fn().mockReturnValue(state), keyboardSwitched: jest.fn() };
    const agent = new AndroidAgent(gateway as unknown as AndroidGatewayService, 'hw-1') as any;
    return { gateway, tool: (name: string) => agent.tools.find((t: any) => t.name === name) };
  };
  const sent = (gateway: any) => gateway.executeAction.mock.calls.map((c: any[]) => c[1].type);

  it('types a refused code through the active Vector Keyboard', async () => {
    const { gateway, tool } = setup('active', [rejected, ok('typed 6 chars')]);
    const result = await tool('type_text').execute({ text: '482913' }, {} as any, {} as any);
    expect(sent(gateway).slice(0, 2)).toEqual(['SetText', 'KeyboardType']);
    expect(gateway.executeAction.mock.calls[1][1]).toEqual({ type: 'KeyboardType', text: '482913', replace: true });
    expect(result.isError).toBe(false);
    expect(result.content[0].text).toMatch(/Vector Keyboard/);
  });

  it('switches to the keyboard first when it is enabled but not current', async () => {
    const { gateway, tool } = setup('enabled', [rejected, ok('switched'), ok('typed')]);
    const result = await tool('type_text').execute({ text: '1234' }, {} as any, {} as any);
    expect(sent(gateway).slice(0, 3)).toEqual(['SetText', 'SetKeyboard', 'KeyboardType']);
    expect(gateway.keyboardSwitched).toHaveBeenCalledWith('hw-1', true);
    expect(result.isError).toBe(false);
  });

  it('says the keyboard must be enabled when it is off, without sending it', async () => {
    const { gateway, tool } = setup('off', [rejected]);
    const result = await tool('type_text').execute({ text: '1234' }, {} as any, {} as any);
    expect(sent(gateway)).not.toContain('KeyboardType');
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Enable Vector Keyboard/);
  });

  it('leaves older companions alone', async () => {
    const { gateway, tool } = setup(null, [rejected]);
    const result = await tool('type_text').execute({ text: '1234' }, {} as any, {} as any);
    expect(sent(gateway)).not.toContain('KeyboardType');
    expect(result.isError).toBe(true);
    const onTool = await tool('use_vector_keyboard').execute({ on: true }, {} as any, {} as any);
    expect(onTool.isError).toBe(true);
    expect(sent(gateway)).not.toContain('SetKeyboard');
  });

  it('use_vector_keyboard switches the phone keyboard', async () => {
    const { gateway, tool } = setup('enabled', [ok('Vector Keyboard is now active')]);
    const result = await tool('use_vector_keyboard').execute({ on: true }, {} as any, {} as any);
    expect(gateway.executeAction.mock.calls[0][1]).toEqual({ type: 'SetKeyboard', keyboard: 'VECTOR' });
    expect(result.isError).toBe(false);
  });
});

describe('browserFor', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { browserFor } = require('./AndroidAgent');
  it('keeps a URL in the browser the task is about', () => {
    expect(browserFor('com.android.chrome', 'open google')).toBe('com.android.chrome');
    expect(browserFor('com.instagram.android', 'Open Chrome, close tabs, then open google.co.uk')).toBe('com.android.chrome');
    expect(browserFor(null, 'open bbc.com and read headlines')).toBeUndefined();
    expect(browserFor('org.mozilla.firefox', 'open bbc.com')).toBe('org.mozilla.firefox');
  });
});
