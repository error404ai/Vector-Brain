/**
 * Whose problem a failed run was (docs/RELIABILITY.md → Measuring).
 *
 * "Success rate" alone mixes the agent's own mistakes with things no agent
 * could have done: a phone that went offline, an AI provider out of quota, a
 * CAPTCHA only the user can solve. Splitting them shows what the agent itself
 * gets right, without hiding the rest — overall completion is still reported
 * next to it.
 *
 * Derived from the stored reason code and the run's final message, so it also
 * works for runs that ended before this existed. A reason the agent gave in its
 * own words (AGENT_REPORTED_FAILURE) is read for known causes; anything not
 * recognised stays the agent's.
 */

export type FailureKind = 'agent' | 'needs_user' | 'phone' | 'ai_service' | 'platform';

export const FAILURE_KINDS: FailureKind[] = ['agent', 'needs_user', 'phone', 'ai_service', 'platform'];

export const FAILURE_KIND_LABELS: Record<FailureKind, string> = {
  agent: 'Agent mistake',
  needs_user: 'Needed the user',
  phone: 'Phone problem',
  ai_service: 'AI service',
  platform: 'Our server',
};

const AI_SERVICE = new Set(['LLM_QUOTA', 'LLM_RATE_LIMIT', 'LLM_AUTH_OR_CREDIT', 'LLM_SLOW', 'PLAN_FAILED']);
const PLATFORM = new Set(['SERVER_RESTART', 'QUEUE_DROPPED', 'TASK_MISSING', 'DISPATCH_ERROR', 'INTERRUPTED', 'ERROR']);
const PHONE = new Set(['DEVICE_OFFLINE', 'DEVICE_BUSY', 'TIMEOUT', 'NEEDS_SETUP', 'CAPTURE_PERMISSION', 'DEVICE_ACTION_FAILURES']);

/**
 * Play's "Complete account setup" sheet is not a sign-in (Continue, then Skip).
 * Agents kept calling it a login and skipping the phone; that is their mistake.
 */
const MISREAD_AS_LOGIN = /account setup|review your account to continue/i;

/** The agent's final message names something on the phone itself. */
const PHONE_CAUSE =
  /pocket mode|proximity sensor|cover the earphone|is not installed|isn['’]t installed|not (?:found )?among the \d+ installed|no internet|offline|not enough (?:storage|space)|storage (?:is )?full|blocks screen ?(?:capture|shots)|secure screen|black screen|screen is black/i;

/** Only the user can do it: their identity, their money, their choice. */
const USER_CAUSE =
  /captcha|i['’]m not a robot|verify (?:that )?you['’]re human|\botp\b|verification code|one-time (?:code|password)|enter (?:your|the) password|sign[- ]?in|log[- ]?in|login|biometric|fingerprint|face id|selfie|identity check|paid app|payment (?:approval|required|method)|needs the user|needs you|hand (?:this|the) step to the user|choose (?:an|which) account/i;

export function failureKind(reasonCode: string | null | undefined, message?: string | null): FailureKind {
  const code = (reasonCode || '').toUpperCase();
  if (AI_SERVICE.has(code)) return 'ai_service';
  if (PLATFORM.has(code)) return 'platform';
  if (PHONE.has(code)) return 'phone';
  // Guard stops, step limits and a rejected completion check are the agent's.
  if (code !== 'AGENT_REPORTED_FAILURE') return 'agent';

  const text = message || '';
  if (MISREAD_AS_LOGIN.test(text)) return 'agent';
  if (PHONE_CAUSE.test(text)) return 'phone';
  if (USER_CAUSE.test(text)) return 'needs_user';
  return 'agent';
}
