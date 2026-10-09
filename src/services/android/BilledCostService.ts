import { AgentTask } from '@/entities/AgentTask';
import AppError from '@/helpers/AppError';
import Logger from '@/logger/index';
import { AppDataSource } from '@/loaders/database';
import { AiConfigService, type DecryptedAiConfig } from '@/services/controllerService/AiConfigService';
import { Container, Service } from 'typedi';
import type { BilledCost, RunGeneration } from './runDiagnostics';

const OPENROUTER_API = 'https://openrouter.ai/api/v1';
/** Requests asked at once; OpenRouter rate-limits per key. */
const CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 15_000;

/** The OpenRouter API root for a config, or null when the config is not an OpenRouter key. */
export function openRouterApi(config: Pick<DecryptedAiConfig, 'provider' | 'base_url'>): string | null {
  const base = config.base_url?.trim() ?? '';
  if (base.includes('openrouter.ai')) return `${new URL(base).origin}/api/v1`;
  if (String(config.provider).toLowerCase() === 'openrouter' && !base) return OPENROUTER_API;
  return null;
}

type Fetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * What the provider itself billed for a run: every model request the engine made
 * (agent turns, retried or cut-off attempts, plan and judge) looked up by its
 * generation id on OpenRouter's /generation endpoint, with the key that made it.
 * Only for the Diagnostics page; the key never leaves the server.
 */
@Service()
export class BilledCostService {
  private get taskRepo() {
    return AppDataSource.getRepository(AgentTask);
  }

  /** Replaced in tests. */
  fetcher: Fetch = (url, init) => fetch(url, init);

  private get aiConfigs(): AiConfigService {
    return Container.get(AiConfigService);
  }

  async check(taskId: number): Promise<BilledCost> {
    const task = await this.taskRepo.findOne({ where: { id: taskId }, select: ['id', 'user_id', 'diagnostics'] });
    if (!task) throw new AppError('Run not found', 404);
    const generations: RunGeneration[] = task.diagnostics?.generations ?? [];
    if (!generations.length) throw new AppError('This run has no recorded model requests to check (only Vector and Lite runs since Oct 9 record them).', 400);

    // One lookup per AI config that made requests.
    const byConfig = new Map<number | null, string[]>();
    for (const g of generations) byConfig.set(g.c, [...(byConfig.get(g.c) ?? []), g.id]);

    let usd = 0;
    let found = 0;
    let notCheckable = 0;
    for (const [configId, ids] of byConfig) {
      const config = configId != null ? await this.aiConfigs.resolveConfigById(task.user_id, configId).catch(() => null) : null;
      const api = config ? openRouterApi(config) : null;
      if (!config || !api) {
        notCheckable += ids.length;
        continue;
      }
      const costs = await this.lookup(api, config.api_key, ids);
      for (const cost of costs) {
        if (cost == null) continue;
        usd += cost;
        found += 1;
      }
    }

    const billed: BilledCost = {
      usd: Math.round(usd * 1e8) / 1e8,
      found,
      requested: generations.length,
      not_checkable: notCheckable,
      checked_at: new Date().toISOString(),
    };
    if (task.diagnostics) await this.taskRepo.update({ id: taskId }, { diagnostics: { ...task.diagnostics, billed } });
    return billed;
  }

  /** total_cost of each id, or null when the provider has no record of it (yet). */
  private async lookup(api: string, key: string, ids: string[]): Promise<(number | null)[]> {
    const out: (number | null)[] = new Array(ids.length).fill(null);
    let next = 0;
    const worker = async () => {
      while (next < ids.length) {
        const i = next++;
        out[i] = await this.costOf(api, key, ids[i]);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
    return out;
  }

  private async costOf(api: string, key: string, id: string): Promise<number | null> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const res = await this.fetcher(`${api}/generation?id=${encodeURIComponent(id)}`, {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (res.status === 429 && attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
          continue;
        }
        if (!res.ok) return null;
        const body = (await res.json()) as { data?: { total_cost?: unknown } };
        const cost = Number(body?.data?.total_cost);
        return Number.isFinite(cost) && cost >= 0 ? cost : null;
      } catch (error) {
        if (attempt === 3) Logger.warn(`[BilledCost] Could not look up generation ${id}: ${String((error as Error)?.message ?? error)}`);
      }
    }
    return null;
  }
}
