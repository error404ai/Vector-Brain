import { simulateReadableStream } from 'ai';
import { MockLanguageModelV2 } from 'ai/test';
import type { AndroidAgent } from '../eko/AndroidAgent';
import { RESTART_SUMMARY, VectorEngine, restartedByTap } from './VectorEngine';

type Chunk = Record<string, unknown>;
type Slow = { chunks: Chunk[]; initialDelayInMs?: number; chunkDelayInMs?: number };
type Response = Chunk[] | Error | Slow;

const usage = { inputTokens: 1200, outputTokens: 40, totalTokens: 1240 };
const toolCall = (toolName: string, input: unknown, id = 'call_0'): Chunk[] => [
  { type: 'stream-start', warnings: [] },
  { type: 'tool-call', toolCallId: id, toolName, input: JSON.stringify(input) },
  { type: 'finish', finishReason: 'tool-calls', usage },
];
const done = (success: boolean, summary: string) => toolCall('task_done', { success, summary });

/** A model that plays back responses in order; an Error entry fails that call. */
function scriptedModel(responses: Response[]) {
  const prompts: unknown[] = [];
  const model = new MockLanguageModelV2({
    doStream: async (options) => {
      prompts.push(options.prompt);
      const next = responses.shift();
      if (!next) throw new Error('script exhausted');
      if (next instanceof Error) throw next;
      if (!Array.isArray(next)) {
        const stream = simulateReadableStream({ chunks: next.chunks as never[], initialDelayInMs: next.initialDelayInMs, chunkDelayInMs: next.chunkDelayInMs });
        // Like a real HTTP stream: stops when the request is aborted.
        const reader = stream.getReader();
        const signal = options.abortSignal;
        return {
          stream: new ReadableStream({
            async pull(controller) {
              if (signal?.aborted) return controller.error(signal.reason);
              const aborted = new Promise<never>((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }));
              try {
                const { done: finished, value } = await Promise.race([reader.read(), aborted]);
                if (finished) controller.close();
                else controller.enqueue(value);
              } catch (error) {
                controller.error(error);
              }
            },
          }),
        };
      }
      return { stream: simulateReadableStream({ chunks: next as never[] }) };
    },
    doGenerate: async (options) => {
      prompts.push(options.prompt);
      return {
        content: [{ type: 'text', text: '{"verdict":"yes","reason":"looks done"}' }],
        finishReason: 'stop',
        usage,
        warnings: [],
      };
    },
  });
  return { model, prompts };
}

function fakeAgent(options: { tapResult?: () => { text: string; isError?: boolean }; foreground?: string; tapDelayMs?: number } = {}) {
  const calls: Record<string, number> = {};
  const count = (name: string) => (calls[name] = (calls[name] ?? 0) + 1);
  let foreground = options.foreground ?? 'com.android.launcher3';
  const agent = {
    Tools: [
      {
        name: 'tap_coordinate',
        description: 'tap',
        parameters: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } } },
        execute: async () => {
          count('tap_coordinate');
          if (options.tapDelayMs) await new Promise((r) => setTimeout(r, options.tapDelayMs));
          const r = options.tapResult?.() ?? { text: 'Action succeeded: Tapped\n\nUPDATED SCREEN ELEMENTS:\nidx|type|label|flags|tap_at\n0|btn|OK|t|1,1' };
          return { content: [{ type: 'text', text: r.text }], isError: Boolean(r.isError) };
        },
      },
      {
        name: 'global_action',
        description: 'global',
        parameters: { type: 'object', properties: { action: { type: 'string' } } },
        execute: async () => {
          count('global_action');
          return { content: [{ type: 'text', text: 'Action succeeded: Performed global power_dialog action' }] };
        },
      },
      {
        name: 'open_app',
        description: 'open',
        parameters: { type: 'object', properties: { packageName: { type: 'string' } } },
        execute: async (args: { packageName: string }) => {
          count('open_app');
          foreground = args.packageName;
          return { content: [{ type: 'text', text: `Action succeeded: Opened ${args.packageName}` }] };
        },
      },
    ],
    systemPrompt: async () => 'You control a phone.',
    observeForCheck: async () => {
      count('observe');
      return { packageName: foreground, tree: 'idx|type|label|flags|tap_at\n0|btn|Home|t|1,1' };
    },
    launcherAppsText: async () => 'Installed apps (2):\nYouTube | com.google.android.youtube\nChrome | com.android.chrome',
  };
  return { agent: agent as unknown as AndroidAgent, calls };
}

function engineWith(responses: Response[], agentOptions?: Parameters<typeof fakeAgent>[0], extra: Partial<ConstructorParameters<typeof VectorEngine>[0]> = {}) {
  const { model, prompts } = scriptedModel(responses);
  const { agent, calls } = fakeAgent(agentOptions);
  const messages: { type: string; [k: string]: unknown }[] = [];
  const engine = new VectorEngine({
    model,
    agent,
    vision: false,
    planner: false,
    onMessage: async (m) => {
      messages.push(m as never);
    },
    ...extra,
  });
  return { engine, calls, messages, prompts };
}

describe('restart detection', () => {
  const ok = { isError: false, resultText: 'Action succeeded: Gesture completed' };
  it('reads a slow or dropped tap in the power menu as a restart', () => {
    expect(restartedByTap(true, 'tap_element', 17_344, ok)).toBe(true);
    expect(restartedByTap(true, 'tap_coordinate', 900, { isError: true, resultText: 'Action failed: TIMEOUT: Remote action timed out' })).toBe(true);
  });
  it('leaves ordinary taps alone', () => {
    expect(restartedByTap(true, 'tap_element', 1_200, ok)).toBe(false);
    expect(restartedByTap(false, 'tap_element', 17_344, ok)).toBe(false);
    expect(restartedByTap(true, 'open_app', 17_344, ok)).toBe(false);
  });
});

describe('VectorEngine', () => {
  it('ends the run after the Restart tap instead of restarting the phone again', async () => {
    const { engine, calls } = engineWith(
      [toolCall('global_action', { action: 'POWER_DIALOG' }), toolCall('tap_coordinate', { x: 5, y: 5 }), toolCall('tap_coordinate', { x: 5, y: 5 }), done(true, 'restarted')],
      { tapDelayMs: 60 },
      { restartGapMs: 50 },
    );
    const result = await engine.run('restart the phone', 'r-restart');
    expect(result).toMatchObject({ success: true, stopReason: 'done', result: RESTART_SUMMARY });
    expect(calls.tap_coordinate).toBe(1);
  });

  it('a slow tap outside the power menu is just a slow tap', async () => {
    const { engine, calls } = engineWith([toolCall('tap_coordinate', { x: 5, y: 5 }), done(true, 'Tapped OK')], { tapDelayMs: 60 }, { restartGapMs: 50, verify: false });
    const result = await engine.run('tap ok', 'r-slow');
    expect(result.result).toBe('Tapped OK');
    expect(calls.tap_coordinate).toBe(1);
  });

  it('acts, finishes with task_done and passes a rule check without a judge call', async () => {
    const { engine, calls, messages } = engineWith([toolCall('open_app', { packageName: 'com.google.android.youtube' }), done(true, 'YouTube is open')]);
    const result = await engine.run('open YouTube', 'r1');
    expect(result).toMatchObject({ success: true, stopReason: 'done', verification: { status: 'verified', method: 'rule' } });
    expect(calls.open_app).toBe(1);
    const types = messages.map((m) => m.type);
    expect(types.filter((t) => t === 'tool_use')).toHaveLength(1);
    expect(types.filter((t) => t === 'finish')).toHaveLength(2); // one per model call
    expect(types).toContain('agent_result');
  });

  it('retries a failed model request without repeating any phone action', async () => {
    const rateLimited = Object.assign(new Error('429 Too Many Requests'), { statusCode: 429 });
    const { engine, calls } = engineWith([toolCall('tap_coordinate', { x: 1, y: 1 }), rateLimited, done(true, 'Tapped OK')], undefined, { verify: false });
    const result = await engine.run('tap ok', 'r2');
    expect(result.success).toBe(true);
    expect(calls.tap_coordinate).toBe(1);
  });

  it('does not retry a request the provider rejects for good (e.g. 401)', async () => {
    const unauthorised = Object.assign(new Error('401 Unauthorized'), { statusCode: 401 });
    const { engine } = engineWith([unauthorised]);
    await expect(engine.run('tap ok', 'r3')).rejects.toThrow('401');
  });

  it('runs a duplicated tool call inside one response only once', async () => {
    const dup: Chunk[] = [
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: 'a', toolName: 'tap_coordinate', input: '{"x":1,"y":1}' },
      { type: 'tool-call', toolCallId: 'a', toolName: 'tap_coordinate', input: '{"x":1,"y":1}' },
      { type: 'finish', finishReason: 'tool-calls', usage },
    ];
    const { engine, calls } = engineWith([dup, done(true, 'ok')], undefined, { verify: false });
    await engine.run('tap', 'r4');
    expect(calls.tap_coordinate).toBe(1);
  });

  it('never re-sends an action the phone did not confirm; it reads the screen and tells the model', async () => {
    const { engine, calls, prompts } = engineWith(
      [toolCall('tap_coordinate', { x: 5, y: 5 }), done(true, 'sent')],
      { tapResult: () => ({ text: 'Action failed: TIMEOUT: Remote action timed out after 15000 ms', isError: true }) },
      { verify: false },
    );
    await engine.run('send it', 'r5');
    expect(calls.tap_coordinate).toBe(1);
    expect(calls.observe).toBe(1);
    expect(JSON.stringify(prompts[1])).toContain('may already have happened');
  });

  it('sends the agent back once when the check fails, then fails the run', async () => {
    const { engine, prompts } = engineWith([done(true, 'YouTube open'), done(true, 'YouTube open, really')]);
    const result = await engine.run('open YouTube', 'r6'); // foreground stays on the launcher
    expect(result).toMatchObject({ success: false, reasonCode: 'VERIFICATION_FAILED', verification: { status: 'failed', method: 'rule', retries: 1 } });
    expect(JSON.stringify(prompts[1])).toContain('SYSTEM CHECK FAILED');
  });

  it('asks the judge when no rule fits and records its verdict', async () => {
    const { engine } = engineWith([done(true, 'Playing lofi music')]);
    const result = await engine.run('open YouTube and play lofi music', 'r7');
    expect(result.verification).toMatchObject({ status: 'verified', method: 'judge' });
  });

  it('reports a task the agent says it cannot do as a failure, without a check', async () => {
    const { engine, calls } = engineWith([done(false, 'Sign-in required')]);
    const result = await engine.run('post a comment', 'r8');
    expect(result).toMatchObject({ success: false, reasonCode: 'AGENT_REPORTED_FAILURE' });
    expect(calls.observe).toBeUndefined();
  });

  it('stops when aborted mid-run', async () => {
    const { engine, calls } = engineWith([toolCall('tap_coordinate', { x: 1, y: 1 }), done(true, 'x')], undefined, { verify: false });
    const running = engine.run('tap', 'r9');
    engine.abort('Task cancelled by user');
    await expect(running).resolves.toMatchObject({ stopReason: 'abort', success: false });
    expect(calls.tap_coordinate).toBeUndefined();
  });

  it('makes a planning call only when the planner is on, and shows the plan', async () => {
    const off = engineWith([done(true, 'x')], undefined, { verify: false });
    await off.engine.run('open YouTube', 'p1');
    expect(off.messages.some((m) => m.type === 'workflow')).toBe(false);

    const { model } = scriptedModel([done(true, 'x')]);
    model.doGenerate = async () => ({ content: [{ type: 'text', text: '1. Open YouTube\n2. Search lofi' }], finishReason: 'stop', usage, warnings: [] }) as never;
    const { agent } = fakeAgent();
    const seen: { type: string; workflow?: { nodes: string[] } }[] = [];
    const on = new VectorEngine({ model, agent, vision: false, planner: true, verify: false, onMessage: async (m) => void seen.push(m as never) });
    await on.run('open YouTube and search lofi', 'p2');
    expect(seen.find((m) => m.type === 'workflow')?.workflow?.nodes).toEqual(['Open YouTube', 'Search lofi']);
  });

  it('gives up on a model call that goes silent and asks again, without touching the phone twice', async () => {
    const silent: Slow = { chunks: toolCall('tap_coordinate', { x: 1, y: 1 }), initialDelayInMs: 400 };
    const { engine, calls, messages } = engineWith([silent, toolCall('tap_coordinate', { x: 1, y: 1 }), done(true, 'ok')], undefined, {
      verify: false,
      callIdleMs: 60,
      callMaxMs: 5000,
    });
    const result = await engine.run('tap', 't1');
    expect(result.success).toBe(true);
    expect(calls.tap_coordinate).toBe(1);
    expect(messages.some((m) => m.type === 'thinking' && String(m.text).includes('sent nothing'))).toBe(true);
  });

  it('cuts off a call that keeps streaming past the limit, and fails clearly when it happens twice', async () => {
    const rambling = (): Slow => ({
      chunks: [{ type: 'stream-start', warnings: [] }, { type: 'reasoning-start', id: 'r' }, ...Array.from({ length: 40 }, () => ({ type: 'reasoning-delta', id: 'r', delta: 'hmm ' })), ...done(true, 'x').slice(1)],
      chunkDelayInMs: 20,
    });
    const { engine, calls } = engineWith([rambling(), rambling()], undefined, { verify: false, callIdleMs: 1000, callMaxMs: 150 });
    await expect(engine.run('tap', 't2')).rejects.toThrow(/did not finish answering within .*twice in a row/);
    expect(calls.tap_coordinate).toBeUndefined();
  });

  it('a user abort during a slow call still reads as an abort, not a timeout', async () => {
    const slow: Slow = { chunks: done(true, 'x'), initialDelayInMs: 500 };
    const { engine } = engineWith([slow], undefined, { verify: false, callIdleMs: 5000, callMaxMs: 5000 });
    const running = engine.run('tap', 't3');
    setTimeout(() => engine.abort('Task cancelled by user'), 50);
    await expect(running).resolves.toMatchObject({ stopReason: 'abort' });
  });

  it('switches to the backup model when the main one is out of its daily quota, and does not retry the main one', async () => {
    const quota = Object.assign(new Error('Rate limit exceeded: free-models-per-day-high-balance'), { statusCode: 429 });
    const main = scriptedModel([quota]);
    const backup = scriptedModel([done(true, 'ok')]);
    const { agent } = fakeAgent();
    const seen: { type: string; text?: string }[] = [];
    const engine = new VectorEngine({ model: main.model, agent, vision: false, planner: false, verify: false, fallback: { model: backup.model, label: 'backup-x' }, onMessage: async (m) => void seen.push(m as never) });
    const result = await engine.run('tap', 'fb1');
    expect(result.success).toBe(true);
    expect(main.prompts).toHaveLength(1);
    expect(backup.prompts).toHaveLength(1);
    expect(seen.some((m) => m.type === 'thinking' && String(m.text).includes('backup-x'))).toBe(true);
  });

  it('fails plainly on a daily quota when there is no backup model', async () => {
    const quota = Object.assign(new Error('Rate limit exceeded: free-models-per-day-high-balance'), { statusCode: 429 });
    const { engine } = engineWith([quota, done(true, 'x')], undefined, { verify: false });
    await expect(engine.run('tap', 'fb2')).rejects.toThrow(/per-day/);
  });
});
