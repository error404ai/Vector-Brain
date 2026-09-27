import { ClientReport } from '@/entities/ClientReport';
import AppError from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import { Service } from 'typedi';
import { MoreThanOrEqual } from 'typeorm';

export const CLIENT_REPORT_KINDS = new Set(['unclean_exit', 'stuck_loader', 'js_error', 'unhandled_rejection', 'render_error', 'manual']);

/** A report is diagnostic context, not a data dump. */
const MAX_PAYLOAD_BYTES = 48 * 1024;
/** Per IP: enough for a burst of errors, not enough to flood the table. */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 60;
/** Older reports are pruned on write. */
const KEEP_DAYS = 30;

const BASE64_BLOB = /[A-Za-z0-9+/=]{300,}/g;

@Service()
export class ClientReportService {
  private repo = AppDataSource.getRepository(ClientReport);
  private hits = new Map<string, number[]>();
  private lastPrune = 0;

  async record(
    input: { kind?: unknown; page?: unknown; tab_id?: unknown; app_version?: unknown; payload?: unknown },
    context: { userId: number | null; ip: string; userAgent: string },
  ): Promise<{ id: number }> {
    this.limit(context.ip);
    const kind = String(input.kind ?? '');
    if (!CLIENT_REPORT_KINDS.has(kind)) throw new AppError('Unknown report kind', 400);

    let payload: Record<string, unknown> | null = null;
    if (input.payload && typeof input.payload === 'object') {
      // Never store screenshots or other blobs a buggy client might attach.
      let text = JSON.stringify(input.payload).replace(BASE64_BLOB, '<blob>');
      if (Buffer.byteLength(text) > MAX_PAYLOAD_BYTES) text = JSON.stringify({ truncated: true, head: text.slice(0, MAX_PAYLOAD_BYTES - 200) });
      payload = JSON.parse(text);
    }

    const saved = await this.repo.save(
      this.repo.create({
        user_id: context.userId,
        kind,
        page: typeof input.page === 'string' ? input.page.slice(0, 200) : null,
        tab_id: typeof input.tab_id === 'string' ? input.tab_id.slice(0, 40) : null,
        user_agent: context.userAgent.slice(0, 300) || null,
        app_version: typeof input.app_version === 'string' ? input.app_version.slice(0, 40) : null,
        payload,
      }),
    );
    void this.prune();
    return { id: saved.id };
  }

  async list(days: number, limit = 200) {
    const since = new Date(Date.now() - days * 86_400_000);
    const rows = await this.repo.find({ where: { created_at: MoreThanOrEqual(since) }, order: { id: 'DESC' }, take: Math.min(Math.max(limit, 1), 1000) });
    return rows;
  }

  private limit(ip: string): void {
    const now = Date.now();
    const recent = (this.hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= MAX_PER_WINDOW) throw new AppError('Too many reports', 429);
    recent.push(now);
    this.hits.set(ip, recent);
    if (this.hits.size > 5000) this.hits.clear();
  }

  private async prune(): Promise<void> {
    if (Date.now() - this.lastPrune < 60 * 60 * 1000) return;
    this.lastPrune = Date.now();
    await this.repo
      .createQueryBuilder()
      .delete()
      .where('created_at < :cutoff', { cutoff: new Date(Date.now() - KEEP_DAYS * 86_400_000) })
      .execute()
      .catch(() => undefined);
  }
}
