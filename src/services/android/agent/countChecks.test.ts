import { countChecks, ruleFor, verifyCompletion } from './successVerifier';
import { buttonChanges, countActions, type StepRecord } from './contextBuilder';
import { buttonChange, buildScreenModel } from '../eko/screenModel';
import type { UiNodeSnapshot } from '../AndroidProtocol';

const tally = (openUrl = 0, scrolls = 0, changes: { from: string; to: string }[] = []) => ({ openUrl, scrolls, changes });

describe("the goal's own numbers, counted by code", () => {
  it('finds the number in many phrasings', () => {
    expect(countChecks('Open Chrome and visit 10 random websites, one after another', tally(8)).short).toEqual(['pages opened (open_url): 8 of 10']);
    expect(countChecks('browse three news sites', tally(3)).met).toHaveLength(1);
    expect(countChecks('Open Instagram and scroll through Reels 5 times, pausing briefly', tally(0, 4)).short).toEqual(['scrolls (swipe/scroll_element): 4 of 5']);
    expect(countChecks('swipe 10 shorts on YouTube', tally(0, 10)).met).toHaveLength(1);
  });

  it('does not read durations or unrelated numbers as counts', () => {
    expect(countChecks('scroll reels for 10 minutes', tally(0, 2))).toEqual({ short: [], met: [] });
    expect(countChecks('open the YouTube app and play any random song', tally())).toEqual({ short: [], met: [] });
    expect(countChecks('send "hi 5" to Mom on WhatsApp', tally())).toEqual({ short: [], met: [] });
    expect(countChecks('set an alarm for 7 am', tally())).toEqual({ short: [], met: [] });
  });

  it('button changes are evidence only: they never fail a run', () => {
    const goal = 'Open Instagram and randomly follow 3 people, then stop.';
    expect(countChecks(goal, tally(0, 0, [{ from: 'Follow', to: 'Following' }]))).toEqual({ short: [], met: [] });
    expect(countChecks(goal, tally(0, 0, [{ from: 'Follow', to: 'Following' }, { from: 'Follow', to: 'Requested' }, { from: 'Follow', to: 'Following' }])).met).toEqual(['"follow" buttons changed by taps: 3 of 3']);
  });

  it('fewer pages than asked fails without the judge; enough tells the judge not to recount (Oct 10: #3340 8 of 10 passed, #3342 15 failed)', async () => {
    const judge = jest.fn(async () => '{"verdict":"yes","reason":"ok"}');
    const base = { goal: 'visit 10 random websites', summary: 'done', observe: async () => ({ packageName: 'com.android.chrome', tree: '0|text|Guardian|t|500,500' }), listApps: async () => [], judge };
    const short = await verifyCompletion({ ...base, tally: tally(8) });
    expect(short).toMatchObject({ status: 'failed', method: 'rule' });
    expect(short.reason).toMatch(/8 of 10\. Do the rest/);
    expect(judge).not.toHaveBeenCalled();
    await verifyCompletion({ ...base, tally: tally(15) });
    expect(String(judge.mock.calls[0])).toMatch(/THE GOAL'S NUMBERS ARE MET \(checked by the system\): pages opened \(open_url\): 15 of 10/);
  });

  it('"…, then stop" ends the task; it does not mean close the app (#3347)', () => {
    expect(ruleFor('Open Instagram and randomly follow 3 people, then stop.')).toBeNull();
    expect(ruleFor('close Instagram')).toBe('close');
    expect(ruleFor('open YouTube, then stop YouTube')).toBe('close');
  });
});

let n = 0;
const node = (label: string, box: [number, number, number, number], clickable = true): UiNodeSnapshot => ({
  path: String(n++), text: label, bounds: { left: box[0], top: box[1], right: box[2], bottom: box[3] }, clickable, editable: false, enabled: true, children: [],
});
const list = (button: string, extra: UiNodeSnapshot[] = []) => ({
  path: 'r', bounds: { left: 0, top: 0, right: 1080, bottom: 2400 }, clickable: false, editable: false, enabled: true,
  children: [node('nasa', [0, 300, 700, 400]), node(button, [800, 300, 1050, 400]), node('esa', [0, 420, 700, 520]), node('Follow', [800, 420, 1050, 520]), node('spacex', [0, 540, 700, 640]), ...extra],
}) as UiNodeSnapshot;

describe('a button the tap changed', () => {
  const grid = { x: Math.round((925 / 1080) * 1000), y: Math.round((350 / 2400) * 1000) };

  it('Follow → Following on the same screen', () => {
    expect(buttonChange(buildScreenModel(list('Follow')), buildScreenModel(list('Following')), grid, 'Follow')).toEqual({ from: 'Follow', to: 'Following' });
  });

  it('a tap that opened another screen is not a change', () => {
    const other = { ...list('Message'), children: [node('Posts', [0, 300, 700, 400]), node('Message', [800, 300, 1050, 400]), node('Reels', [0, 420, 700, 520])] } as UiNodeSnapshot;
    expect(buttonChange(buildScreenModel(list('Follow')), buildScreenModel(other), grid, 'Follow')).toBeNull();
    expect(buttonChange(buildScreenModel(list('Follow')), buildScreenModel(list('Follow')), grid, 'Follow')).toBeNull();
  });

  it('the progress line counts them', () => {
    const step = (text: string): StepRecord => ({ callId: 'x', toolName: 'tap_element', input: { idx: '1' }, thought: '', resultText: text, isError: false });
    const steps = [step('Action succeeded: Gesture completed\nCHANGED: "Follow" → "Following"'), step('Action succeeded: Gesture completed\nCHANGED: "Follow" → "Following"'), step('Action succeeded: Gesture completed')];
    expect(buttonChanges(steps)).toHaveLength(2);
    expect(countActions(steps)).toBe('tap_element: 3 succeeded; buttons changed by your taps: "Follow" → "Following" ×2');
  });
});
