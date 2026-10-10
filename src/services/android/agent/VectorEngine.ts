import Logger from '@/logger/index';
import type { AgentContext, AgentStreamMessage, Tool } from '@eko-ai/eko';
import { generateText, jsonSchema, streamText, tool, wrapLanguageModel, type LanguageModel, type ToolSet } from 'ai';
import type { AndroidAgent } from '../eko/AndroidAgent';
import type { AgentEngine, EngineMessageHandler, EngineRunResult, VerificationOutcome } from './AgentEngine';
import { compactTool, type ToolSpec } from './compactTools';
import { buildContext, buttonChanges, countActions, summaryLine, type StepRecord } from './contextBuilder';
import { LITE_ENGINE_RULES } from '../eko/compactPrompt';
import { countChecks, parseAppList, verifyCompletion, type RunTally } from './successVerifier';
import { CACHE_BREAKPOINT, NO_REASONING_OPTIONS, USAGE_REPORT_OPTIONS, isReasoningRejected, usageDetails, type UsageDetails } from './usageDetails';

export interface VectorEngineOptions {
  model: LanguageModel;
  agent: AndroidAgent;
  onMessage: EngineMessageHandler;
  vision: boolean;
  /** One planning call before acting, shown as the plan card. Off by default. */
  planner: boolean;
  /** Token budget for step history in each call (see contextBuilder). */
  historyBudgetTokens?: number;
  /** Check the phone after task_done. */
  verify?: boolean;
  maxOutputTokens?: number;
  temperature?: number;
  /** Model calls allowed for one round; the planner's step limit usually stops a run first. */
  maxModelCalls?: number;
  /** Abandon a model call that sends nothing for this long (ms). */
  callIdleMs?: number;
  /** Abandon a model call that has not finished after this long (ms), even while it streams. */
  callMaxMs?: number;
  /** Used for the rest of the run when the main model is rate-limited or out of quota. */
  fallback?: { model: LanguageModel; label: string };
  /** A tap in the power menu that takes this long (ms) means the phone restarted. */
  restartGapMs?: number;
  /**
   * Lite: the same engine with less input per call — short tool descriptions
   * (compactTools) and a smaller history budget. Same tools, prompt, loop and checks.
   * Lite also caches the part every call repeats (tools, system prompt, task).
   */
  compact?: boolean;
  /**
   * Lite: OpenRouter session for sticky routing, so the calls that share a cached
   * prompt keep landing on the provider that holds the cache. One per account
   * and model: with the phone's facts outside the prompt, a mission's phones share it.
   */
  cacheSession?: string;
}

export const DEFAULT_HISTORY_BUDGET = 6000;
/** Lite's history budget: older steps stay one line each, the latest few in full. */
export const COMPACT_HISTORY_BUDGET = 800;
/** Lite sends the last two steps in full; older ones are one line each. */
const COMPACT_MIN_RECENT = 2;

/** Taps answer in 1–3 s; a tap in the power menu that takes longer than this rebooted the phone. */
const RESTART_GAP_MS = 8000;
const TAP_TOOLS = new Set(['tap_coordinate', 'tap_element', 'click_node', 'long_press']);
export const RESTART_SUMMARY = 'Restart sent: the phone went offline to restart and reconnects by itself in a minute or two.';

/**
 * Did this tap restart the phone? It was made in the power menu and either
 * took far longer than a tap does (the phone went down mid-answer) or never
 * came back. The screen check cannot tell — it compares against the frame from
 * before the restart — so without this the agent saw "no change" and tapped
 * Restart again: three restarts for one request.
 */
export function restartedByTap(powerMenuOpen: boolean, toolName: string, tookMs: number, result: { isError: boolean; resultText: string }, gapMs = RESTART_GAP_MS): boolean {
  if (!powerMenuOpen || !TAP_TOOLS.has(toolName)) return false;
  if (tookMs >= gapMs) return true;
  return result.isError && /TIMEOUT|timed out|not connected|disconnected|offline|socket/i.test(result.resultText);
}
const MIN_RECENT_STEPS = 3;
/** Attempts per model call; only the model request is retried, never a phone action. */
const MODEL_ATTEMPTS = 3;
const MAX_VERIFICATION_RETRIES = 1;
/**
 * Model call limits. Recorded runs: a call usually takes ~6 s, 1 in 10 over
 * 23 s, and single calls hung for minutes until the planner's 4-minute
 * no-action watchdog failed the whole task. A call past these limits is
 * abandoned and asked again once; two slow attempts plus backoff stay under
 * that watchdog, so the task gets a clear reason instead of NO_ACTION.
 */
export const DEFAULT_CALL_IDLE_MS = 45_000;
export const DEFAULT_CALL_MAX_MS = 90_000;
const TIMEOUT_ATTEMPTS = 2;
/** Planning and the completion judge are short calls. */
const SIDE_CALL_MAX_MS = 60_000;

/** A model call abandoned for taking too long. Nothing on the phone was touched. */
export class ModelCallTimeout extends Error {
  constructor(readonly kind: 'idle' | 'total', readonly afterMs: number) {
    super(
      kind === 'idle'
        ? `The AI model sent nothing for ${Math.round(afterMs / 1000)} s`
        : `The AI model did not finish answering within ${Math.round(afterMs / 1000)} s`,
    );
    this.name = 'ModelCallTimeout';
  }
}

/**
 * Actions that change something on the phone. If the phone does not confirm
 * one in time it may still have happened, so it is never re-sent; the engine
 * reads the screen and tells the model to check before repeating it.
 */
const NOT_IDEMPOTENT = new Set([
  'tap_coordinate',
  'tap_element',
  'click_node',
  'type_text',
  'long_press',
  'swipe',
  'scroll_element',
  'press_key',
  'paste',
  'global_action',
  'use_vector_keyboard',
]);

const TASK_DONE = 'task_done';
/** Tools that only look or wait; left out of the progress line the model reads. */
const LOOK_ONLY = new Set(['read_ui_tree', 'capture_screen', 'wait', 'wait_for_element', 'phone_info', 'list_apps', 'read_clipboard', 'read_notifications']);
/** Actions after which the screen has moved: in a Lite reply, nothing after one of these is sent. */
const MOVES_SCREEN = new Set(['swipe', 'scroll_element']);
/**
 * Lite: the phone's network and locale facts on request. They used to ride along
 * as a message after the task on every call — after the cache mark, so billed in
 * full each time — for the few tasks that ask about them. The tool is offered on
 * every phone (with or without facts) so all phones keep one cached tool list.
 */
export const PHONE_INFO = 'phone_info';
const NO_PHONE_FACTS = 'This phone has not reported its network or locale facts. Find what you need with open_settings or a website.';

const VECTOR_RULES = `

FINISHING THE TASK:
- When the task is complete, call task_done with success=true and one short sentence saying what you did and what is on screen now.
- If it cannot be done (app missing, sign-in required, an error you cannot get past), call task_done with success=false and the reason.
- Never finish by only writing text — always call task_done.
- After task_done the system checks the phone. If the check fails you are told why and must carry on.

UNCONFIRMED ACTIONS:
- If a result says the phone did not confirm an action, it may already have happened. Look at the screen in that result before repeating it.`;

const PLANNER_PROMPT = `You plan tasks for an agent that controls an Android phone through tools (open_app, open_url, tap, type, scroll, back/home).
Write the shortest plan that does exactly what the user asked: numbered steps, one action each, at most 8 lines, no preamble.
Prefer open_url or a deep link over navigating menus when a URL exists.`;

class RetryableModelError extends Error {}

/** A limit that will not lift within this run: a daily cap, or no credit left. */
function isQuota(error: unknown): boolean {
  const e = error as { message?: string; responseBody?: string; statusCode?: number };
  const text = `${e?.message ?? ''} ${e?.responseBody ?? ''}`;
  return Number(e?.statusCode) === 402 || /per-day|per day|daily (?:limit|quota)|quota exceeded|insufficient credits?/i.test(text);
}

function isRateLimited(error: unknown): boolean {
  const e = error as { statusCode?: number; status?: number; message?: string };
  return Number(e?.statusCode ?? e?.status) === 429 || /\b429\b|rate limit|too many requests/i.test(String(e?.message ?? ''));
}

function isRetryable(error: unknown): boolean {
  const e = error as { statusCode?: number; status?: number; message?: string; name?: string; cause?: unknown };
  if (e?.name === 'AbortError') return false;
  if (isQuota(error)) return false;
  const status = Number(e?.statusCode ?? e?.status);
  if (status === 429 || (status >= 500 && status < 600)) return true;
  if (status >= 400 && status < 500) return false;
  return /429|rate limit|overloaded|timeout|timed out|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|network|temporarily|unavailable|502|503|504/i.test(
    String(e?.message ?? error),
  );
}

interface ModelTurn {
  text: string;
  reasoning: string;
  toolCalls: { toolCallId: string; toolName: string; input: unknown }[];
  inputTokens: number;
  outputTokens: number;
  details: UsageDetails;
}

/**
 * Vector Brain's own agent loop on the AI SDK.
 *
 * Same tools, same system prompt and the same Eko-shaped messages to the
 * planner's handler as the Eko engine, so recording, guards and diagnostics
 * behave identically. What differs is how the model is driven:
 * - planning is optional (no planner call by default);
 * - the context is rebuilt for every call under a token budget, with no model
 *   call spent on compression;
 * - the run ends with task_done and a system check of the phone;
 * - only model requests are retried; a phone action is sent at most once.
 */
/** What the run did, counted from its steps, for the goal's own numbers (successVerifier.countChecks). */
export function runTally(steps: StepRecord[]): RunTally {
  const ok = (names: string[]) => steps.filter((s) => !s.isError && names.includes(s.toolName)).length;
  return { openUrl: ok(['open_url']), scrolls: ok(['swipe', 'scroll_element']), changes: buttonChanges(steps) };
}

export class VectorEngine implements AgentEngine {
  readonly kind: 'vector' | 'lite';
  private controller: AbortController | null = null;
  private abortReason: string | null = null;
  private readonly tools: Tool[];
  private readonly toolSet: ToolSet;
  private callCounter = 0;
  /** The last action opened the power menu (and only taps followed). */
  private powerMenuOpen = false;
  private model: LanguageModel;
  private onFallback = false;
  /** Lite asks for no hidden reasoning until a model refuses that once. */
  private reasoningOff: boolean;
  /**
   * Every model request's generation id (agent turns, retried or abandoned
   * attempts, plan and judge), and whether the backup model made it. The
   * Diagnostics page asks the provider what each one was billed.
   */
  readonly generations: { id: string; fallback: boolean }[] = [];

  /** True once the run switched to the backup model (counted as a recovery in the run's outcome). */
  get usedBackupModel(): boolean {
    return this.onFallback;
  }

  constructor(private readonly options: VectorEngineOptions) {
    this.kind = options.compact ? 'lite' : 'vector';
    this.reasoningOff = Boolean(options.compact);
    this.model = options.model;
    this.tools = options.agent.Tools;
    const set: ToolSet = {};
    for (const t of this.tools) {
      const spec = options.compact ? compactTool(t as unknown as ToolSpec) : t;
      set[t.name] = tool({ description: spec.description ?? '', inputSchema: jsonSchema(spec.parameters as never) });
    }
    const compact = Boolean(options.compact);
    if (compact) {
      options.agent.compactText = true;
      set[PHONE_INFO] = tool({
        description: "This phone's public IP, proxy, DNS, language, region, timezone and time, as the phone reported them.",
        inputSchema: jsonSchema({ type: 'object', properties: {}, additionalProperties: false } as never),
      });
    }
    set[TASK_DONE] = tool({
      description: compact
        ? 'Finish. success=true if achieved, false if impossible. summary: one short sentence.'
        : 'Finish the task. success=true when the goal is achieved, false when it cannot be done. summary: one short sentence.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          success: { type: 'boolean', description: compact ? 'Goal achieved' : 'Whether the goal was achieved' },
          summary: { type: 'string', description: compact ? "What was done and what's on screen, or why not" : 'What was done and what is on screen now, or why it could not be done' },
        },
        required: ['success', 'summary'],
        additionalProperties: false,
      } as never),
    });
    this.toolSet = set;
  }

  /**
   * The current model, noting each request's generation id as soon as the
   * provider sends it — before the answer streams, so an attempt that is cut
   * off or fails later is still on the list.
   */
  private tracked(): LanguageModel {
    const model = this.model;
    if (typeof model === 'string') return model;
    const fallback = this.onFallback;
    const note = (id?: string) => {
      if (id && !this.generations.some((g) => g.id === id)) this.generations.push({ id, fallback });
    };
    return wrapLanguageModel({
      model,
      middleware: {
        wrapStream: async ({ doStream }) => {
          const response = await doStream();
          const watch = new TransformStream({
            transform(chunk: { type: string; id?: string }, controller) {
              if (chunk.type === 'response-metadata') note(chunk.id);
              controller.enqueue(chunk);
            },
          });
          return { ...response, stream: response.stream.pipeThrough(watch as never) };
        },
        wrapGenerate: async ({ doGenerate }) => {
          const response = await doGenerate();
          note(response.response?.id);
          return response;
        },
      },
    });
  }

  /** Per-call provider options: cost report, Lite's reasoning-off and sticky session. */
  private callOptions(reasoningOff = this.reasoningOff) {
    const base = reasoningOff ? NO_REASONING_OPTIONS : USAGE_REPORT_OPTIONS;
    if (!this.options.cacheSession) return base;
    return { openrouter: { ...base.openrouter, session_id: this.options.cacheSession } };
  }

  abort(reason: string): void {
    this.abortReason = reason;
    this.controller?.abort(reason);
  }

  dispose(): void {
    this.controller?.abort('disposed');
    this.controller = null;
  }

  async run(prompt: string, runId: string): Promise<EngineRunResult> {
    this.controller = new AbortController();
    this.abortReason = null;
    const signal = this.controller.signal;
    const envelope = { streamType: 'agent', chatId: runId, taskId: runId, agentName: 'AndroidAgent' };
    const emit = (message: Record<string, unknown>) => this.options.onMessage({ ...envelope, ...message } as unknown as AgentStreamMessage);

    // Lite: the short prompt, with nothing phone-specific in it (facts come from
    // phone_info), so every phone shares one cached prefix.
    const system = this.options.compact ? `${await this.options.agent.systemPrompt({ withFacts: false })}${LITE_ENGINE_RULES}` : `${await this.options.agent.systemPrompt()}${VECTOR_RULES}`;
    const plan = this.options.planner ? await this.makePlan(prompt, signal, emit) : null;
    const steps: StepRecord[] = [];
    const notes: string[] = [];
    let verificationRetries = 0;
    /** Whether the agent was already asked once to reconsider giving up. */
    let gaveUpAsked = false;
    const maxCalls = this.options.maxModelCalls ?? 600;

    for (let call = 0; call < maxCalls; call += 1) {
      if (signal.aborted) return this.aborted();

      const context = buildContext({
        task: prompt,
        plan,
        steps,
        budgetTokens: this.options.historyBudgetTokens ?? (this.options.compact ? COMPACT_HISTORY_BUDGET : DEFAULT_HISTORY_BUDGET),
        minRecent: this.options.compact ? COMPACT_MIN_RECENT : MIN_RECENT_STEPS,
        vision: this.options.vision,
        notes,
        taskFirst: Boolean(this.options.compact),
        maxRecent: this.options.compact ? COMPACT_MIN_RECENT : undefined,
        cleanOld: Boolean(this.options.compact),
        progress: this.options.compact ? countActions(steps, LOOK_ONLY) || undefined : undefined,
      });
      notes.length = 0;

      let turn: ModelTurn;
      try {
        turn = await this.callModel(system, context.messages, signal, emit);
      } catch (error) {
        if (signal.aborted) return this.aborted();
        throw error;
      }

      // Duplicates inside one response are dropped. Provider ids are not
      // trusted across responses (some reuse "call_0" every turn), so each
      // executed call gets our own id.
      const seen = new Set<string>();
      const calls = turn.toolCalls.filter((c) => {
        const key = `${c.toolCallId}|${c.toolName}|${JSON.stringify(c.input ?? {})}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      let usageBooked = false;
      const bookUsage = async () => {
        if (usageBooked) return;
        usageBooked = true;
        await emit({
          type: 'finish',
          finishReason: calls.length ? 'tool-calls' : 'stop',
          usage: { promptTokens: turn.inputTokens, completionTokens: turn.outputTokens, totalTokens: turn.inputTokens + turn.outputTokens, ...turn.details },
        });
      };

      let done: { success: boolean; summary: string } | null = null;
      let restarted = false;
      for (const c of calls) {
        if (signal.aborted) return this.aborted();
        if (c.toolName === TASK_DONE) {
          const input = (c.input ?? {}) as { success?: unknown; summary?: unknown };
          done = { success: input.success === true || input.success === 'true', summary: String(input.summary ?? '').trim() || 'Done.' };
          break;
        }
        const callId = `v${++this.callCounter}`;
        const thought = [turn.reasoning, turn.text].filter(Boolean).join(' ').trim();
        await emit({ type: 'tool_use', toolCallId: callId, toolName: c.toolName, params: c.input ?? {} });
        await bookUsage();
        const began = Date.now();
        const record = await this.executeTool(c.toolName, c.input, callId, thought.slice(-600));
        if (restartedByTap(this.powerMenuOpen, c.toolName, Date.now() - began, record, this.options.restartGapMs)) restarted = true;
        this.powerMenuOpen =
          c.toolName === 'global_action'
            ? !record.isError && /POWER_DIALOG/i.test(JSON.stringify(c.input ?? {}))
            : this.powerMenuOpen && TAP_TOOLS.has(c.toolName);
        await emit({
          type: 'tool_result',
          toolCallId: callId,
          toolName: c.toolName,
          params: c.input ?? {},
          toolResult: { content: [{ type: 'text', text: record.resultText }], isError: record.isError },
        });
        steps.push(record);
        if (restarted) break;
        // Lite may send several actions in one reply; after one fails, the rest were
        // planned on a screen that did not come about, so they are not sent.
        if (this.options.compact && record.isError) break;
        // After a scroll the screen is new: whatever else the reply planned (another
        // scroll, a tap) was chosen on the old one. Oct 9: replies of 3–4 swipes
        // overshot "scroll 5 times" and the model lost count.
        if (this.options.compact && MOVES_SCREEN.has(c.toolName) && calls.indexOf(c) < calls.length - 1) {
          notes.push('Only the first scroll of your last reply was done: the screen moved. Look at the new screen list before the next action.');
          break;
        }
        // Same after a tap when the reply goes on to tap or scroll: the next idx was
        // picked on the screen before the tap. Oct 10, mission 249: five or nine Follow
        // taps in one reply, the list shifted after each, extra accounts got followed
        // and the agent lost count. (Tap a field, then type: still one reply.)
        const next = calls[calls.indexOf(c) + 1];
        if (this.options.compact && TAP_TOOLS.has(c.toolName) && next && (TAP_TOOLS.has(next.toolName) || MOVES_SCREEN.has(next.toolName))) {
          notes.push('Only the first tap of your last reply was done: a tap can change the screen. Look at the new screen list, then tap the next one.');
          break;
        }
      }
      await bookUsage();

      // The phone is rebooting: the run is done, and nothing may tap Restart again.
      if (restarted) {
        await emit({ type: 'agent_result', result: RESTART_SUMMARY });
        return { success: true, stopReason: 'done', result: RESTART_SUMMARY, verification: { status: 'unverified', method: 'none', reason: 'The phone is restarting', retries: 0 } };
      }

      if (!done && calls.length === 0) {
        // The model answered in text instead of calling task_done; take it as
        // its final word, and let the check decide.
        const text = turn.text.trim();
        if (!text) {
          notes.push('You returned nothing. Continue the task with a tool call, or call task_done.');
          continue;
        }
        done = { success: !/\b(unable|cannot|can't|could not|couldn't|failed|not possible|impossible)\b/i.test(text), summary: text.slice(0, 500) };
      }
      if (!done) continue;

      // Giving up while the run is still moving: ask once whether it is really blocked.
      // Oct 9, mission 245 ("visit 10 random websites"): 14 of 15 phones called
      // task_done(false) mid-way — "visited 5, did not reach 10", "could not confirm
      // 10 visits" — with nothing in the way.
      if (!done.success && !gaveUpAsked && steps.some((s) => !s.isError && !LOOK_ONLY.has(s.toolName))) {
        gaveUpAsked = true;
        const progress = countActions(steps, LOOK_ONLY);
        // The goal's numbers already reached (Oct 9: phones gave up with 10 of 10 pages open).
        const { short, met } = countChecks(prompt, runTally(steps));
        const reached = met.length && !short.length ? ` The system counted ${met.join('; ')}: the goal's numbers are reached.` : '';
        notes.push(
          `You reported failure, but nothing has blocked you${progress ? ` (DONE SO FAR: ${progress})` : ''}.${reached} If the task can still be done, carry on with the part that is missing. Not sure it is complete? Call task_done with success=true: the system checks the phone and tells you what is missing. Use success=false only for a real blocker (app not installed, sign-in required, an error you cannot get past).`,
        );
        continue;
      }

      await emit({ type: 'agent_result', result: done.summary });
      if (!done.success) {
        return {
          success: false,
          stopReason: 'done',
          result: done.summary,
          reasonCode: 'AGENT_REPORTED_FAILURE',
          verification: { status: 'failed', method: 'none', reason: 'The agent reported it could not complete the task', retries: verificationRetries },
        };
      }
      if (this.options.verify === false) {
        return { success: true, stopReason: 'done', result: done.summary, verification: { status: 'unverified', method: 'none', reason: 'Verification is off', retries: 0 } };
      }

      const outcome = await this.verify(prompt, done.summary, verificationRetries, signal, emit, steps.map(summaryLine), countActions(steps), runTally(steps));
      if (outcome.status === 'failed' && verificationRetries < MAX_VERIFICATION_RETRIES) {
        verificationRetries += 1;
        // Oct 9: after "carry on" alone, 2 of 3 Chrome runs gave up with success=false although only the check's wording was at issue.
        notes.push(
          `SYSTEM CHECK FAILED: ${outcome.reason}. The task is not finished — look at the current screen, do the part that is still missing (for example more of the same action), and call task_done again when it is really done. Report failure only if it truly cannot be done.`,
        );
        continue;
      }
      if (outcome.status === 'failed') {
        return { success: false, stopReason: 'done', result: `${done.summary}\n\nSystem check: ${outcome.reason}`, reasonCode: 'VERIFICATION_FAILED', verification: outcome };
      }
      return { success: true, stopReason: 'done', result: done.summary, verification: outcome };
    }
    return { success: false, stopReason: 'max_calls', result: 'unfinished', reasonCode: 'STEP_LIMIT' };
  }

  // -------------------------------------------------------------------------

  private aborted(): EngineRunResult {
    return { success: false, stopReason: 'abort', result: this.abortReason ?? 'Aborted' };
  }

  /** One model call, retried only on transient errors. Nothing is executed until the whole response is in. */
  private async callModel(
    system: string,
    messages: ReturnType<typeof buildContext>['messages'],
    signal: AbortSignal,
    emit: (message: Record<string, unknown>) => Promise<void>,
  ): Promise<ModelTurn> {
    let lastError: unknown;
    let timeouts = 0;
    for (let attempt = 1; attempt <= MODEL_ATTEMPTS; attempt += 1) {
      if (signal.aborted) throw new Error('aborted');
      try {
        return await this.streamOnce(system, messages, signal, emit);
      } catch (error) {
        lastError = error;
        if (signal.aborted) throw error;
        if (error instanceof ModelCallTimeout) {
          timeouts += 1;
          if (timeouts >= TIMEOUT_ATTEMPTS) {
            throw new Error(`${error.message}, twice in a row. The model is too slow right now; try again or switch to a faster model.`);
          }
          Logger.warn(`[VectorEngine] ${error.message}; asking again (nothing was sent to the phone).`);
          await emit({ type: 'thinking', text: `${error.message}. Asking again…` });
          continue;
        }
        // The model refuses to run without reasoning: ask again with it, and stop asking for that.
        if (this.reasoningOff && isReasoningRejected(error)) {
          this.reasoningOff = false;
          Logger.warn('[VectorEngine] The model refused reasoning off; continuing with its default reasoning.');
          attempt -= 1;
          continue;
        }
        // Rate-limited even after waiting (the fetch layer already waited out
        // short limits), or out of daily quota: carry on with the backup model.
        if ((isQuota(error) || isRateLimited(error)) && this.options.fallback && !this.onFallback) {
          this.onFallback = true;
          this.model = this.options.fallback.model;
          const why = isQuota(error) ? 'has used up its limit' : 'is rate-limited';
          Logger.warn(`[VectorEngine] Main model ${why}; switching to ${this.options.fallback.label}`);
          await emit({ type: 'thinking', text: `The main AI model ${why} — continuing with the backup model (${this.options.fallback.label}).` });
          attempt -= 1; // the switch itself is not a failed attempt
          continue;
        }
        if (!isRetryable(error) || attempt === MODEL_ATTEMPTS) throw error;
        const wait = 1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 500);
        Logger.warn(`[VectorEngine] Model call failed (attempt ${attempt}/${MODEL_ATTEMPTS}), retrying in ${wait}ms: ${String((error as Error)?.message ?? error).slice(0, 200)}`);
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
    throw lastError;
  }

  private async streamOnce(
    system: string,
    messages: ReturnType<typeof buildContext>['messages'],
    signal: AbortSignal,
    emit: (message: Record<string, unknown>) => Promise<void>,
  ): Promise<ModelTurn> {
    const idleMs = this.options.callIdleMs ?? DEFAULT_CALL_IDLE_MS;
    const maxMs = this.options.callMaxMs ?? DEFAULT_CALL_MAX_MS;
    // This attempt's own switch: the run's abort still reaches it, and a slow
    // attempt can be cut off without aborting the run.
    const attempt = new AbortController();
    let timedOut: ModelCallTimeout | null = null;
    const cutOff = (kind: 'idle' | 'total', afterMs: number) => {
      if (timedOut || attempt.signal.aborted) return;
      timedOut = new ModelCallTimeout(kind, afterMs);
      attempt.abort(timedOut);
    };
    const onRunAbort = () => attempt.abort(signal.reason);
    if (signal.aborted) attempt.abort(signal.reason);
    else signal.addEventListener('abort', onRunAbort, { once: true });
    const totalTimer = setTimeout(() => cutOff('total', maxMs), maxMs);
    let idleTimer = setTimeout(() => cutOff('idle', idleMs), idleMs);
    const alive = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => cutOff('idle', idleMs), idleMs);
    };
    try {
      return await this.readStream(system, messages, attempt.signal, emit, alive);
    } catch (error) {
      if (timedOut) throw timedOut;
      throw error;
    } finally {
      clearTimeout(totalTimer);
      clearTimeout(idleTimer);
      signal.removeEventListener('abort', onRunAbort);
    }
  }

  private async readStream(
    system: string,
    messages: ReturnType<typeof buildContext>['messages'],
    signal: AbortSignal,
    emit: (message: Record<string, unknown>) => Promise<void>,
    alive: () => void,
  ): Promise<ModelTurn> {
    const result = streamText({
      model: this.tracked(),
      // Lite sends the system prompt as a message so it can carry its own cache mark.
      system: this.options.compact ? undefined : system,
      // Lite caches in two layers. Mark 1 ends after tools + system prompt, which are
      // the same for every task, so a new task reuses them warm instead of writing
      // ~4,900 tokens again (run #3232's first call: 0 cached, $0.0007). Mark 2 ends
      // after the task message, identical on every call of the run.
      messages: this.options.compact
        ? [
            { role: 'system', content: system, providerOptions: CACHE_BREAKPOINT } as (typeof messages)[number],
            ...(messages.length ? [{ ...messages[0], providerOptions: CACHE_BREAKPOINT } as (typeof messages)[number], ...messages.slice(1)] : []),
          ]
        : messages,
      providerOptions: this.callOptions(),
      tools: this.toolSet,
      toolChoice: 'auto',
      maxOutputTokens: this.options.maxOutputTokens ?? 16000,
      temperature: this.options.temperature ?? 0.1,
      maxRetries: 0,
      abortSignal: signal,
      // Errors are handled (and logged once) by callModel; the default handler would print each one again.
      onError: () => undefined,
    });
    const turn: ModelTurn = { text: '', reasoning: '', toolCalls: [], inputTokens: 0, outputTokens: 0, details: usageDetails(undefined, undefined) };
    let stepMetadata: unknown;
    let lastEmit = 0;
    const flush = async (force = false) => {
      if (!force && Date.now() - lastEmit < 400) return;
      lastEmit = Date.now();
      if (turn.reasoning) await emit({ type: 'thinking', text: turn.reasoning });
      if (turn.text) await emit({ type: 'text', text: turn.text });
    };
    for await (const part of result.fullStream) {
      alive();
      switch (part.type) {
        case 'reasoning-delta':
          turn.reasoning += part.text;
          await flush();
          break;
        case 'text-delta':
          turn.text += part.text;
          await flush();
          break;
        case 'tool-call':
          turn.toolCalls.push({ toolCallId: part.toolCallId, toolName: part.toolName, input: part.input });
          break;
        case 'finish-step':
          // One step per call (tools are run by this engine, not the SDK): its metadata carries the cost.
          stepMetadata = part.providerMetadata;
          break;
        case 'finish':
          turn.inputTokens = part.totalUsage?.inputTokens ?? 0;
          turn.outputTokens = part.totalUsage?.outputTokens ?? 0;
          turn.details = usageDetails(part.totalUsage, stepMetadata as never);
          break;
        case 'error':
          throw part.error instanceof Error ? part.error : new RetryableModelError(String((part.error as { message?: string })?.message ?? part.error));
        case 'abort':
          throw new Error('aborted');
        default:
          break;
      }
    }
    await flush(true);
    return turn;
  }

  private async executeTool(toolName: string, input: unknown, callId: string, thought: string): Promise<StepRecord> {
    if (toolName === PHONE_INFO && this.options.compact) {
      const agent = this.options.agent as AndroidAgent & { deviceFactsText?: () => string | null };
      return { callId, toolName, input, thought, resultText: agent.deviceFactsText?.() ?? NO_PHONE_FACTS, isError: false };
    }
    const definition = this.tools.find((t) => t.name === toolName);
    if (!definition) {
      return { callId, toolName, input, thought, resultText: `Unknown tool "${toolName}". Use one of the listed tools.`, isError: true };
    }
    let resultText = '';
    let isError = false;
    let image: StepRecord['image'];
    try {
      const result = await definition.execute((input ?? {}) as Record<string, unknown>, {} as AgentContext, {
        type: 'tool-call',
        toolCallId: callId,
        toolName,
        input: JSON.stringify(input ?? {}),
      } as never);
      isError = Boolean(result?.isError);
      for (const part of result?.content ?? []) {
        if (part.type === 'text') resultText += (resultText ? '\n\n' : '') + part.text;
        else if (part.type === 'image' && this.options.vision && !image) image = { data: part.data, mediaType: part.mimeType || 'image/jpeg' };
      }
    } catch (error) {
      isError = true;
      resultText = `Action failed: ${String((error as Error)?.message ?? error)}`;
    }

    // Timed out: the phone may have done it anyway. Never re-send; show the screen instead.
    if (isError && NOT_IDEMPOTENT.has(toolName) && /TIMEOUT|timed out/i.test(resultText)) {
      const screen = await this.options.agent.observeForCheck().catch(() => null);
      resultText +=
        '\n\nNOTE: the phone did not confirm this action before the timeout, so it may already have happened. ' +
        (screen
          ? `The current screen is below — check it before repeating the action.\n\nCURRENT APP: ${screen.packageName ?? 'unknown'}\n\nUPDATED SCREEN ELEMENTS:\n${screen.tree}`
          : 'The screen could not be read either; use read_ui_tree before repeating it.');
    }
    return { callId, toolName, input, thought, resultText, isError, image };
  }

  private async makePlan(prompt: string, signal: AbortSignal, emit: (message: Record<string, unknown>) => Promise<void>): Promise<string | null> {
    try {
      const { text, usage, providerMetadata } = await generateText({
        model: this.tracked(),
        providerOptions: USAGE_REPORT_OPTIONS,
        system: PLANNER_PROMPT,
        prompt,
        maxOutputTokens: 600,
        temperature: 0.1,
        maxRetries: 2,
        abortSignal: AbortSignal.any([signal, AbortSignal.timeout(SIDE_CALL_MAX_MS)]),
      });
      await emit({ type: 'finish', finishReason: 'stop', usage: { promptTokens: usage?.inputTokens ?? 0, completionTokens: usage?.outputTokens ?? 0, ...usageDetails(usage, providerMetadata as never) } });
      const nodes = text
        .split('\n')
        .map((line) => line.replace(/^\s*(?:\d+[.)]|[-*])\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 12);
      if (nodes.length) await emit({ type: 'workflow', streamDone: true, workflow: { nodes } });
      return nodes.length ? nodes.map((n, i) => `${i + 1}. ${n}`).join('\n') : null;
    } catch (error) {
      if (signal.aborted) throw error;
      // A failed plan is not a failed task: act without one.
      Logger.warn(`[VectorEngine] Planning failed, continuing without a plan: ${String((error as Error)?.message ?? error).slice(0, 200)}`);
      return null;
    }
  }

  private async verify(
    goal: string,
    summary: string,
    retries: number,
    signal: AbortSignal,
    emit: (message: Record<string, unknown>) => Promise<void>,
    steps: string[] = [],
    counts = '',
    tally?: RunTally,
  ): Promise<VerificationOutcome> {
    const agent = this.options.agent;
    return verifyCompletion(
      {
        goal,
        summary,
        steps,
        counts,
        tally,
        observe: () => agent.observeForCheck(),
        listApps: async () => parseAppList(await agent.launcherAppsText()),
        judge: async (text) => {
          const ask = (providerOptions: ReturnType<VectorEngine['callOptions']>) =>
            generateText({
              model: this.tracked(),
              providerOptions,
              prompt: text,
              // At 300, models that reason first often spent it all thinking and answered nothing ("No reason given").
              maxOutputTokens: 1000,
              temperature: 0,
              maxRetries: 2,
              abortSignal: AbortSignal.any([signal, AbortSignal.timeout(SIDE_CALL_MAX_MS)]),
            });
          let reply;
          try {
            reply = await ask(this.callOptions());
          } catch (error) {
            if (!(this.reasoningOff && isReasoningRejected(error))) throw error;
            this.reasoningOff = false;
            reply = await ask(this.callOptions(false));
          }
          const { text: answer, usage, providerMetadata } = reply;
          // The check's own model call counts in the run's totals.
          await emit({ type: 'finish', finishReason: 'stop', usage: { promptTokens: usage?.inputTokens ?? 0, completionTokens: usage?.outputTokens ?? 0, ...usageDetails(usage, providerMetadata as never) } });
          return answer;
        },
      },
      retries,
    );
  }
}
