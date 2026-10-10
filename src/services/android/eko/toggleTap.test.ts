import type { UiNodeSnapshot } from '../AndroidProtocol';
import { AndroidAgent } from './AndroidAgent';
import { buttonChanges, countActions, type StepRecord } from '../agent/contextBuilder';

let n = 0;
const node = (label: string, box: [number, number, number, number]): UiNodeSnapshot => ({
  path: String(n++), contentDescription: label, bounds: { left: box[0], top: box[1], right: box[2], bottom: box[3] }, clickable: true, editable: false, enabled: true, children: [],
});
/** An Instagram reel: the heart's label stays "Like" whether liked or not. */
const reel = (caption: string) =>
  ({
    path: 'r', bounds: { left: 0, top: 0, right: 1080, bottom: 2400 }, clickable: false, editable: false, enabled: true,
    children: [node('Like', [960, 900, 1040, 980]), node('Comment', [960, 1000, 1040, 1080]), node('Share', [960, 1100, 1040, 1180]), node(caption, [0, 1900, 900, 2000]), node('Reels', [0, 2250, 540, 2400])],
  }) as UiNodeSnapshot;

function phone(frames: boolean) {
  let current = reel('first reel');
  let frame = 0;
  const actions: { type: string }[] = [];
  const gateway = {
    executeAction: jest.fn(async (_hw: string, action: { type: string }) => {
      actions.push(action);
      if (action.type === 'ObserveScreen') return { status: 'SUCCESS', uiTree: { packageName: 'com.instagram.android', root: current }, screenCapture: frames ? { base64Data: `F${frame}` } : undefined };
      if (action.type === 'Tap') frame += 1; // the heart turns red: only the picture changes
      if (action.type === 'Swipe') {
        current = reel(`reel ${frame}`);
        frame += 1;
      }
      return { status: 'SUCCESS', summary: `${action.type} done` };
    }),
  };
  const agent = new AndroidAgent(gateway as never, 'hw');
  const tools = (agent as unknown as { tools: { name: string; execute: (a: Record<string, unknown>, c: unknown, t: unknown) => Promise<{ content: { text?: string }[]; isError?: boolean }> }[] }).tools;
  const run = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await tools.find((t) => t.name === name)!.execute(args, {}, {});
    return { text: r.content.map((c) => c.text ?? '').join(''), isError: Boolean(r.isError) };
  };
  return { run, taps: () => actions.filter((a) => a.type === 'Tap').length };
}

const likeIdx = (listing: string) => listing.split('\n').find((r) => r.includes('|Like|'))!.split('|')[0];

describe('toggles whose label stays the same (Oct 10: 15 of 15 "like 5 reels" runs liked and unliked)', () => {
  it('a Like tap that leaves the list the same is counted as done, not "did NOT change"', async () => {
    const p = phone(false);
    const idx = likeIdx((await p.run('read_ui_tree')).text);
    const r = await p.run('tap_element', { idx });
    expect(r.text).toMatch(/TOGGLED: "Like"/);
    expect(r.text).toMatch(/is a toggle/);
    expect(r.text).not.toMatch(/did NOT change/);
  });

  it('the same Like again before moving on is refused once; after a swipe the next reel’s Like is fine', async () => {
    const p = phone(false);
    const idx = likeIdx((await p.run('read_ui_tree')).text);
    await p.run('tap_element', { idx });
    const again = await p.run('tap_element', { idx });
    expect(again.isError).toBe(true);
    expect(again.text).toMatch(/already tapped "Like" here.*would undo it/);
    expect(p.taps()).toBe(1);
    await p.run('swipe', { direction: 'UP' });
    const next = await p.run('tap_element', { idx: likeIdx((await p.run('read_ui_tree')).text) });
    expect(next.isError).toBe(false);
    expect(p.taps()).toBe(2);
  });

  it('insisting goes through (the first tap may really have missed)', async () => {
    const p = phone(false);
    const idx = likeIdx((await p.run('read_ui_tree')).text);
    await p.run('tap_element', { idx });
    await p.run('tap_element', { idx });
    const third = await p.run('tap_element', { idx });
    expect(third.isError).toBe(false);
    expect(p.taps()).toBe(2);
  });

  it('a non-toggle tap with the same list but a changed picture is not called "did NOT change"', async () => {
    const p = phone(true);
    const listing = (await p.run('read_ui_tree')).text;
    const idx = listing.split('\n').find((r) => r.includes('|Comment|'))!.split('|')[0];
    const r = await p.run('tap_element', { idx });
    expect(r.text).toMatch(/screen image changed/);
    expect(r.text).not.toMatch(/did NOT change/);
  });

  it('DONE SO FAR counts the toggles', () => {
    const step = (text: string): StepRecord => ({ callId: 'x', toolName: 'tap_element', input: {}, thought: '', resultText: text, isError: false });
    const steps = [step('Action succeeded\nTOGGLED: "Like"'), step('Action succeeded\nTOGGLED: "Like"')];
    expect(buttonChanges(steps)).toHaveLength(2);
    expect(countActions(steps)).toMatch(/"Like" → "tapped once" ×2/);
  });
});

describe('a Like that also changes the like count (Oct 10, mission 266)', () => {
  const withCount = (count: string) =>
    ({
      path: 'r', bounds: { left: 0, top: 0, right: 1080, bottom: 2400 }, clickable: false, editable: false, enabled: true,
      children: [node('Like', [960, 900, 1040, 980]), node(count, [960, 985, 1040, 1000]), node('Comment', [960, 1000, 1040, 1080]), node('Share', [960, 1100, 1040, 1180]), node('a reel', [0, 1900, 900, 2000]), node('Reels', [0, 2250, 540, 2400])],
    }) as UiNodeSnapshot;

  it('is still TOGGLED: the button kept its label on the same screen', async () => {
    let current = withCount('1,204');
    const gateway = {
      executeAction: jest.fn(async (_hw: string, action: { type: string }) => {
        if (action.type === 'ObserveScreen') return { status: 'SUCCESS', uiTree: { packageName: 'com.instagram.android', root: current } };
        if (action.type === 'Tap') current = withCount('1,205');
        return { status: 'SUCCESS', summary: `${action.type} done` };
      }),
    };
    const agent = new AndroidAgent(gateway as never, 'hw');
    const tools = (agent as unknown as { tools: { name: string; execute: (a: Record<string, unknown>, c: unknown, t: unknown) => Promise<{ content: { text?: string }[] }> }[] }).tools;
    const run = async (name: string, args: Record<string, unknown> = {}) => (await tools.find((t) => t.name === name)!.execute(args, {}, {})).content.map((c) => c.text ?? '').join('');
    const idx = likeIdx(await run('read_ui_tree'));
    const r = await run('tap_element', { idx });
    expect(r).toMatch(/TOGGLED: "Like"/);
    expect(r).toMatch(/do NOT tap it again/);
  });
});
