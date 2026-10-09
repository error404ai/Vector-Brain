import type { UiNodeSnapshot } from '../AndroidProtocol';
import { AndroidAgent } from './AndroidAgent';
import { buildScreenModel, elementAt, formatScreen, isThin, toPixels } from './screenModel';

let pathCounter = 0;
function node(partial: Omit<Partial<UiNodeSnapshot>, 'bounds'> & { bounds: [number, number, number, number] }): UiNodeSnapshot {
  const [left, top, right, bottom] = partial.bounds;
  return {
    path: String(pathCounter++),
    className: partial.className ?? 'android.view.View',
    text: partial.text,
    contentDescription: partial.contentDescription,
    viewId: partial.viewId,
    bounds: { left, top, right, bottom },
    clickable: partial.clickable ?? false,
    editable: partial.editable ?? false,
    enabled: partial.enabled ?? true,
    children: partial.children ?? [],
  };
}

/** A Play Store result row as Compose exposes it: an unlabelled tappable box, its text on a child. */
function playStore(buttonText: string, width = 1080, height = 2400): UiNodeSnapshot {
  const filler = Array.from({ length: 8 }, (_, i) => node({ text: `Line ${i}`, bounds: [0, 1500 + i * 60, width, 1550 + i * 60] }));
  return node({
    bounds: [0, 0, width, height],
    children: [
      node({ text: 'X', bounds: [100, 1150, 700, 1250] }),
      node({
        clickable: true,
        bounds: [Math.round(width * 0.8), 1150, Math.round(width * 0.95), 1250],
        children: [node({ text: buttonText, className: 'android.widget.TextView', bounds: [Math.round(width * 0.82), 1170, Math.round(width * 0.93), 1230] })],
      }),
      ...filler,
    ],
  });
}

describe('screen model', () => {
  it('gives a tappable box the text inside it and does not list that text twice', () => {
    const model = buildScreenModel(playStore('Install'));
    const table = formatScreen(model);
    const installRows = table.split('\n').filter((row) => row.includes('Install'));
    expect(installRows).toHaveLength(1);
    expect(installRows[0]).toMatch(/\|Install\|t\|/);
  });

  it('puts the same button at the same grid point on a 720 px and a 1080 px phone', () => {
    const small = buildScreenModel(playStore('Install', 720, 1600)).elements.find((e) => e.label === 'Install')!;
    const large = buildScreenModel(playStore('Install', 1080, 2400)).elements.find((e) => e.label === 'Install')!;
    expect(Math.abs(small.grid.x - large.grid.x)).toBeLessThanOrEqual(2);
    expect(small.px.x).not.toBe(large.px.x);
    expect(toPixels(500, 720)).toBe(360);
    expect(toPixels(500, 1080)).toBe(540);
  });

  it('finds the element under a grid point, and calls a screen of unlabelled buttons thin', () => {
    const model = buildScreenModel(playStore('Install'));
    const install = model.elements.find((e) => e.label === 'Install')!;
    expect(elementAt(model, install.grid.x, install.grid.y)?.label).toBe('Install');
    const blank = node({ bounds: [0, 0, 1080, 2400], children: Array.from({ length: 6 }, (_, i) => node({ clickable: true, bounds: [0, i * 300, 1080, i * 300 + 200] })) });
    expect(isThin(buildScreenModel(blank))).toBe(true);
    expect(isThin(model)).toBe(false);
  });
});

function fakePhone(screens: UiNodeSnapshot[]) {
  let current = 0;
  const actions: { type: string; [k: string]: unknown }[] = [];
  const gateway = {
    executeAction: jest.fn(async (_hw: string, action: { type: string }) => {
      actions.push(action);
      if (action.type === 'ObserveScreen') {
        return { status: 'SUCCESS', uiTree: { packageName: 'com.android.vending', root: screens[Math.min(current, screens.length - 1)] }, screenCapture: { base64Data: 'AAAA' } };
      }
      if (action.type === 'Tap') current += 1;
      return { status: 'SUCCESS', summary: `${action.type} done` };
    }),
  };
  return { gateway, actions, setScreen: (i: number) => (current = i) };
}

const tool = (agent: AndroidAgent, name: string) => (agent as unknown as { tools: { name: string; execute: (a: Record<string, unknown>, c: unknown, t: unknown) => Promise<{ content: { type: string; text?: string }[]; isError?: boolean }> }[] }).tools.find((t) => t.name === name)!;
const text = (r: { content: { type: string; text?: string }[] }) => r.content.map((c) => c.text ?? '').join('\n');

describe('AndroidAgent taps', () => {
  it('taps by idx at the real pixel spot of that phone', async () => {
    const phone = fakePhone([playStore('Install', 720, 1600), playStore('Cancel', 720, 1600)]);
    const agent = new AndroidAgent(phone.gateway as never, 'hw');
    const listing = text(await tool(agent, 'read_ui_tree').execute({}, {}, {}));
    const idx = listing.split('\n').find((row) => row.includes('|Install|'))!.split('|')[0];
    await tool(agent, 'tap_element').execute({ idx }, {}, {});
    const tap = phone.actions.find((a) => a.type === 'Tap')!;
    expect(tap.x).toBeGreaterThan(560);
    expect(tap.x).toBeLessThan(700);
  });

  it('refuses to tap the spot that turned from Install into Cancel', async () => {
    const phone = fakePhone([playStore('Install'), playStore('Cancel')]);
    const agent = new AndroidAgent(phone.gateway as never, 'hw');
    const listing = text(await tool(agent, 'read_ui_tree').execute({}, {}, {}));
    const row = listing.split('\n').find((r) => r.includes('|Install|'))!;
    const [x, y] = row.split('|')[4].split(',').map(Number);
    await tool(agent, 'tap_coordinate').execute({ x, y }, {}, {});
    const second = await tool(agent, 'tap_coordinate').execute({ x: x + 5, y }, {}, {});
    expect(second.isError).toBe(true);
    expect(text(second)).toMatch(/was "Install" and is now "Cancel"/);
    expect(phone.actions.filter((a) => a.type === 'Tap')).toHaveLength(1);
  });

  it('says when a tap changed nothing, and will not repeat it on the same screen', async () => {
    const same = playStore('Install');
    const phone = fakePhone([same, same, same]);
    const agent = new AndroidAgent(phone.gateway as never, 'hw');
    await tool(agent, 'read_ui_tree').execute({}, {}, {});
    // Nothing in the list is at 100,100: the guess is questioned once, not tapped.
    const guess = await tool(agent, 'tap_coordinate').execute({ x: 100, y: 100 }, {}, {});
    expect(guess.isError).toBe(true);
    expect(text(guess)).toMatch(/so this is a guess/);
    expect(phone.actions.filter((a) => a.type === 'Tap')).toHaveLength(0);
    // The same point again is taken as meant.
    const first = await tool(agent, 'tap_coordinate').execute({ x: 100, y: 100 }, {}, {});
    expect(text(first)).toMatch(/did NOT change/);
    const again = await tool(agent, 'tap_coordinate').execute({ x: 102, y: 101 }, {}, {});
    expect(again.isError).toBe(true);
    expect(phone.actions.filter((a) => a.type === 'Tap')).toHaveLength(1);
  });

  it('rejects coordinates off the 0–1000 grid instead of tapping somewhere random', async () => {
    const phone = fakePhone([playStore('Install')]);
    const agent = new AndroidAgent(phone.gateway as never, 'hw');
    const res = await tool(agent, 'tap_coordinate').execute({ x: 936, y: 1200 }, {}, {});
    expect(res.isError).toBe(true);
    expect(phone.actions.some((a) => a.type === 'Tap')).toBe(false);
  });

  it('waits until the screen is still instead of a fixed pause', async () => {
    const phone = fakePhone([playStore('Install')]);
    const agent = new AndroidAgent(phone.gateway as never, 'hw');
    const started = Date.now();
    const res = await tool(agent, 'wait').execute({ durationMillis: 10_000 }, {}, {});
    expect(text(res)).toMatch(/Screen settled/);
    expect(Date.now() - started).toBeLessThan(4000);
    expect(phone.actions.some((a) => a.type === 'Wait')).toBe(false);
  });

  it('lets a text-only model tap what a vision helper read off a thin screen', async () => {
    const blank = node({ bounds: [0, 0, 1080, 2400], children: Array.from({ length: 5 }, (_, i) => node({ clickable: true, bounds: [0, i * 300, 1080, i * 300 + 200] })) });
    const phone = fakePhone([blank]);
    const grounder = jest.fn(async () => [{ label: 'Accept all', x: 500, y: 900, kind: 'button' }]);
    const agent = new AndroidAgent(phone.gateway as never, 'hw', undefined, { grounder });
    const listing = text(await tool(agent, 'read_ui_tree').execute({}, {}, {}));
    expect(listing).toMatch(/v1\|button\|Accept all\|t\|500,900/);
    await tool(agent, 'tap_element').execute({ idx: 'v1' }, {}, {});
    const tap = phone.actions.find((a) => a.type === 'Tap')!;
    expect(tap).toMatchObject({ x: 540, y: 2160 });
    expect(grounder).toHaveBeenCalledTimes(1);
  });
});

describe('screenshots to the model', () => {
  const tapButton = async (agent: AndroidAgent, label: string) => {
    const listing = text(await tool(agent, 'read_ui_tree').execute({}, {}, {}));
    const idx = listing.split('\n').find((row) => row.includes(`|${label}|`))!.split('|')[0];
    return tool(agent, 'tap_element').execute({ idx }, {}, {});
  };
  const hasImage = (r: { content: { type: string }[] }) => r.content.some((c) => c.type === 'image');

  it('sends the frame after every action when set to every step', async () => {
    const phone = fakePhone([playStore('Open'), playStore('Next')]);
    const agent = new AndroidAgent(phone.gateway as never, 'hw', undefined, { vision: true, screenshots: 'every_step' });
    expect(hasImage(await tapButton(agent, 'Open'))).toBe(true);
  });

  it('sends none on a normal step when set to "when stuck"', async () => {
    const phone = fakePhone([playStore('Open'), playStore('Next')]);
    const agent = new AndroidAgent(phone.gateway as never, 'hw', undefined, { vision: true, screenshots: 'stuck' });
    expect(hasImage(await tapButton(agent, 'Open'))).toBe(false);
  });

  it('notices going back and forth between two screens and shows the screen once', async () => {
    const a = playStore('Open');
    const b = playStore('Next');
    const phone = fakePhone([a, b, a, b, a, b]);
    const agent = new AndroidAgent(phone.gateway as never, 'hw', undefined, { vision: true, screenshots: 'stuck' });
    await tapButton(agent, 'Open');
    await tapButton(agent, 'Next');
    await tapButton(agent, 'Open');
    const fourth = await tapButton(agent, 'Next');
    expect(text(fourth)).toMatch(/STUCK: you are going back and forth/);
    expect(hasImage(fourth)).toBe(true);
  });

  it('says it is stuck but sends no screenshot when screenshots are off', async () => {
    const a = playStore('Open');
    const b = playStore('Next');
    const phone = fakePhone([a, b, a, b, a, b]);
    const agent = new AndroidAgent(phone.gateway as never, 'hw', undefined, { vision: true, screenshots: 'off' });
    await tapButton(agent, 'Open');
    await tapButton(agent, 'Next');
    await tapButton(agent, 'Open');
    const fourth = await tapButton(agent, 'Next');
    expect(text(fourth)).toMatch(/STUCK/);
    expect(hasImage(fourth)).toBe(false);
  });

  // Oct 7: "Off" still sent the screen on unreadable screens (Facebook update, Play sign-in).
  it('sends nothing at all when screenshots are off — not on a thin screen, not to a helper, no screenshot tool', async () => {
    const blank = node({ bounds: [0, 0, 1080, 2400], children: Array.from({ length: 5 }, (_, i) => node({ clickable: true, bounds: [0, i * 300, 1080, i * 300 + 200] })) });
    const phone = fakePhone([blank, blank, blank]);
    const grounder = jest.fn(async () => [{ label: 'Accept all', x: 500, y: 900, kind: 'button' }]);
    const agent = new AndroidAgent(phone.gateway as never, 'hw', undefined, { vision: true, grounder, screenshots: 'off' });
    const listing = await tool(agent, 'read_ui_tree').execute({}, {}, {});
    expect(hasImage(listing)).toBe(false);
    expect(text(listing)).toMatch(/screenshots are off/);
    expect(grounder).not.toHaveBeenCalled();
    await tool(agent, 'wait').execute({ durationMillis: 1000 }, {}, {});
    const again = await tool(agent, 'wait').execute({ durationMillis: 1000 }, {}, {});
    expect(hasImage(again)).toBe(false);
    expect((agent as unknown as { tools: { name: string }[] }).tools.some((t) => t.name === 'capture_screen')).toBe(false);
    expect(await agent.systemPrompt()).toMatch(/screenshots are off for this account/);
  });

  it('"when stuck" does not show a thin screen until the agent is stuck (Oct 9: an image after nearly every open_url)', async () => {
    const blank = node({ bounds: [0, 0, 1080, 2400], children: Array.from({ length: 5 }, (_, i) => node({ clickable: true, bounds: [0, i * 300, 1080, i * 300 + 200] })) });
    const phone = fakePhone([blank]);
    const agent = new AndroidAgent(phone.gateway as never, 'hw', undefined, { vision: true, screenshots: 'stuck' });
    const listing = await tool(agent, 'read_ui_tree').execute({}, {}, {});
    expect(hasImage(listing)).toBe(false);
    expect(text(listing)).toMatch(/If you get stuck, you will be shown a screenshot/);
  });

  it('"every step" shows a thin screen', async () => {
    const blank = node({ bounds: [0, 0, 1080, 2400], children: Array.from({ length: 5 }, (_, i) => node({ clickable: true, bounds: [0, i * 300, 1080, i * 300 + 200] })) });
    const phone = fakePhone([blank]);
    const agent = new AndroidAgent(phone.gateway as never, 'hw', undefined, { vision: true, screenshots: 'every_step' });
    expect(hasImage(await tool(agent, 'read_ui_tree').execute({}, {}, {}))).toBe(true);
  });
});
