import type { UiNodeSnapshot } from '../AndroidProtocol';
import { AndroidAgent } from './AndroidAgent';
import { buildScreenModel, formatScreen, submitTarget } from './screenModel';

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

const full = (children: UiNodeSnapshot[]) => node({ bounds: [0, 0, 1080, 2400], children });
const rows = (n: number, from = 0) => Array.from({ length: n }, (_, i) => node({ text: `Row ${from + i}`, bounds: [0, 300 + i * 100, 1080, 380 + i * 100] }));

describe('ads on screen', () => {
  it('marks rows the app labels Sponsored, and says how to get past an ad that is playing (YouTube, Oct 9 #3277)', () => {
    const screen = full([
      node({ clickable: true, bounds: [800, 500, 1050, 560], children: [node({ text: 'Skip ad', bounds: [810, 505, 1000, 555] }), node({ text: 'Skip', bounds: [1000, 505, 1040, 555] })] }),
      node({ text: 'Sponsored', clickable: true, bounds: [40, 560, 300, 620] }),
      node({ text: 'Visit advertiser', clickable: true, bounds: [800, 40, 1050, 120] }),
      ...rows(6),
    ]);
    const table = formatScreen(buildScreenModel(screen));
    const marks = table.split('\n').filter((l) => l.startsWith('ADS:'));
    expect(marks).toHaveLength(1);
    expect(marks[0]).toMatch(/^ADS: row 1 is labelled as an ad/);
    expect(marks[0]).toMatch(/An ad is playing: tap "Skip ad" \(row 0\)/);
  });

  it('an ad that cannot be skipped yet: wait for it', () => {
    const table = formatScreen(buildScreenModel(full([node({ text: 'Sponsored · 2 of 2 · 0:12', clickable: true, bounds: [40, 560, 600, 620] }), ...rows(6)])));
    expect(table).toMatch(/An ad is playing and cannot be skipped yet: wait for it to end/);
  });

  it('a Sponsored search result is marked, the songs around it are not', () => {
    const screen = full([
      node({ clickable: true, bounds: [0, 300, 1080, 600], children: [node({ text: 'Buy shoes now', bounds: [20, 320, 900, 380] }), node({ text: 'Sponsored', bounds: [20, 400, 300, 450] })] }),
      node({ clickable: true, bounds: [0, 620, 1080, 900], children: [node({ text: 'Lofi beats to relax', bounds: [20, 640, 900, 700] })] }),
      ...rows(6, 10),
    ]);
    const model = buildScreenModel(screen);
    expect(model.adRows).toEqual(['0']);
    expect(model.adPlaying).toBeUndefined();
    expect(formatScreen(model)).not.toMatch(/is playing/);
  });

  it('words that only contain "ad" are not ads', () => {
    const screen = full([
      node({ text: 'Ad Astra (Official Trailer)', clickable: true, bounds: [0, 300, 1080, 400] }),
      node({ text: 'Add to cart', clickable: true, bounds: [0, 420, 1080, 500] }),
      node({ text: 'Download', clickable: true, bounds: [0, 520, 1080, 600] }),
      node({ text: 'Skip', clickable: true, bounds: [0, 620, 1080, 700] }),
      ...rows(6),
    ]);
    const model = buildScreenModel(screen);
    expect(model.adRows).toBeUndefined();
    expect(model.adPlaying).toBeUndefined();
    expect(formatScreen(model)).not.toMatch(/ADS:/);
  });
});

describe('pop-up in front', () => {
  const app = full(rows(10));
  const dialog = node({
    bounds: [90, 900, 990, 1500],
    children: [node({ text: 'Allow notifications?', bounds: [120, 950, 960, 1050] }), node({ text: 'Allow', clickable: true, bounds: [600, 1350, 950, 1450] })],
  });

  it('says a dialog is in front once the full screen is known, and keeps grid numbers on the whole screen', () => {
    const model = buildScreenModel(dialog, undefined, { width: 1080, height: 2400 });
    expect(model.popup).toBe(true);
    expect(formatScreen(model)).toMatch(/\nPOP-UP: a dialog or pop-up is in front; only its rows are listed/);
    const allow = model.elements.find((e) => e.label === 'Allow')!;
    expect(allow.grid.x).toBe(Math.round((775 / 1080) * 1000));
    expect(allow.grid.y).toBe(Math.round((1400 / 2400) * 1000));
  });

  it("knows Android's own dialogs by their ids even without the full screen size", () => {
    const alert = node({ bounds: [0, 0, 1080, 2400], children: [node({ viewId: 'android:id/parentPanel', bounds: [90, 900, 990, 1500], children: [node({ text: 'Delete?', bounds: [120, 950, 960, 1050] })] })] });
    expect(buildScreenModel(alert).popup).toBe(true);
  });

  it('a normal screen, or the app resized for the keyboard, is not a pop-up', () => {
    expect(buildScreenModel(app, undefined, { width: 1080, height: 2400 }).popup).toBeUndefined();
    const resized = node({ bounds: [0, 0, 1080, 1300], children: rows(8) });
    expect(buildScreenModel(resized, undefined, { width: 1080, height: 2400 }).popup).toBeUndefined();
    expect(formatScreen(buildScreenModel(app))).not.toMatch(/POP-UP/);
  });

  it('the agent learns the full screen from a normal window, then flags the dialog', async () => {
    let current = app;
    const gateway = {
      executeAction: jest.fn(async (_hw: string, action: { type: string }) => {
        if (action.type === 'ObserveScreen') return { status: 'SUCCESS', uiTree: { packageName: 'com.example', root: current }, screenCapture: { base64Data: 'A', width: 540, height: 1200 } };
        return { status: 'SUCCESS', summary: 'done' };
      }),
    };
    const agent = new AndroidAgent(gateway as never, 'hw');
    const read = (agent as unknown as { tools: { name: string; execute: (a: Record<string, unknown>, c: unknown, t: unknown) => Promise<{ content: { text?: string }[] }> }[] }).tools.find((t) => t.name === 'read_ui_tree')!;
    expect((await read.execute({}, {}, {})).content.map((c) => c.text).join('')).not.toMatch(/POP-UP/);
    current = dialog;
    expect((await read.execute({}, {}, {})).content.map((c) => c.text).join('')).toMatch(/POP-UP/);
  });
});

describe('Enter that does not work', () => {
  /** YouTube's search screen on Android 10 after typing "random songs" (#3273, Oct 9). */
  const searchScreen = () =>
    full([
      node({ contentDescription: 'Navigate up', clickable: true, bounds: [0, 100, 160, 200] }),
      node({ text: 'random songs', editable: true, clickable: true, bounds: [160, 100, 940, 200] }),
      node({ contentDescription: 'Search with your voice', clickable: true, bounds: [940, 100, 1080, 200] }),
      node({ text: 'random songs playlist', clickable: true, bounds: [0, 400, 940, 500] }),
      node({ text: 'random songs', clickable: true, bounds: [0, 260, 940, 360] }),
      node({ contentDescription: 'Edit suggestion random songs', clickable: true, bounds: [940, 260, 1080, 360] }),
      ...rows(6, 20),
    ]);

  it('finds the suggestion that repeats the typed text, not the field or the voice button', () => {
    const target = submitTarget(buildScreenModel(searchScreen()), 'Random  Songs');
    expect(target?.label).toBe('random songs');
    expect(target?.editable).toBe(false);
  });

  it('prefers a Search button when there is one, and finds nothing when neither is on screen', () => {
    const withButton = full([node({ text: 'q', editable: true, clickable: true, bounds: [0, 100, 900, 200] }), node({ contentDescription: 'Search', clickable: true, bounds: [900, 100, 1080, 200] }), ...rows(6)]);
    expect(submitTarget(buildScreenModel(withButton), 'lofi')?.label).toBe('Search');
    expect(submitTarget(buildScreenModel(full(rows(8))), 'lofi')).toBeNull();
  });

  it('press_key ENTER refused: taps the matching suggestion and says so', async () => {
    const actions: { type: string; [k: string]: unknown }[] = [];
    const gateway = {
      executeAction: jest.fn(async (_hw: string, action: { type: string; key?: string }) => {
        actions.push(action);
        if (action.type === 'ObserveScreen') return { status: 'SUCCESS', uiTree: { packageName: 'com.google.android.youtube', root: searchScreen() }, screenCapture: { base64Data: 'A' } };
        if (action.type === 'PressKey') return { status: 'FAILURE', code: 'ACTION_REJECTED', message: 'This device runs Android 10, and pressing Enter needs Android 11.', recoverable: true };
        return { status: 'SUCCESS', summary: `${action.type} done` };
      }),
    };
    const agent = new AndroidAgent(gateway as never, 'hw');
    const tools = (agent as unknown as { tools: { name: string; execute: (a: Record<string, unknown>, c: unknown, t: unknown) => Promise<{ content: { text?: string }[]; isError?: boolean }> }[] }).tools;
    const run = (name: string, args: Record<string, unknown>) => tools.find((t) => t.name === name)!.execute(args, {}, {});
    await run('read_ui_tree', {});
    await run('type_text', { text: 'random songs' });
    const result = await run('press_key', { key: 'ENTER' });
    expect(result.isError).toBeFalsy();
    expect(result.content.map((c) => c.text).join('')).toMatch(/Enter does not work in this field on this phone, so "random songs" \(row \d+\) was tapped instead/);
    const tap = actions.filter((a) => a.type === 'Tap').pop() as unknown as { y: number };
    expect(tap.y).toBeGreaterThanOrEqual(260);
    expect(tap.y).toBeLessThanOrEqual(360);
  });

  it('press_key ENTER refused with nothing to tap: the refusal comes back as before', async () => {
    const gateway = {
      executeAction: jest.fn(async (_hw: string, action: { type: string }) => {
        if (action.type === 'ObserveScreen') return { status: 'SUCCESS', uiTree: { packageName: 'x', root: full(rows(8)) }, screenCapture: { base64Data: 'A' } };
        if (action.type === 'PressKey') return { status: 'FAILURE', code: 'ACTION_REJECTED', message: 'The field did not accept Enter.', recoverable: true };
        return { status: 'SUCCESS', summary: 'done' };
      }),
    };
    const agent = new AndroidAgent(gateway as never, 'hw');
    const tools = (agent as unknown as { tools: { name: string; execute: (a: Record<string, unknown>, c: unknown, t: unknown) => Promise<{ content: { text?: string }[]; isError?: boolean }> }[] }).tools;
    await tools.find((t) => t.name === 'read_ui_tree')!.execute({}, {}, {});
    const result = await tools.find((t) => t.name === 'press_key')!.execute({ key: 'ENTER' }, {}, {});
    expect(result.isError).toBe(true);
    expect(gateway.executeAction.mock.calls.filter(([, a]) => (a as { type: string }).type === 'Tap')).toHaveLength(0);
  });
});

describe('open_url with a bare address', () => {
  it('adds https:// to a bare address and leaves everything else alone (Oct 9: 20 of 21 failed open_url calls)', () => {
    const { withScheme } = jest.requireActual('./AndroidAgent') as typeof import('./AndroidAgent');
    expect(withScheme('bbc.com')).toBe('https://bbc.com');
    expect(withScheme('www.reddit.com/r/news?x=1')).toBe('https://www.reddit.com/r/news?x=1');
    expect(withScheme('//example.org/a')).toBe('https://example.org/a');
    expect(withScheme('https://example.com')).toBe('https://example.com');
    expect(withScheme('market://details?id=x')).toBe('market://details?id=x');
    expect(withScheme('random website')).toBe('random website');
  });
});
