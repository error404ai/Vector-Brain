import Logger from '@/logger/index';
import { Eko, type LLMs } from '@eko-ai/eko';
import type { AndroidAgent } from '../eko/AndroidAgent';
import type { AgentEngine, EngineMessageHandler, EngineRunResult } from './AgentEngine';

/** The Eko framework as an engine: planner call, Eko ReAct loop, Eko compression. Unchanged behaviour. */
export class EkoEngine implements AgentEngine {
  readonly kind = 'eko' as const;
  private readonly eko: Eko;
  private readonly runIds: string[] = [];
  private currentRunId: string | null = null;

  constructor(llms: LLMs, agent: AndroidAgent, onMessage: EngineMessageHandler) {
    this.eko = new Eko({ llms, agents: [agent], callback: { onMessage } });
  }

  async run(prompt: string, runId: string): Promise<EngineRunResult> {
    this.currentRunId = runId;
    this.runIds.push(runId);
    const result = await this.eko.run(prompt, runId);
    return { success: result.success, stopReason: result.stopReason, result: result.result };
  }

  abort(reason: string): void {
    if (!this.currentRunId) return;
    try {
      this.eko.abortTask(this.currentRunId, reason);
    } catch (error) {
      Logger.warn(`[EkoEngine] Failed to abort ${this.currentRunId}:`, error);
    }
  }

  dispose(): void {
    for (const id of this.runIds) {
      try {
        this.eko.deleteTask(id);
      } catch (error) {
        Logger.warn(`[EkoEngine] Failed to release Eko task ${id}:`, error);
      }
    }
  }
}
