import { simulateReadableStream } from 'ai';
import { MockLanguageModelV2 } from 'ai/test';
import type { AndroidAgent } from '../eko/AndroidAgent';
import { SHORT_DESCRIPTIONS } from './compactTools';
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

  it('Lite (compact) runs the same loop with short tool descriptions', async () => {
    const seen: { tools: { name: string; description?: string }[] }[] = [];
    const full = engineWith([toolCall('open_app', { packageName: 'com.google.android.youtube' }), done(true, 'YouTube is open')]);
    const lite = engineWith([toolCall('open_app', { packageName: 'com.google.android.youtube' }), done(true, 'YouTube is open')], undefined, { compact: true });
    for (const e of [full, lite]) {
      const model = (e.engine as unknown as { model: { doStream: (o: unknown) => unknown } }).model;
      const original = model.doStream.bind(model);
      model.doStream = (o: unknown) => {
        seen.push(o as never);
        return original(o);
      };
    }
    const a = await full.engine.run('open YouTube', 'f');
    const b = await lite.engine.run('open YouTube', 'l');
    expect(lite.engine.kind).toBe('lite');
    expect(b).toMatchObject({ success: a.success, stopReason: a.stopReason, verification: { status: 'verified', method: 'rule' } });
    expect(lite.calls.open_app).toBe(1);
    const fullTools = seen[0].tools;
    const liteTools = seen[2].tools;
    // Same tools, plus phone_info (the phone's facts on request instead of in every call).
    expect(liteTools.map((t) => t.name).filter((n) => n !== 'phone_info')).toEqual(fullTools.map((t) => t.name));
    expect(liteTools.map((t) => t.name)).toContain('phone_info');
    expect(fullTools.map((t) => t.name)).not.toContain('phone_info');
    expect(liteTools.find((t) => t.name === 'open_app')?.description).toBe(SHORT_DESCRIPTIONS.open_app);
  });

  it('Lite caches the repeated part and reports cached tokens, reasoning and cost per call', async () => {
    const cachedFinish = (toolName: string, input: unknown): Chunk[] => [
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: 'c', toolName, input: JSON.stringify(input) },
      {
        type: 'finish',
        finishReason: 'tool-calls',
        usage: { inputTokens: 5000, outputTokens: 60, totalTokens: 5060, cachedInputTokens: 4600, reasoningTokens: 20 },
        providerMetadata: { openrouter: { usage: { cost: 0.0012 } } },
      },
    ];
    const lite = engineWith([cachedFinish('open_app', { packageName: 'com.google.android.youtube' }), done(true, 'YouTube is open')], undefined, { compact: true });
    const full = engineWith([toolCall('open_app', { packageName: 'com.google.android.youtube' }), done(true, 'YouTube is open')]);
    const seen: { prompt: { role: string; providerOptions?: Record<string, unknown> }[]; providerOptions?: Record<string, unknown> }[] = [];
    for (const e of [lite, full]) {
      const model = (e.engine as unknown as { model: { doStream: (o: unknown) => unknown } }).model;
      const original = model.doStream.bind(model);
      model.doStream = (o: unknown) => {
        seen.push(o as never);
        return original(o);
      };
    }
    await lite.engine.run('open YouTube', 'c1');
    await full.engine.run('open YouTube', 'c2');
    // Lite: the task message carries the cache breakpoint; Vector does not cache.
    const liteFirstUser = seen[0].prompt.find((m) => m.role === 'user');
    expect(liteFirstUser?.providerOptions).toMatchObject({ openrouter: { cacheControl: { type: 'ephemeral' } } });
    const fullFirstUser = seen[2].prompt.find((m) => m.role === 'user');
    expect(fullFirstUser?.providerOptions?.openrouter).toBeUndefined();
    // Both ask OpenRouter for the cost.
    expect(seen[0].providerOptions).toMatchObject({ openrouter: { usage: { include: true } } });
    const usage = lite.messages.find((m) => m.type === 'finish')?.usage;
    expect(usage).toMatchObject({ promptTokens: 5000, completionTokens: 60, cachedTokens: 4600, reasoningTokens: 20, costUsd: 0.0012, cacheWriteTokens: null });
  });

  it('Lite asks for no hidden reasoning and short answers; Vector does not', async () => {
    const seen: { providerOptions?: { openrouter?: Record<string, unknown> }; prompt: { role: string; content: unknown }[] }[] = [];
    const lite = engineWith([toolCall('open_app', { packageName: 'com.google.android.youtube' }), done(true, 'YouTube is open')], undefined, { compact: true });
    const full = engineWith([toolCall('open_app', { packageName: 'com.google.android.youtube' }), done(true, 'YouTube is open')]);
    for (const e of [lite, full]) {
      const model = (e.engine as unknown as { model: { doStream: (o: unknown) => unknown } }).model;
      const original = model.doStream.bind(model);
      model.doStream = (o: unknown) => {
        seen.push(o as never);
        return original(o);
      };
    }
    await lite.engine.run('open YouTube', 'n1');
    await full.engine.run('open YouTube', 'n2');
    expect(seen[0].providerOptions?.openrouter).toMatchObject({ reasoning: { enabled: false } });
    expect(seen[2].providerOptions?.openrouter?.reasoning).toBeUndefined();
    const system = (o: (typeof seen)[number]) => String(seen.length && o.prompt.find((m) => m.role === 'system')?.content);
    expect(system(seen[0])).toContain('KEEP IT SHORT');
    expect(system(seen[2])).not.toContain('KEEP IT SHORT');
  });

  it('Lite carries on with default reasoning when the model refuses reasoning off', async () => {
    const refused = Object.assign(new Error('Reasoning is mandatory for this model'), { statusCode: 400 });
    const { engine, calls } = engineWith([refused, toolCall('open_app', { packageName: 'com.google.android.youtube' }), done(true, 'YouTube is open')], undefined, { compact: true });
    const seen: { providerOptions?: { openrouter?: Record<string, unknown> } }[] = [];
    const model = (engine as unknown as { model: { doStream: (o: unknown) => unknown } }).model;
    const original = model.doStream.bind(model);
    model.doStream = (o: unknown) => {
      seen.push(o as never);
      return original(o);
    };
    const result = await engine.run('open YouTube', 'n3');
    expect(result.success).toBe(true);
    expect(calls.open_app).toBe(1);
    expect(seen[0].providerOptions?.openrouter).toMatchObject({ reasoning: { enabled: false } });
    expect(seen[1].providerOptions?.openrouter?.reasoning).toBeUndefined();
  });

  it('Lite sends phone facts only through phone_info and asks for a sticky session', async () => {
    const { agent } = fakeAgent();
    const withFacts = Object.assign(Object.create(Object.getPrototypeOf(agent)), agent, {
      systemPrompt: async (o?: { withFacts?: boolean }) => (o?.withFacts === false ? 'You control a phone.' : 'You control a phone.\n\nTHIS PHONE: ip 1.2.3.4'),
      deviceFactsText: () => 'THIS PHONE: ip 1.2.3.4',
    });
    const seen: { prompt: { role: string; content: unknown; providerOptions?: unknown }[]; providerOptions?: { openrouter?: Record<string, unknown> } }[] = [];
    const run = async (compact: boolean, script: Chunk[][]) => {
      const e = engineWith(script, undefined, { compact, agent: withFacts as never, cacheSession: compact ? 'vb-u1-c2' : undefined });
      const model = (e.engine as unknown as { model: { doStream: (o: unknown) => unknown } }).model;
      const original = model.doStream.bind(model);
      model.doStream = (o: unknown) => {
        seen.push(o as never);
        return original(o);
      };
      return e.engine.run('what is my IP', compact ? 's1' : 's2');
    };
    const lite = await run(true, [toolCall('phone_info', {}), done(true, 'The IP is 1.2.3.4')]);
    await run(false, [toolCall('open_app', { packageName: 'com.google.android.youtube' }), done(true, 'YouTube is open')]);
    const text = (m: { content: unknown }) => JSON.stringify(m.content);
    // First Lite call: the facts are nowhere — not in the system prompt, not after the task.
    expect(JSON.stringify(seen[0].prompt)).not.toContain('1.2.3.4');
    const users = seen[0].prompt.filter((m) => m.role === 'user');
    expect(users).toHaveLength(1);
    expect(text(users[0])).toContain('TASK: what is my IP');
    expect(users[0].providerOptions).toBeDefined(); // the cache ends at the task
    expect(seen[0].providerOptions?.openrouter).toMatchObject({ session_id: 'vb-u1-c2' });
    // phone_info answered from the facts, without touching the phone.
    expect(JSON.stringify(seen[1].prompt.filter((m) => m.role === 'tool'))).toContain('1.2.3.4');
    expect(lite.success).toBe(true);
    // Vector keeps the facts in its system prompt and sends no session.
    expect(text(seen[3].prompt.find((m) => m.role === 'system')!)).toContain('1.2.3.4');
    expect(seen[3].providerOptions?.openrouter?.session_id).toBeUndefined();
  });

  it('Lite answers phone_info plainly when the phone reported no facts', async () => {
    const { agent } = fakeAgent();
    const noFacts = Object.assign(Object.create(Object.getPrototypeOf(agent)), agent, { deviceFactsText: () => null });
    const e = engineWith([toolCall('phone_info', {}), done(false, 'Not reported')], undefined, { compact: true, agent: noFacts as never });
    await e.engine.run('what is my IP', 's3');
    const result = e.messages.find((m) => m.type === 'tool_result' && m.toolName === 'phone_info');
    expect(JSON.stringify(result)).toContain('has not reported');
  });

  it('Lite: in a reply with several actions, the ones after a failure are not sent', async () => {
    const two: Chunk[] = [
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: 'a', toolName: 'tap_coordinate', input: JSON.stringify({ x: 1, y: 1 }) },
      { type: 'tool-call', toolCallId: 'b', toolName: 'global_action', input: JSON.stringify({ action: 'BACK' }) },
      { type: 'finish', finishReason: 'tool-calls', usage },
    ];
    const lite = engineWith([two, done(false, 'gave up')], { tapResult: () => ({ text: 'Action failed: NODE_NOT_FOUND', isError: true }) }, { compact: true });
    await lite.engine.run('tap then back', 'b1');
    expect(lite.calls.tap_coordinate).toBe(1);
    expect(lite.calls.global_action ?? 0).toBe(0);
    // Vector keeps sending every action of the reply, as before.
    const full = engineWith([two, done(false, 'gave up')], { tapResult: () => ({ text: 'Action failed: NODE_NOT_FOUND', isError: true }) });
    await full.engine.run('tap then back', 'b2');
    expect(full.calls.global_action).toBe(1);
  });

  it('records every request\'s generation id, the judge\'s too', async () => {
    const withId = (id: string, chunks: Chunk[]): Chunk[] => [chunks[0], { type: 'response-metadata', id } as never, ...chunks.slice(1)];
    const e = engineWith([withId('gen-a', toolCall('open_app', { packageName: 'com.android.chrome' })), withId('gen-b', done(true, 'Visited the sites'))], undefined, { compact: true });
    await e.engine.run('open Chrome and visit 2 sites', 'g1');
    const ids = e.engine.generations.map((g) => g.id);
    expect(ids).toEqual(expect.arrayContaining(['gen-a', 'gen-b']));
    expect(e.engine.generations.every((g) => g.fallback === false)).toBe(true);
  });

  it('Lite: after 25 steps the first one is still in the model\'s view, and the judge gets the counts', async () => {
    const script = [
      ...Array.from({ length: 25 }, (_, i) => toolCall('tap_coordinate', { x: i, y: i }, `t${i}`)),
      done(true, 'Tapped 25 times'),
    ];
    const e = engineWith(script, undefined, { compact: true });
    await e.engine.run('tap 25 times then open the sites', 'long1');
    const lastAgentPrompt = JSON.stringify(e.prompts.filter((p) => JSON.stringify(p).includes('TASK:')).at(-1));
    expect(lastAgentPrompt).toContain('1. tap_coordinate');
    expect(lastAgentPrompt).not.toContain('not shown');
    expect(JSON.stringify(e.prompts.at(-1))).toContain('COUNTED BY THE SYSTEM');
  });

  it('gives the judge the steps the phone performed', async () => {
    const { engine, prompts } = engineWith([toolCall('open_app', { packageName: 'com.android.chrome' }), done(true, 'Visited the sites')]);
    await engine.run('open Chrome and visit 2 sites', 'r9');
    expect(JSON.stringify(prompts.at(-1))).toContain('STEPS (1):');
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
