import { zodValidationMiddleware } from '@/middleware/zodValidationMiddleware';
import { AiRuleService } from '@/services/controllerService/AiRuleService';
import { AiRuleListValidation, CreateAiRuleValidation, SearchAiRulesValidation, UpdateAiRuleValidation } from '@/validations/AiRuleValidation';
import { Authorized, Body, CurrentUser, Delete, Get, JsonController, Param, Post, Put, QueryParams, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';
import z from 'zod';

@Service()
@Authorized()
@JsonController('/ai-rules')
export class AiRuleController {
  constructor(private aiRuleService: AiRuleService) {}

  @Get('/list')
  @UseBefore(zodValidationMiddleware(AiRuleListValidation))
  async list(@QueryParams() query: any, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.aiRuleService.list(query, user.userId);
  }

  @Get('/details/:id')
  async details(@Param('id') id: number, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.aiRuleService.details(id, user.userId);
  }

  @Post('/create')
  @UseBefore(zodValidationMiddleware(CreateAiRuleValidation))
  async create(@Body() request: z.infer<typeof CreateAiRuleValidation>, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.aiRuleService.create(request, user.userId);
  }

  @Put('/update/:id')
  @UseBefore(zodValidationMiddleware(UpdateAiRuleValidation))
  async update(@Param('id') id: number, @Body() data: z.infer<typeof UpdateAiRuleValidation>, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.aiRuleService.update(id, data, user.userId);
  }

  @Delete('/delete/:id')
  async delete(@Param('id') id: number, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.aiRuleService.delete(id, user.userId);
  }

  @Post('/search')
  @UseBefore(zodValidationMiddleware(SearchAiRulesValidation))
  async search(@Body() request: z.infer<typeof SearchAiRulesValidation>, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.aiRuleService.searchByPrompt(request);
  }

  @Post('/backfill-vectors')
  async backfillVectors(@CurrentUser({ required: true }) user: { userId: number }) {
    return this.aiRuleService.backfillAllVectors(user.userId);
  }

  @Post('/vectorize/:id')
  async vectorize(@Param('id') id: number) {
    return this.aiRuleService.vectorizeSingle(id);
  }
}
