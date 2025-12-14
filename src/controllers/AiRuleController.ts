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
  async list(@QueryParams() query: any) {
    return this.aiRuleService.list(query);
  }

  @Get('/details/:id')
  async details(@Param('id') id: number) {
    return this.aiRuleService.details(id);
  }

  @Post('/create')
  @UseBefore(zodValidationMiddleware(CreateAiRuleValidation))
  async create(@Body() request: z.infer<typeof CreateAiRuleValidation>, @CurrentUser({ required: true }) user: { userId: number }) {
    return this.aiRuleService.create(request, user.userId);
  }

  @Put('/update/:id')
  @UseBefore(zodValidationMiddleware(UpdateAiRuleValidation))
  async update(@Param('id') id: number, @Body() data: z.infer<typeof UpdateAiRuleValidation>) {
    return this.aiRuleService.update(id, data);
  }

  @Delete('/delete/:id')
  async delete(@Param('id') id: number) {
    return this.aiRuleService.delete(id);
  }

  @Post('/search')
  @UseBefore(zodValidationMiddleware(SearchAiRulesValidation))
  async search(@Body() request: z.infer<typeof SearchAiRulesValidation>) {
    return this.aiRuleService.searchByPrompt(request);
  }

  @Post('/backfill-vectors')
  async backfillVectors() {
    return this.aiRuleService.backfillAllVectors();
  }

  @Post('/vectorize/:id')
  async vectorize(@Param('id') id: number) {
    return this.aiRuleService.vectorizeSingle(id);
  }
}
