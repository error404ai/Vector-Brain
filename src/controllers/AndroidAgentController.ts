import { AgentTask } from '@/entities/AgentTask';
import { AndroidTaskLog } from '@/entities/AndroidTaskLog';
import AppError from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import { zodValidationMiddleware } from '@/middleware/zodValidationMiddleware';
import { AndroidPlannerService } from '@/services/android/AndroidPlannerService';
import { DispatchAndroidPromptValidation } from '@/validations/AndroidDeviceValidation';
import { Authorized, Body, CurrentUser, Delete, Get, JsonController, Param, Post, Put, QueryParam, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';
import z from 'zod';

/** The step feed shows the latest steps of a run; older ones are summed up. */
const STEP_FEED_LIMIT = 300;

@Service()
@Authorized()
@JsonController('/android/agent')
export class AndroidAgentController {
  private taskLogRepo = AppDataSource.getRepository(AndroidTaskLog);
  private agentTaskRepo = AppDataSource.getRepository(AgentTask);

  constructor(private plannerService: AndroidPlannerService) {}

  /** Which agent engine this account's runs use (eko = stable, vector = Vector Brain's own loop). */
  @Get('/engine')
  async getEngine(@CurrentUser({ required: true }) user: { userId: number }) {
    return { data: await this.plannerService.engineSettings(user.userId) };
  }

  /**
   * engine: 'eko' | 'vector' | null (null = server default); planner: Vector engine's optional planning call;
   * vision_config_id / fallback_config_id: one of the account's AI configs, or null.
   * screenshots: when the agent model sees a screenshot — 'off' | 'stuck' | 'every_step' (null = 'stuck').
   */
  @Put('/engine')
  async setEngine(
    @Body() body: { engine?: string | null; planner?: boolean; vision_config_id?: number | null; fallback_config_id?: number | null; screenshots?: string | null },
    @CurrentUser({ required: true }) user: { userId: number },
  ) {
    return this.plannerService.setEngineSettings(user.userId, {
      engine: body?.engine,
      planner: body?.planner,
      vision_config_id: body?.vision_config_id,
      fallback_config_id: body?.fallback_config_id,
      screenshots: body?.screenshots,
    });
  }

  /**
   * Run an autonomous AI task on an Android device.
   */
  @Post('/run')
  @UseBefore(zodValidationMiddleware(DispatchAndroidPromptValidation))
  async runTask(
    @Body() request: z.infer<typeof DispatchAndroidPromptValidation>,
    @CurrentUser({ required: true }) user: { userId: number },
  ) {
    return this.plannerService.runTask(
      request.prompt,
      request.device_id,
      user.userId,
      request.max_steps,
      request.task_id,
      // The dashboard's per-run model picker was being dropped here, so every
      // task silently used the active provider.
      request.ai_config_id,
      Boolean(request.record),
      Boolean(request.skip_proxy_lane),
    );
  }

  /**
   * Cancel an ongoing Android task.
   */
  @Post('/cancel/:taskId')
  async cancelTask(@Param('taskId') taskId: number, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.plannerService.cancelTask(taskId, user.userId);
  }

  /**
   * List recent Android automation tasks for the current user.
   * Optionally filtered by device, so each device can show its own history.
   */
  @Get('/tasks')
  async listTasks(
    @CurrentUser({ required: true }) user: { userId: number },
    @QueryParam('deviceId') deviceId?: number,
    @QueryParam('limit') limit?: number,
  ) {
    const take = Math.max(1, Math.min(Number(limit) || 30, 100));

    const where: { user_id: number; device_id?: number } = { user_id: user.userId };
    if (deviceId !== undefined && deviceId !== null && !Number.isNaN(Number(deviceId))) {
      where.device_id = Number(deviceId);
    }

    const tasks = await this.agentTaskRepo.find({
      where,
      order: { created_at: 'DESC' },
      take,
      select: {
        id: true,
        device_id: true,
        prompt: true,
        provider: true,
        model: true,
        success: true,
        message: true,
        total_steps: true,
        total_duration_seconds: true,
        status: true,
        reason_code: true,
        started_at: true,
        finished_at: true,
        created_at: true,
        updated_at: true,
      },
    });

    const runningTaskIds = this.plannerService.getActiveTaskIds();

    return {
      message: 'Android tasks retrieved successfully',
      data: tasks.map((task) => ({
        ...task,
        // The stored status survives restarts; the in-memory set also covers
        // runs started before this field existed.
        is_running: task.status === 'RUNNING' || runningTaskIds.includes(task.id),
      })),
    };
  }

  /**
   * Get the task currently running on a device, if any.
   * Used by the UI to re-attach to a live session after a page reload.
   */
  @Get('/active')
  async getActiveTask(
    @CurrentUser({ required: true }) user: { userId: number },
    @QueryParam('deviceId') deviceId?: number,
  ) {
    const parsedDeviceId =
      deviceId !== undefined && deviceId !== null && !Number.isNaN(Number(deviceId)) ? Number(deviceId) : undefined;
    let taskId = this.plannerService.getActiveTaskIdForDevice(parsedDeviceId);

    // Not in this process's memory — e.g. right after a deploy while the old
    // container is still finishing it. Fall back to a stored RUNNING run whose
    // lease is still alive.
    if (!taskId && parsedDeviceId !== undefined) {
      const stored = await this.agentTaskRepo
        .createQueryBuilder('task')
        .select(['task.id'])
        .where('task.user_id = :userId', { userId: user.userId })
        .andWhere('task.device_id = :deviceId', { deviceId: parsedDeviceId })
        .andWhere('task.status = :status', { status: 'RUNNING' })
        .andWhere('task.lease_until > :now', { now: new Date() })
        .orderBy('task.id', 'DESC')
        .getOne();
      taskId = stored?.id;
    }

    if (!taskId) {
      return { message: 'No active task', data: null };
    }

    const task = await this.agentTaskRepo.findOne({ where: { id: taskId, user_id: user.userId } });
    if (!task) {
      return { message: 'No active task', data: null };
    }

    return {
      message: 'Active task retrieved successfully',
      data: { ...task, is_running: true },
    };
  }

  /**
   * Delete a finished run and everything stored under it.
   *
   * Shared frames are removed by the foreign key cascade, so a deleted run also
   * stops resolving on its public share link. Saved flows keep their own copy of
   * the steps, so a flow made from this run keeps working.
   */
  @Delete('/tasks/:taskId')
  async deleteTask(@Param('taskId') taskId: number, @CurrentUser({ required: true }) user: { userId: number }) {
    const task = await this.agentTaskRepo.findOne({ where: { id: taskId, user_id: user.userId } });
    if (!task) throw new AppError('Task not found', 404);

    if (this.plannerService.getActiveTaskIds().includes(task.id)) {
      throw new AppError('This run is still in progress. Stop it before deleting.', 409);
    }

    await this.taskLogRepo.delete({ agent_task_id: task.id });
    await this.agentTaskRepo.delete({ id: task.id });

    return { message: 'Run deleted successfully', data: { id: task.id } };
  }

  /**
   * The steps of a run without screenshots or UI trees: what the chat's step
   * feed shows. The full logs endpoint carries a screenshot per step, which is
   * far too heavy to load for every card on Mission Control.
   */
  @Get('/logs/:taskId/steps')
  async getTaskSteps(@Param('taskId') taskId: number, @CurrentUser({ required: true }) user: { userId: number }) {
    const task = await this.agentTaskRepo.findOne({ where: { id: taskId, user_id: user.userId }, select: ['id', 'status', 'message', 'total_steps'] });
    if (!task) throw new AppError('Task not found', 404);
    const rows = await this.taskLogRepo
      .createQueryBuilder('l')
      .select(['l.id', 'l.step_index', 'l.action_type', 'l.action_payload', 'l.thought_reasoning', 'l.status', 'l.duration_ms', 'l.error_message', 'l.created_at'])
      .where('l.agent_task_id = :taskId', { taskId })
      .orderBy('l.step_index', 'DESC')
      .addOrderBy('l.id', 'DESC')
      .limit(STEP_FEED_LIMIT)
      .getMany();
    const clip = (value: unknown, max: number) => (typeof value === 'string' && value.length > max ? `${value.slice(0, max)}…` : value);
    return {
      message: 'Task steps',
      data: {
        task: { id: task.id, status: task.status, message: task.message, total_steps: task.total_steps },
        steps: rows.reverse().map((l) => ({
          id: l.id,
          step_index: l.step_index,
          action_type: l.action_type,
          // Only the fields the feed names (URL, text, target); never bulk data.
          action_payload: l.action_payload && typeof l.action_payload === 'object'
            ? Object.fromEntries(Object.entries(l.action_payload as Record<string, unknown>).filter(([, v]) => typeof v !== 'object').map(([k, v]) => [k, clip(v, 300)]))
            : null,
          thought: clip(l.thought_reasoning ?? '', 800),
          status: l.status,
          duration_ms: l.duration_ms,
          error: clip(l.error_message ?? null, 300),
          at: l.created_at,
        })),
      },
    };
  }

  /**
   * Get step-by-step logs and screenshots for an Android task.
   */
  @Get('/logs/:taskId')
  async getTaskLogs(@Param('taskId') taskId: number, @CurrentUser({ required: true }) user: { userId: number }) {
    const task = await this.agentTaskRepo.findOne({ where: { id: taskId, user_id: user.userId } });
    if (!task) throw new AppError('Task not found', 404);

    const logs = await this.taskLogRepo.find({
      where: { agent_task_id: taskId },
      order: { step_index: 'ASC' },
    });

    return {
      message: 'Task logs retrieved successfully',
      data: logs,
      task: {
        id: task.id,
        device_id: task.device_id,
        prompt: task.prompt,
        success: task.success,
        message: task.message,
        total_steps: task.total_steps,
        status: task.status,
        reason_code: task.reason_code,
        created_at: task.created_at,
        is_running: task.status === 'RUNNING' || this.plannerService.getActiveTaskIds().includes(task.id),
      },
    };
  }
}
