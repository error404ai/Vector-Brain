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
