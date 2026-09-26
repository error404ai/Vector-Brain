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
export const SCREEN_DUMP = /(?:^|\n\n)(?:UPDATED SCREEN ELEMENTS:|VISIBLE UI ELEMENTS \([^\n]*\):)\n[\s\S]*?(?=\n\nNOTE:|$)/;
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

type FilePart = { type: string; mediaType?: string; data?: unknown; text?: string };

/**
 * Screenshots reach the model once, as a real image, and never as text.
 *
 * With Eko's toolResultMultimodal off, a captured screenshot arrives as a user
 * message with an image file part right after the step's tool result. This
 * keeps only the newest one, and only while it belongs to the latest step (it
 * sits after the last assistant turn); every older screenshot becomes a short
 * note. Any image still inside a tool result is always removed, because
 * OpenRouter and OpenAI-compatible APIs serialise those as base64 text —
 * ~80k tokens per screenshot, re-sent on every call.
 *
 * `vision` false removes every image: a text-only model cannot use one.
 */
export function keepOnlyFreshImage(messages: Message[], vision: boolean): { kept: number; removed: number } {
  let lastAssistant = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === 'assistant') {
      lastAssistant = i;
      break;
    }
  }
  let kept = 0;
  let removed = 0;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!Array.isArray(message.content)) continue;
    if (message.role === 'user') {
      const parts = message.content as FilePart[];
      for (let j = 0; j < parts.length; j += 1) {
        const part = parts[j];
        if (part?.type !== 'file' || !String(part.mediaType ?? '').startsWith('image/')) continue;
        if (vision && kept === 0 && i > lastAssistant) {
          kept += 1;
          continue;
        }
        parts[j] = { type: 'text', text: '[older screenshot removed — the element list is current]' };
        removed += 1;
      }
    } else if (message.role === 'tool') {
      for (const result of message.content as { output?: ToolOutput }[]) {
        const output = result?.output;
        if (!output || output.type !== 'content' || !Array.isArray(output.value)) continue;
        const pieces = output.value as FilePart[];
        for (let j = 0; j < pieces.length; j += 1) {
          if (pieces[j]?.type !== 'media') continue;
          pieces[j] = { type: 'text', text: '[screenshot not sent inside a tool result]' };
          removed += 1;
        }
      }
    }
  }
  return { kept, removed };
}
