/**
 * Honest, experience-based metadata about models we have actually run agent
 * tasks on. Shown as chips in Settings and the Agent page model picker so
 * users do not have to discover these quirks the expensive way.
 *
 * Matching is substring-based on the model id, so it covers both paid and
 * ":free" variants of the same family.
 */

export type ModelTag = 'recommended' | 'caution';

export interface ModelMeta {
  tag: ModelTag;
  /** Short honest note, shown as tooltip / helper text. */
  note: string;
}

interface MetaRule {
  patterns: string[];
  meta: ModelMeta;
}

const RULES: MetaRule[] = [
  {
    patterns: ['deepseek-v4-flash'],
    meta: {
      tag: 'recommended',
      note: 'Most reliable in our testing for multi-step Android tasks.',
    },
  },
  {
    patterns: ['dots-3-note'],
    meta: {
      tag: 'caution',
      note: 'Tends to repeat itself on long tasks. Fine for short, simple ones.',
    },
  },
];

export function isFreeModel(model: string): boolean {
  return model.toLowerCase().includes(':free');
}

export function getModelMeta(model: string | null | undefined): ModelMeta | null {
  if (!model) return null;
  const haystack = model.toLowerCase();
  for (const rule of RULES) {
    if (rule.patterns.some((pattern) => haystack.includes(pattern))) {
      return rule.meta;
    }
  }
  return null;
}

/**
 * Display order: recommended models first, then free models (cheap to try),
 * then everything else. Stable within each group.
 */
export function sortModelsForDisplay<T extends { model: string }>(items: T[]): T[] {
  const rank = (item: T): number => {
    if (getModelMeta(item.model)?.tag === 'recommended') return 0;
    if (isFreeModel(item.model)) return 1;
    return 2;
  };
  return [...items].sort((a, b) => rank(a) - rank(b));
}

/**
 * A readable name for a model id.
 *
 * Ids like "deepseek/deepseek-v4-flash-0731" are hard to scan in a list, so the
 * provider prefix, the ":free" suffix and trailing date stamps are dropped and
 * the rest is title-cased. The raw id is still shown underneath in the picker.
 */
const BRAND_CASING: Record<string, string> = {
  deepseek: 'DeepSeek',
  gemini: 'Gemini',
  gpt: 'GPT',
  qwen: 'Qwen',
  nemotron: 'Nemotron',
  minimax: 'MiniMax',
  claude: 'Claude',
  dots: 'Dots',
};

export function modelDisplayName(model: string | null | undefined): string {
  if (!model) return 'Unknown model';

  let name = model.split('/').pop() ?? model;
  name = name.replace(/:free$/i, '');
  // Trailing build or date stamps: -0731, -20251001, -latest, -preview
  name = name.replace(/-(\d{4,8}|latest|preview)$/i, '');
  name = name.replace(/^~/, '');

  // Split on dashes and underscores only — dots carry version numbers (2.5),
  // and breaking those apart reads worse than leaving them alone.
  return name
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => {
      if (/^v\d/i.test(part)) return part.toUpperCase();
      if (/^\d/.test(part)) return part;
      const branded = BRAND_CASING[part.toLowerCase()];
      if (branded) return branded;
      if (part.length <= 2) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ');
}

/** Brand-ish colour per provider, used for the small square in the picker. */
export function providerAccent(provider: string | null | undefined): string {
  switch ((provider ?? '').toLowerCase()) {
    case 'openai':
      return '#10a37f';
    case 'google':
      return '#4285f4';
    case 'anthropic':
      return '#d97706';
    case 'deepseek':
      return '#4f46e5';
    case 'groq':
      return '#f97316';
    case 'openrouter':
      return '#8b5cf6';
    default:
      return '#6b7280';
  }
}
