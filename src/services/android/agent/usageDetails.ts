/**
 * Where a model call's tokens went, as the provider reports them.
 *
 * - cachedTokens: input read from the prompt cache (billed at ~10% on Claude).
 *   OpenRouter counts them inside inputTokens; uncached = input − cached.
 * - cacheWriteTokens: input written to the cache (billed at 1.25× on Claude).
 *   Only Anthropic's own API reports it; OpenRouter does not, so it is null there.
 * - reasoningTokens: hidden thinking, counted inside the output tokens.
 * - costUsd: what the provider billed for the call (OpenRouter reports it when
 *   asked with usage.include), cache discounts and premiums included.
 */
export interface UsageDetails {
  cachedTokens: number;
  cacheWriteTokens: number | null;
  reasoningTokens: number;
  costUsd: number | null;
}

type Usage = { cachedInputTokens?: number; reasoningTokens?: number } | undefined;
type Metadata = Record<string, Record<string, unknown> | undefined> | undefined;

const num = (value: unknown): number | null => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

export function usageDetails(usage: Usage, providerMetadata: Metadata): UsageDetails {
  const openrouter = providerMetadata?.openrouter as { usage?: { cost?: unknown; promptTokensDetails?: { cachedTokens?: unknown } } } | undefined;
  const anthropic = providerMetadata?.anthropic as { cacheCreationInputTokens?: unknown; usage?: { cache_creation_input_tokens?: unknown } } | undefined;
  return {
    cachedTokens: num(usage?.cachedInputTokens) ?? num(openrouter?.usage?.promptTokensDetails?.cachedTokens) ?? 0,
    cacheWriteTokens: num(anthropic?.cacheCreationInputTokens) ?? num(anthropic?.usage?.cache_creation_input_tokens),
    reasoningTokens: num(usage?.reasoningTokens) ?? 0,
    costUsd: num(openrouter?.usage?.cost),
  };
}

/** Ask OpenRouter to return the call's cost; other providers ignore this key. */
export const USAGE_REPORT_OPTIONS = { openrouter: { usage: { include: true } } } as const;

/**
 * Lite: also ask for no hidden reasoning. On Claude, OpenRouter maps
 * reasoning.enabled=false to thinking disabled (effort "none" is rejected there).
 * A model that refuses it is retried without it (see isReasoningRejected).
 */
export const NO_REASONING_OPTIONS = { openrouter: { usage: { include: true }, reasoning: { enabled: false } } } as const;

/** The provider refused the reasoning setting (a model whose reasoning cannot be turned off). */
export function isReasoningRejected(error: unknown): boolean {
  const e = error as { statusCode?: number; status?: number; message?: string; responseBody?: string };
  const status = Number(e?.statusCode ?? e?.status);
  return status === 400 && /reason|thinking/i.test(`${e?.message ?? ''} ${e?.responseBody ?? ''}`);
}

/** Prompt-cache breakpoint: everything up to and including the marked message is cached. */
export const CACHE_BREAKPOINT = {
  openrouter: { cacheControl: { type: 'ephemeral' } },
  anthropic: { cacheControl: { type: 'ephemeral' } },
} as const;

/**
 * A call's cost from the model's list price, for providers that do not bill per
 * call in the response (OpenAI, Anthropic, Google, DeepSeek, Groq, custom).
 * Anthropic's own API counts input without the cached part; the others count
 * cached tokens inside input. Missing cache prices fall back to the input price.
 */
export function costFromPrice(
  price: { input: number; output: number; cacheRead: number | null; cacheWrite: number | null },
  provider: string,
  usage: { inputTokens: number; outputTokens: number; cachedTokens: number; cacheWriteTokens: number | null },
): number {
  const read = Math.max(0, usage.cachedTokens);
  const write = Math.max(0, usage.cacheWriteTokens ?? 0);
  const plain = String(provider).toLowerCase() === 'anthropic' ? Math.max(0, usage.inputTokens) : Math.max(0, usage.inputTokens - read - write);
  return plain * price.input + read * (price.cacheRead ?? price.input) + write * (price.cacheWrite ?? price.input) + Math.max(0, usage.outputTokens) * price.output;
}
