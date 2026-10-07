import { AgentTask } from '@/entities/AgentTask';
import { AndroidTaskLog } from '@/entities/AndroidTaskLog';
import { FlowPatch } from '@/entities/FlowPatch';
import { FlowStats, SavedFlow } from '@/entities/SavedFlow';
import { User } from '@/entities/User';
import Logger from '@/logger/index';
import { AppDataSource } from '@/loaders/database';
import { Service } from 'typedi';
import {
  FLOW_FORMAT,
  type FlowParam,
  type FlowStepV2,
  matchTemplate,
  parseSteps,
  promptKey,
  recordFlow,
  type RecordedStep,
} from './flowSteps';

/** The account's four switches (Settings → Saved flows). All off by default. */
export interface FlowSettings {
  record: boolean;
  replay_first: boolean;
  ai_repair: boolean;
  share_fixes: boolean;
}

/** A flow chosen for a run, with the values the task's wording fills it with. */
export interface FlowPlan {
  flow: SavedFlow;
  steps: FlowStepV2[];
  params: FlowParam[];
  values: Record<string, string>;
}

/** How a run that used a flow ended. */
export type FlowMode = 'replay' | 'repaired' | 'fallback';

/** A fix is trusted fleet-wide after this many runs on at least this many phone models. */
export const PROMOTE_AFTER_RUNS = 3;
export const PROMOTE_MIN_MODELS = 2;
/** A promoted fix is undone after this many failed runs in a row. */
export const ROLLBACK_AFTER_FAILURES = 2;

const MAX_FLOWS_SCANNED = 300;
/** Typed text of recent runs, in memory only, so "Save as flow" right after a run still knows it. */
const TYPED_KEPT = 200;

const emptyStats = (): FlowStats => ({ runs: 0, replay_only: 0, repaired: 0, fell_back: 0, failed: 0, models: {} });

@Service()
export class FlowLibraryService {
  private flowRepo = AppDataSource.getRepository(SavedFlow);
  private patchRepo = AppDataSource.getRepository(FlowPatch);
  private logRepo = AppDataSource.getRepository(AndroidTaskLog);
  private typedByTask = new Map<number, Map<number, string>>();

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  async settings(userId: number): Promise<FlowSettings> {
    const user = await AppDataSource.getRepository(User)
      .findOne({ where: { id: userId }, select: ['id', 'flow_record', 'flow_replay_first', 'flow_ai_repair', 'flow_share_fixes'] })
      .catch(() => null);
    return {
      record: Boolean(user?.flow_record),
      replay_first: Boolean(user?.flow_replay_first),
      ai_repair: Boolean(user?.flow_ai_repair),
      share_fixes: Boolean(user?.flow_share_fixes),
    };
  }

  async setSettings(userId: number, input: Partial<Record<keyof FlowSettings, unknown>>): Promise<FlowSettings> {
    const patch: Partial<User> = {};
    if (input.record !== undefined) patch.flow_record = Boolean(input.record);
    if (input.replay_first !== undefined) patch.flow_replay_first = Boolean(input.replay_first);
    if (input.ai_repair !== undefined) patch.flow_ai_repair = Boolean(input.ai_repair);
    if (input.share_fixes !== undefined) patch.flow_share_fixes = Boolean(input.share_fixes);
    if (Object.keys(patch).length) await AppDataSource.getRepository(User).update({ id: userId }, patch);
    return this.settings(userId);
  }

  // -------------------------------------------------------------------------
  // Choosing a flow
  // -------------------------------------------------------------------------

  /** An enabled, checkable flow that fits this task's wording, or null. */
  async match(userId: number, prompt: string): Promise<FlowPlan | null> {
    const key = promptKey(prompt);
    const exact = await this.flowRepo.findOne({ where: { user_id: userId, format: FLOW_FORMAT, enabled: true, prompt_key: key }, order: { updated_at: 'DESC' } });
    const exactPlan = exact ? this.planFor(exact, prompt) : null;
    if (exactPlan) return exactPlan;
    const flows = await this.flowRepo.find({ where: { user_id: userId, format: FLOW_FORMAT, enabled: true }, order: { updated_at: 'DESC' }, take: MAX_FLOWS_SCANNED });
    for (const flow of flows) {
      if (!flow.template?.includes('{{')) continue;
      const plan = this.planFor(flow, prompt);
      if (plan) return plan;
    }
    return null;
  }

  /** A specific flow, for "Replay" on the Flows page (its own recorded wording fills it). */
  async byId(userId: number, flowId: number): Promise<FlowPlan | null> {
    const flow = await this.flowRepo.findOne({ where: { id: flowId, user_id: userId } });
    if (!flow || flow.format !== FLOW_FORMAT) return null;
    return this.planFor(flow, flow.source_prompt ?? '');
  }

  private planFor(flow: SavedFlow, prompt: string): FlowPlan | null {
    const values = flow.template ? matchTemplate(flow.template, prompt) : promptKey(prompt) === flow.prompt_key ? {} : null;
    if (!values) return null;
    const steps = parseSteps(flow.steps_json);
    if (!steps.length) return null;
    let params: FlowParam[] = [];
    try {
      params = JSON.parse(flow.params_json || '[]');
    } catch {
      params = [];
    }
    return { flow, steps, params, values };
  }

  // -------------------------------------------------------------------------
  // Recording
  // -------------------------------------------------------------------------

  /** What a run typed, kept in memory only (logs store "[REDACTED]"). */
  rememberTyped(taskId: number, typed: Map<number, string>): void {
    if (!typed.size) return;
    this.typedByTask.set(taskId, typed);
    while (this.typedByTask.size > TYPED_KEPT) {
      const oldest = this.typedByTask.keys().next().value;
      if (oldest === undefined) break;
      this.typedByTask.delete(oldest);
    }
  }

  /** The run's logged steps in the shape the recorder reads. */
  async recordedSteps(taskId: number, fromStep = 0, toStep = Number.MAX_SAFE_INTEGER): Promise<RecordedStep[]> {
    const logs = await this.logRepo
      .createQueryBuilder('l')
      .addSelect('l.ui_tree_before')
      .where('l.agent_task_id = :taskId', { taskId })
      .andWhere('l.step_index > :fromStep AND l.step_index <= :toStep', { fromStep, toStep })
      .orderBy('l.step_index', 'ASC')
      .getMany();
    const typed = this.typedByTask.get(taskId);
    return logs.map((l) => ({
      action: l.action_type,
      payload: (l.action_payload ?? {}) as Record<string, unknown>,
      ok: l.status === 'SUCCESS',
      treeBefore: l.ui_tree_before ?? null,
      treeAfter: typeof l.ui_tree_snapshot === 'string' ? l.ui_tree_snapshot : null,
      pkgBefore: l.package_before,
      pkgAfter: l.package_after,
      screenBefore: l.screen_before,
      screenAfter: l.screen_after,
      typed: typed?.get(l.step_index) ?? null,
    }));
  }

  /**
   * Save a run as a checkable flow. Automatic saves skip a task that already
   * has a flow; "Save as flow" always makes a new one.
   */
  async recordFromTask(task: AgentTask, options: { auto: boolean; name?: string; deviceModel?: string | null }): Promise<SavedFlow | null> {
    if (!task.prompt) return null;
    const recorded = recordFlow(task.prompt, await this.recordedSteps(task.id));
    if (!recorded.steps.length) return null;
    const key = promptKey(task.prompt);
    if (options.auto) {
      const existing = await this.flowRepo.findOne({ where: { user_id: task.user_id, format: FLOW_FORMAT, prompt_key: key } });
      if (existing) return null;
      if (recorded.template.includes('{{')) {
        const sameShape = await this.flowRepo.findOne({ where: { user_id: task.user_id, format: FLOW_FORMAT, template: recorded.template } });
        if (sameShape) return null;
      }
    }
    const flow = this.flowRepo.create({
      user_id: task.user_id,
      name: (options.name || task.prompt).slice(0, 150),
      source_prompt: task.prompt,
      source_task_id: task.id,
      steps_json: JSON.stringify(recorded.steps),
      step_count: recorded.steps.length,
      // Checkable steps act on the element, not its old pixels.
      coordinate_step_count: recorded.steps.filter((s) => s.action === 'tap' && !s.target?.label).length,
      format: FLOW_FORMAT,
      enabled: true,
      version: 1,
      prompt_key: key,
      template: recorded.template,
      params_json: JSON.stringify(recorded.params),
      package_name: recorded.packageName,
      auto: options.auto,
      checked: task.verification?.status === 'verified',
      ai_steps: recorded.aiSteps,
      stats: emptyStats(),
      source_device_model: options.deviceModel ?? null,
    });
    await this.flowRepo.save(flow);
    Logger.info(`[FlowLibrary] Saved flow ${flow.id} (${recorded.steps.length} steps${options.auto ? ', automatic' : ''}) from task ${task.id}`);
    return flow;
  }

  // -------------------------------------------------------------------------
  // Step fixes
  // -------------------------------------------------------------------------

  /** Saved fixes that may be tried for this broken step on this phone. */
  async patchesFor(flow: SavedFlow, stepIndex: number, deviceId: number | null, deviceModel: string | null, share: boolean): Promise<FlowPatch[]> {
    const candidates = await this.patchRepo.find({
      where: { flow_id: flow.id, flow_version: flow.version, step_index: stepIndex, status: 'candidate' },
      order: { successes: 'DESC', id: 'ASC' },
      take: 10,
    });
    // Unshared: only the phone that made it. Shared: any phone of the account
    // (that is how a fix proves itself on a second model), this phone's own first.
    const mine = (p: FlowPatch) => deviceId !== null && p.device_id === deviceId;
    const sameModel = (p: FlowPatch) => Boolean(deviceModel) && p.device_model === deviceModel;
    return candidates
      .filter((p) => mine(p) || share)
      .sort((a, b) => Number(mine(b)) - Number(mine(a)) || Number(sameModel(b)) - Number(sameModel(a)) || b.successes - a.successes);
  }

  async savePatch(flow: SavedFlow, stepIndex: number, resumeIndex: number, steps: FlowStepV2[], deviceId: number | null, deviceModel: string | null): Promise<FlowPatch | null> {
    if (!steps.length) return null;
    const patch = this.patchRepo.create({
      flow_id: flow.id,
      flow_version: flow.version,
      step_index: stepIndex,
      resume_index: resumeIndex,
      steps_json: JSON.stringify(steps),
      device_id: deviceId,
      device_model: deviceModel,
      status: 'candidate',
      // The run that made it is its first success (it only counts if the run passes its checks).
      successes: 0,
      failures: 0,
      models: [],
    });
    return this.patchRepo.save(patch);
  }

  /**
   * A fix was used on a run that then succeeded or failed. With sharing on,
   * enough successes on enough phone models promote it into the flow.
   */
  async patchOutcome(patchId: number, ok: boolean, deviceModel: string | null, share: boolean): Promise<void> {
    const patch = await this.patchRepo.findOne({ where: { id: patchId } });
    if (!patch || patch.status !== 'candidate') return;
    if (ok) {
      patch.successes += 1;
      const models = new Set(patch.models ?? []);
      if (deviceModel) models.add(deviceModel);
      patch.models = [...models];
    } else {
      patch.failures += 1;
      if (patch.failures >= 2 && patch.failures > patch.successes) patch.status = 'rejected';
    }
    await this.patchRepo.save(patch);
    if (ok && share && patch.successes >= PROMOTE_AFTER_RUNS && (patch.models?.length ?? 0) >= PROMOTE_MIN_MODELS) await this.promote(patch);
  }

  private async promote(patch: FlowPatch): Promise<void> {
    const flow = await this.flowRepo.findOne({ where: { id: patch.flow_id } });
    if (!flow || flow.version !== patch.flow_version) return;
    const steps = parseSteps(flow.steps_json);
    const fix = parseSteps(patch.steps_json);
    const next = [...steps.slice(0, patch.step_index), ...fix, ...steps.slice(patch.resume_index)];
    flow.previous_steps_json = flow.steps_json;
    flow.steps_json = JSON.stringify(next);
    flow.step_count = next.length;
    flow.version += 1;
    flow.fail_streak = 0;
    await this.flowRepo.save(flow);
    patch.status = 'promoted';
    await this.patchRepo.save(patch);
    Logger.info(`[FlowLibrary] Promoted fix ${patch.id} into flow ${flow.id} (now version ${flow.version})`);
  }

  // -------------------------------------------------------------------------
  // Outcomes
  // -------------------------------------------------------------------------

  /** Book a run that used the flow; a promoted fix that keeps failing is rolled back. */
  async recordOutcome(flowId: number, mode: FlowMode, ok: boolean, deviceModel: string | null): Promise<void> {
    const flow = await this.flowRepo.findOne({ where: { id: flowId } });
    if (!flow) return;
    const stats = { ...emptyStats(), ...(flow.stats ?? {}) };
    stats.runs += 1;
    if (!ok) stats.failed += 1;
    else if (mode === 'replay') stats.replay_only += 1;
    else if (mode === 'repaired') stats.repaired += 1;
    else stats.fell_back += 1;
    const model = deviceModel || 'unknown';
    const entry = stats.models[model] ?? { runs: 0, ok: 0 };
    stats.models = { ...stats.models, [model]: { runs: entry.runs + 1, ok: entry.ok + (ok ? 1 : 0) } };
    flow.stats = stats;
    flow.run_count += 1;
    flow.last_run_at = new Date();
    if (ok && mode !== 'fallback') flow.last_verified_at = new Date();
    flow.fail_streak = ok && mode !== 'fallback' ? 0 : flow.fail_streak + 1;
    if (flow.previous_steps_json && flow.fail_streak >= ROLLBACK_AFTER_FAILURES) {
      flow.steps_json = flow.previous_steps_json;
      flow.step_count = parseSteps(flow.steps_json).length;
      flow.previous_steps_json = null;
      flow.version += 1;
      flow.fail_streak = 0;
      Logger.info(`[FlowLibrary] Rolled back the last fix of flow ${flow.id} after ${ROLLBACK_AFTER_FAILURES} failed runs`);
    }
    await this.flowRepo.save(flow);
  }

  /** Whether any enabled flow fits (missions use this to decide on a first phone). */
  async hasMatch(userId: number, prompt: string): Promise<boolean> {
    return Boolean(await this.match(userId, prompt));
  }
}
