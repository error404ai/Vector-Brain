/**
 * Human wording for the reason codes the backend stores on every finished run.
 * The code is the stable contract; this is only how it reads on screen.
 */
const REASON_LABELS: Record<string, string> = {
  SERVER_RESTART: 'Server restarted during the run',
  USER_CANCELLED: 'Stopped by you',
  NO_ACTION: 'AI model took no action for 4 minutes',
  STALLED: 'Nothing happened for 3 minutes',
  STEP_LIMIT: 'Reached the step limit',
  LOOP_DETECTED: 'Kept repeating the same action',
  SCREEN_UNCHANGED: 'Screen stopped changing',
  DEVICE_ACTION_FAILURES: 'Phone actions kept failing',
  LLM_RATE_LIMIT: 'AI provider rate limit hit',
  LLM_AUTH_OR_CREDIT: 'AI provider key or credit problem',
  DEVICE_OFFLINE: 'Phone went offline',
  TIMEOUT: 'Timed out',
  UNFINISHED: 'Stopped before the agent confirmed completion',
  AGENT_REPORTED_FAILURE: 'Agent said it could not finish',
  REPLAY_STEP_FAILED: 'A replay step failed',
  GUARD_STOP: 'Stopped by a safety check',
  ERROR: 'Internal error',
};

export function reasonLabel(code?: string | null): string | undefined {
  if (!code) return undefined;
  return REASON_LABELS[code] ?? code;
}

/** A run cut short by the server, not by anything the task or the user did. */
export function isInterruption(code?: string | null): boolean {
  return code === 'SERVER_RESTART';
}
