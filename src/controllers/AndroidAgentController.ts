import { AgentTask } from '@/entities/AgentTask';
import { AndroidTaskLog } from '@/entities/AndroidTaskLog';
import AppError from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import { zodValidationMiddleware } from '@/middleware/zodValidationMiddleware';
import { AndroidPlannerService } from '@/services/android/AndroidPlannerService';
import { DispatchAndroidPromptValidation } from '@/validations/AndroidDeviceValidation';
import { Authorized, Body, CurrentUser, Delete, Get, JsonController, Param, Post, QueryParam, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';
import z from 'zod';

@Service()
@Authorized()
@JsonController('/android/agent')
export class AndroidAgentController {
  private taskLogRepo = AppDataSource.getRepository(AndroidTaskLog);
  private agentTaskRepo = AppDataSource.getRepository(AgentTask);

  constructor(private plannerService: AndroidPlannerService) {}

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
        created_at: true,
        updated_at: true,
      },
    });

    const runningTaskIds = this.plannerService.getActiveTaskIds();

    return {
      message: 'Android tasks retrieved successfully',
      data: tasks.map((task) => ({
        ...task,
        is_running: runningTaskIds.includes(task.id),
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
    const taskId = this.plannerService.getActiveTaskIdForDevice(parsedDeviceId);

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
        created_at: task.created_at,
        is_running: this.plannerService.getActiveTaskIds().includes(task.id),
      },
    };
  }
}
