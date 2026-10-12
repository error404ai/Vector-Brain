import type { UiNodeSnapshot } from '../AndroidProtocol';
import { callsWrittenAsText } from '../agent/VectorEngine';
import { AndroidAgent, focusedFieldText, newFieldMessages, sameTyped } from './AndroidAgent';

describe('tool calls a model wrote as text (Oct 12, #3759)', () => {
  const tools = new Set(['open_app', 'tap_element', 'task_done']);
  it('reads <tool_use>, <invoke> and JSON forms, only for real tools', () => {
    const xml = `I'll start.\n<tool_use>\n<server_name>android</server_name>\n<tool_name>open_app</tool_name>\n<arguments>\n{"packageName": "com.android.chrome"}\n</arguments>\n</tool_use>`;
    expect(callsWrittenAsText(xml, tools)).toEqual([{ toolName: 'open_app', input: { packageName: 'com.android.chrome' } }]);
    const invoke = '<invoke name="tap_element"><parameter name="idx">"5"</parameter></invoke>';
    expect(callsWrittenAsText(invoke, tools)).toEqual([{ toolName: 'tap_element', input: { idx: '5' } }]);
    expect(callsWrittenAsText('{"name": "task_done", "arguments": {"success": true}}', tools)).toEqual([{ toolName: 'task_done', input: { success: true } }]);
    expect(callsWrittenAsText('<tool_name>rm_rf</tool_name>', tools)).toEqual([]);
    expect(callsWrittenAsText('Done so far: 3 sites. Still failed to open the fourth.', tools)).toEqual([]);
  });
});

let n = 0;
const node = (over: Partial<UiNodeSnapshot> & { box: [number, number, number, number] }): UiNodeSnapshot => {
  const { box, ...rest } = over;
  return { path: String(n++), bounds: { left: box[0], top: box[1], right: box[2], bottom: box[3] }, clickable: false, editable: false, enabled: true, children: [], ...rest };
};
const screen = (children: UiNodeSnapshot[]) => node({ box: [0, 0, 1080, 2400], children });

describe('what a field shows after typing', () => {
  it('reads the focused field and compares loosely', () => {
    expect(focusedFieldText({ elements: [{ editable: true, focused: true, label: 'travel742 by' }] })).toBe('travel742 by');
    expect(focusedFieldText({ elements: [{ editable: true, label: 'a' }, { editable: true, label: 'b' }] })).toBeNull();
    expect(sameTyped('Travel742', 'travel742')).toBe(true);
    expect(sameTyped('travel742 by', 'travel742')).toBe(false);
  });

  it('a field that came out wrong is cleared and pasted, and the result says what it shows', async () => {
    let value = '';
    const blog = () =>
      screen([
        node({ text: 'Choose a URL for your blog', box: [0, 200, 1080, 300] }),
        node({ text: value, editable: true, clickable: true, focused: true, box: [40, 500, 1040, 600] }),
        ...(value.includes(' ') ? [node({ text: 'This blog address is invalid or not supported.', box: [40, 620, 1040, 680] })] : []),
        node({ text: 'Next', clickable: true, box: [800, 1200, 1040, 1300] }),
      ]);
    let clip = '';
    const exec = jest.fn(async (_hw: string, action: { type: string; text?: string; key?: string }) => {
      if (action.type === 'ObserveScreen') return { status: 'SUCCESS', uiTree: { packageName: 'com.android.chrome', root: blog() } };
      if (action.type === 'SetText') value = `${action.text} by`;
      if (action.type === 'SetClipboard') clip = action.text ?? '';
      if (action.type === 'PressKey' && action.key === 'CLEAR') value = '';
      if (action.type === 'Paste') value = clip;
      return { status: 'SUCCESS', summary: `${action.type} done` };
    });
    const agent = new AndroidAgent({ executeAction: exec } as never, 'hw');
    const tools = (agent as unknown as { tools: { name: string; execute: (a: Record<string, unknown>, c: unknown, t: unknown) => Promise<{ content: { text?: string }[] }> }[] }).tools;
    const run = async (name: string, args: Record<string, unknown> = {}) => (await tools.find((t) => t.name === name)!.execute(args, {}, {})).content.map((c) => c.text ?? '').join('');
    await run('read_ui_tree');
    const r = await run('type_text', { text: 'travel742' });
    expect(r).toMatch(/FIELD MESSAGE: "This blog address is invalid or not supported\."/);
    expect(r).toMatch(/TYPED CHECK: the field first showed "travel742 by".*by pasting it\. It now shows "travel742"/s);
    expect(value).toBe('travel742');
  });

  it('a field with a length limit: said once, not retried, and a repeat is called out (Blogger, 15 of 16)', async () => {
    let value = '';
    const exec = jest.fn(async (_hw: string, action: { type: string; text?: string }) => {
      if (action.type === 'ObserveScreen') {
        return { status: 'SUCCESS', uiTree: { packageName: 'com.android.chrome', root: screen([node({ text: value, editable: true, clickable: true, focused: true, box: [40, 500, 1040, 600] }), node({ text: 'Next', clickable: true, box: [800, 1200, 1040, 1300] })]) } };
      }
      if (action.type === 'SetText') value = (action.text ?? '').slice(0, 15);
      return { status: 'SUCCESS', summary: `${action.type} done` };
    });
    const agent = new AndroidAgent({ executeAction: exec } as never, 'hw');
    const tools = (agent as unknown as { tools: { name: string; execute: (a: Record<string, unknown>, c: unknown, t: unknown) => Promise<{ content: { text?: string }[] }> }[] }).tools;
    const run = async (name: string, args: Record<string, unknown> = {}) => (await tools.find((t) => t.name === name)!.execute(args, {}, {})).content.map((c) => c.text ?? '').join('');
    await run('read_ui_tree');
    const first = await run('type_text', { text: 'wanderlusttrip42' });
    expect(first).toMatch(/FIELD LIMIT: this field holds at most 15 characters\. It kept "wanderlusttrip4" and dropped "2"/);
    expect(first).not.toMatch(/TYPED AGAIN/);
    expect(exec.mock.calls.filter(([, a]) => a.type === 'Paste' || a.type === 'SetClipboard')).toHaveLength(0);
    const second = await run('type_text', { text: 'wanderlusttrip42' });
    expect(second).toMatch(/TYPED AGAIN: this exact text has now been typed 2 times/);
    const shorter = await run('type_text', { text: 'wanderlust42' });
    expect(shorter).not.toMatch(/FIELD LIMIT|TYPED/);
  });

  it('length-limit messages count as field messages', () => {
    const after = { elements: [{ label: 'Use up to 15 characters', tappable: false }, { label: '20 characters max', tappable: false }, { label: 'Up to 15', tappable: false }] };
    expect(newFieldMessages(null, after)).toEqual(['Use up to 15 characters', '20 characters max']);
  });

  it('new form messages only', () => {
    const before = { elements: [{ label: 'Password must be 8 characters', tappable: false }] };
    const after = { elements: [{ label: 'Password must be 8 characters', tappable: false }, { label: 'This username is already taken', tappable: false }, { label: 'Invalid', tappable: true }] };
    expect(newFieldMessages(before, after)).toEqual(['This username is already taken']);
  });
});

describe('player controls and circling', () => {
  let taps = 0;
  const player = () =>
    screen([
      node({ text: `views ${taps}`, box: [0, 1100, 1080, 1200] }),
      node({ contentDescription: 'Pause video', clickable: true, box: [440, 300, 640, 500] }),
      node({ text: 'lofi beats', box: [0, 900, 1080, 1000] }),
      node({ text: 'Sign in', clickable: true, box: [800, 100, 1040, 180] }),
    ]);
  function agent() {
    const exec = jest.fn(async (_hw: string, action: { type: string }) => {
      if (action.type === 'Tap') taps += 1;
      return action.type === 'ObserveScreen' ? { status: 'SUCCESS', uiTree: { packageName: 'com.google.android.youtube', root: player() } } : { status: 'SUCCESS', summary: `${action.type} done` };
    });
    const a = new AndroidAgent({ executeAction: exec } as never, 'hw');
    const tools = (a as unknown as { tools: { name: string; execute: (x: Record<string, unknown>, c: unknown, t: unknown) => Promise<{ content: { text?: string }[] }> }[] }).tools;
    const run = async (name: string, args: Record<string, unknown> = {}) => (await tools.find((t) => t.name === name)!.execute(args, {}, {})).content.map((c) => c.text ?? '').join('');
    return { exec, run };
  }
  const idxOf = (t: string, label: string) => t.split('\n').find((r) => r.includes(`|${label}|`))!.split('|')[0];

  it('Pause is pressed by an accessibility click, not a tap that only shows the controls', async () => {
    const { exec, run } = agent();
    await run('tap_element', { idx: idxOf(await run('read_ui_tree'), 'Pause video') });
    expect(exec.mock.calls.some(([, a]) => a.type === 'ClickNode' && (a as { text?: string }).text === 'Pause video')).toBe(true);
    expect(exec.mock.calls.some(([, a]) => a.type === 'Tap')).toBe(false);
  });

  it('the fourth tap on one spot in a run says it is going in circles', async () => {
    const { run } = agent();
    const idx = idxOf(await run('read_ui_tree'), 'Sign in');
    let last = '';
    for (let i = 0; i < 4; i += 1) {
      last = await run('tap_element', { idx });
      await run('global_action', { action: 'BACK' });
    }
    expect(last).toMatch(/CIRCLING: this is tap number 4 on this same spot \("Sign in"\)/);
  });
});

describe('sign-in walls and the browser a link opens in', () => {
  it('a wrong password or account recovery stops the agent, said once', async () => {
    let page = 'password';
    const exec = jest.fn(async (_hw: string, action: { type: string; packageName?: string }) => {
      if (action.type === 'ObserveScreen') {
        const rows =
          page === 'password'
            ? [node({ text: 'Enter your password', box: [40, 300, 1040, 380] }), node({ text: '', editable: true, clickable: true, password: true, box: [40, 500, 1040, 600] }), node({ text: 'Next', clickable: true, box: [800, 1200, 1040, 1300] })]
            : [node({ text: 'Wrong password. Try again or click Forgot password to reset it.', box: [40, 620, 1040, 680] }), node({ text: 'Try another way', clickable: true, box: [40, 1200, 400, 1300] }), node({ text: 'Next', clickable: true, box: [800, 1200, 1040, 1300] })];
        return { status: 'SUCCESS', uiTree: { packageName: 'com.google.android.gms', root: screen(rows) } };
      }
      if (action.type === 'Tap') page = 'wrong';
      return { status: 'SUCCESS', summary: `${action.type} done` };
    });
    const agent = new AndroidAgent({ executeAction: exec } as never, 'hw');
    const tools = (agent as unknown as { tools: { name: string; execute: (a: Record<string, unknown>, c: unknown, t: unknown) => Promise<{ content: { text?: string }[] }> }[] }).tools;
    const run = async (name: string, args: Record<string, unknown> = {}) => (await tools.find((t) => t.name === name)!.execute(args, {}, {})).content.map((c) => c.text ?? '').join('');
    const list = await run('read_ui_tree');
    const next = list.split('\n').find((r) => r.includes('|Next|'))!.split('|')[0];
    const r = await run('tap_element', { idx: next });
    expect(r).toMatch(/SIGN-IN BLOCKED: the screen says "Wrong password.*Call task_done with success=false/s);
    const again = await run('tap_element', { idx: next });
    expect(again).not.toMatch(/SIGN-IN BLOCKED/);
  });

  it('a link opens in Chrome; on a phone without Chrome, in its own browser', async () => {
    const sent: (string | undefined)[] = [];
    const exec = jest.fn(async (_hw: string, action: { type: string; packageName?: string }) => {
      if (action.type === 'ObserveScreen') return { status: 'SUCCESS', uiTree: { packageName: 'com.heytap.browser', root: screen([node({ text: 'Blogger', box: [0, 0, 500, 100] })]) } };
      if (action.type === 'OpenUrl') {
        sent.push(action.packageName);
        if (action.packageName === 'com.android.chrome') return { status: 'FAILURE', code: 'APP_NOT_FOUND', message: 'Chrome is not installed' };
      }
      return { status: 'SUCCESS', summary: `${action.type} done` };
    });
    const agent = new AndroidAgent({ executeAction: exec } as never, 'hw');
    const tools = (agent as unknown as { tools: { name: string; execute: (a: Record<string, unknown>, c: unknown, t: unknown) => Promise<{ content: { text?: string }[]; isError?: boolean }> }[] }).tools;
    const r = await tools.find((t) => t.name === 'open_url')!.execute({ url: 'blogger.com' }, {}, {});
    expect(sent).toEqual(['com.android.chrome', undefined]);
    expect(r.isError).toBeFalsy();
  });
});
