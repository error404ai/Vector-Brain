import { AgentTask } from '@/entities/AgentTask';
import { AndroidTaskLog } from '@/entities/AndroidTaskLog';
import AppError from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import { zodValidationMiddleware } from '@/middleware/zodValidationMiddleware';
import { AndroidPlannerService } from '@/services/android/AndroidPlannerService';
import { DispatchAndroidPromptValidation } from '@/validations/AndroidDeviceValidation';
import { Authorized, Body, CurrentUser, Get, JsonController, Param, Post, UseBefore } from 'routing-controllers';
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
    return this.plannerService.runTask(request.prompt, request.device_id, user.userId, request.max_steps);
  }

  /**
   * Cancel an ongoing Android task.
   */
  @Post('/cancel/:taskId')
  async cancelTask(@Param('taskId') taskId: number, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.plannerService.cancelTask(taskId, user.userId);
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
    };
  }
}
