import { simulateReadableStream } from 'ai';
import { MockLanguageModelV2 } from 'ai/test';
import type { AndroidAgent } from '../eko/AndroidAgent';
import { LiteEngine } from './LiteEngine';

type Msg = { type: string; [k: string]: unknown };
const usage = (input = 220, output = 6) => ({ inputTokens: input, outputTokens: output, totalTokens: input + output });

/** Lite calls and the judge use doGenerate (text in order); the Vector helper uses doStream. */
function scriptedModel(replies: (string | Error)[], streams: Record<string, unknown>[][] = []) {
  const prompts: string[] = [];
  const model = new MockLanguageModelV2({
    doGenerate: async (options) => {
      prompts.push(JSON.stringify(options.prompt));
      const next = replies.shift();
      if (next === undefined) throw new Error('script exhausted');
      if (next instanceof Error) throw next;
      return { content: [{ type: 'text', text: next }], finishReason: 'stop', usage: usage(), warnings: [] };
    },
    doStream: async () => {
      const next = streams.shift();
      if (!next) throw new Error('stream script exhausted');
      return { stream: simulateReadableStream({ chunks: next as never[] }) };
    },
  });
  return { model, prompts };
}

const streamCall = (toolName: string, input: unknown) => [
  { type: 'stream-start', warnings: [] },
  { type: 'tool-call', toolCallId: 'c', toolName, input: JSON.stringify(input) },
  { type: 'finish', finishReason: 'tool-calls', usage: usage(7000, 40) },
];

const HOME = 'idx|type|label|flags|tap_at\n0|btn|Chrome|t|100,100\n1|btn|YouTube|t|200,100';
const CHROME = 'idx|type|label|flags|tap_at\n0|edit|Search or type URL|te|500,90\n1|btn|Menu|t|950,90';

function fakeAgent(opts: { scrollUnchanged?: boolean; tapFails?: boolean } = {}) {
  const calls: string[] = [];
  let app = 'com.android.launcher3';
  let tree = HOME;
  const screen = () => `\n\nCURRENT APP: ${app}\n\nUPDATED SCREEN ELEMENTS:\n${tree}`;
  const t = (name: string, run: (args: Record<string, unknown>) => { text: string; isError?: boolean }) => ({
    name,
    description: name,
    parameters: { type: 'object', properties: {} },
    execute: async (args: Record<string, unknown>) => {
      calls.push(`${name} ${JSON.stringify(args)}`);
      const r = run(args);
      return { content: [{ type: 'text', text: r.text }], isError: Boolean(r.isError) };
    },
  });
  const agent = {
    Tools: [
      t('tap_element', (a) => {
        if (opts.tapFails) return { text: `There is no element ${a.idx} on the current screen.`, isError: true };
        if (app === 'com.android.launcher3' && a.idx === '0') {
          app = 'com.android.chrome';
          tree = CHROME;
        }
        return { text: `Action succeeded: Tapped ${a.idx}${screen()}` };
      }),
      t('type_text', (a) => {
        tree = `${CHROME}\n2|text|${a.text}||500,200`;
        return { text: `Action succeeded: Typed${screen()}` };
      }),
      t('press_key', () => {
        tree = 'idx|type|label|flags|tap_at\n0|text|lofi music - Search results|t|500,300';
        return { text: `Action succeeded: Pressed ENTER${screen()}` };
      }),
      t('scroll_element', () => ({ text: opts.scrollUnchanged ? `Action succeeded: Scrolled\n\nCHECK: the screen did NOT change after this action.${screen()}` : `Action succeeded: Scrolled${screen()}` })),
      t('global_action', () => {
        app = 'com.android.launcher3';
        tree = HOME;
        return { text: `Action succeeded: HOME${screen()}` };
      }),
      t('open_app', (a) => {
        app = String(a.packageName);
        return { text: `Action succeeded: Opened${screen()}` };
      }),
    ],
    systemPrompt: async () => 'You control a phone.',
    observeForCheck: async () => ({ packageName: app, tree }),
    launcherAppsText: async () => 'Chrome | com.android.chrome\nYouTube | com.google.android.youtube',
  };
  return { agent: agent as unknown as AndroidAgent, calls };
}

function engineWith(replies: (string | Error)[], opts: { streams?: Record<string, unknown>[][]; agent?: Parameters<typeof fakeAgent>[0]; verify?: boolean; helperCalls?: number } = {}) {
  const { model, prompts } = scriptedModel(replies, opts.streams);
  const { agent, calls } = fakeAgent(opts.agent);
  const messages: Msg[] = [];
  const engine = new LiteEngine({
    model,
    agent,
    vision: false,
    verify: opts.verify ?? false,
    helperCalls: opts.helperCalls,
    onMessage: async (m) => {
      messages.push(m as never);
    },
  });
  return { engine, calls, messages, prompts };
}

const tokens = (messages: Msg[]) =>
  messages.filter((m) => m.type === 'finish').map((m) => (m.usage as { promptTokens: number }).promptTokens + (m.usage as { completionTokens: number }).completionTokens);

describe('LiteEngine', () => {
  it('runs a simple task with one short call per step', async () => {
    const { engine, calls, messages, prompts } = engineWith(['T 0', 'YE 0 lofi music', 'D Search results for lofi music are open']);
    const result = await engine.run('Open Chrome and search lofi music', 'r1');
    expect(result).toMatchObject({ success: true, stopReason: 'done', result: 'Search results for lofi music are open' });
    expect(calls).toEqual([
      'tap_element {"idx":"0"}',
      'tap_element {"idx":"0"}',
      'type_text {"text":"lofi music"}',
      'press_key {"key":"ENTER"}',
    ]);
    // Same message shapes as the other engines: usage after the first tool_use of its call.
    expect(messages.map((m) => m.type).filter((t) => t !== 'text')).toEqual([
      'tool_use', 'finish', 'tool_result',
      'tool_use', 'finish', 'tool_result', 'tool_use', 'tool_result', 'tool_use', 'tool_result',
      'finish', 'agent_result',
    ]);
    expect(tokens(messages)).toEqual([226, 226, 226]);
    // The prompt carries the compact screen and history, no tool schemas and no coordinates.
    const second = prompts[1];
    expect(second).toContain('T 0 (Chrome) → ok, now com.android.chrome');
    expect(second).toContain('0|edit|Search or type URL|te');
    expect(second).not.toContain('500,90');
    expect(second).not.toContain('tap_element');
    expect(second.length).toBeLessThan(1700);
  });

  it('asks again after a reply that is not a command', async () => {
    const { engine, prompts } = engineWith(['Let me tap Chrome', 'T 0', 'D done']);
    const result = await engine.run('Open Chrome', 'r2');
    expect(result.success).toBe(true);
    expect(prompts[1]).toContain('is not a command');
  });

  it('calls the Vector helper after two unchanged screens and continues after it hands back', async () => {
    const { engine, calls, messages } = engineWith(['T 0', 'S down', 'S down', 'D done'], {
      agent: { scrollUnchanged: true },
      helperCalls: 1,
      streams: [streamCall('tap_element', { idx: '1' })],
    });
    const result = await engine.run('Open Chrome and find settings', 'r3');
    expect(result.success).toBe(true);
    expect(calls.filter((c) => c.startsWith('scroll_element'))).toHaveLength(2);
    expect(calls).toContain('tap_element {"idx":"1"}');
    expect(messages.some((m) => m.type === 'tool_use' && String(m.toolCallId).startsWith('h1-'))).toBe(true);
  });

  it('lets the helper decide when the cheap model says impossible', async () => {
    const { engine, messages } = engineWith(['F no such app'], {
      streams: [streamCall('task_done', { success: false, summary: 'The app is not installed' })],
    });
    const result = await engine.run('Open FooApp', 'r4');
    expect(result).toMatchObject({ success: false, reasonCode: 'AGENT_REPORTED_FAILURE', result: 'The app is not installed' });
    expect(tokens(messages)).toEqual([226, 7040]);
  });

  it('calls the helper after two failed actions', async () => {
    const { engine, calls } = engineWith(['T 7', 'T 8'], {
      agent: { tapFails: true },
      streams: [streamCall('task_done', { success: true, summary: 'Home screen' })],
    });
    const result = await engine.run('Go home', 'r5');
    expect(result.success).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('checks the phone after done and carries on once when the check fails', async () => {
    // Judge says no, Lite carries on, then the judge says yes.
    const { engine, prompts } = engineWith(
      ['D searched', '{"verdict":"no","reason":"no search results on screen"}', 'YE 0 lofi', 'D searched', '{"verdict":"yes","reason":"results shown"}'],
      { verify: true },
    );
    const result = await engine.run('Search lofi in the Chrome address bar', 'r6');
    expect(result).toMatchObject({ success: true, verification: { status: 'verified', method: 'judge' } });
    expect(prompts[2]).toContain('SYSTEM CHECK FAILED: no search results on screen');
  });

  it('retries a transient model error and stops cleanly on abort', async () => {
    const busy = Object.assign(new Error('overloaded'), { statusCode: 503 });
    const { engine } = engineWith([busy, 'T 0', 'D ok']);
    await expect(engine.run('Open Chrome', 'r7')).resolves.toMatchObject({ success: true });

    const { engine: e2 } = engineWith(['T 0', 'T 1', 'T 1', 'T 1']);
    const pending = e2.run('Open Chrome', 'r8');
    e2.abort('user stopped');
    await expect(pending).resolves.toMatchObject({ success: false, stopReason: 'abort', result: 'user stopped' });
  });
});
