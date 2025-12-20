import envConfig from '@/config/envConfig';
import Logger from '@/logger/index';
import { Service } from 'typedi';

@Service()
export class AiService {
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.apiKey = envConfig.embeddingApiKey || '';
    this.baseUrl = envConfig.embeddingBaseUrl || 'https://api.openai.com/v1';
  }

  async isPromptRelatedToWebsite(prompt: string, website: string): Promise<boolean> {
    if (!this.apiKey) {
      Logger.warn('No AI API key configured. Assuming not related.');
      return false;
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo', // or from config
          messages: [
            {
              role: 'system',
              content: 'You are a helpful assistant. Answer with only "yes" or "no".',
            },
            {
              role: 'user',
              content: `Is the following user prompt related to the website "${website}"? Prompt: "${prompt}". Answer with yes or no.`,
            },
          ],
          max_tokens: 10,
        }),
      });

      if (!response.ok) {
        throw new Error(`AI API error: ${response.statusText}`);
      }

      const data = await response.json();
      const answer = data.choices[0]?.message?.content?.trim().toLowerCase();
      return answer === 'yes';
    } catch (error) {
      Logger.error('Failed to check relatedness with AI:', error);
      return false;
    }
  }
}
