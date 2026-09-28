/** A run of message text: plain, or an @phone / #tag the fleet knows. */
export interface MentionSegment {
  text: string;
  kind: 'plain' | 'phone' | 'tag';
  /** Index of this mention in the message, so a re-render keeps its identity. */
  key: number;
}

export interface MentionVocab {
  phones: string[];
  tags: string[];
}

/** One option in the @ / # menu. */
export interface MentionOption {
  name: string;
  /** Phones sharing this name. */
  count: number;
  online: number;
  /** For a phone: its tag; for a tag: null. */
  tag: string | null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Splits a message into plain text and the @phones / #tags it names. Names
 * may contain spaces ("@motorola moto g(9) power"), so known names are matched
 * whole, longest first, and only where a mention can start (start or after a
 * space) and end (end, space or punctuation).
 */
export function splitMentions(text: string, vocab: MentionVocab): MentionSegment[] {
  const names = [
    ...vocab.phones.map((n) => ({ n, kind: 'phone' as const, t: '@' })),
    ...vocab.tags.map((n) => ({ n, kind: 'tag' as const, t: '#' })),
  ]
    .filter((x) => x.n)
    .sort((a, b) => b.n.length - a.n.length);
  if (!names.length || !/[@#]/.test(text)) return [{ text, kind: 'plain', key: 0 }];

  const pattern = new RegExp(`(^|\\s)(${names.map((x) => escapeRegExp(x.t + x.n)).join('|')})(?=$|[\\s,.!?;:)])`, 'gi');
  const out: MentionSegment[] = [];
  let last = 0;
  let key = 0;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    const start = m.index + m[1].length;
    if (start > last) out.push({ text: text.slice(last, start), kind: 'plain', key: key++ });
    out.push({ text: m[2], kind: m[2][0] === '@' ? 'phone' : 'tag', key: key++ });
    last = start + m[2].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), kind: 'plain', key: key++ });
  return out.length ? out : [{ text, kind: 'plain', key: 0 }];
}

/** The @ / # being typed at the end of the message, if any. Queries may contain spaces. */
export function typedMention(text: string): { trigger: '@' | '#'; query: string; start: number } | null {
  const m = /(^|\s)([@#])([^@#\n]*)$/.exec(text);
  if (!m) return null;
  return { trigger: m[2] as '@' | '#', query: m[3], start: m.index + m[1].length };
}

/** Every option matching the query: prefix matches first, then the rest, A–Z within each. */
export function mentionOptions(
  trigger: '@' | '#',
  query: string,
  devices: { name: string; online: boolean; tag: string | null }[],
): MentionOption[] {
  const q = query.toLowerCase();
  const map = new Map<string, MentionOption>();
  for (const d of devices) {
    const tag = (d.tag ?? '').split(':').pop()?.trim() || null;
    const name = trigger === '@' ? d.name : tag;
    if (!name) continue;
    const entry = map.get(name) ?? { name, count: 0, online: 0, tag: trigger === '@' ? tag : null };
    entry.count += 1;
    if (d.online) entry.online += 1;
    map.set(name, entry);
  }
  const all = [...map.values()].filter((o) => o.name.toLowerCase().includes(q));
  // Hide the menu once the whole name is typed and a space follows.
  if (q.endsWith(' ') && !all.length) return [];
  return all.sort((a, b) => {
    const pa = a.name.toLowerCase().startsWith(q) ? 0 : 1;
    const pb = b.name.toLowerCase().startsWith(q) ? 0 : 1;
    return pa - pb || a.name.localeCompare(b.name);
  });
}
