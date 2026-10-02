/**
 * Whether the AI saw the phone's screen as an image, per step and per run, and
 * whether it can at all — so neither the owner nor the user has to guess.
 *
 *  - ai:     the screenshot went to a model that reads images
 *  - helper: a vision helper read the screenshot for a text-only model
 *  - none:   no image reached the AI; `why` says which reason
 */

export type SightSeen = 'ai' | 'helper' | 'none';
export type SightWhy = 'model_text_only' | 'setting_off' | 'setting_stuck' | 'no_frame' | 'not_needed' | 'failed';

export interface Sight {
  seen: SightSeen;
  why?: SightWhy;
}

/** One run's totals: how many steps the AI saw an image on, and why not otherwise. */
export interface RunSight {
  ai: number;
  helper: number;
  none: number;
  /** The reason most steps went without an image (null when every step had one). */
  why: SightWhy | null;
  /** The agent model's name, for "deepseek-v4-flash can't see images". */
  model: string | null;
  /** The model reads images itself / a vision helper was set for it. */
  model_sees: boolean;
  helper_model: string | null;
}

export type ScreenshotModeLike = 'off' | 'stuck' | 'every_step' | undefined;

/** What one step's tool result shows: an image the model reads, rows a helper read, or neither. */
export function sightOfResult(
  result: { content?: { type: string; text?: string }[]; isError?: boolean } | undefined,
  state: { vision: boolean; grounder: boolean; screenshots: ScreenshotModeLike; hasFrame: boolean },
): Sight {
  const parts = result?.content ?? [];
  if (state.vision && parts.some((p) => p.type === 'image')) return { seen: 'ai' };
  const text = parts.map((p) => p.text ?? '').join('\n');
  if (HELPER_MARK.test(text)) return { seen: 'helper' };
  return { seen: 'none', why: noSightReason(state, Boolean(result?.isError)) };
}

/** The phrase the agent adds when a vision helper read the screen (AndroidAgent.screenExtras). */
export const HELPER_MARK = /were read from a screenshot by a vision model/;

export function noSightReason(state: { vision: boolean; grounder: boolean; screenshots: ScreenshotModeLike; hasFrame: boolean }, failed = false): SightWhy {
  if (!state.vision && !state.grounder) return 'model_text_only';
  if (state.screenshots === 'off') return 'setting_off';
  if (!state.hasFrame) return 'no_frame';
  if (failed) return 'failed';
  return state.screenshots === 'every_step' && state.vision ? 'not_needed' : 'setting_stuck';
}

/** Short, plain reasons for a step with no image (shown on hover). */
export const WHY_TEXT: Record<SightWhy, string> = {
  model_text_only: 'the AI model is text-only and no vision helper is set',
  setting_off: 'screenshots are off in Settings',
  setting_stuck: 'Settings send screenshots only when the AI is stuck',
  no_frame: 'the phone is not sharing its screen',
  not_needed: 'the element list described this screen',
  failed: 'the action failed before a new screen was read',
};

export function emptyRunSight(model: string | null, modelSees: boolean, helperModel: string | null): RunSight {
  return { ai: 0, helper: 0, none: 0, why: null, model, model_sees: modelSees, helper_model: helperModel };
}

/** Adds one step to a run's totals; `why` keeps the most frequent reason. */
export function addSight(run: RunSight, sight: Sight, whyCounts: Map<SightWhy, number>): void {
  run[sight.seen] += 1;
  if (sight.seen !== 'none' || !sight.why) return;
  whyCounts.set(sight.why, (whyCounts.get(sight.why) ?? 0) + 1);
  run.why = [...whyCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

/** The model's short name: "deepseek/deepseek-v4-flash-0731" → "deepseek-v4-flash-0731". */
export function shortModel(model: string | null | undefined): string {
  return (model ?? 'this model').split('/').pop() ?? 'this model';
}

/** The one line a finished run carries: "AI saw 6 screenshots", or why it saw none. */
export function runSightLine(run: RunSight | null | undefined): string | null {
  if (!run) return null;
  const seen = run.ai + run.helper;
  const plural = (n: number) => `${n} screenshot${n === 1 ? '' : 's'}`;
  if (run.ai && run.helper) return `AI saw ${plural(run.ai)}; the vision helper read ${run.helper} more.`;
  if (run.ai) return `AI saw ${plural(run.ai)}.`;
  if (run.helper) return `The vision helper read ${plural(run.helper)} for ${shortModel(run.model)}.`;
  if (seen === 0 && !run.model_sees && !run.helper_model) return `0 screenshots seen — ${shortModel(run.model)} can't see images and no vision helper is set.`;
  if (seen === 0 && run.why === 'no_frame') return '0 screenshots seen — the phone was not sharing its screen.';
  if (seen === 0 && run.why === 'setting_off') return '0 screenshots seen — screenshots are off in Settings.';
  return '0 screenshots seen — the element list was enough.';
}

/** Before a run: can the AI see the phone's screen with the current settings? */
export type SightCapability = 'sees' | 'helper' | 'blind';

export function sightCapability(modelSees: boolean, helperSees: boolean): SightCapability {
  if (modelSees) return 'sees';
  return helperSees ? 'helper' : 'blind';
}
