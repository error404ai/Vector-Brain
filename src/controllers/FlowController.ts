import { zodValidationMiddleware } from '@/middleware/zodValidationMiddleware';
import { FlowReplayService } from '@/services/android/FlowReplayService';
import { FlowLibraryService } from '@/services/android/FlowLibraryService';
import AppError from '@/helpers/AppError';
import { RenameFlowValidation, RunFlowValidation, SaveFlowValidation } from '@/validations/FlowValidation';
import { Authorized, Body, CurrentUser, Delete, Get, JsonController, Param, Patch, Post, Put, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';
import z from 'zod';

@Service()
@JsonController('/android/flows')
export class FlowController {
  constructor(
    private flowReplayService: FlowReplayService,
    private flowLibrary: FlowLibraryService,
  ) {}

  /** The account's saved-flow switches (Settings → Saved flows). */
  @Authorized()
  @Get('/settings')
  async getSettings(@CurrentUser({ required: true }) user: { userId: number }) {
    return { message: 'Saved-flow settings', data: await this.flowLibrary.settings(user.userId) };
  }

  @Authorized()
  @Put('/settings')
  async putSettings(
    @Body() request: { record?: unknown; replay_first?: unknown; ai_repair?: unknown; share_fixes?: unknown },
    @CurrentUser({ required: true }) user: { userId: number },
  ) {
    const body = request ?? {};
    for (const key of ['record', 'replay_first', 'ai_repair', 'share_fixes'] as const) {
      if (body[key] !== undefined && typeof body[key] !== 'boolean') throw new AppError(`${key} must be true or false`, 400);
    }
    return { message: 'Saved — applies to the next run', data: await this.flowLibrary.setSettings(user.userId, body) };
  }

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
    @Body() request: { name?: string; enabled?: boolean },
    @CurrentUser({ required: true }) user: { userId: number },
  ) {
    if (request?.enabled !== undefined) {
      if (typeof request.enabled !== 'boolean') throw new AppError('enabled must be true or false', 400);
      if (request.name === undefined) return this.flowReplayService.setEnabled(id, user.userId, request.enabled);
      await this.flowReplayService.setEnabled(id, user.userId, request.enabled);
    }
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
