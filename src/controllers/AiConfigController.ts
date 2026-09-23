import { zodValidationMiddleware } from '@/middleware/zodValidationMiddleware';
import { AiConfigService } from '@/services/controllerService/AiConfigService';
import { CreateAiConfigValidation, TestAiConfigValidation, UpdateAiConfigValidation } from '@/validations/AiConfigValidation';
import { Authorized, Body, CurrentUser, Delete, Get, JsonController, Param, Patch, Post, Put, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';
import { z } from 'zod';

@Service()
@Authorized()
@JsonController('/ai-configs')
export class AiConfigController {
  constructor(private aiConfigService: AiConfigService) {}

  @Get('/list')
  async list(@CurrentUser({ required: true }) user: { userId: number }) {
    return this.aiConfigService.list(user.userId);
  }

  @Get('/details/:id')
  async getOne(@Param('id') id: number, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.aiConfigService.getOne(id, user.userId);
  }

  @Post('/create')
  @UseBefore(zodValidationMiddleware(CreateAiConfigValidation))
  async create(
    @Body() request: z.infer<typeof CreateAiConfigValidation>,
    @CurrentUser({ required: true }) user: { userId: number },
  ) {
    return this.aiConfigService.create(request, user.userId);
  }

  @Put('/update/:id')
  @UseBefore(zodValidationMiddleware(UpdateAiConfigValidation))
  async update(
    @Param('id') id: number,
    @Body() request: z.infer<typeof UpdateAiConfigValidation>,
    @CurrentUser({ required: true }) user: { userId: number },
  ) {
    return this.aiConfigService.update(id, request, user.userId);
  }

  @Delete('/delete/:id')
  async delete(@Param('id') id: number, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.aiConfigService.delete(id, user.userId);
  }

  @Patch("/set-chat-default/:id")
  async setChatDefault(@Param("id") id: number, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.aiConfigService.setChatDefault(id, user.userId);
  }

  @Patch("/set-active/:id")
  async setActive(@Param('id') id: number, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.aiConfigService.setActive(id, user.userId);
  }

  @Post('/test')
  @UseBefore(zodValidationMiddleware(TestAiConfigValidation))
  async testCredentials(@Body() request: z.infer<typeof TestAiConfigValidation>) {
    return this.aiConfigService.testCredentials(request);
  }

  @Post('/test/:id')
  async testSaved(@Param('id') id: number, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.aiConfigService.testSaved(id, user.userId);
  }
}
