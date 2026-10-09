import Logger from '@/logger/index';

/**
 * Whether a model can actually look at a screenshot.
 *
 * This decides if the agent is offered screenshots at all. Sending one to a
 * text-only model is pure cost: OpenRouter's text models received each capture
 * as ~80k tokens of base64 and could not read it (see the Step-0 diagnostics).
 *
 * AiConfig.config_type cannot answer this — it defaults to 'vision' for every
 * config — so OpenRouter models are looked up in its public catalog and other
 * providers go by model family. Unknown means no: a blind model loses nothing
 * it had, while a wrong yes costs tens of thousands of tokens per step.
 */

const CATALOG_URL = 'https://openrouter.ai/api/v1/models';
const CATALOG_TTL_MS = 6 * 60 * 60 * 1000;
const CATALOG_RETRY_MS = 10 * 60 * 1000;
const CATALOG_TIMEOUT_MS = 4000;

/** USD per token, as OpenRouter's catalog lists it. */
export interface ModelPrice {
  input: number;
  output: number;
  cacheRead: number | null;
  cacheWrite: number | null;
}

let catalog: Map<string, boolean> | null = null;
/** Every catalog model's price, keyed by id ("anthropic/claude-haiku-5.5") and by its normalised name. */
let prices: Map<string, ModelPrice> | null = null;
let catalogAt = 0;
let catalogFailedAt = 0;
let loading: Promise<void> | null = null;

/** Families known to take image input. Used when the catalog cannot answer. */
const VISION_NAME = /(gpt-4o|gpt-4\.1|gpt-5|\bo3\b|\bo4|claude|gemini|gemma-3|pixtral|llava|qwen[\w.-]*vl|[-_/]vl\b|vl-|vision|llama-4|scout|maverick|grok-(?:2-vision|4)|v4\.1-flash)/i;

async function loadCatalog(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CATALOG_TIMEOUT_MS);
  try {
    const res = await fetch(CATALOG_URL, { signal: controller.signal });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const json = (await res.json()) as {
      data?: {
        id?: string;
        architecture?: { input_modalities?: string[]; modality?: string };
        pricing?: { prompt?: string; completion?: string; input_cache_read?: string; input_cache_write?: string };
      }[];
    };
    const next = new Map<string, boolean>();
    const nextPrices = new Map<string, ModelPrice>();
    for (const model of json.data ?? []) {
      if (!model.id) continue;
      const inputs = model.architecture?.input_modalities;
      const sees = Array.isArray(inputs) ? inputs.includes('image') : /image/.test(String(model.architecture?.modality ?? '').split('->')[0]);
      const id = model.id.toLowerCase();
      next.set(id, sees);
      const price = parsePrice(model.pricing);
      if (price) {
        nextPrices.set(id, price);
        // A provider's own name for it ("claude-haiku-5-5", "gpt-4o-mini-2024-07-18") finds it too.
        // Not from a tagged variant (":free" costs nothing, ":nitro" more): the plain listing sets the price.
        const key = normaliseModel(id);
        if (!id.includes(':') && !nextPrices.has(key)) nextPrices.set(key, price);
      }
    }
    if (next.size === 0) throw new Error('empty catalog');
    catalog = next;
    prices = nextPrices;
    catalogAt = Date.now();
  } catch (error) {
    catalogFailedAt = Date.now();
    Logger.warn(`[ModelVision] OpenRouter catalog unavailable, falling back to model names: ${String((error as Error)?.message ?? error)}`);
  } finally {
    clearTimeout(timer);
  }
}

const perToken = (value: unknown): number | null => {
  const n = Number(value);
  return value != null && value !== '' && Number.isFinite(n) && n >= 0 ? n : null;
};

function parsePrice(pricing?: { prompt?: string; completion?: string; input_cache_read?: string; input_cache_write?: string }): ModelPrice | null {
  const input = perToken(pricing?.prompt);
  const output = perToken(pricing?.completion);
  // "-1" marks a router whose price depends on the model it picks: no fixed price.
  if (input === null || output === null) return null;
  return { input, output, cacheRead: perToken(pricing?.input_cache_read), cacheWrite: perToken(pricing?.input_cache_write) };
}

/**
 * One spelling for a model across providers: no vendor prefix, no ":free"-style
 * tag, no date or "-latest", dots as dashes. "anthropic/claude-3.5-sonnet" and
 * Anthropic's "claude-3-5-sonnet-20241022" both become "claude-3-5-sonnet".
 */
export function normaliseModel(model: string): string {
  return String(model ?? '')
    .toLowerCase()
    .trim()
    .replace(/^.*\//, '')
    .replace(/:[\w-]+$/, '')
    .replace(/-(?:\d{8}|\d{4}-\d{2}-\d{2}|\d{4})$/, '')
    .replace(/-latest$/, '')
    .replace(/\./g, '-');
}

async function ensureCatalog(): Promise<void> {
  const fresh = catalog && Date.now() - catalogAt < CATALOG_TTL_MS;
  const mayRetry = Date.now() - catalogFailedAt > CATALOG_RETRY_MS;
  if (!fresh && mayRetry) {
    loading ??= loadCatalog().finally(() => {
      loading = null;
    });
    await loading;
  }
}

/**
 * What a model costs per token, for any provider: OpenRouter ids are looked up
 * as they are, other providers' names by their normalised form (OpenRouter
 * lists the big vendors at the vendor's own price). Null when the catalog has
 * no such model or cannot be reached: the price is unknown, not zero.
 */
export async function modelPrice(provider: string, model: string): Promise<ModelPrice | null> {
  const id = String(model ?? '').trim().toLowerCase();
  if (!id) return null;
  await ensureCatalog();
  if (!prices) return null;
  if (String(provider).toLowerCase() === 'openrouter' && prices.has(id)) return prices.get(id)!;
  return prices.get(id) ?? prices.get(normaliseModel(id)) ?? null;
}

/** Tests: set the catalog directly. */
export function setCatalogForTests(models: { id: string; sees?: boolean; pricing?: { prompt?: string; completion?: string; input_cache_read?: string; input_cache_write?: string } }[] | null): void {
  if (!models) {
    catalog = null;
    prices = null;
    catalogAt = 0;
    return;
  }
  catalog = new Map(models.map((m) => [m.id.toLowerCase(), Boolean(m.sees)]));
  prices = new Map();
  for (const m of models) {
    const price = parsePrice(m.pricing);
    if (!price) continue;
    prices.set(m.id.toLowerCase(), price);
    const key = normaliseModel(m.id);
    if (!m.id.includes(':') && !prices.has(key)) prices.set(key, price);
  }
  catalogAt = Date.now();
}

export function visionFromName(model: string): boolean {
  return VISION_NAME.test(model);
}

export async function modelSeesImages(provider: string, model: string): Promise<boolean> {
  const id = String(model ?? '').trim().toLowerCase();
  if (!id) return false;
  switch (String(provider).toLowerCase()) {
    case 'anthropic':
    case 'google':
      // Every current Claude and Gemini model takes images.
      return true;
    case 'openrouter': {
      await ensureCatalog();
      const known = catalog?.get(id);
      return known ?? visionFromName(id);
    }
    default:
      return visionFromName(id);
  }
}
