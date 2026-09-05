import { zodValidationMiddleware } from '@/middleware/zodValidationMiddleware';
import { FlowReplayService } from '@/services/android/FlowReplayService';
import AppError from '@/helpers/AppError';
import { RenameFlowValidation, RunFlowValidation, SaveFlowValidation } from '@/validations/FlowValidation';
import { Authorized, Body, CurrentUser, Delete, Get, JsonController, Param, Patch, Post, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';
import z from 'zod';

@Service()
@JsonController('/android/flows')
export class FlowController {
  constructor(private flowReplayService: FlowReplayService) {}

  @Authorized()
  @Get('/')
  async list(@CurrentUser({ required: true }) user: { userId: number }) {
    return this.flowReplayService.listFlows(user.userId);
  }

  /** Record a finished run as a repeatable flow. */
  @Authorized()
  @Post('/')
  @UseBefore(zodValidationMiddleware(SaveFlowValidation))
  async save(
    @Body() request: z.infer<typeof SaveFlowValidation>,
    @CurrentUser({ required: true }) user: { userId: number },
  ) {
    return this.flowReplayService.saveFromTask(Number(request.task_id), user.userId, request.name as any);
  }

  /**
   * The shared zod middleware validates route params whenever a path has any,
   * so a body schema would never be applied here. The body is checked in the
   * handler instead.
   */
  @Authorized()
  @Post('/:id/run')
  async run(
    @Param('id') id: number,
    @Body() request: { device_id?: number | string },
    @CurrentUser({ required: true }) user: { userId: number },
  ) {
    const parsed = RunFlowValidation.safeParse({ device_id: Number(request?.device_id) });
    if (!parsed.success) {
      throw new AppError('Target device is required', 400);
    }
    return this.flowReplayService.runFlow(id, user.userId, Number(request.device_id));
  }

  @Authorized()
  @Patch('/:id')
  async rename(
    @Param('id') id: number,
    @Body() request: { name?: string },
    @CurrentUser({ required: true }) user: { userId: number },
  ) {
    const parsed = RenameFlowValidation.safeParse({ name: request?.name });
    if (!parsed.success) {
      throw new AppError('Name cannot be empty', 400);
    }
    return this.flowReplayService.renameFlow(id, user.userId, String(request.name));
  }

  @Authorized()
  @Delete('/:id')
  async remove(@Param('id') id: number, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.flowReplayService.deleteFlow(id, user.userId);
  }
}
