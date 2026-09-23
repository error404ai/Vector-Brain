/**
 * Keeps the agent's context from growing by a whole screen every step.
 *
 * Almost every tool result carries a full dump of the screen ("UPDATED SCREEN
 * ELEMENTS" / "VISIBLE UI ELEMENTS"). Only the newest one describes the phone
 * as it is now; older dumps are stale and were being re-sent on every call.
 * Eko's own trimming only touches multi-part results, and ours are plain text,
 * so a 30-step run was sending ~100k input tokens per step for a simple task.
 *
 * This removes every screen dump except the newest, leaving the rest of each
 * result (what the action did, any NOTE) so the model still sees its history.
 */
const SCREEN_DUMP = /(?:^|\n\n)(?:UPDATED SCREEN ELEMENTS:|VISIBLE UI ELEMENTS \([^\n]*\):)\n[\s\S]*?(?=\n\nNOTE:|$)/;
const STALE = '\n\n(older screen omitted — only the latest screen is current)';

type TextPart = { type: string; text?: string };
type ToolOutput = { type: string; value: unknown };
type Message = { role: string; content: unknown };

export function pruneStaleScreens(messages: Message[]): void {
  let keptLatest = false;
  // Newest first, so the first dump found is the one that stays.
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== 'tool' || !Array.isArray(message.content)) continue;
    for (const part of message.content as { output?: ToolOutput }[]) {
      const output = part?.output;
      if (!output) continue;
      if ((output.type === 'text' || output.type === 'error-text') && typeof output.value === 'string') {
        if (!SCREEN_DUMP.test(output.value)) continue;
        if (!keptLatest) keptLatest = true;
        else output.value = output.value.replace(SCREEN_DUMP, STALE);
      } else if (output.type === 'content' && Array.isArray(output.value)) {
        for (const piece of output.value as TextPart[]) {
          if (piece?.type !== 'text' || typeof piece.text !== 'string' || !SCREEN_DUMP.test(piece.text)) continue;
          if (!keptLatest) keptLatest = true;
          else piece.text = piece.text.replace(SCREEN_DUMP, STALE);
        }
      }
    }
  }
}
