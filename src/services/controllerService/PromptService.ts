import { AiService } from '@/services/AiService';
import { Service } from 'typedi';

@Service()
export class PromptService {
  constructor(private aiService: AiService) {}

  async enhancePrompt(prompt: string, userId?: number): Promise<string> {
    return this.aiService.enhancePrompt(prompt, userId);
  }
}

