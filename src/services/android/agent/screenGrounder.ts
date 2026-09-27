import Logger from '@/logger/index';
import { generateText, type LanguageModel } from 'ai';
import type { ScreenGrounder, SeenElement } from '../eko/AndroidAgent';

/**
 * A small vision model that reads a screenshot for a text-only agent model.
 *
 * Used only on screens the element list does not describe (web views, canvas
 * UIs, rows of unlabelled buttons). It returns what a user could tap, with
 * centres on the same 0–1000 grid the agent uses, and the agent sees them as
 * rows v1, v2… it can tap by idx — instead of guessing coordinates.
 */
const PROMPT = `This is a screenshot of an Android phone screen.
List the things a user could tap or type into: buttons, links, tabs, text fields, list items, checkboxes, switches, dialog buttons, and any short text that names what a nearby control does.
For each give:
- "label": its visible text (or a 2-4 word description if it has no text, e.g. "search icon", "back arrow")
- "kind": one of button, link, field, tab, item, checkbox, switch, icon, text
- "x", "y": the CENTRE of it on a 0-1000 grid over the whole screenshot (x across, y down; 0,0 is the top-left corner, 1000,1000 the bottom-right)
Reply with a JSON array only, top to bottom, at most 30 entries. Example:
[{"label":"Install","kind":"button","x":870,"y":502},{"label":"Search apps & games","kind":"field","x":450,"y":85}]`;

export function parseSeen(text: string): SeenElement[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  try {
    const raw = JSON.parse(text.slice(start, end + 1)) as unknown[];
    return raw
      .map((r) => r as { label?: unknown; kind?: unknown; x?: unknown; y?: unknown })
      .filter((r) => typeof r.x === 'number' && typeof r.y === 'number' && r.x >= 0 && r.x <= 1000 && r.y >= 0 && r.y <= 1000 && String(r.label ?? '').trim())
      .slice(0, 30)
      .map((r) => ({ label: String(r.label).trim(), kind: typeof r.kind === 'string' ? r.kind : undefined, x: Number(r.x), y: Number(r.y) }));
  } catch {
    return [];
  }
}

export function createScreenGrounder(
  model: LanguageModel,
  onUsage?: (usage: { inputTokens: number; outputTokens: number }) => void,
): ScreenGrounder {
  return async (screenshotBase64: string) => {
    const started = Date.now();
    const { text, usage } = await generateText({
      model,
      temperature: 0,
      maxOutputTokens: 1200,
      maxRetries: 1,
      abortSignal: AbortSignal.timeout(25_000),
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: PROMPT },
            { type: 'image', image: screenshotBase64, mediaType: 'image/jpeg' },
          ],
        },
      ],
    });
    onUsage?.({ inputTokens: usage?.inputTokens ?? 0, outputTokens: usage?.outputTokens ?? 0 });
    const seen = parseSeen(text);
    Logger.info(`[ScreenGrounder] ${seen.length} elements in ${Date.now() - started}ms`);
    return seen;
  };
}
