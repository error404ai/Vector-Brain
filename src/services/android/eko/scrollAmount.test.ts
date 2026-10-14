import type { UiNodeSnapshot } from '../AndroidProtocol';
import { AndroidAgent } from './AndroidAgent';
import { buildScreenModel, verticalShift } from './screenModel';

let n = 0;
const node = (over: Partial<UiNodeSnapshot> & { box: [number, number, number, number] }): UiNodeSnapshot => {
  const { box, ...rest } = over;
  return { path: String(n++), bounds: { left: box[0], top: box[1], right: box[2], bottom: box[3] }, clickable: false, editable: false, enabled: true, children: [], ...rest };
};

/** A 1080x2400 page: a fixed toolbar and product rows every 200 px, scrolled down by `offset` px. */
function page(offset: number): UiNodeSnapshot {
  const rows: UiNodeSnapshot[] = [node({ text: 'Search Amazon.in', clickable: true, box: [0, 0, 1080, 150] })];
  for (let i = 1; i <= 40; i++) {
    const top = i * 200 - offset;
    if (top < 150 || top + 150 > 2400) continue;
    rows.push(node({ text: `Product ${i} · ₹${500 + i}`, clickable: true, box: [40, top, 1040, top + 150] }));
  }
  return node({ box: [0, 0, 1080, 2400], children: rows });
}

type Tools = { tools: { name: string; parameters: { properties: Record<string, unknown> }; execute: (a: Record<string, unknown>, c: unknown, t: unknown) => Promise<{ content: { text?: string }[]; isError?: boolean }> }[] };

/** An agent on a phone that scrolls by `pagePx` for a list scroll and by the drag's own length for a drag. */
function phone(features: string[], pagePx = 2400) {
  let offset = 0;
  const exec = jest.fn(async (_hw: string, action: Record<string, unknown>) => {
    if (action.type === 'ObserveScreen' || action.type === 'ReadUiTree') return { status: 'SUCCESS', uiTree: { packageName: 'com.android.chrome', root: page(offset) } };
    if (action.type === 'ScrollNode') offset = Math.max(0, offset + (action.direction === 'BACKWARD' ? -pagePx : pagePx));
    if (action.type === 'Gesture') {
      const pts = (action.strokes as { points: { y: number }[] }[])[0].points;
      offset = Math.max(0, offset + (pts[0].y - pts[pts.length - 1].y));
    }
    return { status: 'SUCCESS', summary: `${String(action.type)} done` };
  });
  const gateway = { executeAction: exec, hasFeature: (_: string, f: string) => features.includes(f) };
  const agent = new AndroidAgent(gateway as never, 'hw', undefined, {});
  const tools = (agent as unknown as Tools).tools;
  const run = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await tools.find((t) => t.name === name)!.execute(args, {}, {});
    return { text: r.content.map((c) => c.text ?? '').join(''), isError: Boolean(r.isError) };
  };
  return { exec, run, tools, setPage: (px: number) => (pagePx = px) };
}

describe('scroll_element amount', () => {
  it('small drags a finger slowly over about a quarter of the screen and says how far it moved', async () => {
    const p = phone(['gesture']);
    await p.run('read_ui_tree');
    const r = await p.run('scroll_element', { direction: 'FORWARD', amount: 'small' });
    const gesture = p.exec.mock.calls.map(([, a]) => a).find((a) => a.type === 'Gesture') as { strokes: { points: { x: number; y: number }[]; durationMillis: number }[] };
    const pts = gesture.strokes[0].points;
    expect(pts[0].y).toBeGreaterThan(pts[pts.length - 1].y); // finger goes up: further down the page
    expect(pts[0].y - pts[pts.length - 1].y).toBe(648); // 27% of 2400
    expect(pts.every((pt) => pt.x === 540)).toBe(true);
    expect(gesture.strokes[0].durationMillis).toBe(1500);
    expect(p.exec.mock.calls.some(([, a]) => a.type === 'ScrollNode')).toBe(false);
    expect(r.text).toMatch(/MOVED: about 27% of the screen further down the page\./);
  });

  it('BACKWARD small drags the other way', async () => {
    const p = phone(['gesture']);
    await p.run('read_ui_tree');
    await p.run('scroll_element', { direction: 'FORWARD' });
    const r = await p.run('scroll_element', { direction: 'BACKWARD', amount: 'small' });
    const pts = (p.exec.mock.calls.map(([, a]) => a).filter((a) => a.type === 'Gesture').at(-1) as { strokes: { points: { y: number }[] }[] }).strokes[0].points;
    expect(pts[0].y).toBeLessThan(pts[pts.length - 1].y);
    expect(r.text).toMatch(/about 27% of the screen back up the page/);
  });

  it('a page scroll that jumps past everything says so and points at amount small', async () => {
    const p = phone(['gesture']);
    await p.run('read_ui_tree');
    const r = await p.run('scroll_element', { direction: 'FORWARD' });
    expect(p.exec.mock.calls.some(([, a]) => a.type === 'ScrollNode')).toBe(true);
    expect(r.text).toMatch(/MOVED: more than a screen down; nothing that was on screen before is still in view\. If you wanted only a little, scroll back with amount small\./);
  });

  it('a page scroll that keeps some rows reports the share it moved', async () => {
    const p = phone(['gesture'], 800);
    await p.run('read_ui_tree');
    const r = await p.run('scroll_element', { direction: 'FORWARD' });
    expect(r.text).toMatch(/MOVED: about 33% of the screen further down the page\./);
  });

  it('a scroll that moved nothing is no longer a plain success', async () => {
    const p = phone(['gesture'], 0);
    await p.run('read_ui_tree');
    const r = await p.run('scroll_element', { direction: 'FORWARD' });
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/NOTHING MOVED: the list did not scroll down\./);
  });

  it('four scrolls down and up in turn: told it is overshooting and how to stop', async () => {
    const p = phone(['gesture', 'scroll_until'], 800);
    await p.run('read_ui_tree');
    await p.run('scroll_element', { direction: 'FORWARD' });
    await p.run('scroll_element', { direction: 'FORWARD' });
    const third = await p.run('scroll_element', { direction: 'BACKWARD' });
    expect(third.text).not.toMatch(/BACK AND FORTH/);
    await p.run('scroll_element', { direction: 'FORWARD' });
    const fifth = await p.run('scroll_element', { direction: 'BACKWARD' });
    expect(fifth.text).toMatch(/BACK AND FORTH: .*scroll_until with its text; to move only a little, use scroll_element with amount small/);
  });

  it('phones without finger drags keep the list scroll and are not offered amount', async () => {
    const p = phone([]);
    const tool = p.tools.find((t) => t.name === 'scroll_element')!;
    expect(tool.parameters.properties).not.toHaveProperty('amount');
    expect(phone(['gesture']).tools.find((t) => t.name === 'scroll_element')!.parameters.properties).toHaveProperty('amount');
    await p.run('read_ui_tree');
    const r = await p.run('scroll_element', { direction: 'FORWARD', amount: 'small' });
    expect(p.exec.mock.calls.some(([, a]) => a.type === 'Gesture')).toBe(false);
    expect(p.exec.mock.calls.some(([, a]) => a.type === 'ScrollNode')).toBe(true);
    expect(r.text).not.toMatch(/amount small/);
  });
});

describe('verticalShift', () => {
  const model = (offset: number) => buildScreenModel(page(offset), { width: 1080, height: 2400 });

  it('measures how far the rows moved, leaving out the fixed toolbar', () => {
    expect(verticalShift(model(0), model(600)).shift).toBe(250);
    expect(verticalShift(model(600), model(0)).shift).toBe(-250);
  });

  it('a jump past every row leaves only the fixed toolbar in common', () => {
    const r = verticalShift(model(0), model(4000));
    expect(r.shift).toBe(0); // only the toolbar is left, and it did not move
    expect(r.kept).toBe(1);
    expect(r.total).toBeGreaterThan(6);
  });

  it('no screens: nothing to say', () => {
    expect(verticalShift(null, model(0))).toEqual({ shift: null, kept: 0, total: 0 });
  });
});
