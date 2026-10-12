import type { UiNodeSnapshot } from '../AndroidProtocol';
import { gestureAsSwipe } from '../gestures';
import { AndroidAgent } from './AndroidAgent';

let n = 0;
const node = (over: Partial<UiNodeSnapshot> & { box: [number, number, number, number] }): UiNodeSnapshot => {
  const { box, ...rest } = over;
  return { path: String(n++), bounds: { left: box[0], top: box[1], right: box[2], bottom: box[3] }, clickable: false, editable: false, enabled: true, children: [], ...rest };
};
const screen = (children: UiNodeSnapshot[]) => node({ box: [0, 0, 1080, 2400], children });

type Tools = { tools: { name: string; execute: (a: Record<string, unknown>, c: unknown, t: unknown) => Promise<{ content: { text?: string }[]; isError?: boolean }> }[] };
function agentWith(executeAction: jest.Mock, features: string[] = []) {
  const gateway = { executeAction, hasFeature: (_: string, f: string) => features.includes(f) };
  const agent = new AndroidAgent(gateway as never, 'hw', undefined, {});
  const tools = (agent as unknown as Tools).tools;
  return {
    names: tools.map((t) => t.name),
    run: async (name: string, args: Record<string, unknown> = {}) => {
      const r = await tools.find((t) => t.name === name)!.execute(args, {}, {});
      return { text: r.content.map((c) => c.text ?? '').join(''), isError: Boolean(r.isError) };
    },
  };
}

describe('companion 0.32', () => {
  it('new tools only for builds that have them', () => {
    const old = agentWith(jest.fn(), ['intent', 'scroll_until']).names;
    expect(old).not.toEqual(expect.arrayContaining(['drag']));
    expect(old).not.toContain('notification_action');
    expect(old).not.toContain('upload_file');
    const now = agentWith(jest.fn(), ['gesture', 'notif_actions', 'upload']).names;
    expect(now).toEqual(expect.arrayContaining(['drag', 'double_tap', 'pinch', 'notification_action', 'dismiss_notification', 'list_downloads', 'upload_file']));
  });

  it('a thin web page: the phone reads its text (OCR) and the lines become rows to tap', async () => {
    const page = screen([node({ text: 'Blogger', box: [0, 0, 1080, 120] })]);
    const exec = jest.fn(async (_hw: string, action: { type: string }) => {
      if (action.type === 'ObserveScreen' || action.type === 'ReadUiTree') return { status: 'SUCCESS', uiTree: { packageName: 'com.android.chrome', root: page } };
      if (action.type === 'ReadText')
        return {
          status: 'SUCCESS',
          summary: 'Read 2 lines',
          textLines: [
            { text: 'We care about your privacy', bounds: { left: 100, top: 1000, right: 980, bottom: 1060 } },
            { text: 'Accept all', bounds: { left: 600, top: 1800, right: 980, bottom: 1880 } },
          ],
        };
      return { status: 'SUCCESS', summary: `${action.type} done` };
    });
    const a = agentWith(exec, ['ocr']);
    const r = await a.run('read_ui_tree');
    expect(r.text).toMatch(/v2\|text\|Accept all\|t\|731,767/);
    expect(r.text).toMatch(/the phone read its text \(OCR\)/);
    // Same screen again: no second read.
    await a.run('read_ui_tree');
    expect(exec.mock.calls.filter(([, x]) => x.type === 'ReadText')).toHaveLength(1);
  });

  it('drag follows the path in pixels; double tap is two short strokes', async () => {
    const exec = jest.fn(async (_hw: string, action: { type: string }) => {
      if (action.type === 'ObserveScreen') return { status: 'SUCCESS', uiTree: { packageName: 'x', root: screen([node({ text: 'Slider', clickable: true, box: [100, 1000, 980, 1100] })]) } };
      return { status: 'SUCCESS', summary: 'Gesture completed' };
    });
    const a = agentWith(exec, ['gesture']);
    await a.run('drag', { from_x: 100, from_y: 500, to_x: 900, to_y: 500, durationMillis: 600 });
    const drag = exec.mock.calls.map(([, x]) => x).find((x) => x.type === 'Gesture') as unknown as { strokes: { points: { x: number; y: number }[]; durationMillis: number }[] };
    expect(drag.strokes[0].points[0]).toEqual({ x: 108, y: 1200 });
    expect(drag.strokes[0].points.at(-1)).toEqual({ x: 972, y: 1200 });
    expect(drag.strokes[0].durationMillis).toBe(600);
    await a.run('double_tap', { x: 500, y: 500 });
    const dbl = exec.mock.calls.map(([, x]) => x).filter((x) => x.type === 'Gesture').at(-1) as unknown as { strokes: { startMillis: number }[] };
    expect(dbl.strokes.map((s) => s.startMillis)).toEqual([0, 160]);
  });

  it("a drag from the live screen becomes the nearest swipe on older phones", () => {
    expect(gestureAsSwipe({ type: 'Gesture', strokes: [{ points: [{ x: 500, y: 1800 }, { x: 520, y: 600 }], durationMillis: 300 }] })).toEqual({ type: 'Swipe', direction: 'UP', durationMillis: 300 });
    expect(gestureAsSwipe({ type: 'Gesture', strokes: [{ points: [{ x: 900, y: 1000 }, { x: 100, y: 1050 }] }] })).toMatchObject({ direction: 'LEFT' });
  });
});
