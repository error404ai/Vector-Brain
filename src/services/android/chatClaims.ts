/**
 * Keeping the chat honest about tasks: what counts as a claim that a task
 * started or runs, and how earlier replies are shown to the model. Pure, so
 * it can be tested without the database.
 */

/**
 * A reply that says a task started, is running or will be reported on. Only a
 * tool result may say that: the model copies "Started — …" from earlier
 * replies and tells the user a task is running that was never created.
 */
export const CLAIMS_ACTIVITY =
  /(^|[.!\n]\s*)(started|starting)\b|\b(has|have|was|were|is|are|just|already|i'?ve|i have) (been )?started\b|\bstarting (it|the|now|on)\b|\b(is|are|still|currently|now) (running|installing)\b|\brunning (now|on)\b|\b(installing|launching) \S+ (on|from)\b|\bon it\b|\b(i'?ll|i will|will) report\b|\breport once\b|\b(chal raha|chal rahi|chal rahe|chalu (?:kar|ho)|shuru (?:kar|ho)|kar raha hu|kar rahi hu|install ho raha)/i;

/** True when some sentence claims activity without negating it ("No task is running" is not a claim). */
export function claimsActivity(text: string): boolean {
  return String(text ?? '')
    .split(/(?<=[.!?\n])\s+|\s+—\s+/)
    .some((sentence) => CLAIMS_ACTIVITY.test(sentence) && !/\b(no|not|nothing|none|isn'?t|aren'?t|wasn'?t|weren'?t|nahi|nahin)\b/i.test(sentence));
}

/** An earlier chat message as the model sees it, with the system's record of what it actually did. */
export function historyText(row: { role: string; text: string; mission_id?: number | null }): string {
  const text = String(row.text ?? '').slice(0, 600);
  if (row.role !== 'assistant') return text;
  if (row.mission_id) return `${text}\n[record: this reply started mission #${row.mission_id}]`;
  if (claimsActivity(text)) return `${text}\n[record: this reply did NOT start any task — nothing ran]`;
  return text;
}
