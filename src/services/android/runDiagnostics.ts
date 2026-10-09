import { createHash } from 'crypto';
import { failureKind, type FailureKind } from './failureKind';

/**
 * Run diagnostics: pure functions that explain where a run's steps went.
 *
 * Kept free of the database so they can be unit-tested with plain arrays and
 * reused by the export, the report page and a future recipe/replay layer.
 */

export const DIAGNOSTICS_VERSION = 1;

/** Why a step counted as wasted. Order matters: the first rule that matches wins. */
export type WasteTag = 'failed' | 'repeat' | 'reopen' | 'reread' | 'no_effect' | 'backtrack';

export const WASTE_LABELS: Record<WasteTag, string> = {
  failed: 'Action failed',
  repeat: 'Same action again on the same screen',
  reopen: 'Opened an app that was already open',
  reread: 'Read the screen again although nothing changed',
  no_effect: 'Action changed nothing on screen',
  backtrack: 'Went back',
};

export interface RunDiagnostics {
  version: number;
  steps: number;
  sources: Record<string, number>;
  llm_calls: number;
  /** False when the provider never reported usage; token counts are then 0, not "free". */
  tokens_reported: boolean;
  prompt_tokens: number;
  completion_tokens: number;
  /** Of prompt_tokens: read from the prompt cache. Absent on runs before this was recorded. */
  cache_read_tokens?: number;
  /** Written to the prompt cache; null when the provider does not report it. */
  cache_write_tokens?: number | null;
  /** Of completion_tokens: hidden reasoning. */
  reasoning_tokens?: number;
  /** What the provider billed for the run's model calls, in USD; null when not reported. */
  cost_usd?: number | null;
  think_ms: number;
  phone_ms: number;
  wait_ms: number;
  failed: number;
  wasted: number;
  waste: Partial<Record<WasteTag, number>>;
  actions: Record<string, number>;
  /** Screenshots the model asked for (vision is the expensive observation). */
  vision: number;
  packages: string[];
  /**
   * What the engine had to recover from before the run ended (absent on runs
   * recorded before outcomes existed). Keys: step_failed, no_effect, repeat,
   * verify_retry, backup_model, obstacle.
   */
  recoveries?: Partial<Record<RecoveryKind, number>>;
  /** Generation ids of every model request (Vector/Lite runs); stripped from exports and lists. */
  generations?: RunGeneration[];
  /** The provider's own bill for those requests, once checked from Diagnostics. */
  billed?: BilledCost;
}

/** The subset of a step row these functions need. */
export interface StepLite {
  action_type: string;
  action_payload?: unknown;
  status: string;
  duration_ms?: number | null;
  think_ms?: number | null;
  source?: string | null;
  package_before?: string | null;
  package_after?: string | null;
  screen_before?: string | null;
  screen_after?: string | null;
}

/** Actions that are supposed to change the screen. */
const INTERACTIVE = new Set([
  'tap_coordinate',
  'tap_element',
  'click_node',
  'long_press',
  'swipe',
  'scroll_element',
  'press_key',
  'type_text',
  'paste',
]);

/**
 * A short fingerprint of what the screen offers, not of everything it shows.
 *
 * Built from the agent's formatted tree (`idx|type|label|flags|tap_at`) using
 * only rows that can be tapped or typed into, plus the foreground package.
 * Clocks, counters and feed text in plain labels therefore do not make two
 * identical screens look different; a changed button or typed text does.
 * Returns null when there is no tree to fingerprint.
 */
export function screenFingerprint(tree: string | null | undefined, packageName?: string | null): string | null {
  if (!tree || typeof tree !== 'string' || !tree.includes('|')) return null;
  const rows: string[] = [];
  for (const line of tree.split('\n')) {
    const parts = line.split('|');
    if (parts.length < 5 || parts[0] === 'idx') continue;
    const flags = parts[parts.length - 2];
    if (!/[te]/.test(flags)) continue;
    const type = parts[1];
    const label = parts.slice(2, parts.length - 2).join('|');
    const tapAt = parts[parts.length - 1];
    rows.push(`${type}|${label}|${flags}|${tapAt}`);
  }
  const material = `${packageName ?? ''}\n${rows.join('\n')}`;
  return createHash('sha1').update(material).digest('hex').slice(0, 16);
}

function payloadKey(payload: unknown): string {
  try {
    return JSON.stringify(payload ?? null);
  } catch {
    return String(payload);
  }
}

function isBack(step: StepLite): boolean {
  if (step.action_type !== 'global_action') return false;
  const action = (step.action_payload as { action?: string } | null)?.action;
  return String(action ?? '').toUpperCase() === 'BACK';
}

/** One tag (or null) per step, in order. */
export function tagWaste(steps: StepLite[]): (WasteTag | null)[] {
  const tags: (WasteTag | null)[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index];
    const previous = index > 0 ? steps[index - 1] : undefined;
    const known = Boolean(step.screen_before && step.screen_after);
    const unchanged = known && step.screen_before === step.screen_after;

    let tag: WasteTag | null = null;
    if (step.status === 'FAILED') tag = 'failed';
    else if (
      previous &&
      previous.status !== 'FAILED' &&
      previous.action_type === step.action_type &&
      step.action_type !== 'wait' &&
      payloadKey(previous.action_payload) === payloadKey(step.action_payload) &&
      step.screen_before &&
      previous.screen_before === step.screen_before
    )
      tag = 'repeat';
    else if (
      step.action_type === 'open_app' &&
      step.package_before &&
      (step.action_payload as { packageName?: string } | null)?.packageName === step.package_before
    )
      tag = 'reopen';
    else if (step.action_type === 'read_ui_tree' && unchanged) tag = 'reread';
    else if (INTERACTIVE.has(step.action_type) && unchanged) tag = 'no_effect';
    else if (isBack(step)) tag = 'backtrack';
    tags.push(tag);
  }
  return tags;
}

export interface RunTotals {
  llmCalls: number;
  promptTokens: number;
  completionTokens: number;
  tokensReported: boolean;
  cacheReadTokens?: number;
  cacheWriteTokens?: number | null;
  reasoningTokens?: number;
  costUsd?: number | null;
  /** Recoveries only the engine knows about (e.g. 'backup_model'). */
  recoveries?: RecoveryKind[];
  /** Provider generation ids of the run's model requests and the AI config that made each (c). */
  generations?: RunGeneration[];
}

export interface RunGeneration {
  id: string;
  c: number | null;
}

/** What the provider says it billed for a run's requests (OpenRouter's /generation), fetched on demand. */
export interface BilledCost {
  usd: number;
  /** Requests the provider returned a cost for, of `requested`. */
  found: number;
  requested: number;
  /** Requests made through a provider that cannot be asked (not OpenRouter). */
  not_checkable: number;
  checked_at: string;
}

export function summarizeRun(steps: StepLite[], tags: (WasteTag | null)[], totals: RunTotals): RunDiagnostics {
  const sources: Record<string, number> = {};
  const actions: Record<string, number> = {};
  const waste: Partial<Record<WasteTag, number>> = {};
  const packages = new Set<string>();
  let thinkMs = 0;
  let phoneMs = 0;
  let waitMs = 0;
  let failed = 0;
  let vision = 0;

  steps.forEach((step, index) => {
    const source = step.source || 'ai';
    sources[source] = (sources[source] ?? 0) + 1;
    actions[step.action_type] = (actions[step.action_type] ?? 0) + 1;
    thinkMs += Math.max(0, step.think_ms ?? 0);
    if (step.action_type === 'wait') waitMs += Math.max(0, step.duration_ms ?? 0);
    else phoneMs += Math.max(0, step.duration_ms ?? 0);
    if (step.status === 'FAILED') failed += 1;
    if (step.action_type === 'capture_screen') vision += 1;
    if (step.package_before) packages.add(step.package_before);
    if (step.package_after) packages.add(step.package_after);
    const tag = tags[index];
    if (tag) waste[tag] = (waste[tag] ?? 0) + 1;
  });

  return {
    version: DIAGNOSTICS_VERSION,
    steps: steps.length,
    sources,
    llm_calls: totals.llmCalls,
    tokens_reported: totals.tokensReported,
    prompt_tokens: totals.promptTokens,
    completion_tokens: totals.completionTokens,
    cache_read_tokens: totals.cacheReadTokens ?? 0,
    cache_write_tokens: totals.cacheWriteTokens ?? null,
    reasoning_tokens: totals.reasoningTokens ?? 0,
    cost_usd: totals.costUsd ?? null,
    think_ms: thinkMs,
    phone_ms: phoneMs,
    wait_ms: waitMs,
    failed,
    wasted: tags.filter(Boolean).length,
    waste,
    actions,
    vision,
    packages: [...packages].filter((p) => p && p !== 'unknown').slice(0, 20),
    recoveries: countRecoveries(tags, totals.recoveries),
  };
}

// ---------------------------------------------------------------------------
// Outcome (docs/RELIABILITY.md → Measuring)
// ---------------------------------------------------------------------------

export type RecoveryKind = 'step_failed' | 'no_effect' | 'repeat' | 'verify_retry' | 'backup_model' | 'obstacle';

export const RECOVERY_LABELS: Record<RecoveryKind, string> = {
  step_failed: 'An action failed and the run went on',
  no_effect: 'A tap or key changed nothing',
  repeat: 'The same action was sent again',
  verify_retry: 'The completion check sent the agent back',
  backup_model: 'Switched to the backup model',
  obstacle: 'A popup was cleared by rule',
};

export type RunOutcome = 'first_try' | 'recovered' | 'human_assisted' | 'failed' | 'cancelled';

export const OUTCOMES: RunOutcome[] = ['first_try', 'recovered', 'human_assisted', 'failed', 'cancelled'];

/** Step-level recoveries come from the waste tags; engine-level ones are passed in. */
export function countRecoveries(tags: (WasteTag | null)[], engine: RecoveryKind[] = []): Partial<Record<RecoveryKind, number>> {
  const out: Partial<Record<RecoveryKind, number>> = {};
  const add = (kind: RecoveryKind, n = 1) => {
    if (n > 0) out[kind] = (out[kind] ?? 0) + n;
  };
  for (const tag of tags) {
    if (tag === 'failed') add('step_failed');
    else if (tag === 'no_effect') add('no_effect');
    else if (tag === 'repeat') add('repeat');
  }
  for (const kind of engine) add(kind);
  return out;
}

export interface OutcomeInput {
  status: string;
  /** Recoveries recorded for the run (diagnostics.recoveries). */
  recoveries?: Partial<Record<RecoveryKind, number>> | null;
  /** The completion check (Vector engine); its retries count as recoveries. */
  verification?: { status?: string; retries?: number } | null;
  /** Set once handoff exists: the user completed a step the run handed to them. */
  humanAssisted?: boolean;
  /** Fallback for runs without recorded recoveries: failed steps in diagnostics. */
  failedSteps?: number;
}

/**
 * The single honest label for how a run ended. Only SUCCEEDED can be a
 * success; a run the completion check rejected is already FAILED by then.
 * Returns null while a run is still queued or running.
 */
export function classifyOutcome(input: OutcomeInput): RunOutcome | null {
  switch (input.status) {
    case 'SUCCEEDED': {
      if (input.humanAssisted) return 'human_assisted';
      const recovered =
        Object.values(input.recoveries ?? {}).some((n) => (n ?? 0) > 0) ||
        (input.verification?.retries ?? 0) > 0 ||
        (!input.recoveries && (input.failedSteps ?? 0) > 0);
      return recovered ? 'recovered' : 'first_try';
    }
    case 'FAILED':
    case 'INTERRUPTED':
      return 'failed';
    case 'CANCELLED':
      return 'cancelled';
    default:
      return null;
  }
}

/** The run fields outcome reporting needs (an AgentTask row fits). */
export interface OutcomeTask {
  status: string;
  outcome?: string | null;
  reason_code?: string | null;
  /** The run's final message; read for the failure kind (failureKind.ts). */
  message?: string | null;
  verification?: { status?: string; retries?: number } | null;
  diagnostics?: Pick<RunDiagnostics, 'failed' | 'recoveries'> | null;
}

/** The stored outcome, or one derived for runs that ended before outcomes were recorded. */
export function outcomeOf(task: OutcomeTask): RunOutcome | null {
  if (task.outcome && (OUTCOMES as string[]).includes(task.outcome)) return task.outcome as RunOutcome;
  return classifyOutcome({
    status: task.status,
    recoveries: task.diagnostics?.recoveries ?? null,
    verification: task.verification,
    failedSteps: task.diagnostics?.failed ?? 0,
  });
}

/**
 * The four reliability numbers (docs/RELIABILITY.md). Completion is over runs
 * that ended (cancelled runs excluded); human-assisted runs are shown apart and
 * never folded into first-try or recovered. `verified` counts successes the
 * system checked on the phone, not only the agent's word.
 */
export function outcomeBreakdown(tasks: OutcomeTask[]) {
  const counts: Record<RunOutcome, number> = { first_try: 0, recovered: 0, human_assisted: 0, failed: 0, cancelled: 0 };
  const reasons = new Map<string, number>();
  const kinds: Record<FailureKind, number> = { agent: 0, needs_user: 0, phone: 0, ai_service: 0, platform: 0 };
  let verified = 0;
  for (const task of tasks) {
    const outcome = outcomeOf(task);
    if (!outcome) continue;
    counts[outcome] += 1;
    if (outcome === 'failed') {
      const reason = task.reason_code || 'UNKNOWN';
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
      kinds[failureKind(task.reason_code, task.message)] += 1;
    }
    if (outcome !== 'failed' && outcome !== 'cancelled' && task.verification?.status === 'verified') verified += 1;
  }
  const ended = counts.first_try + counts.recovered + counts.human_assisted + counts.failed;
  const done = counts.first_try + counts.recovered + counts.human_assisted;
  return {
    ...counts,
    ended,
    completion_pct: ended ? roundTenth((done / ended) * 100) : null,
    /**
     * Completion counting only the agent's own failures: runs lost to the
     * phone, the AI provider, our server or a step only the user can do are
     * left out. Always shown next to completion_pct, never instead of it.
     */
    agent_completion_pct: done + kinds.agent ? roundTenth((done / (done + kinds.agent)) * 100) : null,
    failure_kinds: kinds,
    verified,
    failure_reasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 10),
  };
}

function roundTenth(value: number): number {
  return Math.round(value * 10) / 10;
}
