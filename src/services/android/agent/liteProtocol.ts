/**
 * The Lite engine's wire format: a short text prompt in, one line out.
 *
 * Vector and Eko send every tool's JSON schema (~3.5k tokens), the full system
 * prompt (~1k+), the step history and often a screenshot with every call. For
 * a simple step none of that is needed: the model only has to pick the next
 * action from the current screen. Lite sends the task, a one-line-per-step
 * history, the last result and the screen rows without coordinates, and the
 * model answers with one short command that code turns into the same agent
 * tools. A typical call is 200–400 tokens.
 */

import { SCREEN_DUMP } from '../eko/contextPruning';

export const LITE_RULES = `Android phone agent. Reply with ONE line only:
T idx = tap | Y idx text = type into field | YE idx text = type + Enter | E = Enter | S down/up = scroll | SW left/right = swipe
O url = open link | A package = open app | B = back | H = home | W = wait | D result = done | F reason = impossible | X reason = stuck
Use idx from SCREEN. Never repeat an action that changed nothing. Reply D only when SCREEN shows the task done.`;

/** Rows kept from a screen; long lists are mostly off-screen noise for a step decision. */
export const MAX_ROWS = 60;
const MAX_LABEL = 48;
/** History lines sent in full; older ones are only counted. */
export const MAX_HISTORY = 16;

export type LiteToolCall = { tool: string; args: Record<string, unknown> };
export type LiteAction =
  | { kind: 'tools'; code: string; calls: LiteToolCall[] }
  | { kind: 'done'; summary: string }
  | { kind: 'failed'; summary: string }
  | { kind: 'escalate'; reason: string }
  | { kind: 'invalid'; text: string };

/**
 * The agent's screen table (idx|type|label|flags|tap_at) without the header
 * and the tap_at column, labels shortened, rows with nothing to read or tap
 * dropped. Labels may contain "|": idx and type are the first two columns,
 * flags and tap_at the last two.
 */
export function compactScreen(tree: string | null | undefined, maxRows = MAX_ROWS): string {
  const out: string[] = [];
  let dropped = 0;
  for (const raw of String(tree ?? '').split('\n')) {
    const line = raw.trim();
    if (!line || /^idx\|type\|/i.test(line)) continue;
    const cols = line.split('|');
    if (cols.length < 4) {
      if (/^No visible UI elements/i.test(line)) return 'No visible elements.';
      continue;
    }
    const hasTapAt = cols.length >= 5 && /^-?\d+,-?\d+$/.test(cols[cols.length - 1].trim());
    const flags = (hasTapAt ? cols[cols.length - 2] : cols[cols.length - 1]).trim();
    const label = cols
      .slice(2, hasTapAt ? -2 : -1)
      .join('|')
      .replace(/\s+/g, ' ')
      .trim();
    const idx = cols[0].trim();
    const type = cols[1].trim();
    if (!label && !/[te]/.test(flags)) continue;
    if (out.length >= maxRows) {
      dropped += 1;
      continue;
    }
    const short = label.length > MAX_LABEL ? `${label.slice(0, MAX_LABEL - 1)}…` : label;
    out.push(flags ? `${idx}|${type}|${short}|${flags}` : `${idx}|${type}|${short}`);
  }
  if (dropped) out.push(`(+${dropped} more rows; scroll to see them)`);
  return out.length ? out.join('\n') : 'No visible elements.';
}

/** The screen table and app named in a tool result, if it has one. */
export function screenFromResult(text: string): { tree: string | null; app: string | null } {
  const app = /CURRENT (?:VISIBLE )?APP: (\S+)/.exec(text)?.[1] ?? null;
  const dump = SCREEN_DUMP.exec(text)?.[0] ?? null;
  const tree = dump ? dump.replace(/^\s*(?:UPDATED SCREEN ELEMENTS:|VISIBLE UI ELEMENTS \([^\n]*\):)\n/, '') : null;
  return { tree, app: app && app !== 'unknown' ? app : null };
}

/** What a result says apart from the screen, in one short line. */
export function resultNote(text: string, max = 180): string {
  const bare = text
    .replace(SCREEN_DUMP, '')
    .replace(/CURRENT (?:VISIBLE )?APP: \S+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return bare.length > max ? `${bare.slice(0, max - 1)}…` : bare;
}

export const screenUnchanged = (text: string) => /screen did NOT change/i.test(text);

export interface LitePromptInput {
  task: string;
  history: string[];
  lastNote?: string | null;
  app?: string | null;
  screen: string;
  /** System messages for this call: a failed check, a retry after a bad reply. */
  notes?: string[];
}

export function buildLitePrompt(input: LitePromptInput): string {
  const lines = [`TASK: ${input.task.trim()}`];
  if (input.history.length) {
    const hidden = Math.max(0, input.history.length - MAX_HISTORY);
    const shown = input.history.slice(-MAX_HISTORY);
    lines.push('DONE SO FAR:');
    if (hidden) lines.push(`(${hidden} earlier steps)`);
    shown.forEach((h, i) => lines.push(`${hidden + i + 1}. ${h}`));
  }
  if (input.lastNote) lines.push(`LAST RESULT: ${input.lastNote}`);
  for (const note of input.notes ?? []) lines.push(`NOTE: ${note}`);
  lines.push(`APP: ${input.app ?? 'unknown'}`);
  lines.push('SCREEN (idx|type|label|flags t=tap e=edit d=disabled):');
  lines.push(input.screen);
  return lines.join('\n');
}

const IDX = '(v?\\d+)';
const unquote = (s: string) => s.trim().replace(/^(["'`“])([\s\S]*)\1$/, '$2').replace(/^["“]([\s\S]*)["”]$/, '$1');

/** One reply line → the agent tools it stands for. */
function parseLine(line: string): LiteAction | null {
  const l = line.trim().replace(/^[`*>\-\s]+|[`*\s]+$/g, '');
  if (!l) return null;
  let m: RegExpExecArray | null;
  if ((m = new RegExp(`^T\\s+${IDX}$`, 'i').exec(l))) return { kind: 'tools', code: `T ${m[1]}`, calls: [{ tool: 'tap_element', args: { idx: m[1] } }] };
  if ((m = new RegExp(`^(YE|Y)\\s+${IDX}\\s+([\\s\\S]+)$`, 'i').exec(l))) {
    const text = unquote(m[3]);
    if (!text) return null;
    const calls: LiteToolCall[] = [
      { tool: 'tap_element', args: { idx: m[2] } },
      { tool: 'type_text', args: { text } },
    ];
    if (m[1].toUpperCase() === 'YE') calls.push({ tool: 'press_key', args: { key: 'ENTER' } });
    return { kind: 'tools', code: `${m[1].toUpperCase()} ${m[2]} "${text}"`, calls };
  }
  if ((m = /^(YE|Y)\s+(?!v?\d+\s)([\s\S]+)$/i.exec(l))) {
    // No idx: type into the field that has focus.
    const text = unquote(m[2]);
    if (!text) return null;
    const calls: LiteToolCall[] = [{ tool: 'type_text', args: { text } }];
    if (m[1].toUpperCase() === 'YE') calls.push({ tool: 'press_key', args: { key: 'ENTER' } });
    return { kind: 'tools', code: `${m[1].toUpperCase()} "${text}"`, calls };
  }
  if (/^E$/i.test(l)) return { kind: 'tools', code: 'E', calls: [{ tool: 'press_key', args: { key: 'ENTER' } }] };
  if ((m = /^SW\s+(up|down|left|right)$/i.exec(l))) {
    const dir = m[1].toUpperCase();
    return { kind: 'tools', code: `SW ${m[1].toLowerCase()}`, calls: [{ tool: 'swipe', args: { direction: dir } }] };
  }
  if ((m = /^S(?:\s+(down|up|d|u))?$/i.exec(l))) {
    const up = /^u/i.test(m[1] ?? 'down');
    return { kind: 'tools', code: up ? 'S up' : 'S down', calls: [{ tool: 'scroll_element', args: { direction: up ? 'BACKWARD' : 'FORWARD' } }] };
  }
  if ((m = /^O\s+(\S+)$/i.exec(l))) {
    const url = unquote(m[1]);
    const full = /^[a-z][\w+.-]*:/i.test(url) ? url : `https://${url}`;
    return { kind: 'tools', code: `O ${full}`, calls: [{ tool: 'open_url', args: { url: full } }] };
  }
  if ((m = /^A\s+([a-zA-Z][\w]*(?:\.[\w]+)+)$/.exec(l))) return { kind: 'tools', code: `A ${m[1]}`, calls: [{ tool: 'open_app', args: { packageName: m[1] } }] };
  if (/^B$/i.test(l)) return { kind: 'tools', code: 'B', calls: [{ tool: 'global_action', args: { action: 'BACK' } }] };
  if (/^H$/i.test(l)) return { kind: 'tools', code: 'H', calls: [{ tool: 'global_action', args: { action: 'HOME' } }] };
  if (/^[WP]$/i.test(l)) return { kind: 'tools', code: 'W', calls: [{ tool: 'wait', args: { durationMillis: 4000 } }] };
  if ((m = /^DONE\b[:\s-]*([\s\S]*)$/i.exec(l))) return { kind: 'done', summary: unquote(m[1]) || 'Done.' };
  if ((m = /^D(?:\s+([\s\S]*))?$/i.exec(l))) return { kind: 'done', summary: unquote(m[1] ?? '') || 'Done.' };
  if ((m = /^F(?:\s+([\s\S]*))?$/i.exec(l))) return { kind: 'failed', summary: unquote(m[1] ?? '') || 'The task cannot be done.' };
  if ((m = /^X(?:\s+([\s\S]*))?$/i.exec(l))) return { kind: 'escalate', reason: unquote(m[1] ?? '') || 'The model asked for help.' };
  return null;
}

/**
 * The model's reply → an action. The first line that is a valid command wins,
 * so a model that thinks out loud first still works; anything else is invalid.
 */
export function parseLiteAction(reply: string): LiteAction {
  const text = String(reply ?? '').replace(/<think>[\s\S]*?<\/think>/gi, '');
  for (const line of text.split('\n')) {
    const action = parseLine(line);
    if (action) return action;
  }
  return { kind: 'invalid', text: text.trim().slice(0, 200) };
}

/** One history line: the command, and what came of it. The app is named only when it changed. */
export function historyEntry(code: string, outcome: { ok: boolean; unchanged: boolean; app: string | null; prevApp?: string | null; label?: string | null }): string {
  const target = outcome.label ? ` (${outcome.label})` : '';
  const moved = outcome.app && outcome.app !== outcome.prevApp ? `, now ${outcome.app}` : '';
  const result = !outcome.ok ? 'failed' : outcome.unchanged ? 'no change' : `ok${moved}`;
  return `${code}${target} → ${result}`;
}

/** The label of row idx in a screen table, for history lines that read well. */
export function labelOf(tree: string | null | undefined, idx: string): string | null {
  for (const line of String(tree ?? '').split('\n')) {
    const cols = line.split('|');
    if (cols[0]?.trim() !== idx || cols.length < 4) continue;
    const hasTapAt = cols.length >= 5 && /^-?\d+,-?\d+$/.test(cols[cols.length - 1].trim());
    const label = cols.slice(2, hasTapAt ? -2 : -1).join('|').trim();
    return label ? label.slice(0, 30) : null;
  }
  return null;
}
