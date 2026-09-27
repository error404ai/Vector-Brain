/**
 * fetch for AI providers that rides out a short rate limit instead of failing
 * the run. Recorded runs lost 32 tasks to plain 429s on a free model; each
 * one was a request that would have worked a few seconds later.
 *
 * Only the HTTP request is repeated — a 429 comes back before the model has
 * produced anything, so nothing on the phone can happen twice. A daily cap
 * ("free-models-per-day") is returned at once: waiting minutes will not lift
 * it, and the engine switches to the backup model instead.
 */
export const DAILY_CAP = /per-day|per day|daily (?:limit|quota)|quota exceeded|exceeded your current quota/i;

export interface RateLimitOptions {
  /** Longest total wait across retries. Kept under the engines' own call timeouts. */
  maxTotalMs?: number;
  maxAttempts?: number;
  /** Told about each wait (for logs). */
  onWait?: (ms: number, attempt: number) => void;
  sleep?: (ms: number, signal?: AbortSignal | null) => Promise<void>;
}

const DEFAULT_STEPS = [3_000, 8_000, 15_000];

function defaultSleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

/** How long the provider asked us to wait: Retry-After (seconds or a date), or OpenRouter's reset time. */
export function retryAfterMs(headers: Headers, now = Date.now()): number | null {
  const after = headers.get('retry-after');
  if (after) {
    const seconds = Number(after);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const date = Date.parse(after);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }
  const reset = Number(headers.get('x-ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) {
    const at = reset > 1e12 ? reset : reset * 1000; // ms or s epoch
    if (at > now) return at - now;
  }
  return null;
}

export function withRateLimitRetry(base: typeof fetch = fetch, options: RateLimitOptions = {}): typeof fetch {
  const maxTotal = options.maxTotalMs ?? 30_000;
  const maxAttempts = options.maxAttempts ?? 4;
  const sleep = options.sleep ?? defaultSleep;
  const wrapped = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
    let waited = 0;
    for (let attempt = 1; ; attempt += 1) {
      const response = await base(input, init);
      if (response.status !== 429 || attempt >= maxAttempts || init?.signal?.aborted) return response;
      const body = await response.clone().text().catch(() => '');
      if (DAILY_CAP.test(body)) return response;
      const wait = Math.max(500, retryAfterMs(response.headers) ?? DEFAULT_STEPS[Math.min(attempt - 1, DEFAULT_STEPS.length - 1)]);
      if (waited + wait > maxTotal) return response;
      options.onWait?.(wait, attempt);
      await sleep(wait, init?.signal);
      waited += wait;
      if (init?.signal?.aborted) return response;
    }
  };
  return wrapped as typeof fetch;
}
