import { createHash } from 'crypto';

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
    think_ms: thinkMs,
    phone_ms: phoneMs,
    wait_ms: waitMs,
    failed,
    wasted: tags.filter(Boolean).length,
    waste,
    actions,
    vision,
    packages: [...packages].filter((p) => p && p !== 'unknown').slice(0, 20),
  };
}
