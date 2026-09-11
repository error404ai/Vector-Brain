import { AgentTask } from '@/entities/AgentTask';
import { AndroidTaskLog } from '@/entities/AndroidTaskLog';
import { SavedFlow } from '@/entities/SavedFlow';
import Logger from '@/logger/index';
import { AppDataSource } from '@/loaders/database';
import { Repository } from 'typeorm';
import { Service } from 'typedi';

/** How long a finished run stays before it is cleared out. */
const RETENTION_DAYS = 30;

/** Gap between sweeps. */
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Rows per pass, so a large backlog never locks the table for long. */
const BATCH_SIZE = 200;

/**
 * Batches per sweep. A backlog used to drain at 200 runs per six hours; this
 * lets one sweep clear up to 4,000 while still deleting in small bites.
 */
const MAX_BATCHES_PER_SWEEP = 20;

/**
 * Clears out old run history.
 *
 * Each step stores its screen dump, and recorded runs store screenshots on top
 * of that, so history grows far faster than it stays useful. Runs that someone
 * has deliberately kept — shared publicly, or saved as a flow — are left alone.
 */
@Service()
export class HistoryCleanupService {
  private taskRepo: Repository<AgentTask> = AppDataSource.getRepository(AgentTask);
  private logRepo: Repository<AndroidTaskLog> = AppDataSource.getRepository(AndroidTaskLog);
  private flowRepo: Repository<SavedFlow> = AppDataSource.getRepository(SavedFlow);

  start(): void {
    // A first pass shortly after boot, then on a slow loop.
    setTimeout(() => void this.sweep(), 60_000);
    setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
    Logger.info(`[Cleanup] History retention set to ${RETENTION_DAYS} days`);
  }

  async sweep(): Promise<{ tasksDeleted: number; logsDeleted: number }> {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    let tasksDeleted = 0;
    let logsDeleted = 0;

    try {
      for (let batch = 0; batch < MAX_BATCHES_PER_SWEEP; batch++) {
        const ids = await this.findDeletableIds(cutoff);
        if (ids.length === 0) break;

        const logResult = await this.logRepo
          .createQueryBuilder()
          .delete()
          .where('agent_task_id IN (:...ids)', { ids })
          .execute();
        await this.taskRepo.delete(ids);

        tasksDeleted += ids.length;
        logsDeleted += logResult.affected ?? 0;
        if (ids.length < BATCH_SIZE) break;
      }

      if (tasksDeleted > 0) {
        Logger.info(`[Cleanup] Removed ${tasksDeleted} runs and ${logsDeleted} steps older than ${RETENTION_DAYS} days`);
      }
      return { tasksDeleted, logsDeleted };
    } catch (error) {
      // Cleanup is housekeeping; a failure must never take the app down.
      Logger.warn('[Cleanup] Sweep failed', error);
      return { tasksDeleted, logsDeleted };
    }
  }

  /**
   * The next batch of runs that are old AND not kept.
   *
   * The "kept" filter has to live in the query. It used to run in JS on the 200
   * oldest rows, so once more than 200 old runs were shared or saved as flows,
   * every batch came back fully filtered and cleanup stopped for good without
   * logging anything.
   */
  private async findDeletableIds(cutoff: Date): Promise<number[]> {
    const flowTable = this.flowRepo.metadata.tableName;
    const rows = await this.taskRepo
      .createQueryBuilder('task')
      .select('task.id', 'id')
      .where('task.created_at < :cutoff', { cutoff })
      .andWhere('task.share_token IS NULL')
      .andWhere(`NOT EXISTS (SELECT 1 FROM \`${flowTable}\` kept WHERE kept.source_task_id = task.id)`)
      .orderBy('task.created_at', 'ASC')
      .limit(BATCH_SIZE)
      .getRawMany<{ id: number | string }>();

    return rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
  }
}
