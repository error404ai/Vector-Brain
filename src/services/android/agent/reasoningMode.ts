/**
 * Lite: when the model writes out its thinking before it acts.
 * - off: never (cheapest; the model acts straight away).
 * - hard: on hard steps only — the first step, after an error, a screen that did
 *   not change, a stuck or loop warning, a system note, before giving up.
 * - always: every step.
 * The thinking is written as a few short lines of text before the tool call, not
 * a provider "hidden reasoning" mode: Claude's extended thinking needs its earlier
 * thinking blocks sent back on every tool call, which a context rebuilt each step
 * does not keep. Written thinking works the same on every model.
 */
export type ReasoningMode = 'off' | 'hard' | 'always';

export function isReasoningMode(value: unknown): value is ReasoningMode {
  return value === 'off' || value === 'hard' || value === 'always';
}
