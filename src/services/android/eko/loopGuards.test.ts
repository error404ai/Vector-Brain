import type { UiNodeSnapshot, WindowSnapshot } from '../AndroidProtocol';
import { AndroidAgent, actionCycle, stableArgs } from './AndroidAgent';
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
function harness(exec: Exec, options: ConstructorParameters<typeof AndroidAgent>[3] = {}) {
  const agent = new AndroidAgent({ executeAction: exec } as never, 'hw', undefined, options);
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

describe('another phone\'s account (Oct 13, #3866 signed phone 68\'s Gmail into phone 63)', () => {
  const accounts = { own: ['lucy@gmail.com'], others: [{ email: 'kai@gmail.com', device: 'OPPO B' }] };
  const chooser = () => {
    const exec: Exec = jest.fn(async (_hw, action) => {
      if (action.type === 'ObserveScreen') {
        return {
          status: 'SUCCESS',
          uiTree: {
            packageName: 'com.android.chrome',
            root: screen([
              node({ text: 'Choose an account', box: [40, 200, 1040, 300] }),
              node({ text: 'Lucy Hartley lucy@gmail.com', clickable: true, box: [40, 400, 1040, 500] }),
              node({ text: 'Kai Harding kai@gmail.com', clickable: true, box: [40, 520, 1040, 620] }),
              node({ text: 'Use another account', clickable: true, box: [40, 640, 1040, 740] }),
              node({ text: '', editable: true, clickable: true, focused: true, box: [40, 900, 1040, 1000] }),
            ]),
          },
        };
      }
      return { status: 'SUCCESS', summary: 'done' };
    });
    return { exec, ...harness(exec, { task: 'Open blogger.com and sign in with kai@gmail.com', accounts }) };
  };

  it('never types or picks it, even when the task names it, and says whose it is', async () => {
    const { run, exec } = chooser();
    await run('read_ui_tree');
    const typed = await run('type_text', { text: 'kai@gmail.com' });
    expect(typed.isError).toBe(true);
    expect(typed.text).toMatch(/account of another phone \("OPPO B"\).*this phone's account is lucy@gmail\.com/s);
    const picked = await run('tap_element', { idx: '2' });
    expect(picked.isError).toBe(true);
    expect((await run('click_node', { text: 'Kai Harding kai@gmail.com' })).isError).toBe(true);
    expect(sent(exec).filter((a) => a.type === 'Tap' || a.type === 'SetText' || a.type === 'ClickNode')).toHaveLength(0);
  });

  it('"Use another account" only for an account the task gives that no phone has', async () => {
    const { run } = chooser();
    await run('read_ui_tree');
    expect((await run('tap_element', { idx: '3' })).text).toMatch(/signs a different account in/);
    expect((await run('tap_element', { idx: '1' })).isError).toBe(false);
    const fresh = harness(jest.fn(async (_hw, action) => (action.type === 'ObserveScreen' ? (await chooser().exec('hw', action)) : { status: 'SUCCESS', summary: 'done' })) as Exec, {
      task: 'Sign in with new.person@gmail.com',
      accounts,
    });
    await fresh.run('read_ui_tree');
    expect((await fresh.run('tap_element', { idx: '3' })).isError).toBe(false);
    expect((await fresh.run('type_text', { text: 'made.up@gmail.com' })).text).toMatch(/not this phone's account.*task does not give it/s);
  });
});

describe('a field that already holds what was typed earlier (Oct 13, #3869: the title went into the body)', () => {
  it('different text over it is questioned once', async () => {
    let value = '';
    const exec: Exec = jest.fn(async (_hw, action) => {
      if (action.type === 'ObserveScreen') {
        return { status: 'SUCCESS', uiTree: { packageName: 'com.android.chrome', root: screen([node({ text: value, editable: true, clickable: true, focused: true, box: [40, 900, 1040, 1400] })]) } };
      }
      if (action.type === 'SetText') value = String(action.text);
      return { status: 'SUCCESS', summary: 'done' };
    });
    const { run } = harness(exec);
    await run('read_ui_tree');
    await run('type_text', { text: 'Chasing Sunsets on the Coast' });
    const body = await run('type_text', { text: 'The road wound along the cliffs for hours before the first village.' });
    expect(body.isError).toBe(true);
    expect(body.text).toMatch(/already holds "Chasing Sunsets on the Coast".*tap that field first/s);
    expect(value).toBe('Chasing Sunsets on the Coast');
    // A correction of the same value is not questioned.
    expect((await run('type_text', { text: 'Chasing Sunsets on the Coastline' })).isError).toBe(false);
  });
});

describe('going round the same screens (Oct 13, #3870: 32 steps of guessed URLs, "Main menu" never opened)', () => {
  it('a cycle of two or three actions is a loop; scrolling through a feed is not', () => {
    const a = 'open_url:url=https://www.blogger.com/';
    const b = 'open_url:url=https://www.blogger.com/blog/create';
    const c = 'open_url:url=https://www.blogger.com/blog/posts';
    expect(actionCycle([a, b, a, b])).toBe(true);
    expect(actionCycle([a, b, c, a, b, c])).toBe(true);
    expect(actionCycle([a, a, a])).toBe(true);
    expect(actionCycle(['tap_element:idx=3', 'swipe:direction=UP', 'tap_element:idx=3', 'swipe:direction=UP'])).toBe(false);
    expect(actionCycle([a, b, c])).toBe(false);
    expect(stableArgs({ idx: '"5"', px_x: 3 })).toBe('idx=5');
  });

  it('the stuck note names the menus not opened yet', async () => {
    const exec: Exec = jest.fn(async (_hw, action) => {
      if (action.type === 'ObserveScreen') {
        return {
          status: 'SUCCESS',
          uiTree: {
            packageName: 'com.android.chrome',
            root: screen([
              node({ contentDescription: 'Main menu', clickable: true, box: [0, 100, 120, 220] }),
              node({ text: 'Blogger', box: [140, 100, 500, 220] }),
              node({ text: 'All (1)', clickable: true, box: [40, 300, 400, 380] }),
              node({ text: 'Untitled', clickable: true, box: [40, 400, 1040, 600] }),
              node({ contentDescription: 'Create new post', clickable: true, box: [900, 2100, 1040, 2240] }),
            ]),
          },
        };
      }
      return { status: 'SUCCESS', summary: 'done' };
    });
    const { run } = harness(exec);
    await run('read_ui_tree');
    await run('open_url', { url: 'https://www.blogger.com/' });
    await run('open_url', { url: 'https://www.blogger.com/blog/create' });
    await run('open_url', { url: 'https://www.blogger.com/' });
    const fourth = await run('open_url', { url: 'https://www.blogger.com/blog/create' });
    expect(fourth.text).toMatch(/STUCK: you keep going round.*Menus on this screen you have not opened yet: "Main menu" \(idx 0\)/s);
  });
});

describe('refused again and again (Oct 13, #3873: one refused tap 30 times, 60 steps)', () => {
  it('names untried options from the 3rd refusal and stops the run at the 6th; a re-tapped chip is called out', async () => {
    const exec: Exec = jest.fn(async (_hw, action) => {
      if (action.type === 'ObserveScreen') {
        return {
          status: 'SUCCESS',
          uiTree: {
            packageName: 'com.android.chrome',
            root: screen([
              node({ text: 'Choose 3 topics or more to continue', box: [40, 200, 1040, 300] }),
              node({ text: 'Technology', clickable: true, box: [40, 400, 400, 480] }),
              node({ text: 'AI', clickable: true, box: [440, 400, 700, 480] }),
              node({ text: 'Android', clickable: true, box: [40, 520, 400, 600] }),
              node({ text: 'Continue', clickable: true, box: [600, 2000, 1040, 2100] }),
            ]),
          },
        };
      }
      return { status: 'SUCCESS', summary: 'done' };
    });
    const onStuck = jest.fn();
    const agent = new AndroidAgent({ executeAction: exec } as never, 'hw', { onStuck });
    const tools = (agent as unknown as { tools: { name: string; execute: (a: Record<string, unknown>, c: unknown, t: unknown) => Promise<{ content: { text?: string }[]; isError?: boolean }> }[] }).tools;
    const run = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await tools.find((t) => t.name === name)!.execute(args, {}, {});
      return { text: r.content.map((c) => c.text ?? '').join(''), isError: Boolean(r.isError) };
    };
    await run('read_ui_tree');
    await run('tap_element', { idx: '2' });
    const again = await run('tap_element', { idx: '1' });
    expect(again.text).not.toMatch(/ALREADY TAPPED/);
    const third = await run('tap_element', { idx: '2' });
    expect(third.text).toMatch(/ALREADY TAPPED: "AI" was tapped 1 time before/);
    // Now the same refused tap over and over, with looks in between.
    let last = { text: '', isError: false };
    for (let i = 0; i < 6; i += 1) {
      last = await run('tap_element', { idx: '2' });
      await run('read_ui_tree');
    }
    expect(last.isError).toBe(true);
    expect(onStuck).toHaveBeenCalledTimes(1);
    expect(last.text).toMatch(/^Not tapped/);
  });
});

describe('swipes tell the truth (Oct 13: every swipe went the wrong way, 56 of 95 moved nothing)', () => {
  /** A reels feed: item n on screen; finger UP shows n+1, DOWN shows n-1, stuck when `stuck` says so. */
  function feed(opts: { stuckUp?: 'short' | 'always'; start?: number } = {}) {
    let item = opts.start ?? 1;
    const exec: Exec = jest.fn(async (_hw, action) => {
      if (action.type === 'ObserveScreen') {
        return {
          status: 'SUCCESS',
          uiTree: { packageName: 'com.instagram.android', root: screen([node({ text: `creator_${item}`, clickable: true, box: [40, 1800, 600, 1880] }), node({ contentDescription: 'Like', clickable: true, box: [900, 1200, 1040, 1320] })]) },
        };
      }
      const up = (action.type === 'Swipe' && action.direction === 'UP') || (action.type === 'Gesture' && (action.strokes as { points: { y: number }[] }[])[0].points[0].y > 1500);
      const down = (action.type === 'Swipe' && action.direction === 'DOWN') || (action.type === 'Gesture' && (action.strokes as { points: { y: number }[] }[])[0].points[0].y < 900);
      const strong = action.type === 'Gesture' || (action.type === 'Swipe' && action.durationMillis === 250);
      if (up && !(opts.stuckUp === 'always' || (opts.stuckUp === 'short' && !strong))) item += 1;
      if (down && item > 1) item -= 1;
      return { status: 'SUCCESS', summary: 'Gesture completed' };
    });
    return { exec, ...harness(exec), now: () => item };
  }

  it('UP goes to the phone as UP and says MOVED', async () => {
    const { run, exec, now } = feed();
    await run('read_ui_tree');
    const r = await run('swipe', { direction: 'UP' });
    expect(sent(exec)[0]).toMatchObject({ type: 'Swipe', direction: 'UP' });
    expect(r.text).toMatch(/MOVED: new content is on screen/);
    expect(now()).toBe(2);
  });

  it('a short swipe that is ignored is made again, longer and faster', async () => {
    const { run, now } = feed({ stuckUp: 'short' });
    await run('read_ui_tree');
    const r = await run('swipe', { direction: 'UP' });
    expect(r.text).toMatch(/first swipe moved nothing, so a longer, faster one was made/);
    expect(now()).toBe(2);
  });

  it('at the end of a list it tries the other way once and says the screen shows the previous item', async () => {
    const { run, now } = feed({ stuckUp: 'always', start: 3 });
    await run('read_ui_tree');
    const r = await run('swipe', { direction: 'UP' });
    expect(r.text).toMatch(/NOTHING MOVED going UP \(tried twice\)\. Going DOWN did move.*PREVIOUS item/s);
    expect(now()).toBe(2);
  });
});

describe('a run that goes nowhere is stopped', () => {
  const still = (opts: ConstructorParameters<typeof AndroidAgent>[3] = {}) => {
    const exec: Exec = jest.fn(async (_hw, action) => {
      if (action.type === 'ObserveScreen') {
        return { status: 'SUCCESS', uiTree: { packageName: 'com.android.chrome', root: screen(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N'].map((t, i) => node({ text: `Item ${t}`, clickable: true, box: [40, 100 + i * 120, 1040, 200 + i * 120] }))) } };
      }
      return { status: 'SUCCESS', summary: 'done' };
    });
    const onStuck = jest.fn();
    const agent = new AndroidAgent({ executeAction: exec } as never, 'hw', { onStuck }, opts);
    const tools = (agent as unknown as { tools: { name: string; execute: (a: Record<string, unknown>, c: unknown, t: unknown) => Promise<{ content: { text?: string }[]; isError?: boolean }> }[] }).tools;
    const run = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await tools.find((t) => t.name === name)!.execute(args, {}, {});
      return { text: r.content.map((c) => c.text ?? '').join(''), isError: Boolean(r.isError) };
    };
    return { run, onStuck };
  };

  it('12 actions with no new screen and nothing changed stop it (NO_PROGRESS), with a warning at 8', async () => {
    const { run, onStuck } = still();
    await run('read_ui_tree');
    const texts: string[] = [];
    // The first tap meets the screen for the first time (progress); the next 12 bring nothing.
    for (let i = 0; i < 13; i += 1) texts.push((await run('tap_element', { idx: String(i) })).text);
    expect(texts.join('\n')).toMatch(/NO PROGRESS: your last 8 actions/);
    expect(onStuck).toHaveBeenCalledWith(expect.stringMatching(/12 actions in a row/), 'NO_PROGRESS');
  });

  it('the same steps a third time stop it sooner (AGENT_LOOP)', async () => {
    const { run, onStuck } = still();
    await run('read_ui_tree');
    for (let i = 0; i < 3; i += 1) {
      await run('tap_element', { idx: '1' });
      await run('tap_element', { idx: '2' });
      await run('tap_element', { idx: '3' });
    }
    expect(onStuck).toHaveBeenCalledWith(expect.stringMatching(/same 3 steps 3 times/), 'AGENT_LOOP');
  });

  it('a timed run is never stopped for staying put', async () => {
    const { run, onStuck } = still({ timed: true });
    await run('read_ui_tree');
    for (let i = 0; i < 14; i += 1) await run('tap_element', { idx: String(i) });
    expect(onStuck).not.toHaveBeenCalled();
  });
});
