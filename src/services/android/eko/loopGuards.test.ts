import type { UiNodeSnapshot, WindowSnapshot } from '../AndroidProtocol';
import { AndroidAgent } from './AndroidAgent';
import { buildScreenModel } from './screenModel';
import { findObstacle } from './obstacles';

/** Oct 12, #3863/#3864 (Blogger, free model): the loops these guards stop. */

let n = 0;
const node = (over: Partial<UiNodeSnapshot> & { box: [number, number, number, number] }): UiNodeSnapshot => {
  const { box, ...rest } = over;
  return { path: String(n++), bounds: { left: box[0], top: box[1], right: box[2], bottom: box[3] }, clickable: false, editable: false, enabled: true, children: [], ...rest };
};
const screen = (children: UiNodeSnapshot[]) => node({ box: [0, 0, 1080, 2400], children });
const keyboardWindow = (top: number): WindowSnapshot =>
  ({ type: 'keyboard', packageName: 'com.google.android.inputmethod.latin', layer: 2, bounds: { left: 0, top, right: 1080, bottom: 2400 }, active: false, focused: false } as WindowSnapshot);

type Exec = jest.Mock<Promise<Record<string, unknown>>, [string, { type: string; [k: string]: unknown }]>;
function harness(exec: Exec) {
  const agent = new AndroidAgent({ executeAction: exec } as never, 'hw');
  const tools = (agent as unknown as { tools: { name: string; execute: (a: Record<string, unknown>, c: unknown, t: unknown) => Promise<{ content: { text?: string }[]; isError?: boolean }> }[] }).tools;
  const run = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await tools.find((t) => t.name === name)!.execute(args, {}, {});
    return { text: r.content.map((c) => c.text ?? '').join(''), isError: Boolean(r.isError) };
  };
  return { agent, run };
}
const sent = (exec: Exec) => exec.mock.calls.map(([, a]) => a).filter((a) => a.type !== 'ObserveScreen');

const EU = 'European Union laws require you to give European Union visitors information about cookies used on your blog.';

describe('a notice over the page (Blogger EU cookie notice)', () => {
  it('the cookie rule sees the EU notice past the 60-character cut and closes it with its own close button', () => {
    const model = buildScreenModel(
      screen([
        node({ text: 'Notices (1)', clickable: true, box: [40, 200, 1040, 280] }),
        node({ text: 'Cancel notification button.', clickable: true, box: [1000, 280, 1060, 340] }),
        node({ text: EU, box: [40, 360, 1040, 900] }),
        node({ text: 'Learn more', box: [40, 1100, 300, 1160] }),
      ]),
    );
    const match = findObstacle(model, 'com.android.chrome', 'Create a blog on blogger.com');
    expect(match?.rule.id).toBe('cookie_banner');
    expect(match?.element.label).toBe('Cancel notification button.');
    // Not in an app that is not a browser, and not when the task is about cookies.
    expect(findObstacle(model, 'com.whatsapp', 'x')).toBeNull();
    expect(findObstacle(model, 'com.android.chrome', 'read the cookie policy')).toBeNull();
  });

  it('is cleared by rule before the model sees the screen', async () => {
    let notice = true;
    const exec: Exec = jest.fn(async (_hw, action) => {
      if (action.type === 'ObserveScreen') {
        return {
          status: 'SUCCESS',
          uiTree: {
            packageName: 'com.android.chrome',
            root: screen([
              ...(notice ? [node({ text: 'Cancel notification button.', clickable: true, box: [1000, 280, 1060, 340] }), node({ text: EU, box: [40, 360, 1040, 900] })] : []),
              node({ text: 'CREATE YOUR BLOG', clickable: true, box: [200, 1200, 880, 1300] }),
            ]),
          },
        };
      }
      if (action.type === 'Tap' && Number(action.y) < 400) notice = false;
      return { status: 'SUCCESS', summary: 'done' };
    });
    const { run } = harness(exec);
    const r = await run('read_ui_tree');
    expect(r.text).toMatch(/AUTO-CLEARED: Cookie banner \(pressed "Cancel notification button\."\)/);
    expect(notice).toBe(false);
  });
});

describe('the keyboard', () => {
  /** A form whose NEXT sits under the keyboard while it is open, and lower down once it closes. */
  function form() {
    const state = { keyboard: true, value: 'Wanderlust Diaries' };
    const exec: Exec = jest.fn(async (_hw, action) => {
      if (action.type === 'ObserveScreen') {
        return {
          status: 'SUCCESS',
          uiTree: {
            packageName: 'com.android.chrome',
            root: screen([
              node({ text: 'Choose a name for your blog', box: [40, 300, 1040, 380] }),
              node({ text: state.value, editable: true, clickable: true, focused: true, box: [40, 600, 1040, 700] }),
              node({ text: 'NEXT', clickable: true, box: [800, state.keyboard ? 1500 : 1700, 1040, state.keyboard ? 1600 : 1800] }),
            ]),
            windows: state.keyboard ? [keyboardWindow(1300)] : [],
          },
        };
      }
      if (action.type === 'Global' && action.action === 'BACK') state.keyboard = false;
      if (action.type === 'PressKey' && action.key === 'BACKSPACE') state.value = state.value.slice(0, -1);
      if (action.type === 'SetText') state.value = String(action.text);
      return { status: 'SUCCESS', summary: `${action.type} done` };
    });
    return { state, exec, ...harness(exec) };
  }

  it('a tap on a button under the keyboard closes the keyboard first, then taps the button where it is now', async () => {
    const { exec, run } = form();
    await run('read_ui_tree');
    const r = await run('tap_element', { idx: '2' });
    const actions = sent(exec);
    expect(actions[0]).toEqual({ type: 'Global', action: 'BACK' });
    expect(actions[1]).toMatchObject({ type: 'Tap', y: 1750 });
    expect(r.text).toMatch(/keyboard was covering it, so the keyboard was closed first/);
  });

  it('press_key BACK and HIDE_KEYBOARD close it; BACKSPACE is capped at 3 in a row', async () => {
    const { exec, run, state } = form();
    await run('read_ui_tree');
    for (let i = 0; i < 3; i += 1) expect((await run('press_key', { key: 'BACKSPACE' })).isError).toBe(false);
    const fourth = await run('press_key', { key: 'BACKSPACE' });
    expect(fourth.isError).toBe(true);
    expect(fourth.text).toMatch(/BACKSPACE deletes one letter; it does not close the keyboard.*type_text with the WHOLE correct value/s);
    expect(state.value).toBe('Wanderlust Diar');
    const back = await run('press_key', { key: 'HIDE_KEYBOARD' });
    expect(back.text).toMatch(/keyboard was open, so BACK closed it/);
    expect(sent(exec).filter((a) => a.type === 'Global')).toEqual([{ type: 'Global', action: 'BACK' }]);
    expect((await run('press_key', { key: 'HIDE_KEYBOARD' })).text).toMatch(/keyboard is not open/);
  });

  it('a swipe closes the keyboard first, so it does not glide-type words into the field', async () => {
    const { exec, run } = form();
    await run('read_ui_tree');
    const r = await run('swipe', { direction: 'UP' });
    const actions = sent(exec);
    expect(actions[0]).toEqual({ type: 'Global', action: 'BACK' });
    expect(actions[1]).toMatchObject({ type: 'Swipe' });
    expect(r.text).toMatch(/keyboard was open, so it was closed first/);
  });

  it('a few letters typed over an earlier value are questioned once (type_text replaces the field)', async () => {
    const { run, state } = form();
    await run('read_ui_tree');
    await run('type_text', { text: 'Wanderlust Diaries' });
    state.value = 'Wanderlust Diarie';
    await run('read_ui_tree');
    const first = await run('type_text', { text: 's' });
    expect(first.isError).toBe(true);
    expect(first.text).toMatch(/REPLACES the whole field.*would leave only "s"/s);
    expect(state.value).toBe('Wanderlust Diarie');
    await run('type_text', { text: 's' });
    expect(state.value).toBe('s');
  });
});

describe('repeats on a screen that does not move', () => {
  const still = () => {
    const exec: Exec = jest.fn(async (_hw, action) => {
      if (action.type === 'ObserveScreen') {
        return {
          status: 'SUCCESS',
          uiTree: {
            packageName: 'com.android.chrome',
            root: screen([node({ text: 'Blogger', box: [40, 100, 400, 180] }), node({ text: 'Google Account', clickable: true, box: [880, 100, 1040, 200] }), node({ text: 'Other', clickable: true, box: [40, 1000, 400, 1100] })]),
          },
        };
      }
      return { status: 'SUCCESS', summary: 'done' };
    });
    return { exec, ...harness(exec) };
  };

  it('waiting on a settled screen a third time is refused, with the screen', async () => {
    const { run } = still();
    await run('read_ui_tree');
    expect((await run('wait', { durationMillis: 1500 })).isError).toBe(false);
    expect((await run('wait', { durationMillis: 1500 })).isError).toBe(false);
    const third = await run('wait', { durationMillis: 1500 });
    expect(third.isError).toBe(true);
    expect(third.text).toMatch(/Not waited: you already waited 2 times.*CURRENT SCREEN ELEMENTS/s);
  });

  it('the same spot on the same screen a fourth time is refused', async () => {
    const { run } = still();
    await run('read_ui_tree');
    // Another element in between, so the "tapped a moment ago" guard is not what stops it.
    for (let i = 0; i < 3; i += 1) {
      expect((await run('tap_coordinate', { x: 888, y: 62 })).text).not.toMatch(/Not tapped: you have tapped this spot/);
      await run('tap_element', { idx: '2' });
    }
    const fourth = await run('tap_coordinate', { x: 888, y: 62 });
    expect(fourth.isError).toBe(true);
    expect(fourth.text).toMatch(/tapped this spot \("Google Account"\) 3 times on this exact screen/);
  });
});
