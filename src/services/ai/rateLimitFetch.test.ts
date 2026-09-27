import { retryAfterMs, withRateLimitRetry } from './rateLimitFetch';

const reply = (status: number, body = '', headers: Record<string, string> = {}) => new Response(body, { status, headers });

describe('withRateLimitRetry', () => {
  it('waits out a short 429 and returns the answer that follows', async () => {
    const base = jest.fn().mockResolvedValueOnce(reply(429, 'Rate limit exceeded: free-models-per-min')).mockResolvedValueOnce(reply(200, 'ok'));
    const waits: number[] = [];
    const f = withRateLimitRetry(base as unknown as typeof fetch, { sleep: async (ms) => void waits.push(ms) });
    const res = await f('https://x/v1/chat', { method: 'POST', body: '{}' });
    expect(res.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([3000]);
  });

  it('follows Retry-After', async () => {
    const base = jest.fn().mockResolvedValueOnce(reply(429, '', { 'retry-after': '7' })).mockResolvedValueOnce(reply(200));
    const waits: number[] = [];
    await withRateLimitRetry(base as unknown as typeof fetch, { sleep: async (ms) => void waits.push(ms) })('u', {});
    expect(waits).toEqual([7000]);
  });

  it('does not wait on a daily cap — that needs the backup model, not patience', async () => {
    const base = jest.fn().mockResolvedValue(reply(429, '{"error":{"message":"Rate limit exceeded: free-models-per-day-high-balance"}}'));
    const f = withRateLimitRetry(base as unknown as typeof fetch, { sleep: async () => undefined });
    const res = await f('u', {});
    expect(res.status).toBe(429);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('gives up within its time budget and hands back the 429', async () => {
    const base = jest.fn().mockResolvedValue(reply(429, '', { 'retry-after': '20' }));
    const f = withRateLimitRetry(base as unknown as typeof fetch, { sleep: async () => undefined, maxTotalMs: 30_000 });
    const res = await f('u', {});
    expect(res.status).toBe(429);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('reads OpenRouter reset times in ms and s', () => {
    const now = 1_000_000_000_000;
    expect(retryAfterMs(new Headers({ 'x-ratelimit-reset': String(now + 4000) }), now)).toBe(4000);
    expect(retryAfterMs(new Headers({ 'x-ratelimit-reset': String(now / 1000 + 5) }), now)).toBe(5000);
    expect(retryAfterMs(new Headers({}), now)).toBeNull();
  });
});
