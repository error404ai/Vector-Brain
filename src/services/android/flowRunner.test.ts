import { FlowRunner, type ReplayScreen } from './flowRunner';
import { recordFlow, type RecordedStep } from './flowSteps';

const table = (rows: string[]) => ['idx|type|label|flags|tap_at', ...rows].join('\n');
const PKG = 'com.google.android.youtube';
const HOME = table(['0|text|YouTube|t|80,40', '1|imgbtn|Search|t|900,40', '2|view|Home|t|100,960', '3|view|Shorts|t|300,960']);
const SEARCH = table(['0|input|Search YouTube|te|450,40', '1|imgbtn|Navigate up|t|40,40', '2|text|Recent searches||100,200']);
const TYPED = table(['0|input|cats|te|450,40', '1|imgbtn|Navigate up|t|40,40']);
const RESULTS = table(['0|text|Filters|t|900,120', '1|view|Cats compilation|t|500,400', '2|view|Home|t|100,960']);

const logged = (action: string, payload: Record<string, unknown>, before: string, after: string, typed?: string): RecordedStep => ({
  action,
  payload,
  ok: true,
  treeBefore: before,
  treeAfter: after,
  pkgBefore: PKG,
  pkgAfter: PKG,
  screenBefore: before,
  screenAfter: after,
  typed,
});

const flow = recordFlow('Search YouTube for cats', [
  logged('open_app', { packageName: PKG }, table([]), HOME),
  logged('tap_element', { idx: '1' }, HOME, SEARCH),
  logged('type_text', { text: '[REDACTED]' }, SEARCH, TYPED, 'cats'),
  logged('press_key', { key: 'ENTER' }, TYPED, RESULTS),
]);

/** A phone whose screen follows the tool calls: each listed call moves it to the next screen. */
function phone(screens: string[], moves: Record<string, number>) {
  let at = 0;
  const calls: { tool: string; args: Record<string, unknown> }[] = [];
  const runner = new FlowRunner({
    observe: async (): Promise<ReplayScreen> => ({ packageName: PKG, tree: screens[at], key: String(at) }),
    step: async (tool, args) => {
      calls.push({ tool, args });
      const key = `${tool}:${JSON.stringify(args)}`;
      if (moves[key] !== undefined) at = moves[key];
      return { content: [{ type: 'text', text: 'Action succeeded' }] };
    },
    stopped: () => false,
    sleep: async () => undefined,
    syncMs: 0,
    afterMs: 0,
  });
  return { runner, calls };
}

describe('FlowRunner', () => {
  it('replays a recorded search with a new value, acting on elements by label', async () => {
    // On this phone the Search button sits elsewhere and has another idx.
    const HOME_OTHER = table(['0|text|YouTube|t|80,40', '1|imgbtn|Cast|t|700,40', '2|imgbtn|Search|t|820,40', '3|view|Home|t|100,960', '4|view|Shorts|t|300,960']);
    const { runner, calls } = phone([HOME_OTHER, SEARCH, TYPED, RESULTS], {
      [`tap_element:${JSON.stringify({ idx: '2' })}`]: 1,
      [`type_text:${JSON.stringify({ text: 'funny dogs' })}`]: 2,
      [`press_key:${JSON.stringify({ key: 'ENTER' })}`]: 3,
    });
    const out = await runner.run(flow.steps, flow.params, { p1: 'funny dogs' });
    expect(out).toEqual({ status: 'done' });
    expect(calls.map((c) => c.tool)).toEqual(['open_app', 'tap_element', 'type_text', 'press_key']);
    expect(calls[1].args).toEqual({ idx: '2' });
  });

  it('stops at the step whose button is gone instead of tapping where it used to be', async () => {
    const HOME_NO_SEARCH = table(['0|text|YouTube|t|80,40', '2|view|Home|t|100,960', '3|view|Shorts|t|300,960']);
    const { runner, calls } = phone([HOME_NO_SEARCH], {});
    const out = await runner.run(flow.steps, flow.params, { p1: 'cats' });
    expect(out).toMatchObject({ status: 'broken', index: 1, acted: false });
    expect((out as { reason: string }).reason).toMatch(/"Search" is not on the screen/);
    expect(calls.map((c) => c.tool)).toEqual(['open_app']);
  });

  it('stops when a step did not lead where it should', async () => {
    // The tap "works" but the screen stays put.
    const { runner } = phone([HOME], {});
    const out = await runner.run(flow.steps, flow.params, { p1: 'cats' });
    expect(out).toMatchObject({ status: 'broken', index: 1, acted: true });
  });

  it('hands a typing step without a value to the AI', async () => {
    const { runner } = phone([HOME, SEARCH], { [`tap_element:${JSON.stringify({ idx: '1' })}`]: 1 });
    const out = await runner.run(flow.steps, flow.params, {});
    expect(out).toMatchObject({ status: 'broken', index: 2, acted: false });
    expect((out as { reason: string }).reason).toMatch(/AI has to type/);
  });

  it('does not act on the wrong app', async () => {
    const runner = new FlowRunner({
      observe: async () => ({ packageName: 'com.android.chrome', tree: HOME, key: 'x' }),
      step: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
      stopped: () => false,
      sleep: async () => undefined,
      syncMs: 0,
      afterMs: 0,
    });
    const out = await runner.run(flow.steps, flow.params, { p1: 'cats' }, 1);
    expect(out).toMatchObject({ status: 'broken', index: 1 });
  });
});
