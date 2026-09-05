import { zodValidationMiddleware } from '@/middleware/zodValidationMiddleware';
import { FlowReplayService } from '@/services/android/FlowReplayService';
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

  @Authorized()
  @Post('/:id/run')
  @UseBefore(zodValidationMiddleware(RunFlowValidation))
  async run(
    @Param('id') id: number,
    @Body() request: z.infer<typeof RunFlowValidation>,
    @CurrentUser({ required: true }) user: { userId: number },
  ) {
    return this.flowReplayService.runFlow(id, user.userId, Number(request.device_id));
  }

  @Authorized()
  @Patch('/:id')
  @UseBefore(zodValidationMiddleware(RenameFlowValidation))
  async rename(
    @Param('id') id: number,
    @Body() request: z.infer<typeof RenameFlowValidation>,
    @CurrentUser({ required: true }) user: { userId: number },
  ) {
    return this.flowReplayService.renameFlow(id, user.userId, String(request.name));
  }

  @Authorized()
  @Delete('/:id')
  async remove(@Param('id') id: number, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.flowReplayService.deleteFlow(id, user.userId);
  }
}
