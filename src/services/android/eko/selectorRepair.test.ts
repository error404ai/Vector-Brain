import type { UiNodeSnapshot } from '../AndroidProtocol';
import { AndroidAgent } from './AndroidAgent';

let pathCounter = 0;
function node(p: Omit<Partial<UiNodeSnapshot>, 'bounds'> & { bounds: [number, number, number, number] }): UiNodeSnapshot {
  const [left, top, right, bottom] = p.bounds;
  return {
    path: String(pathCounter++),
    className: p.className ?? 'android.view.View',
    text: p.text,
    contentDescription: p.contentDescription,
    viewId: p.viewId,
    bounds: { left, top, right, bottom },
    clickable: p.clickable ?? false,
    editable: p.editable ?? false,
    enabled: p.enabled ?? true,
    children: p.children ?? [],
  };
}

const SCREEN = node({
  bounds: [0, 0, 1080, 2400],
  children: [
    node({ text: 'Search YouTube', editable: true, clickable: true, bounds: [100, 100, 900, 200] }),
    node({ text: 'I’ll pass this time', clickable: true, bounds: [100, 1800, 900, 1900] }),
    node({ text: 'Get Premium', clickable: true, bounds: [100, 1600, 900, 1700] }),
  ],
});

function phone(overrides: Record<string, (a: Record<string, unknown>) => unknown> = {}) {
  const actions: Record<string, unknown>[] = [];
  const gateway = {
    executeAction: jest.fn(async (_hw: string, action: Record<string, unknown>) => {
      actions.push(action);
      if (action.type === 'ObserveScreen') return { status: 'SUCCESS', uiTree: { packageName: 'com.google.android.youtube', root: SCREEN } };
      const custom = overrides[String(action.type)];
      if (custom) return custom(action);
      return { status: 'SUCCESS', summary: `${action.type} done` };
    }),
  };
  return { gateway, actions };
}

const run = async (agent: AndroidAgent, name: string, args: Record<string, unknown>) => {
  const r = await agent.runTool(name, args);
  return { isError: Boolean(r.isError), text: (r.content ?? []).map((c) => ('text' in c ? c.text : '')).join('\n') };
};

async function ready(p: ReturnType<typeof phone>) {
  const agent = new AndroidAgent(p.gateway as never, 'hw');
  await agent.runTool('read_ui_tree', {});
  return agent;
}

describe('selector repair', () => {
  it('type_text with an idx as viewId taps that element, then types into the focused field', async () => {
    const p = phone();
    const agent = await ready(p);
    const idx = (await run(agent, 'read_ui_tree', {})).text.match(/(\d+)\|[^|]*\|Search YouTube\|/)![1];
    const r = await run(agent, 'type_text', { text: 'lofi', viewId: idx });
    expect(r.isError).toBe(false);
    const sent = p.actions.filter((a) => a.type !== 'ObserveScreen');
    expect(sent.map((a) => a.type)).toEqual(['Tap', 'SetText']);
    expect(sent[1]).toMatchObject({ text: 'lofi', viewId: undefined, nodePath: undefined });
    expect(r.text).toContain(`"${idx}" is an idx`);
  });

  it('leaves a real viewId alone', async () => {
    const p = phone();
    const agent = await ready(p);
    await run(agent, 'type_text', { text: 'lofi', viewId: 'com.google.android.youtube:id/search_edit_text' });
    expect(p.actions.filter((a) => a.type !== 'ObserveScreen')).toEqual([{ type: 'SetText', text: 'lofi', viewId: 'com.google.android.youtube:id/search_edit_text', nodePath: undefined }]);
  });

  it('click_node falls back to the one label that matches once quotes and case are ignored', async () => {
    const p = phone({ ClickNode: () => ({ status: 'FAILURE', code: 'NODE_NOT_FOUND', message: "No current UI node matches view labelled 'I'll pass this time'" }) });
    const agent = await ready(p);
    const r = await run(agent, 'click_node', { text: "i'll pass this time" });
    expect(r.isError).toBe(false);
    expect(p.actions.filter((a) => a.type !== 'ObserveScreen').map((a) => a.type)).toEqual(['ClickNode', 'Tap']);
    expect(r.text).toContain('tapped "I’ll pass this time"');
  });

  it('click_node does not guess when no label matches', async () => {
    const p = phone({ ClickNode: () => ({ status: 'FAILURE', code: 'NODE_NOT_FOUND', message: 'No current UI node matches' }) });
    const agent = await ready(p);
    const r = await run(agent, 'click_node', { text: 'Skip' });
    expect(r.isError).toBe(true);
    expect(p.actions.some((a) => a.type === 'Tap')).toBe(false);
  });

  it('tells the model not to retry open_app when Android blocks launches from the background', async () => {
    const p = phone({
      OpenApp: () => ({ status: 'FAILURE', code: 'ACTION_REJECTED', message: "The phone did not open com.google.android.youtube: com.android.systemui is still in front. Android or the phone's skin blocked opening it from the background" }),
    });
    const agent = await ready(p);
    const r = await run(agent, 'open_app', { packageName: 'com.google.android.youtube' });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('Do not call open_app for it again');
  });
});
