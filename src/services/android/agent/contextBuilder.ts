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

function stepMessages(step: StepRecord, keepScreen: boolean): ModelMessage[] {
  const thought = step.thought.trim();
  const text = keepScreen ? step.resultText : stripScreen(step.resultText);
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
    if (!mustKeep && used + cost > options.budgetTokens) break;
    used += cost;
    firstFull = i;
  }

  // Older steps become one line each; if even that overflows, the oldest lines go.
  const older = steps.slice(0, firstFull).map(summaryLine);
  const summaryBudget = Math.max(200, options.budgetTokens - used);
  let summary = older;
  let dropped = 0;
  while (summary.length && estimateTokens(summary.join('\n')) > summaryBudget) {
    summary = summary.slice(1);
    dropped += 1;
  }

  const task = [`TASK: ${options.task}`, options.plan ? `\nPLAN (a guide, not a script):\n${options.plan}` : ''].filter(Boolean).join('\n');
  const done = older.length
    ? `STEPS ALREADY DONE (${older.length}${dropped ? `, the oldest ${dropped} not shown` : ''}; the full detail of the last ${steps.length - firstFull} follows):\n${summary.join('\n')}`
    : '';

  const messages: ModelMessage[] = options.taskFirst
    ? [{ role: 'user', content: task }, ...(done ? [{ role: 'user' as const, content: done }] : [])]
    : [{ role: 'user', content: [task, done ? `\n${done}` : ''].filter(Boolean).join('\n') }];
  for (let i = firstFull; i < steps.length; i += 1) {
    messages.push(...stepMessages(steps[i], i === steps.length - 1));
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
