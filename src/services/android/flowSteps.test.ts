import { afterMet, anchorsOf, fillUrl, findTarget, matchTemplate, parseTable, promptTemplate, recordFlow, resyncIndex, screenMatches, stableLabel, type RecordedStep } from './flowSteps';

const table = (rows: string[]) => ['idx|type|label|flags|tap_at', ...rows].join('\n');

const HOME = table(['0|text|YouTube|t|80,40', '1|imgbtn|Search|t|900,40', '2|view|Home|t|100,960', '3|view|Shorts|t|300,960', '4|text|12:45|  |50,10']);
const SEARCH = table(['0|input|Search YouTube|te|450,40', '1|imgbtn|Navigate up|t|40,40', '2|text|Recent searches||100,200']);
const TYPED = table(['0|input|cats|te|450,40', '1|imgbtn|Navigate up|t|40,40', '2|text|cats videos|t|300,200']);
const RESULTS = table(['0|text|Filters|t|900,120', '1|view|Cats compilation · 2.1M views|t|500,400', '2|view|Home|t|100,960']);

const step = (action: string, payload: Record<string, unknown>, before: string, after: string, extra: Partial<RecordedStep> = {}): RecordedStep => ({
  action,
  payload,
  ok: true,
  treeBefore: before,
  treeAfter: after,
  pkgBefore: 'com.google.android.youtube',
  pkgAfter: 'com.google.android.youtube',
  screenBefore: before.length.toString(),
  screenAfter: after.length.toString(),
  ...extra,
});

describe('flow steps: reading the screen', () => {
  it('parses the agent table and keeps only stable labels as anchors', () => {
    const rows = parseTable(HOME);
    expect(rows).toHaveLength(5);
    expect(rows[1]).toMatchObject({ idx: '1', label: 'Search', tappable: true });
    expect(stableLabel('12:45')).toBe(false);
    expect(stableLabel('Cats compilation · 2.1M views')).toBe(true);
    expect(anchorsOf(rows)).toEqual(['YouTube', 'Search', 'Home', 'Shorts']);
  });

  it('matches a screen by app and at least half its anchors', () => {
    const rows = parseTable(HOME);
    expect(screenMatches({ package: 'com.google.android.youtube', anchors: ['YouTube', 'Shorts', 'Library', 'Subscriptions'] }, 'com.google.android.youtube', rows)).toBe(true);
    expect(screenMatches({ package: 'com.google.android.youtube', anchors: ['YouTube', 'Library', 'Subscriptions'] }, 'com.google.android.youtube', rows)).toBe(false);
    expect(screenMatches({ package: 'com.google.android.youtube', anchors: ['YouTube'] }, 'com.android.chrome', rows)).toBe(false);
  });

  it('finds the target by label on a phone where it sits elsewhere, and an unlabelled one by position', () => {
    const moved = parseTable(table(['0|imgbtn|Cast|t|700,40', '1|imgbtn|Search|t|820,40']));
    expect(findTarget({ label: 'Search', type: 'imgbtn', grid: { x: 900, y: 40 } }, moved)?.idx).toBe('1');
    const icons = parseTable(table(['0|imgbtn||t|100,40', '1|imgbtn||t|880,45']));
    expect(findTarget({ label: '', type: 'imgbtn', grid: { x: 900, y: 40 } }, icons)?.idx).toBe('1');
    expect(findTarget({ label: 'Upload', type: 'btn', grid: { x: 500, y: 500 } }, moved)).toBeNull();
  });
});

describe('flow steps: the task wording', () => {
  it('turns typed values from the task into parameters and fills them for a new task', () => {
    const template = promptTemplate('Search YouTube for cats', [{ name: 'p1', value: 'cats' }]);
    expect(template).toBe('Search YouTube for {{p1}}');
    expect(matchTemplate(template, 'search youtube for funny dogs.')).toEqual({ p1: 'funny dogs' });
    expect(matchTemplate(template, 'Open YouTube')).toBeNull();
    expect(matchTemplate('Open Settings', 'open   settings')).toEqual({});
    expect(fillUrl('https://www.youtube.com/results?search_query={{p1}}', [{ name: 'p1', encoding: 'plus' }], { p1: 'funny dogs' })).toBe(
      'https://www.youtube.com/results?search_query=funny+dogs',
    );
  });
});

describe('recordFlow', () => {
  it('keeps the effective path, with checks, and the typed text as a parameter', () => {
    const flow = recordFlow('Search YouTube for cats', [
      step('open_app', { packageName: 'com.google.android.youtube' }, table([]), HOME, { pkgBefore: 'com.android.launcher3' }),
      step('read_ui_tree', {}, HOME, HOME),
      step('tap_element', { idx: '1' }, HOME, SEARCH),
      step('type_text', { text: '[REDACTED]' }, SEARCH, TYPED, { typed: 'cats' }),
      step('press_key', { key: 'ENTER' }, TYPED, RESULTS),
    ]);
    expect(flow.steps.map((s) => s.action)).toEqual(['open_app', 'tap', 'type', 'key']);
    expect(flow.steps[1]).toMatchObject({ target: { label: 'Search' }, before: { package: 'com.google.android.youtube' } });
    expect(flow.steps[1].after.appear).toContain('Navigate up');
    expect(flow.steps[2].value).toEqual({ param: 'p1' });
    expect(flow.template).toBe('Search YouTube for {{p1}}');
    expect(flow.aiSteps).toBe(0);
    expect(flow.packageName).toBe('com.google.android.youtube');
  });

  it('never stores typed text that is not in the task, and leaves that step to the AI', () => {
    const flow = recordFlow('Log in to the app', [step('type_text', { text: '[REDACTED]' }, SEARCH, TYPED, { typed: 'hunter2' })]);
    expect(flow.steps[0].value).toEqual({ missing: true });
    expect(JSON.stringify(flow)).not.toContain('hunter2');
    expect(flow.aiSteps).toBe(1);
  });

  it('drops failed steps and a detour undone by BACK', () => {
    const MENU = table(['0|text|Settings|t|500,300', '1|text|Help|t|500,400']);
    const flow = recordFlow('Open YouTube search', [
      step('tap_element', { idx: '0' }, HOME, MENU, { screenBefore: 'home', screenAfter: 'menu' }),
      step('global_action', { action: 'BACK' }, MENU, HOME, { screenBefore: 'menu', screenAfter: 'home' }),
      step('tap_element', { idx: '9' }, HOME, HOME, { ok: false }),
      step('tap_element', { idx: '1' }, HOME, SEARCH, { screenBefore: 'home', screenAfter: 'search' }),
    ]);
    expect(flow.steps).toHaveLength(1);
    expect(flow.steps[0].target?.label).toBe('Search');
  });

  it('templates a search URL from the task wording', () => {
    const flow = recordFlow('Search YouTube for cats', [
      step('open_url', { url: 'https://www.youtube.com/results?search_query=cats' }, table([]), RESULTS),
    ]);
    expect(flow.steps[0].args.url).toBe('https://www.youtube.com/results?search_query={{p1}}');
    expect(flow.params).toEqual([{ name: 'p1', encoding: 'uri' }]);
  });
});

describe('replay checks', () => {
  it('a tap is done when its new labels appear, or at least the screen moved', () => {
    const flow = recordFlow('Open YouTube search', [step('tap_element', { idx: '1' }, HOME, SEARCH)]);
    const s = flow.steps[0];
    expect(afterMet(s, 'com.google.android.youtube', parseTable(SEARCH), true)).toBe(true);
    expect(afterMet(s, 'com.google.android.youtube', parseTable(HOME), false)).toBe(false);
  });

  it('finds where the phone is in the flow after a detour', () => {
    const flow = recordFlow('Search YouTube for cats', [
      step('open_app', { packageName: 'com.google.android.youtube' }, table([]), HOME),
      step('tap_element', { idx: '1' }, HOME, SEARCH),
      step('type_text', { text: '[REDACTED]' }, SEARCH, TYPED, { typed: 'cats' }),
    ]);
    expect(resyncIndex(flow.steps, 1, 'com.google.android.youtube', parseTable(SEARCH))).toBe(2);
    expect(resyncIndex(flow.steps, 1, 'com.android.chrome', parseTable(SEARCH))).toBe(-1);
  });
});
