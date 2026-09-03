import { AgentTask } from '@/entities/AgentTask';
import { AndroidTaskLog } from '@/entities/AndroidTaskLog';
import { SharedRunFrame } from '@/entities/SharedRunFrame';
import AppError from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import { ApiResponse } from '@/types/ApiResponse';
import { randomBytes } from 'node:crypto';
import { Repository } from 'typeorm';
import { Service } from 'typedi';

/** Upper bound on frames kept per shared run, to keep rows small. */
const MAX_FRAMES = 60;

@Service()
export class RunShareService {
  private taskRepo: Repository<AgentTask> = AppDataSource.getRepository(AgentTask);
  private logRepo: Repository<AndroidTaskLog> = AppDataSource.getRepository(AndroidTaskLog);
  private frameRepo: Repository<SharedRunFrame> = AppDataSource.getRepository(SharedRunFrame);

  /**
   * Make a run publicly readable and snapshot its frames.
   *
   * Sharing is always an explicit action: screenshots of someone's phone can
   * contain notifications, contacts and messages, so nothing is ever published
   * automatically.
   */
  async shareRun(taskId: number, userId: number, excludeSteps: number[] = []): Promise<ApiResponse> {
    const task = await this.taskRepo.findOne({ where: { id: taskId, user_id: userId } });
    if (!task) throw new AppError('Task not found', 404);

    if (!task.share_token) {
      task.share_token = randomBytes(12).toString('hex');
    }
    task.shared_at = new Date();
    await this.taskRepo.save(task);

    // Re-snapshot every time so a re-share picks up the latest exclusions.
    await this.frameRepo.delete({ agent_task_id: task.id });

    const logs = await this.logRepo.find({
      where: { agent_task_id: task.id },
      order: { step_index: 'ASC' },
    });

    const excluded = new Set(excludeSteps);
    const frames: SharedRunFrame[] = [];

    for (const log of logs) {
      if (!log.screenshot_base64) continue;
      if (excluded.has(log.step_index)) continue;
      if (frames.length >= MAX_FRAMES) break;

      // Only the first line of the thought — the rest is planner chatter and can
      // repeat the whole screen dump.
      const caption = (log.thought_reasoning || '').split(/\r?\n/)[0]?.slice(0, 480) || null;

      frames.push(
        this.frameRepo.create({
          agent_task_id: task.id,
          step_index: log.step_index,
          caption,
          image_base64: log.screenshot_base64,
        }),
      );
    }

    if (frames.length > 0) {
      await this.frameRepo.save(frames);
    }

    return {
      message: 'Run shared',
      data: { token: task.share_token, frames: frames.length },
    };
  }

  /** Revoke a share. The link stops working immediately. */
  async unshareRun(taskId: number, userId: number): Promise<ApiResponse> {
    const task = await this.taskRepo.findOne({ where: { id: taskId, user_id: userId } });
    if (!task) throw new AppError('Task not found', 404);

    task.share_token = null;
    task.shared_at = null;
    await this.taskRepo.save(task);
    await this.frameRepo.delete({ agent_task_id: task.id });

    return { message: 'Share link revoked' };
  }

  /** Share status for the owner's UI. */
  async getShareStatus(taskId: number, userId: number): Promise<ApiResponse> {
    const task = await this.taskRepo.findOne({ where: { id: taskId, user_id: userId } });
    if (!task) throw new AppError('Task not found', 404);

    return {
      message: 'Share status',
      data: { token: task.share_token ?? null, shared_at: task.shared_at ?? null },
    };
  }

  /**
   * Public read. Deliberately narrow: prompt, outcome, timings, model name and
   * the frames. No user, no device, no UI trees, no API configuration.
   */
  async getPublicRun(token: string): Promise<ApiResponse> {
    const task = await this.taskRepo.findOne({ where: { share_token: token } });
    if (!task) throw new AppError('This shared run does not exist or is no longer public', 404);

    const frames = await this.frameRepo.find({
      where: { agent_task_id: task.id },
      order: { step_index: 'ASC' },
    });

    return {
      message: 'Shared run',
      data: {
        prompt: task.prompt,
        success: task.success,
        summary: task.message ?? null,
        total_steps: task.total_steps,
        total_duration_seconds: task.total_duration_seconds,
        model: task.model ?? null,
        created_at: task.created_at,
        frames: frames.map((frame) => ({
          step_index: frame.step_index,
          caption: frame.caption,
          image_base64: frame.image_base64,
        })),
      },
    };
  }
}
