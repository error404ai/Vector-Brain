import type { AgentStreamMessage } from '@eko-ai/eko';

/**
 * The part of a phone run that talks to the model.
 *
 * Everything else — step recording, loop guards, watchdogs, cancel, timed
 * rounds, diagnostics — lives in AndroidPlannerService.executeLoop and is fed
 * by the same Eko-shaped messages from either engine, so switching engines
 * changes only how the model is driven.
 */

export type EngineKind = 'eko' | 'vector' | 'lite';

export const ENGINE_KINDS: EngineKind[] = ['eko', 'vector', 'lite'];

export function isEngineKind(value: unknown): value is EngineKind {
  return value === 'eko' || value === 'vector' || value === 'lite';
}

/** Outcome of the system's own check of a run the agent reported as done (Vector engine). */
export interface VerificationOutcome {
  status: 'verified' | 'unverified' | 'failed';
  /**
   * 'rule' = checked on the phone without AI; 'judge' = a separate model call;
   * 'replay' = a saved flow whose every step reached the screen it was recorded on.
   */
  method: 'rule' | 'judge' | 'replay' | 'none';
  reason: string;
  /** How many times the agent was sent back after a failed check. */
  retries: number;
}

export interface EngineRunResult {
  success: boolean;
  /** 'done' when the agent finished; anything else is treated as not finished. */
  stopReason: string;
  result: string;
  /** Set by an engine that knows exactly why a run failed (e.g. VERIFICATION_FAILED). */
  reasonCode?: string | null;
  verification?: VerificationOutcome | null;
}

/** Receives the engine's progress; the planner's existing message handler. */
export type EngineMessageHandler = (message: AgentStreamMessage) => Promise<void>;

export interface AgentEngine {
  readonly kind: EngineKind;
  /** One round of the task. A timed run calls this again with a new runId. */
  run(prompt: string, runId: string): Promise<EngineRunResult>;
  /** Stop the round in progress as soon as possible. */
  abort(reason: string): void;
  /** Release anything held for the task. Called once when the task ends. */
  dispose(): void;
  /** True when the run had to switch to the backup model. */
  readonly usedBackupModel?: boolean;
}
