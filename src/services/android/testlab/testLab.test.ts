import { TASK_BANK } from './taskBank';
import { buildReport, indiaClock, normaliseSettings, planNight, reportMarkdown, seeded, triage, variantOk, type LabJob } from './testLab';

const settings = (over: Record<string, unknown> = {}) => normaliseSettings({ enabled: true, models: ['a/free-one:free', 'b/free-two:free'], device_ids: [51, 65, 67], runs_per_night: 20, ...over });

describe('Test Lab', () => {
  it('the bank has unique keys and no task that reaches people or money', () => {
    const keys = TASK_BANK.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(TASK_BANK.length).toBeGreaterThanOrEqual(90);
    for (const t of TASK_BANK) expect(t.prompt).not.toMatch(/(?<!not )\b(send (?:it|the email|a message to)|buy|purchase|pay|delete|publish it)\b/i);
  });

  it('settings: bad models, phones and numbers are cleaned', () => {
    const s = normaliseSettings({ models: ['ok/model:free', 'not a model', 'ok/model:free'], device_ids: [3, '4', -1, 'x'], hour: 99, runs_per_night: 0, core: [{ prompt: '  open  youtube ' }, { prompt: '' }] });
    expect(normaliseSettings({ core: [{ prompt: 'Open the YouTube app.' }, { prompt: 'my own task' }] }).core).toEqual([{ key: 'core-2', prompt: 'my own task' }]);
    expect(s).toMatchObject({ enabled: false, models: ['ok/model:free'], device_ids: [3, 4], hour: 23, runs_per_night: 1, core: [{ key: 'core-1', prompt: 'open youtube' }] });
  });

  it('a night: core first, every task on two models, kinds in turn, least recently run first', () => {
    const s = settings({ core: [{ prompt: 'my business task' }] });
    const last = new Map(TASK_BANK.filter((t) => t.kind === 'open').map((t) => [t.key, 9]));
    const jobs = planNight(s, TASK_BANK, last, seeded(7));
    expect(jobs).toHaveLength(20);
    expect(jobs[0]).toMatchObject({ key: 'core-1', kind: 'core', model: 'a/free-one:free', pair: 2 });
    expect(jobs[1]).toMatchObject({ key: 'core-1', model: 'b/free-two:free', pair: 1 });
    const kinds = new Set(jobs.map((j) => j.kind));
    expect(kinds.size).toBeGreaterThanOrEqual(8);
    // Tasks run last night wait until the others have had a turn.
    expect(jobs.some((j) => j.kind === 'open')).toBe(false);
    expect(new Set(jobs.map((j) => j.id)).size).toBe(20);
  });

  it('more core tasks than the budget: only as many as fit, least recently run first', () => {
    const core = Array.from({ length: 30 }, (_, i) => ({ key: `core-${i + 1}`, prompt: `my task ${i + 1}` }));
    const jobs = planNight(settings({ core, runs_per_night: 10 }), TASK_BANK, new Map([['core-1', 5]]), seeded(3));
    expect(jobs).toHaveLength(10);
    expect(jobs.every((j) => j.kind === 'core')).toBe(true);
    expect(jobs.some((j) => j.key === 'core-1')).toBe(false);
  });

  it('one model: one job per task; skipped kinds stay out', () => {
    const jobs = planNight(settings({ models: ['a/x:free'], skip_kinds: ['social', 'install'] }), TASK_BANK, new Map(), seeded(1));
    expect(jobs).toHaveLength(20);
    expect(jobs.every((j) => j.pair === undefined && j.kind !== 'social' && j.kind !== 'install')).toBe(true);
  });

  it('a reworded task must keep numbers, addresses and quoted text', () => {
    expect(variantOk('Open Chrome and visit 5 random websites.', 'chrome mein 5 random sites kholo')).toBe(true);
    expect(variantOk('Open Chrome and visit 5 random websites.', 'chrome mein kuch sites kholo')).toBe(false);
    expect(variantOk('Go to https://en.wikipedia.org/wiki/India in Chrome.', 'chrome pe wikipedia india kholo')).toBe(false);
    expect(variantOk('Search YouTube for "lofi hip hop".', 'youtube pe "lofi hip hop" dhundo')).toBe(true);
    expect(variantOk('Open YouTube.', '')).toBe(false);
    expect(variantOk('Open the Play Store.', '<root>')).toBe(false);
  });

  const done = (id: number, key: string, model: string, over: Partial<NonNullable<LabJob['result']>>): LabJob => ({
    id,
    key,
    kind: 'media',
    prompt: key,
    model,
    status: 'done',
    task_id: 1000 + id,
    device_id: 51,
    result: { status: 'FAILED', reason_code: 'VERIFICATION_FAILED', message: '', verification: null, parts: [], cost_usd: 0.001, steps: 10, kind: null, ...over },
  });

  it('triage: fails on every model → engine; passes on another → model habit; setup, quota and platform apart', () => {
    const jobs = triage([
      done(1, 'pause', 'A', {}),
      done(2, 'pause', 'B', { reason_code: 'STEP_LIMIT' }),
      done(3, 'like', 'A', { status: 'SUCCEEDED', reason_code: null, verification: { status: 'verified', method: 'judge', reason: 'ok' } }),
      done(4, 'like', 'B', { reason_code: 'LOOP_DETECTED' }),
      done(5, 'reels', 'A', { reason_code: 'AGENT_REPORTED_FAILURE', message: 'Instagram is not installed on this phone' }),
      done(6, 'reels', 'B', { reason_code: 'LLM_QUOTA' }),
      done(7, 'sites', 'A', { reason_code: 'SERVER_RESTART' }),
      done(8, 'sites', 'B', { status: 'SUCCEEDED', reason_code: null, verification: { status: 'unverified', method: 'none', reason: '' } }),
      { id: 9, key: 'x', kind: 'open', prompt: 'x', model: 'A', status: 'skipped', note: 'stopped' },
      done(10, 'login', 'A', { reason_code: 'AGENT_REPORTED_FAILURE', message: 'This needs you to sign in with your password' }),
    ]);
    expect(jobs.map((j) => j.bucket)).toEqual(['engine', 'engine', 'pass', 'model', 'setup', 'quota', 'platform', 'unsure', 'skipped', 'setup']);

    const report = buildReport(3, '2026-10-12', new Date('2026-10-11T19:30:00Z'), new Date('2026-10-12T00:30:00Z'), jobs);
    expect(report.totals).toMatchObject({ runs: 10, pass: 1, unsure: 1, engine: 2, model: 1, setup: 2, quota: 1, platform: 1, skipped: 1, counted: 5, pass_rate: 0.4 });
    expect(report.failed_everywhere).toEqual(['pause']);
    expect(report.engine.map((g) => g.signature)).toEqual(['VERIFICATION_FAILED · media', 'STEP_LIMIT · media']);
    expect(report.model_quirks).toEqual([{ model: 'B', key: 'like', task_id: 1004, why: 'LOOP_DETECTED' }]);
    expect(report.per_model.find((m) => m.model === 'B')).toMatchObject({ runs: 4, engine: 1, model_fault: 1, quota: 1, unsure: 1 });
    const md = reportMarkdown(report, jobs);
    expect(md).toMatch(/^# Test Lab 2026-10-12 \(night #3\)/);
    expect(md).toMatch(/### VERIFICATION_FAILED · media ×1/);
  });

  it('the India clock', () => {
    expect(indiaClock(new Date('2026-10-11T19:45:00Z'))).toEqual({ day: '2026-10-12', hour: 1 });
  });
});
