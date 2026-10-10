import type { ModelMessage } from 'ai';
import { SCREEN_DUMP } from '../eko/contextPruning';

/**
 * What the Vector engine sends the model on every call, rebuilt from scratch.
 *
 * - The task (and the optional plan) first.
 * - Older steps as one line each — no model call is spent compressing them
 *   (Eko's task_snapshot cost 99 calls / ~1,700 s in the Step-0 data).
 * - Recent steps in full, newest first, while they fit a token budget; at
 *   least `minRecent` always stay so the model sees what it just did.
 * - Only the newest screen dump; older ones are stale.
 * - A screenshot only when the model can see images and only right after the
 *   step that took it.
 */

export interface StepRecord {
  /** Our own id: provider tool-call ids are not unique across calls. */
  callId: string;
  toolName: string;
  input: unknown;
  /** The model's text/reasoning that led to this step (shortened). */
  thought: string;
  resultText: string;
  isError: boolean;
  image?: { data: string; mediaType: string };
}

export interface ContextOptions {
  task: string;
  plan?: string | null;
  steps: StepRecord[];
  /** Token budget for step history (summary + full recent steps). The newest screen is always sent on top. */
  budgetTokens: number;
  minRecent: number;
  vision: boolean;
  /** System notes added at the end (e.g. a failed verification). */
  notes?: string[];
  /**
   * Send the task (and plan) as a message of its own, before the step summary.
   * It is then identical on every call, so a prompt cache can end right after it.
   */
  taskFirst?: boolean;
  /** With taskFirst: a message sent right after the task (outside the cache), e.g. this phone's facts. */
  afterTask?: string | null;
  /**
   * Lite: at most this many recent steps in full, whatever the budget allows; the
   * rest are one line each. (With only a budget, short steps filled it 10 deep.)
   */
  maxRecent?: number;
  /**
   * Lite: older full steps drop their screen dump without the "(older screen
   * omitted)" marker, and the notes that described that screen ("a screenshot is
   * attached", "rows v1… were read from a screenshot"): stale once it is gone.
   */
  cleanOld?: boolean;
  /**
   * Lite: a line of what the run did, counted by code ("swipe: 6 succeeded"),
   * sent with the history so the model never has to count its own steps.
   */
  progress?: string;
}

export interface BuiltContext {
  messages: ModelMessage[];
  fullSteps: number;
  summarisedSteps: number;
  estimatedTokens: number;
}

/** A rough, provider-independent estimate (±15%); exact counts come back from the provider after the call. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const STALE_SCREEN = '\n\n(older screen omitted — only the latest screen is current)';

function stripScreen(text: string): string {
  return text.replace(SCREEN_DUMP, STALE_SCREEN);
}

/** Notes AndroidAgent adds about the screen it just returned; they only apply to that screen. */
const SCREEN_NOTE = /\n\nNOTE: (?:this screen exposes|you have waited twice|rows v1)[^\n]*/g;

/** An older step for Lite: no screen, no marker, no notes about that screen. */
export function cleanOldResult(text: string): string {
  return text.replace(SCREEN_DUMP, '').replace(SCREEN_NOTE, '').trim();
}

function compactInput(input: unknown): string {
  try {
    const text = JSON.stringify(input ?? {});
    return text === '{}' ? '' : text.length > 90 ? `${text.slice(0, 90)}…` : text;
  } catch {
    return '';
  }
}

/** One line for a step: tool, input, outcome. Also what the completion judge reads. */
export function summaryLine(step: StepRecord, index: number): string {
  const firstLine = stripScreen(step.resultText).split('\n').find((line) => line.trim()) ?? '';
  const outcome = firstLine.length > 110 ? `${firstLine.slice(0, 110)}…` : firstLine;
  return `${index + 1}. ${step.toolName}${compactInput(step.input) ? ` ${compactInput(step.input)}` : ''} → ${step.isError ? 'FAILED' : 'ok'}: ${outcome}`;
}

/** The argument that tells steps apart, short: a URL without its scheme, a package, typed text, an idx. */
function keyArg(input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const pick = i.url ?? i.packageName ?? (i.text != null ? `"${String(i.text)}"` : null) ?? (i.idx != null ? `#${String(i.idx).replace(/"/g, '')}` : null) ?? i.action ?? i.direction ?? i.key;
  const text = pick != null ? String(pick).replace(/^https?:\/\/(www\.)?/, '') : compactInput(input);
  return text.length > 50 ? `${text.slice(0, 50)}…` : text;
}

/**
 * Lite's line for an older step: number, tool, what it acted on, ✓ or ✗ with
 * the reason. ~10 tokens, so every step of a long run stays in view — the
 * model counts from these ("visit 10 sites"); dropping the oldest made it lose
 * count (Oct 9, runs #3224/#3225).
 */
export function shortLine(step: StepRecord, index: number): string {
  const arg = keyArg(step.input);
  const head = `${index + 1}. ${step.toolName}${arg ? ` ${arg}` : ''}`;
  if (!step.isError) return `${head} ✓`;
  const reason = (stripScreen(step.resultText).split('\n').find((line) => line.trim()) ?? '').slice(0, 70);
  return `${head} ✗ ${reason}`;
}

/**
 * What the run did, counted by code for the completion judge: successful
 * actions per tool and how many distinct targets (URLs, apps, texts). A model
 * counting 40 step lines itself said "14 visits, short of the 10 required".
 */
export function countActions(steps: StepRecord[], skip: ReadonlySet<string> = new Set()): string {
  const per = new Map<string, { ok: number; failed: number; distinct: Set<string> }>();
  for (const step of steps) {
    if (skip.has(step.toolName)) continue;
    const entry = per.get(step.toolName) ?? { ok: 0, failed: 0, distinct: new Set<string>() };
    if (step.isError) entry.failed += 1;
    else {
      entry.ok += 1;
      const i = (step.input ?? {}) as Record<string, unknown>;
      // Not URLs: one link can serve a new page each visit (Special:Random), and
      // "9 succeeded (1 different)" made 14 of 15 phones give up on "visit 10
      // random websites" (Oct 9, mission 245).
      const target = i.packageName ?? i.text;
      if (target != null) entry.distinct.add(String(target));
    }
    per.set(step.toolName, entry);
  }
  const parts = [...per].map(([tool, e]) => `${tool}: ${e.ok} succeeded${e.distinct.size ? ` (${e.distinct.size} different)` : ''}${e.failed ? `, ${e.failed} failed` : ''}`);
  const changes = buttonChanges(steps);
  if (changes.length) {
    const tally = new Map<string, number>();
    for (const c of changes) tally.set(`"${c.from}" → "${c.to}"`, (tally.get(`"${c.from}" → "${c.to}"`) ?? 0) + 1);
    parts.push(`buttons changed by your taps: ${[...tally].map(([k, n]) => `${k} ×${n}`).join(', ')}`);
  }
  return parts.join('; ');
}

const CHANGED = /^CHANGED: "(.+?)" → "(.+?)"$/m;
/** A toggle whose label stays the same (Like): counted as switched by the tap. */
const TOGGLED = /^TOGGLED: "(.+?)"$/m;

/** Buttons the run's taps turned into something else (the "CHANGED:" line AndroidAgent adds to a tap's result). */
export function buttonChanges(steps: StepRecord[]): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  for (const step of steps) {
    if (step.isError) continue;
    const m = CHANGED.exec(step.resultText ?? '');
    if (m) out.push({ from: m[1], to: m[2] });
    const t = TOGGLED.exec(step.resultText ?? '');
    if (t) out.push({ from: t[1], to: 'tapped once' });
  }
  return out;
}

function stepMessages(step: StepRecord, keepScreen: boolean, clean = false): ModelMessage[] {
  const thought = step.thought.trim();
  const text = keepScreen ? step.resultText : clean ? cleanOldResult(step.resultText) : stripScreen(step.resultText);
  return [
    {
      role: 'assistant',
      content: [
        ...(thought ? [{ type: 'text' as const, text: thought }] : []),
        { type: 'tool-call' as const, toolCallId: step.callId, toolName: step.toolName, input: step.input ?? {} },
      ],
    },
    {
      role: 'tool',
      content: [
        {
          type: 'tool-result' as const,
          toolCallId: step.callId,
          toolName: step.toolName,
          output: step.isError ? { type: 'error-text' as const, value: text || 'Error' } : { type: 'text' as const, value: text || 'Done' },
        },
      ],
    },
  ];
}

export function buildContext(options: ContextOptions): BuiltContext {
  const { steps } = options;
  const minRecent = Math.max(1, options.minRecent);

  // Choose the recent steps sent in full: newest first while within budget.
  let used = 0;
  let firstFull = steps.length;
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    // Costed without its screen dump: only the newest step keeps one, and that
    // screen is sent regardless, so it does not count against the budget.
    const cost = estimateTokens(step2text(steps[i], false));
    const mustKeep = steps.length - i <= minRecent;
    if (options.maxRecent && steps.length - i > options.maxRecent) break;
    if (!mustKeep && used + cost > options.budgetTokens) break;
    used += cost;
    firstFull = i;
  }

  // Older steps become one line each; if even that overflows, the oldest lines go.
  // Lite (maxRecent) keeps every line, in the short form: the model counts from them.
  const older = steps.slice(0, firstFull).map(options.maxRecent ? shortLine : summaryLine);
  const summaryBudget = Math.max(200, options.budgetTokens - used);
  let summary = older;
  let dropped = 0;
  while (!options.maxRecent && summary.length && estimateTokens(summary.join('\n')) > summaryBudget) {
    summary = summary.slice(1);
    dropped += 1;
  }

  const task = [`TASK: ${options.task}`, options.plan ? `\nPLAN (a guide, not a script):\n${options.plan}` : ''].filter(Boolean).join('\n');
  const done = older.length
    ? `STEPS ALREADY DONE (${older.length}${dropped ? `, the oldest ${dropped} not shown` : ''}; the full detail of the last ${steps.length - firstFull} follows):\n${summary.join('\n')}`
    : '';

  const progress = options.progress && steps.length ? `DONE SO FAR (counted by the system, exact): ${options.progress}` : '';
  const doneBlock = [done, progress].filter(Boolean).join('\n\n');
  const messages: ModelMessage[] = options.taskFirst
    ? [
        { role: 'user', content: task },
        ...(options.afterTask ? [{ role: 'user' as const, content: options.afterTask }] : []),
        ...(doneBlock ? [{ role: 'user' as const, content: doneBlock }] : []),
      ]
    : [{ role: 'user', content: [task, done ? `\n${done}` : ''].filter(Boolean).join('\n') }];
  for (let i = firstFull; i < steps.length; i += 1) {
    messages.push(...stepMessages(steps[i], i === steps.length - 1, Boolean(options.cleanOld)));
  }

  const last = steps[steps.length - 1];
  if (options.vision && last?.image) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: 'Screenshot from the last action:' },
        { type: 'file', data: last.image.data, mediaType: last.image.mediaType },
      ],
    });
  }
  for (const note of options.notes ?? []) messages.push({ role: 'user', content: note });

  const estimatedTokens = estimateTokens(JSON.stringify(messages.map((m) => (m.role === 'user' && Array.isArray(m.content) ? { ...m, content: '[image]' } : m))));
  return { messages, fullSteps: steps.length - firstFull, summarisedSteps: firstFull, estimatedTokens };
}

function step2text(step: StepRecord, keepScreen: boolean): string {
  return `${step.thought}\n${step.toolName} ${compactInput(step.input)}\n${keepScreen ? step.resultText : stripScreen(step.resultText)}`;
}
