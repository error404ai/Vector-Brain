import { buildLitePrompt, compactScreen, historyEntry, labelOf, parseLiteAction, resultNote, screenFromResult } from './liteProtocol';

const TREE = [
  'idx|type|label|flags|tap_at',
  '0|view|||500,500',
  '1|imgbtn|Open the homepage|t|60,90',
  '2|edit|Search or type URL|te|500,90',
  '3|text|Price | 2 items||300,400',
  '4|btn||t|900,900',
].join('\n');

describe('compactScreen', () => {
  it('drops the header, tap_at and empty rows, keeps unlabeled tappables', () => {
    expect(compactScreen(TREE)).toBe(['1|imgbtn|Open the homepage|t', '2|edit|Search or type URL|te', '3|text|Price | 2 items', '4|btn||t'].join('\n'));
  });

  it('caps rows and long labels', () => {
    const rows = Array.from({ length: 70 }, (_, i) => `${i}|btn|${'x'.repeat(80)}|t|1,1`).join('\n');
    const out = compactScreen(rows).split('\n');
    expect(out).toHaveLength(61);
    expect(out[0].length).toBeLessThan(70);
    expect(out[60]).toBe('(+10 more rows; scroll to see them)');
  });

  it('handles an empty screen', () => {
    expect(compactScreen('No visible UI elements found.')).toBe('No visible elements.');
    expect(compactScreen(null)).toBe('No visible elements.');
  });
});

describe('parseLiteAction', () => {
  const tools = (reply: string) => {
    const a = parseLiteAction(reply);
    return a.kind === 'tools' ? a.calls : a;
  };

  it('maps each command to agent tools', () => {
    expect(tools('T 12')).toEqual([{ tool: 'tap_element', args: { idx: '12' } }]);
    expect(tools('t v3')).toEqual([{ tool: 'tap_element', args: { idx: 'v3' } }]);
    expect(tools('Y 2 "lofi music"')).toEqual([
      { tool: 'tap_element', args: { idx: '2' } },
      { tool: 'type_text', args: { text: 'lofi music' } },
    ]);
    expect(tools('YE 2 lofi music')).toEqual([
      { tool: 'tap_element', args: { idx: '2' } },
      { tool: 'type_text', args: { text: 'lofi music' } },
      { tool: 'press_key', args: { key: 'ENTER' } },
    ]);
    expect(tools('Y hello')).toEqual([{ tool: 'type_text', args: { text: 'hello' } }]);
    expect(tools('E')).toEqual([{ tool: 'press_key', args: { key: 'ENTER' } }]);
    expect(tools('S down')).toEqual([{ tool: 'scroll_element', args: { direction: 'FORWARD' } }]);
    expect(tools('S up')).toEqual([{ tool: 'scroll_element', args: { direction: 'BACKWARD' } }]);
    expect(tools('SW left')).toEqual([{ tool: 'swipe', args: { direction: 'LEFT' } }]);
    expect(tools('O youtube.com')).toEqual([{ tool: 'open_url', args: { url: 'https://youtube.com' } }]);
    expect(tools('O https://x.com/a?b=1')).toEqual([{ tool: 'open_url', args: { url: 'https://x.com/a?b=1' } }]);
    expect(tools('A com.google.android.youtube')).toEqual([{ tool: 'open_app', args: { packageName: 'com.google.android.youtube' } }]);
    expect(tools('B')).toEqual([{ tool: 'global_action', args: { action: 'BACK' } }]);
    expect(tools('H')).toEqual([{ tool: 'global_action', args: { action: 'HOME' } }]);
    expect(tools('W')).toEqual([{ tool: 'wait', args: { durationMillis: 4000 } }]);
  });

  it('reads done, failed and stuck', () => {
    expect(parseLiteAction('D Playing lofi on YouTube')).toEqual({ kind: 'done', summary: 'Playing lofi on YouTube' });
    expect(parseLiteAction('DONE: opened')).toEqual({ kind: 'done', summary: 'opened' });
    expect(parseLiteAction('F app not installed')).toEqual({ kind: 'failed', summary: 'app not installed' });
    expect(parseLiteAction('X captcha')).toEqual({ kind: 'escalate', reason: 'captcha' });
  });

  it('takes the first valid line after any thinking, and strips markdown', () => {
    expect(tools('The search box is 2.\n`T 2`')).toEqual([{ tool: 'tap_element', args: { idx: '2' } }]);
    expect(tools('<think>T 9 maybe</think>\nT 4')).toEqual([{ tool: 'tap_element', args: { idx: '4' } }]);
  });

  it('rejects anything else', () => {
    expect(parseLiteAction('I will tap the search bar').kind).toBe('invalid');
    expect(parseLiteAction('T search').kind).toBe('invalid');
    expect(parseLiteAction('A youtube').kind).toBe('invalid');
    expect(parseLiteAction('').kind).toBe('invalid');
  });
});

describe('results and prompt', () => {
  const result = `Action succeeded: Tapped "Search"\n\nCURRENT APP: com.android.chrome\n\nUPDATED SCREEN ELEMENTS:\n${TREE}\n\nNOTE: keyboard is open`;

  it('reads the screen and app from a result', () => {
    const seen = screenFromResult(result);
    expect(seen.app).toBe('com.android.chrome');
    expect(seen.tree?.startsWith('idx|type|label')).toBe(true);
    expect(seen.tree).not.toContain('NOTE');
    expect(screenFromResult('Action succeeded: Waited').tree).toBeNull();
  });

  it('keeps the result note short and screen-free', () => {
    const note = resultNote(result);
    expect(note).toBe('Action succeeded: Tapped "Search" NOTE: keyboard is open');
  });

  it('builds history lines and labels', () => {
    expect(labelOf(TREE, '2')).toBe('Search or type URL');
    expect(historyEntry('T 2', { ok: true, unchanged: false, app: 'com.android.chrome', prevApp: null, label: 'Search' })).toBe('T 2 (Search) → ok, now com.android.chrome');
    expect(historyEntry('T 3', { ok: true, unchanged: false, app: 'com.android.chrome', prevApp: 'com.android.chrome' })).toBe('T 3 → ok');
    expect(historyEntry('S down', { ok: true, unchanged: true, app: null })).toBe('S down → no change');
  });

  it('keeps a simple step prompt small', () => {
    const history = Array.from({ length: 20 }, (_, i) => `T ${i} (Item) → ok`);
    const prompt = buildLitePrompt({ task: 'Open Chrome and search lofi music', history, lastNote: 'Action succeeded: Tapped', app: 'com.android.chrome', screen: compactScreen(TREE) });
    expect(prompt).toContain('(4 earlier steps)');
    expect(prompt).toContain('20. T 19');
    expect(prompt).not.toContain('1. T 0 ');
    // ~4 chars per token: the user part stays well under 200 tokens here.
    expect(prompt.length).toBeLessThan(900);
  });
});
