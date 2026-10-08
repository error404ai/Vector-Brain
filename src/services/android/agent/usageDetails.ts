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

/** Prompt-cache breakpoint: everything up to and including the marked message is cached. */
export const CACHE_BREAKPOINT = {
  openrouter: { cacheControl: { type: 'ephemeral' } },
  anthropic: { cacheControl: { type: 'ephemeral' } },
} as const;
