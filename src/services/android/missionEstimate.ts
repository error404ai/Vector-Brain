import type { ModelPrice } from './eko/modelVision';
import { costFromPrice } from './agent/usageDetails';

/**
 * What a mission will cost before it runs, for the Confirm card.
 *
 * It used to be 30 steps × $0.0005 per phone whatever the task or model — on
 * Oct 9 the card said $0.23 for a 15-phone mission that cost $0.033. Now it
 * comes from what actually happened, in this order:
 *   steps per phone — the user's own runs of this same task, else the median
 *     of their recent runs, else a default;
 *   cost per step — what their recent runs on this model cost per step (the
 *     bill, or tokens × list price for providers that send no bill), else the
 *     model's list price × a typical step, else unknown (never a made-up number).
 */

/** A finished run, as much of it as the estimate needs. */
export interface PastRun {
  prompt: string;
  provider: string | null;
  model: string | null;
  steps: number;
  durationSeconds: number;
  costUsd: number | null;
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number | null;
  /** Timed runs ("for 10 minutes") do not count towards a simple task's steps. */
  timed: boolean;
}

export interface MissionEstimate {
  /** AI steps for all phones together. */
  steps: number;
  /** USD for all phones together; null when the model's price is unknown. */
  costUsd: number | null;
  /** Where the step count came from. */
  stepsFrom: 'same_task' | 'your_runs' | 'default';
  /** Where the cost per step came from. */
  costFrom: 'your_runs' | 'price_list' | 'unknown';
  /** How many past runs the step count rests on. */
  runs: number;
  model: string | null;
}

export const DEFAULT_STEPS_PER_TASK = 15;
export const DEFAULT_STEPS_PER_MINUTE = 5;
/** A Lite step as measured on Oct 9: ~5.5k input tokens, ~4.9k of them from the cache, ~100 out. */
export const TYPICAL_STEP = { inputTokens: 5500, cachedTokens: 4900, cacheWriteTokens: null, outputTokens: 100 };

const MAX_SAME_TASK_RUNS = 20;
const MAX_COST_RUNS = 50;

export const sameTask = (a: string, b: string) => squash(a) === squash(b);
const squash = (t: string) =>
  String(t ?? '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?\s]+$/, '')
    .trim();

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * @param runs the user's recent finished runs, newest first
 * @param instructions the mission's tasks (several run in order on each phone)
 */
export function estimateMission(input: {
  runs: PastRun[];
  instructions: string[];
  phones: number;
  minutes: number;
  provider: string | null;
  model: string | null;
  price: ModelPrice | null;
}): MissionEstimate {
  const { runs, instructions, phones, minutes, provider, model, price } = input;
  const usable = runs.filter((r) => r.steps > 0);

  // Steps per phone.
  let perPhone = 0;
  let stepsFrom: MissionEstimate['stepsFrom'] = 'default';
  let basedOn = 0;
  if (minutes > 0) {
    const timed = instructions.flatMap((text) => usable.filter((r) => r.durationSeconds >= 60 && sameTask(r.prompt, text))).slice(0, MAX_SAME_TASK_RUNS);
    const perMinute = timed.length ? timed.reduce((s, r) => s + r.steps, 0) / timed.reduce((s, r) => s + r.durationSeconds / 60, 0) : DEFAULT_STEPS_PER_MINUTE;
    if (timed.length) {
      stepsFrom = 'same_task';
      basedOn = timed.length;
    }
    perPhone = perMinute * minutes;
  } else {
    const simple = usable.filter((r) => !r.timed);
    const fallback = simple.length >= 3 ? median(simple.slice(0, MAX_COST_RUNS).map((r) => r.steps)) : DEFAULT_STEPS_PER_TASK;
    let anySame = false;
    let anyMedian = false;
    for (const text of instructions) {
      const same = simple.filter((r) => sameTask(r.prompt, text)).slice(0, MAX_SAME_TASK_RUNS);
      if (same.length) {
        anySame = true;
        basedOn += same.length;
        perPhone += same.reduce((s, r) => s + r.steps, 0) / same.length;
      } else {
        anyMedian = simple.length >= 3;
        perPhone += fallback;
      }
    }
    stepsFrom = anySame && !anyMedian ? 'same_task' : anySame || anyMedian ? 'your_runs' : 'default';
    if (!anySame && anyMedian) basedOn = Math.min(simple.length, MAX_COST_RUNS);
  }
  const steps = Math.max(1, Math.round(perPhone * Math.max(1, phones)));

  // Cost per step: this model's recent runs first.
  const sameModel = usable.filter((r) => r.model === model && r.provider === provider).slice(0, MAX_COST_RUNS);
  let perStep: number | null = null;
  let costFrom: MissionEstimate['costFrom'] = 'unknown';
  const billed = sameModel.filter((r) => r.costUsd != null);
  if (billed.length) {
    perStep = billed.reduce((s, r) => s + (r.costUsd ?? 0), 0) / billed.reduce((s, r) => s + r.steps, 0);
    costFrom = 'your_runs';
  } else if (price) {
    const withTokens = sameModel.filter((r) => r.promptTokens > 0);
    if (withTokens.length) {
      const total = withTokens.reduce(
        (s, r) =>
          s +
          costFromPrice(price, provider ?? '', {
            inputTokens: r.promptTokens,
            outputTokens: r.completionTokens,
            cachedTokens: r.cacheReadTokens,
            cacheWriteTokens: r.cacheWriteTokens,
          }),
        0,
      );
      perStep = total / withTokens.reduce((s, r) => s + r.steps, 0);
      costFrom = 'your_runs';
    } else {
      perStep = costFromPrice(price, provider ?? '', TYPICAL_STEP);
      costFrom = 'price_list';
    }
  }

  return {
    steps,
    costUsd: perStep === null ? null : Math.round(perStep * steps * 1e6) / 1e6,
    stepsFrom,
    costFrom,
    runs: basedOn,
    model,
  };
}

/** "$0.033", "$0.0021", "$1.40": enough digits that a small mission is not "$0.00". */
export function formatUsd(usd: number): string {
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  if (usd >= 0.0001) return `$${usd.toPrecision(2)}`;
  if (usd > 0) return '<$0.0001';
  return '$0';
}

/** The Confirm card's one-line estimate. */
export function estimateLine(e: MissionEstimate): string {
  const cost = e.costUsd === null ? `price unknown for ${e.model ?? 'this model'}` : `roughly ${formatUsd(e.costUsd)}`;
  return `about ${e.steps} AI steps, ${cost}`;
}

/** Where the numbers come from, for the card's small print. */
export function estimateNote(e: MissionEstimate): string {
  if (e.costFrom === 'unknown') return `${e.model ?? 'This model'} is not in the price list, so only the steps are estimated.`;
  if (e.costFrom === 'your_runs') return e.stepsFrom === 'same_task' ? `From your last ${e.runs} run${e.runs === 1 ? '' : 's'} of this task on ${e.model}.` : `From your recent runs on ${e.model}.`;
  return `From ${e.model}'s list price; no runs on it yet to go by.`;
}
