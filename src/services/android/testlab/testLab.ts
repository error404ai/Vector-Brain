import { failureKind, type FailureKind } from '../failureKind';
import { TASK_BANK, type BankKind, type BankTask } from './taskBank';

/**
 * Test Lab, the pure part: settings, which jobs a night runs, and how their
 * results are sorted into what needs fixing where.
 *
 * Every task runs on two different models when two or more are set. That is
 * what makes the triage mean something:
 * - fails on every model it ran on → the engine (or the app/site) is at fault,
 *   whichever model drives it: these are the ones worth fixing first;
 * - passes on one model, fails on another → that model's habit, not an engine
 *   bug: never patched into the engine;
 * - the phone lacked an app or a sign-in → setup, not engine;
 * - the free model's daily cap → quota, not counted at all.
 */

export interface TestLabSettings {
  enabled: boolean;
  /** Hour of the day (India time) the nightly run starts. */
  hour: number;
  /** OpenRouter model ids, rotated across tasks ("vendor/model:free"). */
  models: string[];
  /** Test phones (android_devices.id). Each runs one job at a time. */
  device_ids: number[];
  /** Phone runs per night, all jobs together. Free models cap requests per day; a run is ~15–30 requests. */
  runs_per_night: number;
  /** Share of tasks given in other words (a model rewrites the prompt), 0–1. */
  variant_share: number;
  max_steps: number;
  /** The account's own must-pass tasks: in every night, before any bank task. */
  core: { key: string; prompt: string }[];
  /** Bank kinds to leave out (e.g. "social" on phones without accounts). */
  skip_kinds: BankKind[];
}

export const DEFAULT_SETTINGS: TestLabSettings = {
  enabled: false,
  hour: 1,
  models: [],
  device_ids: [],
  runs_per_night: 40,
  variant_share: 0.3,
  max_steps: 40,
  core: [],
  skip_kinds: [],
};

const BANK_PROMPTS = new Set(TASK_BANK.map((t) => t.prompt.replace(/\s+/g, ' ').trim().toLowerCase()));
const MODEL_ID = /^[\w.-]+\/[\w.:-]+$/;
const KINDS: BankKind[] = ['open', 'navigate', 'settings', 'read', 'web', 'search', 'media', 'count', 'social', 'install', 'input', 'form', 'multi'];
const int = (v: unknown, min: number, max: number, fallback: number) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

/** Anything saved or sent, made safe to use. */
export function normaliseSettings(raw: unknown): TestLabSettings {
  const r = (raw ?? {}) as Partial<Record<keyof TestLabSettings, unknown>>;
  const models = [...new Set((Array.isArray(r.models) ? r.models : []).map((m) => String(m).trim()).filter((m) => MODEL_ID.test(m)))].slice(0, 6);
  const devices = [...new Set((Array.isArray(r.device_ids) ? r.device_ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 10);
  const core = (Array.isArray(r.core) ? r.core : [])
    .map((c, i) => {
      const item = (c ?? {}) as { key?: unknown; prompt?: unknown };
      const prompt = String(item.prompt ?? '').replace(/\s+/g, ' ').trim().slice(0, 500);
      const key = String(item.key ?? '').trim().replace(/[^\w-]/g, '').slice(0, 40) || `core-${i + 1}`;
      return { key: key.startsWith('core-') ? key : `core-${key}`, prompt };
    })
    // A bank task pasted in as a core task is already in the bank: it would only run twice as often.
    .filter((c) => c.prompt && !BANK_PROMPTS.has(c.prompt.toLowerCase()))
    .slice(0, 30);
  return {
    enabled: r.enabled === true,
    hour: int(r.hour, 0, 23, DEFAULT_SETTINGS.hour),
    models,
    device_ids: devices,
    runs_per_night: int(r.runs_per_night, 1, 300, DEFAULT_SETTINGS.runs_per_night),
    variant_share: Math.max(0, Math.min(1, Number.isFinite(Number(r.variant_share)) ? Number(r.variant_share) : DEFAULT_SETTINGS.variant_share)),
    max_steps: int(r.max_steps, 5, 150, DEFAULT_SETTINGS.max_steps),
    core,
    skip_kinds: (Array.isArray(r.skip_kinds) ? r.skip_kinds : []).map(String).filter((k): k is BankKind => (KINDS as string[]).includes(k)),
  };
}

export type JobStatus = 'queued' | 'running' | 'done' | 'skipped';
export type Bucket = 'pass' | 'unsure' | 'engine' | 'model' | 'setup' | 'quota' | 'platform' | 'skipped';

export interface JobResult {
  status: string;
  reason_code: string | null;
  message: string;
  verification: { status: string; method: string; reason: string } | null;
  /** The rule list the run was checked against (parts only). */
  parts: string[];
  cost_usd: number;
  steps: number;
  kind: FailureKind | null;
}

export interface LabJob {
  id: number;
  key: string;
  kind: BankKind | 'core';
  prompt: string;
  /** The bank's wording when prompt is a rewritten variant. */
  original?: string;
  model: string;
  /** The other job of the same task, run on another model. */
  pair?: number;
  needs?: string[];
  status: JobStatus;
  device_id?: number | null;
  mission_id?: number | null;
  task_id?: number | null;
  started_at?: string | null;
  /** Why it was skipped (quota, night over, stopped). */
  note?: string;
  result?: JobResult;
  bucket?: Bucket;
}

/** Small seeded random, so a night's choice can be reproduced in tests. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * The night's jobs. Core tasks first, then bank tasks: least recently run first
 * (lastRun: key → night number it last ran in), ties broken at random, taking
 * kinds in turn so one night is not all Instagram. Each task gets two jobs on
 * different models when there are two or more.
 */
export function planNight(settings: TestLabSettings, bank: readonly BankTask[], lastRun: Map<string, number>, random: () => number): LabJob[] {
  const models = settings.models;
  if (!models.length) return [];
  const perTask = models.length >= 2 ? 2 : 1;
  const budget = Math.max(1, Math.floor(settings.runs_per_night / perTask));
  // Core tasks first, but never more than the night's budget: the least recently run ones go first.
  const core = [...settings.core].sort((a, b) => (lastRun.get(a.key) ?? -1) - (lastRun.get(b.key) ?? -1)).slice(0, budget);
  const chosen: { key: string; kind: BankKind | 'core'; prompt: string; needs?: string[] }[] = core.map((c) => ({ key: c.key, kind: 'core' as const, prompt: c.prompt }));

  const pool = bank.filter((t) => !settings.skip_kinds.includes(t.kind)).map((t) => ({ t, age: lastRun.get(t.key) ?? -1, r: random() }));
  const byKind = new Map<BankKind, typeof pool>();
  for (const p of pool) byKind.set(p.t.kind, [...(byKind.get(p.t.kind) ?? []), p]);
  for (const list of byKind.values()) list.sort((a, b) => a.age - b.age || a.r - b.r);
  // Kinds in turn, the kind whose next task is the stalest first.
  while (chosen.length < budget) {
    const heads = [...byKind.entries()].filter(([, l]) => l.length).sort(([, a], [, b]) => a[0].age - b[0].age || a[0].r - b[0].r);
    if (!heads.length) break;
    for (const [, list] of heads) {
      if (chosen.length >= budget) break;
      const next = list.shift()!;
      chosen.push({ key: next.t.key, kind: next.t.kind, prompt: next.t.prompt, needs: next.t.needs });
    }
  }

  const jobs: LabJob[] = [];
  chosen.slice(0, budget).forEach((task, i) => {
    const first: LabJob = { id: jobs.length + 1, key: task.key, kind: task.kind, prompt: task.prompt, model: models[i % models.length], status: 'queued', ...(task.needs ? { needs: task.needs } : {}) };
    jobs.push(first);
    if (perTask === 2) {
      const second: LabJob = { ...first, id: jobs.length + 1, model: models[(i + 1) % models.length], pair: first.id };
      first.pair = second.id;
      jobs.push(second);
    }
  });
  return jobs;
}

/** Numbers, URLs, domains and quoted text: what a rewritten task must keep exactly. */
function anchors(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/https?:\/\/\S+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/\S*)?|"[^"]+"|\d+(?:[.:]\d+)?/gi)) out.add(m[0].replace(/[.,)]+$/, '').toLowerCase());
  return [...out];
}

/** A rewritten task is used only if it keeps every number, address and quoted text, and stays about the same size. */
export function variantOk(original: string, variant: string): boolean {
  const v = variant.trim();
  if (!v || v.length > original.length * 3 + 40 || v.length < 4) return false;
  // Markup or JSON is a model answering something else, not a reworded task.
  if (/[<>{}[\]]/.test(v) && !/[<>{}[\]]/.test(original)) return false;
  const lower = v.toLowerCase();
  return anchors(original).every((a) => lower.includes(a));
}

export const VARIANT_PROMPT = `Rewrite this phone task the way a different person might type it to an assistant: casual, maybe in Hinglish (Hindi in Latin letters mixed with English), maybe shorter or longer. Same meaning. Keep every app name, number, URL and anything in quotes exactly as written. Reply with only the rewritten task.`;

export const QUOTA_CODES = new Set(['LLM_QUOTA', 'LLM_RATE_LIMIT', 'LLM_AUTH_OR_CREDIT']);

/** One job's bucket before comparing it with its pair. */
function ownBucket(job: LabJob): Bucket | 'failed' {
  if (job.status === 'skipped' || !job.result) return 'skipped';
  const r = job.result;
  if (r.reason_code && QUOTA_CODES.has(r.reason_code)) return 'quota';
  if (r.status === 'SUCCEEDED') return r.verification?.status === 'verified' ? 'pass' : r.verification?.status === 'failed' ? 'failed' : 'unsure';
  if (r.status === 'CANCELLED') return 'skipped';
  const kind = r.kind ?? failureKind(r.reason_code, r.message);
  if (kind === 'ai_service') return r.reason_code === 'LLM_SLOW' || r.reason_code === 'PLAN_FAILED' ? 'model' : 'quota';
  if (kind === 'phone' || kind === 'needs_user') return 'setup';
  if (kind === 'platform') return 'platform';
  return 'failed';
}

/** Every job's bucket: a failure is the model's when the same task passed on another model, else the engine's. */
export function triage(jobs: LabJob[]): LabJob[] {
  const own = new Map(jobs.map((j) => [j.id, ownBucket(j)]));
  return jobs.map((job) => {
    const b = own.get(job.id)!;
    if (b !== 'failed') return { ...job, bucket: b };
    const passedElsewhere = jobs.some((o) => o.key === job.key && o.id !== job.id && o.model !== job.model && (own.get(o.id) === 'pass' || own.get(o.id) === 'unsure'));
    return { ...job, bucket: passedElsewhere ? 'model' : 'engine' };
  });
}

export interface LabReport {
  night_id: number;
  day: string;
  started_at: string;
  finished_at: string;
  totals: Record<Bucket, number> & { runs: number; counted: number; pass_rate: number | null; cost_usd: number };
  per_model: { model: string; runs: number; pass: number; unsure: number; engine: number; model_fault: number; quota: number; cost_usd: number; avg_steps: number }[];
  per_kind: { kind: string; runs: number; pass: number; engine: number }[];
  /** Engine failures grouped by how they ended, most first: the fix list. */
  engine: { signature: string; count: number; runs: { key: string; task_id: number | null; model: string; device_id: number | null; why: string }[] }[];
  model_quirks: { model: string; key: string; task_id: number | null; why: string }[];
  setup: { device_id: number | null; key: string; task_id: number | null; why: string }[];
  /** Tasks the bank ran tonight that failed on every model: a short list to read first. */
  failed_everywhere: string[];
}

const shortWhy = (job: LabJob) => {
  const r = job.result;
  if (!r) return job.note ?? '';
  const v = r.verification?.status === 'failed' ? r.verification.reason : '';
  return (v || r.message || r.reason_code || '').replace(/\s+/g, ' ').trim().slice(0, 200);
};

export function buildReport(nightId: number, day: string, startedAt: Date, finishedAt: Date, triaged: LabJob[]): LabReport {
  const buckets: Bucket[] = ['pass', 'unsure', 'engine', 'model', 'setup', 'quota', 'platform', 'skipped'];
  const count = (b: Bucket, list = triaged) => list.filter((j) => j.bucket === b).length;
  const cost = (list: LabJob[]) => Number(list.reduce((s, j) => s + (j.result?.cost_usd ?? 0), 0).toFixed(6));
  const counted = triaged.filter((j) => ['pass', 'unsure', 'engine', 'model'].includes(j.bucket ?? '')).length;
  const totals = {
    ...(Object.fromEntries(buckets.map((b) => [b, count(b)])) as Record<Bucket, number>),
    runs: triaged.length,
    counted,
    pass_rate: counted ? Number(((count('pass') + count('unsure')) / counted).toFixed(3)) : null,
    cost_usd: cost(triaged),
  };
  const models = [...new Set(triaged.map((j) => j.model))];
  const per_model = models.map((model) => {
    const list = triaged.filter((j) => j.model === model);
    const ran = list.filter((j) => j.result);
    return {
      model,
      runs: list.length,
      pass: count('pass', list),
      unsure: count('unsure', list),
      engine: count('engine', list),
      model_fault: count('model', list),
      quota: count('quota', list),
      cost_usd: cost(list),
      avg_steps: ran.length ? Number((ran.reduce((s, j) => s + (j.result?.steps ?? 0), 0) / ran.length).toFixed(1)) : 0,
    };
  });
  const kinds = [...new Set(triaged.map((j) => j.kind))];
  const per_kind = kinds.map((kind) => {
    const list = triaged.filter((j) => j.kind === kind);
    return { kind, runs: list.length, pass: count('pass', list) + count('unsure', list), engine: count('engine', list) };
  });
  const groups = new Map<string, LabReport['engine'][number]>();
  for (const job of triaged.filter((j) => j.bucket === 'engine')) {
    const signature = `${job.result?.reason_code ?? 'UNKNOWN'} · ${job.kind}`;
    const g = groups.get(signature) ?? { signature, count: 0, runs: [] };
    g.count += 1;
    g.runs.push({ key: job.key, task_id: job.task_id ?? null, model: job.model, device_id: job.device_id ?? null, why: shortWhy(job) });
    groups.set(signature, g);
  }
  const keys = [...new Set(triaged.map((j) => j.key))];
  return {
    night_id: nightId,
    day,
    started_at: startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
    totals,
    per_model,
    per_kind,
    engine: [...groups.values()].sort((a, b) => b.count - a.count),
    model_quirks: triaged.filter((j) => j.bucket === 'model').map((j) => ({ model: j.model, key: j.key, task_id: j.task_id ?? null, why: shortWhy(j) })),
    setup: triaged.filter((j) => j.bucket === 'setup').map((j) => ({ device_id: j.device_id ?? null, key: j.key, task_id: j.task_id ?? null, why: shortWhy(j) })),
    failed_everywhere: keys.filter((k) => {
      const list = triaged.filter((j) => j.key === k);
      return list.length > 0 && list.every((j) => j.bucket === 'engine');
    }),
  };
}

/** The report as Markdown, for the GitHub copy the daily analysis reads. */
export function reportMarkdown(report: LabReport, jobs: LabJob[]): string {
  const t = report.totals;
  const pct = (n: number | null) => (n === null ? '—' : `${Math.round(n * 100)}%`);
  const lines = [
    `# Test Lab ${report.day} (night #${report.night_id})`,
    '',
    `Pass rate ${pct(t.pass_rate)} of ${t.counted} counted runs · pass ${t.pass} · unsure ${t.unsure} · engine ${t.engine} · model ${t.model} · setup ${t.setup} · quota ${t.quota} · platform ${t.platform} · skipped ${t.skipped} · cost $${t.cost_usd.toFixed(4)}`,
    '',
    '## Models',
    '| model | runs | pass | unsure | engine | model fault | quota | avg steps | cost |',
    '|---|---|---|---|---|---|---|---|---|',
    ...report.per_model.map((m) => `| ${m.model} | ${m.runs} | ${m.pass} | ${m.unsure} | ${m.engine} | ${m.model_fault} | ${m.quota} | ${m.avg_steps} | $${m.cost_usd.toFixed(4)} |`),
    '',
    '## Engine failures (fix these)',
    ...(report.engine.length
      ? report.engine.flatMap((g) => [`### ${g.signature} ×${g.count}`, ...g.runs.map((r) => `- ${r.key} · task #${r.task_id ?? '—'} · ${r.model} · phone ${r.device_id ?? '—'}: ${r.why}`)])
      : ['None.']),
    '',
    '## Model habits (not engine bugs)',
    ...(report.model_quirks.length ? report.model_quirks.map((q) => `- ${q.model} · ${q.key} · task #${q.task_id ?? '—'}: ${q.why}`) : ['None.']),
    '',
    '## Setup gaps',
    ...(report.setup.length ? report.setup.map((s) => `- phone ${s.device_id ?? '—'} · ${s.key} · task #${s.task_id ?? '—'}: ${s.why}`) : ['None.']),
    '',
    '## All runs',
    '| job | task | kind | model | phone | bucket | run | why |',
    '|---|---|---|---|---|---|---|---|',
    ...jobs.map((j) => `| ${j.id} | ${j.key}${j.original ? ' (reworded)' : ''} | ${j.kind} | ${j.model} | ${j.device_id ?? '—'} | ${j.bucket ?? j.status} | ${j.task_id ?? '—'} | ${shortWhy(j).replace(/\|/g, '/')} |`),
  ];
  return lines.join('\n');
}

/** The day in India time ("2026-10-12") and the hour (0–23). */
export function indiaClock(now: Date): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { day: `${get('year')}-${get('month')}-${get('day')}`, hour: Number(get('hour')) };
}
