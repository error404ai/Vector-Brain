import envConfig from '@/config/envConfig';
import Logger from '@/logger/index';
import { ChatOpenAI } from '@langchain/openai';
import { Service } from 'typedi';
import * as z from 'zod';
import SettingService from './controllerService/SettingService';
import { AiConfigService } from './controllerService/AiConfigService';

/**
 * Used when no enhancer prompt has been saved in Settings. The generic fallback
 * that used to sit here produced flowery rewrites the agent then struggled to
 * execute, so the default now encodes what this agent can actually do.
 */
const DEFAULT_ENHANCER_SYSTEM_PROMPT = `Rewrite the user's request as a clear, concrete Android task.

This agent drives a real phone through the accessibility service. It taps by
coordinate, types into focused fields, scrolls, opens apps and opens URLs. It
CANNOT press Enter or a keyboard search key.

- Keep it SHORT and specific. Name the app and say when the task is done.
- For searches, use a direct URL rather than a search box:
  YouTube -> https://www.youtube.com/results?search_query=<query>
  Google  -> https://www.google.com/search?q=<query>
- Say "tap the first result" rather than describing how to judge results.
- Turn time-based wording into something countable: the agent counts steps, not
  minutes.
- Preserve every name, URL, number and quoted string exactly, and never invent
  details the user did not give.

Output ONLY the rewritten instruction, with no preamble or quotes.`;

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

  /**
   * Checks whether an Android task prompt is concrete enough to run. Vague prompts
   * ("open 30 random websites") make the agent burn its whole step budget deciding
   * what to do, so it is far cheaper to ask one question up front.
   */
  async clarifyAndroidPrompt(
    prompt: string,
    userId?: number,
  ): Promise<{ needsClarification: boolean; question?: string; options?: string[] }> {
    const chatModel = await this.getChatModel(userId);
    if (!chatModel) return { needsClarification: false };

    const systemPrompt = [
      'You review short instructions that will be executed by an agent controlling a real Android phone.',
      'Decide whether the instruction is concrete enough to execute without guessing.',
      'It is concrete when the app, the target and the desired end state are clear.',
      'It is vague when it leaves a choice open that changes what the agent does — an unspecified list,',
      '"random"/"any"/"some" items, or a missing target.',
      'Be conservative: most instructions are fine and should pass through untouched.',
      'Reply with ONLY minified JSON, no prose and no code fences:',
      '{"needsClarification":boolean,"question":string,"options":string[]}',
      'question: one short question (max 15 words). options: 2-4 short pickable answers (max 5 words each).',
      'When it is concrete, reply {"needsClarification":false}.',
    ].join(' ');

    try {
      const response = await chatModel.invoke([
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt },
      ]);

      const raw = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) return { needsClarification: false };

      const parsed = JSON.parse(match[0]) as {
        needsClarification?: boolean;
        question?: string;
        options?: string[];
      };

      if (!parsed.needsClarification || !parsed.question) return { needsClarification: false };

      return {
        needsClarification: true,
        question: String(parsed.question).slice(0, 160),
        options: Array.isArray(parsed.options) ? parsed.options.slice(0, 4).map((o) => String(o).slice(0, 60)) : [],
      };
    } catch (error) {
      // Clarification is an optimisation; never block a run because it failed.
      Logger.warn('Failed to clarify prompt with AI:', error);
      return { needsClarification: false };
    }
  }

  async enhancePrompt(prompt: string, userId?: number): Promise<string> {
    const chatModel = await this.getChatModel(userId);
    if (!chatModel) {
      throw new Error('No active AI provider configured. Please add and activate an AI provider in Settings.');
    }

    const systemPrompt = (await this.settingService.getSettingValue('systemPromptForEnhancement')) as string;

    const response = await chatModel.invoke([
      { role: 'system', content: systemPrompt || DEFAULT_ENHANCER_SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ]);

    const enhanced = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
    return enhanced.trim();
  }
}
