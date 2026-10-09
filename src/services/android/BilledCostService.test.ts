jest.mock('@/loaders/database', () => ({ AppDataSource: { getRepository: () => ({}) } }));
jest.mock('@/services/controllerService/AiConfigService', () => ({ AiConfigService: class {} }));

import { BilledCostService, openRouterApi } from './BilledCostService';

describe('billed cost (OpenRouter /generation)', () => {
  it('asks only OpenRouter keys, at the base URL they use', () => {
    expect(openRouterApi({ provider: 'openrouter' as never, base_url: null })).toBe('https://openrouter.ai/api/v1');
    expect(openRouterApi({ provider: 'custom' as never, base_url: 'https://openrouter.ai/api/v1' })).toBe('https://openrouter.ai/api/v1');
    expect(openRouterApi({ provider: 'openai' as never, base_url: null })).toBeNull();
    expect(openRouterApi({ provider: 'custom' as never, base_url: 'https://api.deepseek.com' })).toBeNull();
  });

  it('sums total_cost per generation, retries a 429, and counts unknown ids as not found', async () => {
    const svc = new BilledCostService();
    const asked: string[] = [];
    let limited = false;
    svc.fetcher = async (url, init) => {
      asked.push(`${url} ${init.headers.Authorization}`);
      const id = new URL(url).searchParams.get('id');
      if (id === 'gen-2' && !limited) {
        limited = true;
        return { ok: false, status: 429, json: async () => ({}) };
      }
      if (id === 'gen-3') return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ data: { total_cost: id === 'gen-1' ? 0.0001 : 0.00025 } }) };
    };
    const costs = await (svc as unknown as { lookup: (api: string, key: string, ids: string[]) => Promise<(number | null)[]> }).lookup('https://openrouter.ai/api/v1', 'sk-test', ['gen-1', 'gen-2', 'gen-3']);
    expect(costs).toEqual([0.0001, 0.00025, null]);
    expect(asked[0]).toBe('https://openrouter.ai/api/v1/generation?id=gen-1 Bearer sk-test');
    expect(asked.filter((a) => a.includes('gen-2'))).toHaveLength(2);
  });
});
