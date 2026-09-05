import { AgentTask } from '@/entities/AgentTask';
import { AndroidTaskLog } from '@/entities/AndroidTaskLog';
import { SavedFlow } from '@/entities/SavedFlow';
import Logger from '@/logger/index';
import { AppDataSource } from '@/loaders/database';
import { LessThan, Repository } from 'typeorm';
import { Service } from 'typedi';

/** How long a finished run stays before it is cleared out. */
const RETENTION_DAYS = 30;

/** Gap between sweeps. */
const SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Rows per pass, so a large backlog never locks the table for long. */
const BATCH_SIZE = 200;

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

    try {
      const stale = await this.taskRepo.find({
        where: { created_at: LessThan(cutoff) },
        order: { created_at: 'ASC' },
        take: BATCH_SIZE,
      });

      if (stale.length === 0) return { tasksDeleted: 0, logsDeleted: 0 };

      // Anything the user chose to keep is not history any more.
      const savedFlows = await this.flowRepo.find({ select: { source_task_id: true } });
      const keepTaskIds = new Set(savedFlows.map((flow) => flow.source_task_id).filter(Boolean) as number[]);

      const deletable = stale.filter((task) => !task.share_token && !keepTaskIds.has(task.id));
      if (deletable.length === 0) return { tasksDeleted: 0, logsDeleted: 0 };

      const ids = deletable.map((task) => task.id);
      const logResult = await this.logRepo
        .createQueryBuilder()
        .delete()
        .where('agent_task_id IN (:...ids)', { ids })
        .execute();

      await this.taskRepo.delete(ids);

      const logsDeleted = logResult.affected ?? 0;
      Logger.info(`[Cleanup] Removed ${deletable.length} runs and ${logsDeleted} steps older than ${RETENTION_DAYS} days`);
      return { tasksDeleted: deletable.length, logsDeleted };
    } catch (error) {
      // Cleanup is housekeeping; a failure must never take the app down.
      Logger.warn('[Cleanup] Sweep failed', error);
      return { tasksDeleted: 0, logsDeleted: 0 };
    }
  }
}
