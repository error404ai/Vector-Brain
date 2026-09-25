import { zodValidationMiddleware } from '@/middleware/zodValidationMiddleware';
import { CommandChatService } from '@/services/android/CommandChatService';
import { CommandChatConfirmValidation, CommandChatDryRunValidation, CommandChatRerunValidation, CommandChatValidation } from '@/validations/CommandChatValidation';
import { Authorized, Body, CurrentUser, Delete, Get, JsonController, Param, Post, QueryParam, UseBefore } from 'routing-controllers';
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
    const body = request as { message: string; conversation_id?: number };
    return this.commandChatService.handle(user.userId, body.message, body.conversation_id);
  }

  @Authorized()
  @Get('/history')
  async history(
    @QueryParam('conversation_id') conversationId: number,
    @QueryParam('limit') limit: number,
    @CurrentUser({ required: true }) user: { userId: number },
  ) {
    return this.commandChatService.history(user.userId, Number(conversationId) || undefined, Number(limit) || 100);
  }

  /** A screen Vector showed earlier in the chat, fetched when its tile comes into view. */
  @Authorized()
  @Get('/screens/:id')
  async screen(@Param('id') id: number, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.commandChatService.screenShot(user.userId, Number(id));
  }

  @Authorized()
  @Get('/conversations')
  async conversations(@CurrentUser({ required: true }) user: { userId: number }) {
    return this.commandChatService.listConversations(user.userId);
  }

  @Authorized()
  @Post('/conversations')
  async newConversation(@CurrentUser({ required: true }) user: { userId: number }) {
    return this.commandChatService.newConversation(user.userId);
  }

  @Authorized()
  @Post('/conversations/:id/rename')
  async rename(@Param('id') id: number, @Body() body: { title?: string }, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.commandChatService.renameConversation(user.userId, Number(id), String(body?.title ?? ''));
  }

  @Authorized()
  @Delete('/conversations/:id')
  async remove(@Param('id') id: number, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.commandChatService.deleteConversation(user.userId, Number(id));
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
    const body = request as { message: string; history?: { role: 'user' | 'assistant'; text: string }[]; pending?: string[]; policy?: 'v1' | 'v2' };
    return this.commandChatService.dryRun(user.userId, body.message, body.history, body.pending, body.policy);
  }

  @Authorized()
  @Post('/confirm')
  @UseBefore(zodValidationMiddleware(CommandChatConfirmValidation))
  async confirm(@Body() request: z.infer<typeof CommandChatConfirmValidation>, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.commandChatService.confirm(user.userId, request.confirm_token as string);
  }
}
