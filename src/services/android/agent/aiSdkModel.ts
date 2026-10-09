import { AiProvider } from '@/entities/AiConfig';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { LanguageModel } from 'ai';
import { withRateLimitRetry } from '@/services/ai/rateLimitFetch';

export interface ModelConfig {
  provider: AiProvider | string;
  model: string;
  apiKey: string;
  /** Already resolved: the config's own base URL or the provider default. */
  baseURL?: string;
}

/**
 * The same provider wiring Eko uses (see Eko's LLM factory), so switching
 * engines does not also switch how requests reach the provider.
 */
export function createLanguageModel(config: ModelConfig): LanguageModel {
  const { model, apiKey } = config;
  const baseURL = config.baseURL?.trim() || undefined;
  // Short rate limits are waited out at the HTTP level (see rateLimitFetch).
  const fetch = withRateLimitRetry();
  switch (config.provider) {
    case AiProvider.ANTHROPIC:
      return createAnthropic({ apiKey, baseURL, fetch }).languageModel(model);
    case AiProvider.GOOGLE:
      return createGoogleGenerativeAI({ apiKey, baseURL, fetch }).languageModel(model);
    case AiProvider.OPENROUTER:
      return createOpenRouter({ apiKey, baseURL: baseURL || 'https://openrouter.ai/api/v1', fetch: withSystemCacheParts(fetch) }).languageModel(model);
    case AiProvider.DEEPSEEK:
    case AiProvider.GROQ:
    case AiProvider.CUSTOM:
      return createOpenAICompatible({ name: model.split('/')[0] || 'custom', apiKey, baseURL: baseURL || 'https://openrouter.ai/api/v1', fetch }).languageModel(model);
    case AiProvider.OPENAI:
    default:
      // Eko uses the OpenAI client only for api.openai.com; any other host is
      // treated as OpenAI-compatible.
      if (!baseURL || baseURL.includes('openai.com')) return createOpenAI({ apiKey, baseURL, fetch }).languageModel(model);
      return createOpenAICompatible({ name: model, apiKey, baseURL, fetch }).languageModel(model);
  }
}

/**
 * The OpenRouter provider puts a system message's cache mark on the message
 * ({role, content: "text", cache_control}). OpenRouter documents it on a text
 * part instead ({role, content: [{type: "text", text, cache_control}]}), so the
 * mark is moved there before the request leaves. Nothing else in the body changes.
 */
export function moveSystemCacheMark(body: string): string {
  let json: { messages?: { role?: string; content?: unknown; cache_control?: unknown }[] };
  try {
    json = JSON.parse(body);
  } catch {
    return body;
  }
  let changed = false;
  for (const m of json.messages ?? []) {
    if (m.role === 'system' && typeof m.content === 'string' && m.cache_control) {
      m.content = [{ type: 'text', text: m.content, cache_control: m.cache_control }];
      delete m.cache_control;
      changed = true;
    }
  }
  return changed ? JSON.stringify(json) : body;
}

function withSystemCacheParts(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return (input, init) =>
    fetch(input, init && typeof init.body === 'string' ? { ...init, body: moveSystemCacheMark(init.body) } : init);
}
