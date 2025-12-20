import envConfig from '@/config/envConfig';
import Logger from '@/logger/index';
import { ChatOpenAI } from '@langchain/openai';
import { Service } from 'typedi';

@Service()
export class AiService {
  private chatModel: ChatOpenAI | null = null;

  constructor() {
    if (envConfig.embeddingApiKey) {
      this.chatModel = new ChatOpenAI({
        openAIApiKey: envConfig.embeddingApiKey,
        modelName: 'gpt-4o-mini',
        temperature: 0.7,
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
      const systemPrompt = 'You are a helpful assistant. Answer with only "yes" or "no".';
      const userPrompt = `Is the following user prompt related to the website "${website}"? Prompt: "${prompt}". Answer with yes or no.`;

      const response = await this.chatModel.invoke([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ]);

      const answer = (response.content as string).trim().toLowerCase();
      return answer === 'yes';
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
