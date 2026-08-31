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
    expect(toolNames).toContain('capture_screen');
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
