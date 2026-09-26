import Logger from '@/logger/index';
import type { AgentContext, AgentStreamMessage, Tool } from '@eko-ai/eko';
import { generateText, jsonSchema, streamText, tool, type LanguageModel, type ToolSet } from 'ai';
import type { AndroidAgent } from '../eko/AndroidAgent';
import type { AgentEngine, EngineMessageHandler, EngineRunResult, VerificationOutcome } from './AgentEngine';
import { buildContext, type StepRecord } from './contextBuilder';
import { parseAppList, verifyCompletion } from './successVerifier';

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
}

export const DEFAULT_HISTORY_BUDGET = 6000;
const MIN_RECENT_STEPS = 3;
/** Attempts per model call; only the model request is retried, never a phone action. */
const MODEL_ATTEMPTS = 3;
const MAX_VERIFICATION_RETRIES = 1;

/**
 * Actions that change something on the phone. If the phone does not confirm
 * one in time it may still have happened, so it is never re-sent; the engine
 * reads the screen and tells the model to check before repeating it.
 */
const NOT_IDEMPOTENT = new Set([
  'tap_coordinate',
  'click_node',
  'type_text',
  'long_press',
  'swipe',
  'scroll_element',
  'press_key',
  'paste',
  'global_action',
]);

const TASK_DONE = 'task_done';

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

function isRetryable(error: unknown): boolean {
  const e = error as { statusCode?: number; status?: number; message?: string; name?: string; cause?: unknown };
  if (e?.name === 'AbortError') return false;
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
export class VectorEngine implements AgentEngine {
  readonly kind = 'vector' as const;
  private controller: AbortController | null = null;
  private abortReason: string | null = null;
  private readonly tools: Tool[];
  private readonly toolSet: ToolSet;
  private callCounter = 0;

  constructor(private readonly options: VectorEngineOptions) {
    this.tools = options.agent.Tools;
    const set: ToolSet = {};
    for (const t of this.tools) {
      set[t.name] = tool({ description: t.description ?? '', inputSchema: jsonSchema(t.parameters as never) });
    }
    set[TASK_DONE] = tool({
      description: 'Finish the task. success=true when the goal is achieved, false when it cannot be done. summary: one short sentence.',
      inputSchema: jsonSchema({
        type: 'object',
        properties: {
          success: { type: 'boolean', description: 'Whether the goal was achieved' },
          summary: { type: 'string', description: 'What was done and what is on screen now, or why it could not be done' },
        },
        required: ['success', 'summary'],
        additionalProperties: false,
      } as never),
    });
    this.toolSet = set;
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

    const system = `${await this.options.agent.systemPrompt()}${VECTOR_RULES}`;
    const plan = this.options.planner ? await this.makePlan(prompt, signal, emit) : null;
    const steps: StepRecord[] = [];
    const notes: string[] = [];
    let verificationRetries = 0;
    const maxCalls = this.options.maxModelCalls ?? 600;

    for (let call = 0; call < maxCalls; call += 1) {
      if (signal.aborted) return this.aborted();

      const context = buildContext({
        task: prompt,
        plan,
        steps,
        budgetTokens: this.options.historyBudgetTokens ?? DEFAULT_HISTORY_BUDGET,
        minRecent: MIN_RECENT_STEPS,
        vision: this.options.vision,
        notes,
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
          usage: { promptTokens: turn.inputTokens, completionTokens: turn.outputTokens, totalTokens: turn.inputTokens + turn.outputTokens },
        });
      };

      let done: { success: boolean; summary: string } | null = null;
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
        const record = await this.executeTool(c.toolName, c.input, callId, thought.slice(-600));
        await emit({
          type: 'tool_result',
          toolCallId: callId,
          toolName: c.toolName,
          params: c.input ?? {},
          toolResult: { content: [{ type: 'text', text: record.resultText }], isError: record.isError },
        });
        steps.push(record);
      }
      await bookUsage();

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

      const outcome = await this.verify(prompt, done.summary, verificationRetries, signal, emit);
      if (outcome.status === 'failed' && verificationRetries < MAX_VERIFICATION_RETRIES) {
        verificationRetries += 1;
        notes.push(`SYSTEM CHECK FAILED: ${outcome.reason}. The task is not finished — look at the current screen, carry on, and call task_done again when it is really done.`);
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
    for (let attempt = 1; attempt <= MODEL_ATTEMPTS; attempt += 1) {
      if (signal.aborted) throw new Error('aborted');
      try {
        return await this.streamOnce(system, messages, signal, emit);
      } catch (error) {
        lastError = error;
        if (signal.aborted || !isRetryable(error) || attempt === MODEL_ATTEMPTS) throw error;
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
    const result = streamText({
      model: this.options.model,
      system,
      messages,
      tools: this.toolSet,
      toolChoice: 'auto',
      maxOutputTokens: this.options.maxOutputTokens ?? 16000,
      temperature: this.options.temperature ?? 0.1,
      maxRetries: 0,
      abortSignal: signal,
      // Errors are handled (and logged once) by callModel; the default handler would print each one again.
      onError: () => undefined,
    });
    const turn: ModelTurn = { text: '', reasoning: '', toolCalls: [], inputTokens: 0, outputTokens: 0 };
    let lastEmit = 0;
    const flush = async (force = false) => {
      if (!force && Date.now() - lastEmit < 400) return;
      lastEmit = Date.now();
      if (turn.reasoning) await emit({ type: 'thinking', text: turn.reasoning });
      if (turn.text) await emit({ type: 'text', text: turn.text });
    };
    for await (const part of result.fullStream) {
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
        case 'finish':
          turn.inputTokens = part.totalUsage?.inputTokens ?? 0;
          turn.outputTokens = part.totalUsage?.outputTokens ?? 0;
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
      const { text, usage } = await generateText({
        model: this.options.model,
        system: PLANNER_PROMPT,
        prompt,
        maxOutputTokens: 600,
        temperature: 0.1,
        maxRetries: 2,
        abortSignal: signal,
      });
      await emit({ type: 'finish', finishReason: 'stop', usage: { promptTokens: usage?.inputTokens ?? 0, completionTokens: usage?.outputTokens ?? 0 } });
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
  ): Promise<VerificationOutcome> {
    const agent = this.options.agent;
    return verifyCompletion(
      {
        goal,
        summary,
        observe: () => agent.observeForCheck(),
        listApps: async () => parseAppList(await agent.launcherAppsText()),
        judge: async (text) => {
          const { text: answer, usage } = await generateText({
            model: this.options.model,
            prompt: text,
            maxOutputTokens: 300,
            temperature: 0,
            maxRetries: 2,
            abortSignal: signal,
          });
          // The check's own model call counts in the run's totals.
          await emit({ type: 'finish', finishReason: 'stop', usage: { promptTokens: usage?.inputTokens ?? 0, completionTokens: usage?.outputTokens ?? 0 } });
          return answer;
        },
      },
      retries,
    );
  }
}
