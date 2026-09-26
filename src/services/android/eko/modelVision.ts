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

let catalog: Map<string, boolean> | null = null;
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
    const json = (await res.json()) as { data?: { id?: string; architecture?: { input_modalities?: string[]; modality?: string } }[] };
    const next = new Map<string, boolean>();
    for (const model of json.data ?? []) {
      if (!model.id) continue;
      const inputs = model.architecture?.input_modalities;
      const sees = Array.isArray(inputs) ? inputs.includes('image') : /image/.test(String(model.architecture?.modality ?? '').split('->')[0]);
      next.set(model.id.toLowerCase(), sees);
    }
    if (next.size === 0) throw new Error('empty catalog');
    catalog = next;
    catalogAt = Date.now();
  } catch (error) {
    catalogFailedAt = Date.now();
    Logger.warn(`[ModelVision] OpenRouter catalog unavailable, falling back to model names: ${String((error as Error)?.message ?? error)}`);
  } finally {
    clearTimeout(timer);
  }
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
      const fresh = catalog && Date.now() - catalogAt < CATALOG_TTL_MS;
      const mayRetry = Date.now() - catalogFailedAt > CATALOG_RETRY_MS;
      if (!fresh && mayRetry) {
        loading ??= loadCatalog().finally(() => {
          loading = null;
        });
        await loading;
      }
      const known = catalog?.get(id);
      return known ?? visionFromName(id);
    }
    default:
      return visionFromName(id);
  }
}
