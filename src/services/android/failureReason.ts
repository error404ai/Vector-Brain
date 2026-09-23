/** Best-effort mapping of a thrown error to a stable reason code. */
export function classifyFailure(message: string | undefined): string {
  const text = (message || '').toLowerCase();
  if (/\b429\b|rate limit|too many requests/.test(text)) return 'LLM_RATE_LIMIT';
  if (/\b401\b|\b402\b|api key|unauthori[sz]ed|insufficient|credit/.test(text)) return 'LLM_AUTH_OR_CREDIT';
  // "not currently connected" is what a phone that dropped between two
  // actions produces; missing it filed drops as ERROR, which missions never retry.
  if (/offline|not (?:currently )?connected|disconnected/.test(text)) return 'DEVICE_OFFLINE';
  if (/timed out|timeout/.test(text)) return 'TIMEOUT';
  return 'ERROR';
}
