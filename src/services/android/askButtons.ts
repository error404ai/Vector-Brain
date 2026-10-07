/**
 * A question the chat model wrote as plain text ("Which phones should I do
 * this on?" with a bullet list) instead of calling ask_user. The prompt asks
 * for ask_user, but models don't always follow it, so the server turns such a
 * reply into a question with buttons itself.
 */

export interface AskFromText {
  question: string;
  options: string[];
}

const BULLET = /^\s*(?:[-*•]|\d{1,2}[.)])\s+(.+)$/;
const MAX_OPTIONS = 5;

/** "**All online phones** (21 phones…)" → "All online phones". */
function optionLabel(raw: string): string {
  const plain = raw.replace(/\*\*|__|`/g, '').trim();
  const head = plain.replace(/\s*[(—–:-]\s.*$/, '').replace(/\s+\(.*$/, '').trim();
  const label = head || plain;
  return label.length > 60 ? `${label.slice(0, 57).replace(/\s+\S*$/, '')}…` : label;
}

/** A plain-text question with 2–6 bullet options, read as question + options. Null otherwise. */
export function askFromText(text: string): AskFromText | null {
  if (!text.includes('?')) return null;
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const bullets = lines.map((l) => BULLET.exec(l)?.[1]).filter((b): b is string => Boolean(b));
  if (bullets.length < 2 || bullets.length > 6) return null;
  const options = [...new Set(bullets.map(optionLabel).filter(Boolean))].slice(0, MAX_OPTIONS);
  if (options.length < 2) return null;
  // Only a question that introduces its options: the "?" sits right before
  // one block of bullets, with at most a short closing line after it. A report
  // that lists things and ends with "Want me to retry?" is not turned into buttons.
  const firstBullet = lines.findIndex((l) => BULLET.test(l));
  let lastBullet = -1;
  lines.forEach((l, i) => {
    if (BULLET.test(l)) lastBullet = i;
  });
  if (lines.slice(firstBullet, lastBullet + 1).some((l) => !BULLET.test(l))) return null;
  if (lines.length - 1 - lastBullet > 1) return null;
  const lead = lines.slice(0, firstBullet).map((l) => l.replace(/\*\*/g, '')).join(' ').trim();
  if (!lead.includes('?')) return null;
  return { question: lead, options };
}

/** The reply is asking which phones to use ("Which phones should I…", "kaunse phone…"). */
export function asksForPhones(text: string): boolean {
  // Only the question itself counts, not a status report that names phones.
  const questions = text.split(/(?<=[?.!])\s+|\n/).filter((sentence) => sentence.includes('?')).join(' ');
  return /\b(which|what)\s+(phones?|devices?|lanes?)\b|\bkaun(?:se|si|sa)\s+(phones?|devices?)\b|\bon which (phones?|devices?)\b/i.test(questions);
}

/**
 * Buttons for "which phones": all online phones, each lane, and the phones of
 * the last task when there was one — from the fleet, not from the model.
 */
export function phoneOptions(fleet: { online: number; lanes: { lane: string; online: number }[]; hasLast: boolean }): string[] {
  const options: string[] = [];
  if (fleet.online > 0) options.push(`All online phones (${fleet.online})`);
  for (const l of fleet.lanes) {
    if (l.online > 0 && l.lane !== 'no lane' && l.lane !== 'unknown lane') options.push(`All phones in ${l.lane} (${l.online})`);
  }
  if (fleet.hasLast) options.push('Same phones as the last task');
  return options.slice(0, MAX_OPTIONS);
}
