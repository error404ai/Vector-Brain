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

/** The system's own "[record: …]" notes; a model that copies them has invented a record. */
const RECORD_LINE = /\s*\[record:[^\]\n]*\]/gi;

/** Removes any "[record: …]" note from text shown to the user or kept as history. */
export function stripRecords(text: string): string {
  return String(text ?? '').replace(RECORD_LINE, '').trim();
}

/**
 * A reply that says a task was just started — the mission template ('Running
 * "Install X" on both phones'), or a copied "[record: … started mission …]".
 * Only a mission or proposal created in the same turn makes this true; a
 * status tool (fleet_status) does not, which is how the model used to slip a
 * made-up start past the guard.
 */
export function claimsStart(text: string): boolean {
  const t = String(text ?? '');
  return /\[record:[^\]]*started mission/i.test(t) || /(^|[.!\n]\s*)running\s+["“'][^"”'\n]{2,}["”']\s+on\b/i.test(t);
}

/** An earlier mission a reply really started, as the model is shown it. */
export interface HistoryMission {
  id: number;
  instruction: string;
  phones: string;
}

/** An earlier chat message as the model sees it. */
export interface HistoryEntry {
  role: 'user' | 'assistant';
  text: string;
  /** Set when this reply really started a mission: shown as the run_mission call it was. */
  mission?: HistoryMission;
}

/**
 * An earlier message, made into something safe to learn from.
 *
 * Replies used to be replayed as plain text with a "[record: …]" note, so every
 * example the model saw of "running a task" was a line of text, never a tool
 * call; after a few of those, models (DeepSeek and Qwen alike) answered new
 * tasks with text and invented the record line too. Now a reply that started a
 * mission is replayed as the run_mission call plus its result, and a reply that
 * claimed a task without starting one is replaced by what really happened.
 */
export function historyEntry(row: { role: string; text: string; mission_id?: number | null; reply?: string | null }): HistoryEntry {
  const text = stripRecords(String(row.text ?? '')).slice(0, 600);
  if (row.role !== 'assistant') return { role: 'user', text };
  if (row.mission_id) {
    let instruction = '';
    let phones = '';
    try {
      const reply = JSON.parse(row.reply ?? 'null') as { mission?: { prompt?: string | null; request?: string; items?: { device_name?: string }[] } } | null;
      instruction = reply?.mission?.prompt ?? reply?.mission?.request ?? '';
      phones = (reply?.mission?.items ?? []).map((i) => i.device_name).filter(Boolean).join(', ');
    } catch {
      // An unreadable stored reply still counts as the mission it started.
    }
    return { role: 'assistant', text, mission: { id: row.mission_id, instruction: instruction || text.slice(0, 200), phones: phones || 'last' } };
  }
  if (claimsStart(row.text) || claimsActivity(text)) {
    return { role: 'assistant', text: 'Nothing was started by this reply — no tool was called, so no task ran.' };
  }
  return { role: 'assistant', text };
}

/** Plain-text form of an entry (the dry-run eval and old callers). */
export function historyText(row: { role: string; text: string; mission_id?: number | null; reply?: string | null }): string {
  const entry = historyEntry(row);
  return entry.mission ? `${entry.text}\n(started mission #${entry.mission.id} via run_mission)` : entry.text;
}
