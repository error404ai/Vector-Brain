/**
 * When the agent model is shown a screenshot (a model that can see images only):
 * - off:        only on screens the element list cannot describe at all;
 * - stuck:      also when it is stuck (a loop, actions with no effect) — the default;
 * - every_step: after every action. Best understanding, about 10–15% more tokens a step.
 */
export type ScreenshotMode = 'off' | 'stuck' | 'every_step';

export function isScreenshotMode(value: unknown): value is ScreenshotMode {
  return value === 'off' || value === 'stuck' || value === 'every_step';
}
