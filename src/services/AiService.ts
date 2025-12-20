import envConfig from '@/config/envConfig';
import Logger from '@/logger/index';
import { ChatOpenAI } from '@langchain/openai';
import { Service } from 'typedi';
import * as z from 'zod';

@Service()
export class AiService {
  private chatModel: ChatOpenAI | null = null;

  constructor() {
    if (envConfig.embeddingApiKey) {
      this.chatModel = new ChatOpenAI({
        openAIApiKey: envConfig.embeddingApiKey,
        modelName: 'gpt-5-mini',
      });
    } else {
      Logger.warn('No OpenAI API key configured. AI services will be unavailable.');
    }
  }

  async isPromptRelatedToWebsite(prompt: string, website: string): Promise<boolean> {
    if (!this.chatModel) {
      Logger.warn('AI service not configured. Assuming not related.');
      return false;
    }

    try {
      const schema = z.object({ isRelated: z.boolean() });
      const structuredModel = this.chatModel.withStructuredOutput(schema);

      const response = await structuredModel.invoke([{ role: 'user', content: `Is the following user prompt related to the website "${website}"? Prompt: "${prompt}"` }]);

      console.log('related', response.isRelated);

      return response.isRelated;
    } catch (error) {
      Logger.error('Failed to check relatedness with AI:', error);
      return false;
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
