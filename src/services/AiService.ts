import envConfig from '@/config/envConfig';
import Logger from '@/logger/index';
import { ChatOpenAI } from '@langchain/openai';
import { Service } from 'typedi';
import * as z from 'zod';
import SettingService from './controllerService/SettingService';

@Service()
export class AiService {
  private chatModel: ChatOpenAI | null = null;

  constructor(private settingService: SettingService) {
    if (envConfig.embeddingApiKey) {
      this.chatModel = new ChatOpenAI({
        openAIApiKey: envConfig.embeddingApiKey,
        modelName: 'gpt-4o-mini',
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

      const response = await structuredModel.invoke([{ role: 'user', content: `Determine if the user prompt is related to the website "${website}". The prompt must: 1) Explicitly include the website "${website}". 2) Indicate an intention to perform an action or task on that website. If both conditions are met, return true; otherwise, return false. Prompt: "${prompt}"` }]);

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

    const systemPrompt = (await this.settingService.getSettingValue('systemPromptForEnhancement')) as string;

    const response = await this.chatModel.invoke([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: prompt },
    ]);

    const enhanced = response.content as string;
    return enhanced.trim();
  }
}
