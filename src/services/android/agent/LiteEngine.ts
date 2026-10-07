import Logger from '@/logger/index';
import type { AgentContext, AgentStreamMessage, Tool } from '@eko-ai/eko';
import { generateText, type LanguageModel } from 'ai';
import type { AndroidAgent } from '../eko/AndroidAgent';
import type { AgentEngine, EngineMessageHandler, EngineRunResult, VerificationOutcome } from './AgentEngine';
import {
  LITE_RULES,
  buildLitePrompt,
  compactScreen,
  historyEntry,
  labelOf,
  parseLiteAction,
  resultNote,
  screenFromResult,
  screenUnchanged,
  type LiteToolCall,
} from './liteProtocol';
import { parseAppList, verifyCompletion } from './successVerifier';
import { DEFAULT_CALL_IDLE_MS, VectorEngine, isQuota, isRateLimited, isRetryable } from './VectorEngine';

export interface LiteEngineOptions {
  model: LanguageModel;
  agent: AndroidAgent;
  onMessage: EngineMessageHandler;
  /** Passed to the Vector helper; Lite itself never sends images. */
  vision: boolean;
  fallback?: { model: LanguageModel; label: string };
  verify?: boolean;
  /** Lite model calls allowed for one run; the planner's step limit usually stops a run first. */
  maxModelCalls?: number;
  /** Output cap for one Lite call. A reply is one line; reasoning models need room to think first. */
  maxOutputTokens?: number;
  /** Abandon a Lite call that has not answered after this long (ms). */
  callMaxMs?: number;
  /** For the Vector helper (see VectorEngineOptions). */
  callIdleMs?: number;
  helperCallMaxMs?: number;
  /** Model calls the Vector helper gets each time Lite is stuck. */
  helperCalls?: number;
  /** After this many helper rounds the helper finishes the task on its own. */
  maxHelperRounds?: number;
}

const MODEL_ATTEMPTS = 3;
const DEFAULT_CALL_MAX_MS = 60_000;
const DEFAULT_HELPER_CALLS = 3;
const DEFAULT_HELPER_ROUNDS = 5;
const MAX_VERIFICATION_RETRIES = 1;
/** Consecutive bad replies, unchanged screens or failed actions before the helper is called. */
const STUCK_AFTER = 2;
const JUDGE_MAX_MS = 60_000;

interface LiteTurn {
  text: string;
  reasoning: string;
  inputTokens: number;
  outputTokens: number;
}

type Emit = (message: Record<string, unknown>) => Promise<void>;

/**
 * Vector Brain's cheapest engine: a short text prompt per step and a one-line
 * reply (see liteProtocol), with no tool schemas, no screenshots and no growing
 * message history. When the cheap loop gets stuck — the model asks for help,
 * says the task is impossible, or keeps failing or changing nothing — the full
 * Vector engine takes over for a few calls and hands back.
 *
 * Messages to the planner have the same shape as the other engines', so step
 * records, the step limit, loop guards and token totals work unchanged.
 */
export class LiteEngine implements AgentEngine {
  readonly kind = 'lite' as const;
  private controller: AbortController | null = null;
  private abortReason: string | null = null;
  private readonly tools: Tool[];
  private model: LanguageModel;
  private onFallback = false;
  private callCounter = 0;
  private helper: VectorEngine | null = null;
  private helperRounds = 0;

  get usedBackupModel(): boolean {
    return this.onFallback;
  }

  constructor(private readonly options: LiteEngineOptions) {
    this.model = options.model;
    this.tools = options.agent.Tools;
  }

  abort(reason: string): void {
    this.abortReason = reason;
    this.controller?.abort(reason);
    this.helper?.abort(reason);
  }

  dispose(): void {
    this.controller?.abort('disposed');
    this.controller = null;
    this.helper?.dispose();
  }

  async run(prompt: string, runId: string): Promise<EngineRunResult> {
    this.controller = new AbortController();
    this.abortReason = null;
    const signal = this.controller.signal;
    const envelope = { streamType: 'agent', chatId: runId, taskId: runId, agentName: 'AndroidAgent' };
    const emit: Emit = (message) => this.options.onMessage({ ...envelope, ...message } as unknown as AgentStreamMessage);

    const first = await this.options.agent.observeForCheck().catch(() => null);
    let tree: string | null = first?.tree ?? null;
    let app: string | null = first?.packageName ?? null;
    const history: string[] = [];
    const notes: string[] = [];
    let lastNote: string | null = first ? null : 'The screen could not be read.';
    let invalid = 0;
    let unchanged = 0;
    let failures = 0;
    let verificationRetries = 0;
    const maxCalls = this.options.maxModelCalls ?? 600;

    for (let call = 0; call < maxCalls; call += 1) {
      if (signal.aborted) return this.aborted();

      const stuck = invalid >= STUCK_AFTER ? 'my replies could not be read' : unchanged >= STUCK_AFTER ? 'my actions changed nothing on screen' : failures >= STUCK_AFTER ? 'my actions kept failing' : null;
      if (stuck) {
        const handed = await this.callHelper(prompt, runId, history, stuck, signal);
        if (handed.final) return handed.final;
        ({ tree, app } = handed);
        lastNote = 'A helper took over for a few steps; continue from this screen.';
        invalid = unchanged = failures = 0;
        continue;
      }

      const text = buildLitePrompt({ task: prompt, history, lastNote, app, screen: compactScreen(tree), notes });
      notes.length = 0;
      let turn: LiteTurn;
      try {
        turn = await this.callModel(text, signal, emit);
      } catch (error) {
        if (signal.aborted) return this.aborted();
        throw error;
      }
      let booked = false;
      const bookUsage = async () => {
        if (booked) return;
        booked = true;
        await emit({
          type: 'finish',
          finishReason: 'stop',
          usage: { promptTokens: turn.inputTokens, completionTokens: turn.outputTokens, totalTokens: turn.inputTokens + turn.outputTokens },
        });
      };

      const action = parseLiteAction(turn.text);
      if (turn.reasoning) await emit({ type: 'thinking', text: turn.reasoning.slice(-600) });
      if (turn.text.trim()) await emit({ type: 'text', text: turn.text.trim().slice(0, 300) });

      if (action.kind === 'invalid') {
        await bookUsage();
        invalid += 1;
        lastNote = `Your reply "${action.text.slice(0, 80)}" is not a command. Reply with ONE line such as "T 4".`;
        continue;
      }
      invalid = 0;

      if (action.kind === 'escalate' || action.kind === 'failed') {
        await bookUsage();
        // A cheap model gives up early; the full engine has the last word on "impossible".
        const reason = action.kind === 'escalate' ? action.reason : `I think it cannot be done: ${action.summary}`;
        const handed = await this.callHelper(prompt, runId, history, reason, signal);
        if (handed.final) return handed.final;
        ({ tree, app } = handed);
        lastNote = 'A helper took over for a few steps; continue from this screen.';
        unchanged = failures = 0;
        continue;
      }

      if (action.kind === 'done') {
        await bookUsage();
        await emit({ type: 'agent_result', result: action.summary });
        if (this.options.verify === false) {
          return { success: true, stopReason: 'done', result: action.summary, verification: { status: 'unverified', method: 'none', reason: 'Verification is off', retries: 0 } };
        }
        const outcome = await this.verify(prompt, action.summary, verificationRetries, signal, emit);
        if (outcome.status === 'failed' && verificationRetries < MAX_VERIFICATION_RETRIES) {
          verificationRetries += 1;
          notes.push(`SYSTEM CHECK FAILED: ${outcome.reason}. The task is not finished; carry on.`);
          const fresh = await this.options.agent.observeForCheck().catch(() => null);
          if (fresh) ({ tree, packageName: app } = fresh);
          continue;
        }
        if (outcome.status === 'failed') {
          return { success: false, stopReason: 'done', result: `${action.summary}\n\nSystem check: ${outcome.reason}`, reasonCode: 'VERIFICATION_FAILED', verification: outcome };
        }
        return { success: true, stopReason: 'done', result: action.summary, verification: outcome };
      }

      // Tools: run in order, stop at the first failure.
      const label = action.calls[0]?.tool === 'tap_element' ? labelOf(tree, String(action.calls[0].args.idx)) : null;
      const prevApp = app;
      let ok = true;
      let lastText = '';
      let sawTree = false;
      for (const c of action.calls) {
        if (signal.aborted) return this.aborted();
        const record = await this.executeTool(c, emit, bookUsage);
        lastText = record.text;
        const seen = screenFromResult(record.text);
        if (seen.tree) {
          tree = seen.tree;
          sawTree = true;
        }
        if (seen.app) app = seen.app;
        if (record.isError) {
          ok = false;
          break;
        }
      }
      await bookUsage();
      if (!sawTree) {
        const fresh = await this.options.agent.observeForCheck().catch(() => null);
        if (fresh) ({ tree, packageName: app } = fresh);
      }
      const same = ok && screenUnchanged(lastText);
      unchanged = same ? unchanged + 1 : 0;
      failures = ok ? 0 : failures + 1;
      history.push(historyEntry(action.code, { ok, unchanged: same, app, prevApp, label }));
      lastNote = resultNote(lastText) || null;
    }
    return { success: false, stopReason: 'max_calls', result: 'unfinished', reasonCode: 'STEP_LIMIT' };
  }

  // -------------------------------------------------------------------------

  private aborted(): EngineRunResult {
    return { success: false, stopReason: 'abort', result: this.abortReason ?? 'Aborted' };
  }

  private async executeTool(c: LiteToolCall, emit: Emit, bookUsage: () => Promise<void>): Promise<{ text: string; isError: boolean }> {
    const callId = `l${++this.callCounter}`;
    await emit({ type: 'tool_use', toolCallId: callId, toolName: c.tool, params: c.args });
    // Usage belongs to the first step the call chose.
    await bookUsage();
    const definition = this.tools.find((t) => t.name === c.tool);
    let text = '';
    let isError = false;
    if (!definition) {
      text = `Unknown tool "${c.tool}".`;
      isError = true;
    } else {
      try {
        const result = await definition.execute(c.args, {} as AgentContext, {
          type: 'tool-call',
          toolCallId: callId,
          toolName: c.tool,
          input: JSON.stringify(c.args),
        } as never);
        isError = Boolean(result?.isError);
        for (const part of result?.content ?? []) if (part.type === 'text') text += (text ? '\n\n' : '') + part.text;
      } catch (error) {
        isError = true;
        text = `Action failed: ${String((error as Error)?.message ?? error)}`;
      }
    }
    await emit({ type: 'tool_result', toolCallId: callId, toolName: c.tool, params: c.args, toolResult: { content: [{ type: 'text', text }], isError } });
    return { text, isError };
  }

  /**
   * The full Vector engine for a few calls. It ends the task when it finishes
   * (done, failed or aborted); when its calls run out it hands the phone back.
   */
  private async callHelper(
    task: string,
    runId: string,
    history: string[],
    reason: string,
    signal: AbortSignal,
  ): Promise<{ final?: EngineRunResult; tree: string | null; app: string | null }> {
    this.helperRounds += 1;
    const last = this.helperRounds > (this.options.maxHelperRounds ?? DEFAULT_HELPER_ROUNDS);
    const helperHistory: string[] = [];
    const onMessage: EngineMessageHandler = async (message) => {
      const m = message as unknown as { type?: string; toolName?: string; params?: unknown; toolResult?: { isError?: boolean } };
      if (m.type === 'tool_result') helperHistory.push(`helper: ${m.toolName} ${JSON.stringify(m.params ?? {}).slice(0, 60)} → ${m.toolResult?.isError ? 'failed' : 'ok'}`);
      await this.options.onMessage(message);
    };
    const progress = history.length ? `\n\nSTEPS ALREADY TAKEN (short form):\n${history.slice(-12).join('\n')}` : '';
    const brief = last
      ? `${task}${progress}\n\nFinish the task from the current screen.`
      : `${task}${progress}\n\nThe fast agent working on this got stuck: ${reason}.\nLook at the current screen and get past this point. If the task is complete, call task_done. You have only a few actions; after that the fast agent carries on from the screen you leave.`;
    Logger.info(`[LiteEngine] Helper round ${this.helperRounds}${last ? ' (final)' : ''}: ${reason}`);
    this.helper = new VectorEngine({
      model: this.model,
      fallback: this.onFallback ? undefined : this.options.fallback,
      agent: this.options.agent,
      onMessage,
      vision: this.options.vision,
      planner: false,
      verify: this.options.verify,
      maxModelCalls: last ? undefined : this.options.helperCalls ?? DEFAULT_HELPER_CALLS,
      callIdleMs: this.options.callIdleMs ?? DEFAULT_CALL_IDLE_MS,
      callMaxMs: this.options.helperCallMaxMs,
      callIdPrefix: `h${this.helperRounds}-`,
    });
    try {
      if (signal.aborted) return { final: this.aborted(), tree: null, app: null };
      const result = await this.helper.run(brief, runId);
      if (this.helper.usedBackupModel && this.options.fallback && !this.onFallback) {
        this.onFallback = true;
        this.model = this.options.fallback.model;
      }
      if (result.stopReason !== 'max_calls' || last) return { final: result, tree: null, app: null };
    } finally {
      this.helper.dispose();
      this.helper = null;
    }
    history.push(...helperHistory.slice(-4));
    const fresh = await this.options.agent.observeForCheck().catch(() => null);
    return { tree: fresh?.tree ?? null, app: fresh?.packageName ?? null };
  }

  /** One Lite call, retried only on transient errors. */
  private async callModel(prompt: string, signal: AbortSignal, emit: Emit): Promise<LiteTurn> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= MODEL_ATTEMPTS; attempt += 1) {
      if (signal.aborted) throw new Error('aborted');
      try {
        const result = await generateText({
          model: this.model,
          system: LITE_RULES,
          prompt,
          maxOutputTokens: this.options.maxOutputTokens ?? 1024,
          temperature: 0,
          maxRetries: 0,
          abortSignal: AbortSignal.any([signal, AbortSignal.timeout(this.options.callMaxMs ?? DEFAULT_CALL_MAX_MS)]),
        });
        return {
          text: result.text ?? '',
          reasoning: result.reasoningText ?? '',
          inputTokens: result.usage?.inputTokens ?? 0,
          outputTokens: result.usage?.outputTokens ?? 0,
        };
      } catch (error) {
        lastError = error;
        if (signal.aborted) throw error;
        if ((isQuota(error) || isRateLimited(error)) && this.options.fallback && !this.onFallback) {
          this.onFallback = true;
          this.model = this.options.fallback.model;
          const why = isQuota(error) ? 'has used up its limit' : 'is rate-limited';
          Logger.warn(`[LiteEngine] Main model ${why}; switching to ${this.options.fallback.label}`);
          await emit({ type: 'thinking', text: `The main AI model ${why} — continuing with the backup model (${this.options.fallback.label}).` });
          attempt -= 1;
          continue;
        }
        const timedOut = (error as { name?: string })?.name === 'TimeoutError';
        if ((!isRetryable(error) && !timedOut) || attempt === MODEL_ATTEMPTS) throw error;
        const wait = 1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 500);
        Logger.warn(`[LiteEngine] Model call failed (attempt ${attempt}/${MODEL_ATTEMPTS}), retrying in ${wait}ms: ${String((error as Error)?.message ?? error).slice(0, 200)}`);
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }
    throw lastError;
  }

  private async verify(goal: string, summary: string, retries: number, signal: AbortSignal, emit: Emit): Promise<VerificationOutcome> {
    const agent = this.options.agent;
    return verifyCompletion(
      {
        goal,
        summary,
        observe: () => agent.observeForCheck(),
        listApps: async () => parseAppList(await agent.launcherAppsText()),
        judge: async (text) => {
          const { text: answer, usage } = await generateText({
            model: this.model,
            prompt: text,
            // Room for reasoning models: at 300 they often spent it all thinking and returned nothing.
            maxOutputTokens: 1000,
            temperature: 0,
            maxRetries: 2,
            abortSignal: AbortSignal.any([signal, AbortSignal.timeout(JUDGE_MAX_MS)]),
          });
          await emit({ type: 'finish', finishReason: 'stop', usage: { promptTokens: usage?.inputTokens ?? 0, completionTokens: usage?.outputTokens ?? 0 } });
          return answer;
        },
      },
      retries,
    );
  }
}
