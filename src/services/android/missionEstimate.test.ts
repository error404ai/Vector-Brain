import { estimateLine, estimateMission, estimateNote, formatUsd, type PastRun } from './missionEstimate';
import { modelPrice, normaliseModel, setCatalogForTests } from './eko/modelVision';
import { costFromPrice } from './agent/usageDetails';
import { siteOnlyGoal, verifyCompletion } from './agent/successVerifier';

const run = (over: Partial<PastRun>): PastRun => ({
  prompt: 'Open the YouTube app and play any random song.',
  provider: 'openrouter',
  model: 'anthropic/claude-haiku-5.5',
  steps: 12,
  durationSeconds: 60,
  costUsd: 0.0018,
  promptTokens: 60000,
  completionTokens: 1200,
  cacheReadTokens: 50000,
  cacheWriteTokens: null,
  timed: false,
  ...over,
});

const haiku = { input: 0.1e-6, output: 0.5e-6, cacheRead: 0.01e-6, cacheWrite: 0.125e-6 };

describe('mission estimate', () => {
  it('uses what this task cost on this model before (Oct 9: the card said $0.23 for a $0.033 mission)', () => {
    // 15 phones, each run of this task ~12 steps and ~$0.0022 on Haiku.
    const runs = Array.from({ length: 15 }, () => run({ costUsd: 0.0022 }));
    const e = estimateMission({ runs, instructions: ['open the youtube app and play any random song'], phones: 15, minutes: 0, provider: 'openrouter', model: 'anthropic/claude-haiku-5.5', price: haiku });
    expect(e.steps).toBe(180);
    expect(e.costUsd).toBeCloseTo(0.033, 4);
    expect(e.stepsFrom).toBe('same_task');
    expect(e.costFrom).toBe('your_runs');
    expect(estimateLine(e)).toBe('about 180 AI steps, roughly $0.033');
    expect(estimateNote(e)).toBe('From your last 15 runs of this task on anthropic/claude-haiku-5.5.');
  });

  it('a new task: the median of the user’s runs for steps, their cost per step on this model', () => {
    const runs = [run({ prompt: 'a', steps: 10, costUsd: 0.001 }), run({ prompt: 'b', steps: 20, costUsd: 0.002 }), run({ prompt: 'c', steps: 30, costUsd: 0.003 })];
    const e = estimateMission({ runs, instructions: ['like 3 reels'], phones: 2, minutes: 0, provider: 'openrouter', model: 'anthropic/claude-haiku-5.5', price: null });
    expect(e.steps).toBe(40);
    expect(e.costUsd).toBeCloseTo(0.004, 6);
    expect(e.stepsFrom).toBe('your_runs');
  });

  it('a model the user never ran: its list price × a typical step', () => {
    const e = estimateMission({ runs: [], instructions: ['x'], phones: 10, minutes: 0, provider: 'openai', model: 'gpt-4o-mini', price: { input: 0.15e-6, output: 0.6e-6, cacheRead: 0.075e-6, cacheWrite: null } });
    expect(e.steps).toBe(150);
    expect(e.costFrom).toBe('price_list');
    // 600 fresh + 4900 cached input, 100 output per step.
    expect(e.costUsd).toBeCloseTo(150 * (600 * 0.15e-6 + 4900 * 0.075e-6 + 100 * 0.6e-6), 8);
  });

  it('a provider that sends no bill: the user’s own tokens on that model, priced', () => {
    const runs = [run({ provider: 'deepseek', model: 'deepseek-chat', costUsd: null, steps: 10, promptTokens: 50000, cacheReadTokens: 40000, completionTokens: 1000 })];
    const price = { input: 0.27e-6, output: 1.1e-6, cacheRead: 0.07e-6, cacheWrite: null };
    const e = estimateMission({ runs, instructions: ['open the youtube app and play any random song'], phones: 1, minutes: 0, provider: 'deepseek', model: 'deepseek-chat', price });
    expect(e.costFrom).toBe('your_runs');
    expect(e.costUsd).toBeCloseTo(10000 * 0.27e-6 + 40000 * 0.07e-6 + 1000 * 1.1e-6, 9);
  });

  it('an unknown price stays unknown, never $0', () => {
    const e = estimateMission({ runs: [], instructions: ['x'], phones: 6, minutes: 0, provider: 'custom', model: 'my-local-llm', price: null });
    expect(e.costUsd).toBeNull();
    expect(estimateLine(e)).toBe('about 90 AI steps, price unknown for my-local-llm');
    expect(estimateNote(e)).toMatch(/not in the price list/);
  });

  it('timed missions use this task’s steps per minute, else 5 a minute', () => {
    const runs = [run({ steps: 40, durationSeconds: 600 })];
    expect(estimateMission({ runs, instructions: ['open the youtube app and play any random song'], phones: 2, minutes: 30, provider: null, model: null, price: null }).steps).toBe(240);
    expect(estimateMission({ runs: [], instructions: ['scroll reels'], phones: 2, minutes: 30, provider: null, model: null, price: null }).steps).toBe(300);
  });

  it('shows small amounts with enough digits', () => {
    expect(formatUsd(0.0274)).toBe('$0.027');
    expect(formatUsd(0.0018)).toBe('$0.0018');
    expect(formatUsd(1.4)).toBe('$1.40');
    expect(formatUsd(0.00001)).toBe('<$0.0001');
  });
});

describe('model prices for every provider', () => {
  afterEach(() => setCatalogForTests(null));

  it('finds a provider’s own model name in the catalog', async () => {
    setCatalogForTests([
      { id: 'anthropic/claude-haiku-5.5', pricing: { prompt: '0.0000001', completion: '0.0000005', input_cache_read: '0.00000001', input_cache_write: '0.000000125' } },
      { id: 'openai/gpt-4o-mini', pricing: { prompt: '0.00000015', completion: '0.0000006' } },
      { id: 'openai/gpt-4o-mini:free', pricing: { prompt: '0', completion: '0' } },
      { id: 'google/gemini-2.5-flash', pricing: { prompt: '0.0000003', completion: '0.0000025' } },
      { id: 'openrouter/auto', pricing: { prompt: '-1', completion: '-1' } },
    ]);
    expect((await modelPrice('openrouter', 'anthropic/claude-haiku-5.5'))?.cacheRead).toBe(1e-8);
    expect((await modelPrice('anthropic', 'claude-haiku-5-5'))?.input).toBe(1e-7);
    expect((await modelPrice('openai', 'gpt-4o-mini-2024-07-18'))?.input).toBe(1.5e-7);
    expect((await modelPrice('google', 'gemini-2.5-flash'))?.output).toBe(2.5e-6);
    expect(await modelPrice('openrouter', 'openrouter/auto')).toBeNull();
    expect(await modelPrice('custom', 'my-local-llm')).toBeNull();
  });

  it('normalises names the same way on both sides', () => {
    expect(normaliseModel('anthropic/claude-3.5-sonnet')).toBe(normaliseModel('claude-3-5-sonnet-20241022'));
    expect(normaliseModel('claude-3-5-sonnet-latest')).toBe('claude-3-5-sonnet');
  });

  it('prices a call: Anthropic counts cache apart from input, the others inside it', () => {
    const usage = { inputTokens: 1000, outputTokens: 100, cachedTokens: 800, cacheWriteTokens: null };
    expect(costFromPrice(haiku, 'openai', usage)).toBeCloseTo(200 * 1e-7 + 800 * 1e-8 + 100 * 5e-7, 12);
    expect(costFromPrice(haiku, 'anthropic', { ...usage, cacheWriteTokens: 50 })).toBeCloseTo(1000 * 1e-7 + 800 * 1e-8 + 50 * 1.25e-7 + 100 * 5e-7, 12);
  });
});

describe('done check for "open <site>"', () => {
  it('knows a goal that only opens a site', () => {
    expect(siteOnlyGoal('Open https://www.wikipedia.org')).toBe('wikipedia.org');
    expect(siteOnlyGoal('visit example.com in Chrome')).toBe('example.com');
    expect(siteOnlyGoal('open youtube.com and search lofi')).toBeNull();
    expect(siteOnlyGoal('Open the YouTube app')).toBeNull();
  });

  it('verifies without the judge when the address is on screen, and asks the judge when it is not', async () => {
    const judge = jest.fn(async () => '{"verdict":"yes","reason":"ok"}');
    const listApps = async () => [];
    const shown = await verifyCompletion({ goal: 'open example.com', summary: 'opened', observe: async () => ({ packageName: 'com.android.chrome', tree: '0|input|example.com/|te|500,80' }), listApps, judge });
    expect(shown).toMatchObject({ status: 'verified', method: 'rule' });
    expect(judge).not.toHaveBeenCalled();
    const hidden = await verifyCompletion({ goal: 'open example.com', summary: 'opened', observe: async () => ({ packageName: 'com.android.chrome', tree: '0|text|Welcome|t|500,500' }), listApps, judge });
    expect(hidden.method).toBe('judge');
  });
});
