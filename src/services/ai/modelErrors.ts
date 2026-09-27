/**
 * What went wrong with an AI model call, in words a user can act on.
 *
 * Provider errors arrive as raw text ("429 Rate limit exceeded:
 * free-models-per-day-high-balance. Troubleshooting URL: https://js.langchain…")
 * and used to be shown as they were. The raw text still goes to the logs; the
 * user sees a short title and what to do about it.
 */
export type ModelErrorCode =
  | 'daily_limit'
  | 'rate_limit'
  | 'credits'
  | 'auth'
  | 'model_missing'
  | 'too_long'
  | 'timeout'
  | 'unreachable'
  | 'unknown';

export interface ModelErrorInfo {
  code: ModelErrorCode;
  /** One line: what happened. */
  title: string;
  /** One line: what the user can do. */
  hint: string;
  /** Worth trying again soon without changing anything. */
  retryable: boolean;
}

const SETTINGS = 'Settings → AI models';

function rawText(error: unknown): string {
  const e = error as { message?: unknown; statusCode?: unknown; status?: unknown; cause?: unknown; responseBody?: unknown; data?: unknown } | null;
  const parts = [e?.statusCode, e?.status, e?.message, e?.responseBody, typeof e?.data === 'object' ? JSON.stringify(e?.data) : e?.data];
  if (e?.cause && e.cause !== error) parts.push(rawText(e.cause));
  if (typeof error === 'string') parts.push(error);
  return parts.filter((p) => p !== undefined && p !== null).join(' ');
}

export function describeModelError(error: unknown): ModelErrorInfo {
  const text = rawText(error).toLowerCase();
  if (/free-models-per-day|per[- ]day|daily (limit|quota)|quota exceeded|exceeded your current quota/.test(text)) {
    return {
      code: 'daily_limit',
      title: 'Your AI model has used up its daily limit',
      hint: `Free models have a daily cap. Add credits to your AI key, or choose a paid model in ${SETTINGS}. It resets tomorrow.`,
      retryable: false,
    };
  }
  if (/\b429\b|rate.?limit|too many requests|overloaded|capacity/.test(text)) {
    return { code: 'rate_limit', title: 'The AI provider is busy right now', hint: 'Too many requests in a short time. Wait a minute and try again.', retryable: true };
  }
  if (/\b402\b|insufficient|credits?\b|balance is|payment required|billing/.test(text)) {
    return { code: 'credits', title: 'Your AI account is out of credits', hint: `Top up your AI provider account, or switch the key in ${SETTINGS}.`, retryable: false };
  }
  if (/\b401\b|\b403\b|unauthori[sz]ed|invalid api key|incorrect api key|api key|forbidden/.test(text)) {
    return { code: 'auth', title: 'Your AI key was not accepted', hint: `Check or replace the key in ${SETTINGS}.`, retryable: false };
  }
  if (/\b404\b|model not found|no endpoints found|does not exist|unknown model|not a valid model/.test(text)) {
    return { code: 'model_missing', title: 'The chosen AI model is not available', hint: `The provider does not offer this model any more. Pick another in ${SETTINGS}.`, retryable: false };
  }
  if (/context length|context window|maximum context|too many tokens|prompt is too long|token limit/.test(text)) {
    return { code: 'too_long', title: 'This conversation is too long for the AI model', hint: 'Start a new chat, or choose a model with a larger context.', retryable: false };
  }
  if (/timed? ?out|timeout|did not finish answering|sent nothing/.test(text)) {
    return { code: 'timeout', title: 'The AI model took too long to answer', hint: 'Try again. If it keeps happening, pick a faster model.', retryable: true };
  }
  if (/econnrefused|econnreset|enotfound|eai_again|fetch failed|network|socket hang up|\b50[234]\b|unavailable/.test(text)) {
    return { code: 'unreachable', title: 'Could not reach the AI provider', hint: 'Their service may be down for a moment. Try again shortly.', retryable: true };
  }
  return { code: 'unknown', title: 'The AI model ran into a problem', hint: 'Try again in a moment. If it keeps happening, check the model in Settings.', retryable: true };
}

/** "title. hint" — for places that show one string. */
export function modelErrorText(error: unknown): string {
  const info = describeModelError(error);
  return `${info.title}. ${info.hint}`;
}
