import envConfig from '@/config/envConfig';
import Logger from '@/logger/index';
import { ChatOpenAI } from '@langchain/openai';
import { Service } from 'typedi';
import * as z from 'zod';
import SettingService from './controllerService/SettingService';
import { AiConfigService } from './controllerService/AiConfigService';

@Service()
export class AiService {
  constructor(
    private settingService: SettingService,
    private aiConfigService: AiConfigService,
  ) {}

  private async getChatModel(userId?: number): Promise<ChatOpenAI | null> {
    const aiConfig = await this.aiConfigService.resolveActiveConfig(userId);
    if (aiConfig) {
      return this.aiConfigService.createChatModel({
        provider: aiConfig.provider,
        model: aiConfig.model,
        api_key: aiConfig.api_key,
        base_url: aiConfig.base_url,
      });
    }

    if (envConfig.embeddingApiKey) {
      return new ChatOpenAI({
        openAIApiKey: envConfig.embeddingApiKey,
        modelName: 'gpt-4o-mini',
      });
    }

    return null;
  }

  async isPromptRelatedToWebsite(prompt: string, website: string, userId?: number): Promise<boolean> {
    const chatModel = await this.getChatModel(userId);
    if (!chatModel) {
      Logger.warn('AI service not configured. Assuming not related.');
      return false;
    }

    try {
      const schema = z.object({ isRelated: z.boolean() });
      const structuredModel = chatModel.withStructuredOutput(schema);

      const response = await structuredModel.invoke([
        {
          role: 'user',
          content: `Determine if the user prompt is related to the website "${website}". The prompt must indicate an intention to perform an action or task on that website, and reference the website (by name, domain, or URL). If the prompt is about doing something on the website, return true; otherwise, false. Prompt: "${prompt}"`,
        },
      ]);

      return response.isRelated;
    } catch (error) {
      Logger.error('Failed to check relatedness with AI:', error);
      return false;
    }
  }

  async enhancePrompt(prompt: string, userId?: number): Promise<string> {
    const chatModel = await this.getChatModel(userId);
    if (!chatModel) {
      throw new Error('No active AI provider configured. Please add and activate an AI provider in Settings.');
    }

    const systemPrompt = (await this.settingService.getSettingValue('systemPromptForEnhancement')) as string;

    const response = await chatModel.invoke([
      { role: 'system', content: systemPrompt || 'You are an AI prompt enhancement assistant.' },
      { role: 'user', content: prompt },
    ]);

    const enhanced = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    return enhanced.trim();
  }
}

