/** Whose problem a failed run was; mirrors src/services/android/failureKind.ts. */
export type FailureKind = 'agent' | 'needs_user' | 'phone' | 'ai_service' | 'platform';

export const FAILURE_KIND_ORDER: FailureKind[] = ['agent', 'needs_user', 'phone', 'ai_service', 'platform'];

export const FAILURE_KIND: Record<FailureKind, { label: string; short: string; color: string; hint: string }> = {
  agent: { label: 'Agent mistake', short: 'Agent', color: 'error.main', hint: 'Got stuck, looped, ran out of steps, or the completion check rejected it.' },
  needs_user: { label: 'Needed the user', short: 'Needs you', color: 'warning.main', hint: 'A sign-in, CAPTCHA, code or payment only the user can do (as the agent reported it).' },
  phone: { label: 'Phone problem', short: 'Phone', color: 'secondary.main', hint: 'Offline, app not installed, pocket mode, screen capture blocked, setup missing.' },
  ai_service: { label: 'AI service', short: 'AI service', color: 'info.main', hint: 'The AI provider ran out of quota, rate-limited, was too slow, or returned nothing.' },
  platform: { label: 'Our server', short: 'Server', color: 'text.disabled', hint: 'A server restart or an internal error cut the run.' },
};
