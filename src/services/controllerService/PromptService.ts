import envConfig from '@/config/envConfig';
import Logger from '@/logger/index';
import { ChatOpenAI } from '@langchain/openai';
import { Service } from 'typedi';

@Service()
export class PromptService {
  private chatModel: ChatOpenAI | null = null;

  constructor() {
    if (envConfig.embeddingApiKey) {
      this.chatModel = new ChatOpenAI({
        openAIApiKey: envConfig.embeddingApiKey,
        modelName: 'gpt-4o-mini', // or whatever model for enhancement
        temperature: 0.7,
      });
    } else {
      Logger.warn('No OpenAI API key configured. Prompt enhancement will be unavailable.');
    }
  }

  async enhancePrompt(prompt: string): Promise<string> {
    if (!this.chatModel) {
      throw new Error('AI service not configured');
    }

    const systemPrompt = `You are an expert prompt engineer. Enhance the following user prompt to make it clearer, more specific, and more effective for AI models. Keep the core intent but improve structure, add context if needed, and ensure it's concise. Return only the enhanced prompt, no explanations.`;

    const response = await this.chatModel.invoke([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ]);

    const enhanced = response.content as string;
    return enhanced.trim();
  }
}
