import { zodValidationMiddleware } from '@/middleware/zodValidationMiddleware';
import { PromptService } from '@/services/controllerService/PromptService';
import { EnhancePromptValidation } from '@/validations/PromptValidation';
import { Authorized, Body, CurrentUser, JsonController, Post, UseBefore } from 'routing-controllers';
import { Service } from 'typedi';
import z from 'zod';

@Service()
@Authorized()
@JsonController('/prompts')
export class PromptController {
  constructor(private promptService: PromptService) {}

  @Post('/enhance')
  @UseBefore(zodValidationMiddleware(EnhancePromptValidation))
  async enhance(
    @Body() request: z.infer<typeof EnhancePromptValidation>,
    @CurrentUser({ required: true }) user: { userId: number },
  ) {
    const enhancedPrompt = await this.promptService.enhancePrompt(request.prompt, user.userId);
    return {
      enhancedPrompt,
      originalPrompt: request.prompt,
    };
  }
}

