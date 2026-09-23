import { zodValidationMiddleware } from '@/middleware/zodValidationMiddleware';
import { CommandChatService } from '@/services/android/CommandChatService';
import { CommandChatConfirmValidation, CommandChatDryRunValidation, CommandChatRerunValidation, CommandChatValidation } from '@/validations/CommandChatValidation';
import { Authorized, Body, CurrentUser, Get, JsonController, Post, QueryParam, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';
import z from 'zod';

@Service()
@JsonController('/android/chat')
export class CommandChatController {
  constructor(private commandChatService: CommandChatService) {}

  @Authorized()
  @Post('/')
  @UseBefore(zodValidationMiddleware(CommandChatValidation))
  async chat(@Body() request: z.infer<typeof CommandChatValidation>, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.commandChatService.handle(user.userId, request.message as string);
  }

  @Authorized()
  @Get('/history')
  async history(@QueryParam('limit') limit: number, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.commandChatService.history(user.userId, Number(limit) || 60);
  }

  @Authorized()
  @Post('/rerun')
  @UseBefore(zodValidationMiddleware(CommandChatRerunValidation))
  async rerun(@Body() request: z.infer<typeof CommandChatRerunValidation>, @CurrentUser({ required: true }) user: { userId: number }) {
    const body = request as { mission_id: number; scope?: 'failed' | 'all'; continue?: boolean };
    return this.commandChatService.rerun(user.userId, body.mission_id, { scope: body.scope, continue: body.continue });
  }

  @Authorized()
  @Post('/dry-run')
  @UseBefore(zodValidationMiddleware(CommandChatDryRunValidation))
  async dryRun(@Body() request: z.infer<typeof CommandChatDryRunValidation>, @CurrentUser({ required: true }) user: { userId: number }) {
    const body = request as { message: string; history?: { role: 'user' | 'assistant'; text: string }[]; pending?: string[] };
    return this.commandChatService.dryRun(user.userId, body.message, body.history, body.pending);
  }

  @Authorized()
  @Post('/confirm')
  @UseBefore(zodValidationMiddleware(CommandChatConfirmValidation))
  async confirm(@Body() request: z.infer<typeof CommandChatConfirmValidation>, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.commandChatService.confirm(user.userId, request.confirm_token as string);
  }
}
