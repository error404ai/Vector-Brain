import { AgentTask } from '@/entities/AgentTask';
import { AndroidDevice } from '@/entities/AndroidDevice';
import { AndroidTaskLog } from '@/entities/AndroidTaskLog';
import { ClientReport } from '@/entities/ClientReport';
import { Mission } from '@/entities/Mission';
import { MissionItem } from '@/entities/MissionItem';
import { SavedFlow } from '@/entities/SavedFlow';
import AppError from '@/helpers/AppError';
import Logger from '@/logger/index';
import { AppDataSource } from '@/loaders/database';
import { once } from 'events';
import { Writable } from 'stream';
import { Service } from 'typedi';
import { In, MoreThanOrEqual } from 'typeorm';
import { DiagnosticsSanitizer, TreeRow } from './diagnosticsSanitizer';
import {
  RECOVERY_LABELS,
  RecoveryKind,
  RunDiagnostics,
  RunTotals,
  StepLite,
  WASTE_LABELS,
  WasteTag,
  classifyOutcome,
  outcomeBreakdown,
  outcomeOf,
  summarizeRun,
  tagWaste,
} from './runDiagnostics';
import { failureKind } from './failureKind';

/** Columns a diagnostics pass reads; never the screenshot. */
const STEP_COLUMNS: (keyof AndroidTaskLog)[] = [
  'id',
  'agent_task_id',
  'step_index',
  'action_type',
  'action_payload',
  'status',
  'duration_ms',
  'think_ms',
  'source',
  'package_before',
  'package_after',
  'screen_before',
  'screen_after',
  'llm_call',
  'prompt_tokens',
  'completion_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'reasoning_tokens',
  'cost_usd',
  'waste',
];

/** Sum of two amounts where null means "not reported": known if either side is. */
function addKnown(a: number | null | undefined, b: number | null | undefined): number | null {
  return a == null && b == null ? null : (a ?? 0) + (b ?? 0);
}

const MAX_REPORT_RUNS = 2000;

/**
 * Explains where each run's steps, time and tokens went, and makes that
 * readable: per run (written when the run ends), as a report for the owner,
 * and as a sanitized export that can leave the server.
 */
@Service()
export class RunDiagnosticsService {
  private taskRepo = AppDataSource.getRepository(AgentTask);
  private logRepo = AppDataSource.getRepository(AndroidTaskLog);

  /**
   * Tag the run's steps and store its summary. Called when a run ends; never
   * throws, because diagnostics must not change how a run finishes.
   * A continued task adds this run's model usage to what earlier runs stored.
   */
  async finalize(taskId: number, totals: RunTotals): Promise<RunDiagnostics | null> {
    try {
      const task = await this.taskRepo.findOne({ where: { id: taskId }, select: ['id', 'diagnostics', 'status', 'verification'] });
      if (!task) return null;
      const steps = await this.logRepo.find({
        where: { agent_task_id: taskId },
        select: STEP_COLUMNS,
        order: { step_index: 'ASC', id: 'ASC' },
      });
      const tags = tagWaste(steps as StepLite[]);

      // Only rows whose tag changed are written, grouped by tag.
      const changes = new Map<string | null, number[]>();
      steps.forEach((step, index) => {
        const tag = tags[index];
        if ((step.waste ?? null) !== tag) {
          const ids = changes.get(tag) ?? [];
          ids.push(step.id);
          changes.set(tag, ids);
        }
      });
      for (const [tag, ids] of changes) {
        await this.logRepo.update({ id: In(ids) }, { waste: tag });
      }

      const previous = task.diagnostics;
      // Engine-level recoveries: this run's, what earlier runs of a continued
      // task recorded, and the completion check sending the agent back.
      const engineRecoveries: RecoveryKind[] = [...(totals.recoveries ?? [])];
      for (const kind of ['backup_model', 'obstacle'] as const) {
        for (let i = 0; i < (previous?.recoveries?.[kind] ?? 0); i += 1) engineRecoveries.push(kind);
      }
      for (let i = 0; i < (task.verification?.retries ?? 0); i += 1) engineRecoveries.push('verify_retry');
      const merged: RunTotals = previous
        ? {
            llmCalls: (previous.llm_calls ?? 0) + totals.llmCalls,
            promptTokens: (previous.prompt_tokens ?? 0) + totals.promptTokens,
            completionTokens: (previous.completion_tokens ?? 0) + totals.completionTokens,
            tokensReported: Boolean(previous.tokens_reported) || totals.tokensReported,
            cacheReadTokens: (previous.cache_read_tokens ?? 0) + (totals.cacheReadTokens ?? 0),
            cacheWriteTokens: addKnown(previous.cache_write_tokens, totals.cacheWriteTokens),
            reasoningTokens: (previous.reasoning_tokens ?? 0) + (totals.reasoningTokens ?? 0),
            costUsd: addKnown(previous.cost_usd, totals.costUsd),
            recoveries: engineRecoveries,
          }
        : { ...totals, recoveries: engineRecoveries };
      const diagnostics = summarizeRun(steps as StepLite[], tags, merged);
      const outcome = classifyOutcome({ status: task.status, recoveries: diagnostics.recoveries, verification: task.verification });
      await this.taskRepo.update({ id: taskId }, { diagnostics, outcome });
      return diagnostics;
    } catch (error) {
      Logger.warn(`[RunDiagnostics] Could not finalize task ${taskId}:`, error);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Report (owner only; see DiagnosticsController)
  // ---------------------------------------------------------------------------

  async summary(days: number) {
    const tasks = await this.recentTasks(days);
    // Runs with no recorded steps (older runs, or a run that never reached the phone) explain nothing.
    const withDiagnostics = tasks.filter((t) => (t.diagnostics?.steps ?? 0) > 0);

    const waste: Partial<Record<WasteTag, number>> = {};
    const actions: Record<string, number> = {};
    let steps = 0;
    let wasted = 0;
    let llmCalls = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let tokenRuns = 0;
    let cacheReadTokens = 0;
    let costUsd = 0;
    let costRuns = 0;
    let thinkMs = 0;
    let phoneMs = 0;
    let waitMs = 0;
    let vision = 0;
    const packages = new Map<string, { runs: number; steps: number; wasted: number }>();

    for (const task of withDiagnostics) {
      const d = task.diagnostics as RunDiagnostics;
      steps += d.steps;
      wasted += d.wasted;
      llmCalls += d.llm_calls;
      if (d.tokens_reported) {
        tokenRuns += 1;
        promptTokens += d.prompt_tokens;
        completionTokens += d.completion_tokens;
        cacheReadTokens += d.cache_read_tokens ?? 0;
      }
      if (d.cost_usd != null) {
        costRuns += 1;
        costUsd += d.cost_usd;
      }
      thinkMs += d.think_ms;
      phoneMs += d.phone_ms;
      waitMs += d.wait_ms;
      vision += d.vision;
      for (const [tag, n] of Object.entries(d.waste)) waste[tag as WasteTag] = (waste[tag as WasteTag] ?? 0) + (n ?? 0);
      for (const [action, n] of Object.entries(d.actions)) actions[action] = (actions[action] ?? 0) + n;
      for (const pkg of d.packages) {
        const entry = packages.get(pkg) ?? { runs: 0, steps: 0, wasted: 0 };
        entry.runs += 1;
        entry.steps += d.steps;
        entry.wasted += d.wasted;
        packages.set(pkg, entry);
      }
    }

    // Same instruction (normalised) → how it performs across runs.
    const byTask = new Map<string, { prompt: string; runs: number; succeeded: number; steps: number; wasted: number; measured: number }>();
    for (const task of tasks) {
      const key = normalisePrompt(task.prompt);
      if (!key) continue;
      const entry = byTask.get(key) ?? { prompt: String(task.prompt ?? '').slice(0, 160), runs: 0, succeeded: 0, steps: 0, wasted: 0, measured: 0 };
      entry.runs += 1;
      if (task.status === 'SUCCEEDED') entry.succeeded += 1;
      entry.steps += task.total_steps ?? 0;
      if ((task.diagnostics?.steps ?? 0) > 0) {
        entry.measured += 1;
        entry.wasted += task.diagnostics.wasted;
      }
      byTask.set(key, entry);
    }

    const succeeded = tasks.filter((t) => t.status === 'SUCCEEDED');
    const outcomes = outcomeBreakdown(tasks);
    const recoveries: Partial<Record<RecoveryKind, number>> = {};
    for (const task of tasks) {
      for (const [kind, n] of Object.entries(task.diagnostics?.recoveries ?? {})) {
        recoveries[kind as RecoveryKind] = (recoveries[kind as RecoveryKind] ?? 0) + (n ?? 0);
      }
    }

    // Engine comparison: same measures per engine, over runs that reached the phone.
    const byEngine = new Map<string, AgentTask[]>();
    for (const task of tasks) {
      // A run its saved flow finished with no AI counts as replay, like a Flows-page replay.
      const key = task.provider === 'replay' || task.flow_mode === 'replay' ? 'replay' : task.engine ?? 'eko';
      byEngine.set(key, [...(byEngine.get(key) ?? []), task]);
    }
    const engines = [...byEngine.entries()].map(([engine, list]) => {
      const measured = list.filter((t) => (t.diagnostics?.steps ?? 0) > 0);
      const avg = (pick: (d: RunDiagnostics) => number) =>
        measured.length ? round(measured.reduce((sum, t) => sum + pick(t.diagnostics as RunDiagnostics), 0) / measured.length) : null;
      const finished = list.filter((t) => t.status === 'SUCCEEDED' || t.status === 'FAILED');
      return {
        engine,
        runs: list.length,
        measured_runs: measured.length,
        success_rate: finished.length ? round(finished.filter((t) => t.status === 'SUCCEEDED').length / finished.length) : null,
        avg_steps: avg((d) => d.steps),
        avg_wasted: avg((d) => d.wasted),
        avg_llm_calls: avg((d) => d.llm_calls),
        avg_tokens: avg((d) => (d.tokens_reported ? d.prompt_tokens + d.completion_tokens : 0)),
        avg_think_s: avg((d) => d.think_ms / 1000),
        avg_cached_tokens: avg((d) => (d.tokens_reported ? d.cache_read_tokens ?? 0 : 0)),
        // Over the runs whose provider reported a cost; precise to a hundredth of a cent.
        avg_cost_usd: (() => {
          const costed = measured.filter((t) => (t.diagnostics as RunDiagnostics).cost_usd != null);
          return costed.length ? Math.round((costed.reduce((sum, t) => sum + ((t.diagnostics as RunDiagnostics).cost_usd ?? 0), 0) / costed.length) * 1e6) / 1e6 : null;
        })(),
        verified: list.filter((t) => t.verification?.status === 'verified').length,
        unverified: list.filter((t) => t.verification?.status === 'unverified').length,
        failed_verification: list.filter((t) => t.verification?.status === 'failed').length,
        outcomes: outcomeBreakdown(list),
      };
    });

    return {
      data: {
        days,
        runs: tasks.length,
        measured_runs: withDiagnostics.length,
        succeeded: succeeded.length,
        failed: tasks.filter((t) => t.status === 'FAILED').length,
        replay_runs: tasks.filter((t) => t.provider === 'replay' || t.flow_mode === 'replay').length,
        /** Runs that used a saved flow: done by it alone, after a step fix, or finished by the AI. */
        flow_runs: {
          replay: tasks.filter((t) => t.flow_mode === 'replay').length,
          repaired: tasks.filter((t) => t.flow_mode === 'repaired').length,
          fallback: tasks.filter((t) => t.flow_mode === 'fallback').length,
        },
        outcomes,
        recoveries: Object.entries(recoveries)
          .map(([kind, count]) => ({ kind, label: RECOVERY_LABELS[kind as RecoveryKind] ?? kind, count }))
          .sort((a, b) => b.count - a.count),
        engines,
        avg_steps_succeeded: succeeded.length ? round(succeeded.reduce((s, t) => s + (t.total_steps ?? 0), 0) / succeeded.length) : 0,
        steps,
        wasted,
        waste: Object.entries(waste)
          .map(([tag, count]) => ({ tag, label: WASTE_LABELS[tag as WasteTag] ?? tag, count }))
          .sort((a, b) => b.count - a.count),
        actions: Object.entries(actions)
          .map(([action, count]) => ({ action, count }))
          .sort((a, b) => b.count - a.count),
        llm_calls: llmCalls,
        token_runs: tokenRuns,
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        cache_read_tokens: cacheReadTokens,
        cost_usd: Math.round(costUsd * 1e6) / 1e6,
        cost_runs: costRuns,
        think_ms: thinkMs,
        phone_ms: phoneMs,
        wait_ms: waitMs,
        vision,
        top_packages: [...packages.entries()]
          .map(([pkg, v]) => ({ package: pkg, ...v }))
          .sort((a, b) => b.wasted - a.wasted || b.steps - a.steps)
          .slice(0, 10),
        repeated_tasks: [...byTask.values()]
          .filter((t) => t.runs > 1)
          .map((t) => ({
            prompt: t.prompt,
            runs: t.runs,
            success_rate: round(t.succeeded / t.runs),
            avg_steps: round(t.steps / t.runs),
            avg_wasted: t.measured ? round(t.wasted / t.measured) : null,
          }))
          .sort((a, b) => b.runs - a.runs || b.avg_steps - a.avg_steps)
          .slice(0, 15),
      },
    };
  }

  async runs(days: number, limit: number) {
    const tasks = await this.recentTasks(days, Math.min(Math.max(limit, 1), 200));
    const devices = await this.deviceNames(tasks.map((t) => t.device_id));
    return {
      data: tasks.map((t) => ({
        id: t.id,
        prompt: String(t.prompt ?? '').slice(0, 200),
        device: devices.get(t.device_id) ?? null,
        status: t.status,
        reason: t.reason_code,
        provider: t.provider,
        model: t.model,
        total_steps: t.total_steps,
        duration_s: t.total_duration_seconds,
        created_at: t.created_at,
        engine: t.provider === 'replay' || t.flow_mode === 'replay' ? 'replay' : t.engine ?? 'eko',
        flow_mode: t.flow_mode,
        verification: t.verification,
        outcome: outcomeOf(t),
        failure_kind: outcomeOf(t) === 'failed' ? failureKind(t.reason_code, t.message) : null,
        diagnostics: t.diagnostics,
      })),
    };
  }

  async run(taskId: number) {
    const task = await this.taskRepo.findOne({
      where: { id: taskId },
      select: ['id', 'prompt', 'status', 'reason_code', 'provider', 'model', 'device_id', 'total_steps', 'total_duration_seconds', 'created_at', 'message', 'diagnostics', 'engine', 'verification', 'outcome'],
    });
    if (!task) throw new AppError('Run not found', 404);
    const steps = await this.logRepo.find({
      where: { agent_task_id: taskId },
      select: [...STEP_COLUMNS, 'thought_reasoning', 'result_message', 'error_message'],
      order: { step_index: 'ASC', id: 'ASC' },
    });
    const devices = await this.deviceNames([task.device_id]);
    return {
      data: {
        ...task,
        device: devices.get(task.device_id) ?? null,
        waste_labels: WASTE_LABELS,
        steps: steps.map((s) => ({
          ...s,
          thought_reasoning: String(s.thought_reasoning ?? '').slice(0, 600),
          result_message: String(s.result_message ?? '').slice(0, 400),
          error_message: s.error_message ? String(s.error_message).slice(0, 400) : null,
        })),
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  /**
   * Writes a sanitized JSONL export of runs created in [from, to) to `out`
   * (one JSON object per line). Screenshots are never selected. Returns counts.
   */
  async exportRuns(out: Writable, from: Date, to?: Date): Promise<{ tasks: number; steps: number }> {
    const clean = new DiagnosticsSanitizer();
    let failure: Error | null = null;
    const onError = (error: Error) => {
      failure = error;
    };
    out.on('error', onError);
    const write = async (record: Record<string, unknown>) => {
      if (failure) throw failure;
      // events.once rejects if the stream errors while we wait for it to drain.
      if (!out.write(`${JSON.stringify(record)}\n`)) await once(out, 'drain');
    };

    const tasks = await this.taskRepo
      .createQueryBuilder('t')
      .select([
        't.id', 't.user_id', 't.device_id', 't.prompt', 't.provider', 't.model', 't.success', 't.status', 't.reason_code',
        't.started_at', 't.finished_at', 't.created_at', 't.total_steps', 't.total_duration_seconds', 't.diagnostics', 't.engine', 't.verification', 't.outcome',
      ])
      .where('t.created_at >= :from', { from: await this.toDbClock(from) })
      // Only a closed window (a whole day for the GitHub sync) has an end.
      .andWhere(to ? 't.created_at < :to' : '1=1', to ? { to: await this.toDbClock(to) } : {})
      .orderBy('t.id', 'ASC')
      .limit(MAX_REPORT_RUNS * 2)
      .getMany();

    await write({ t: 'meta', format: 2, exported_at: new Date().toISOString(), from: from.toISOString(), to: to ? to.toISOString() : null, tasks: tasks.length });

    const deviceIds = [...new Set(tasks.map((t) => t.device_id).filter(Boolean))];
    if (deviceIds.length) {
      const devices = await AppDataSource.getRepository(AndroidDevice).find({
        where: { id: In(deviceIds) },
        select: ['id', 'device_model', 'android_version', 'proxy_id', 'status', 'capabilities'],
      });
      for (const d of devices) {
        const caps = d.capabilities;
        await write({
          t: 'device', id: d.id, model: d.device_model, android: d.android_version, proxy_id: d.proxy_id, status: d.status,
          companion: caps?.appVersion ?? null, screen: caps?.screenWidth ? `${caps.screenWidth}x${caps.screenHeight}` : null,
        });
      }
    }

    for (const task of tasks) {
      await write({
        t: 'task', id: task.id, user: clean.hash(task.user_id), device_id: task.device_id,
        prompt: clean.scrub(task.prompt, 500), prompt_h: clean.hash(normalisePrompt(task.prompt)),
        provider: task.provider, model: task.model, success: Boolean(task.success), status: task.status, reason: task.reason_code,
        started_at: task.started_at, finished_at: task.finished_at, created_at: task.created_at,
        total_steps: task.total_steps, duration_s: task.total_duration_seconds, diagnostics: task.diagnostics,
        engine: task.engine, verification: task.verification ? { ...task.verification, reason: clean.scrub(task.verification.reason, 200) } : null,
        outcome: outcomeOf(task),
      });
    }

    // Screens are written once each and referenced by id from the steps.
    const seenTrees = new Map<string, string>();
    const treeRef = async (raw: unknown): Promise<string | null> => {
      const rows: TreeRow[] | null = clean.tree(raw);
      if (!rows) return null;
      const key = JSON.stringify(rows);
      const known = seenTrees.get(key);
      if (known) return known;
      const ref = clean.hash(key);
      seenTrees.set(key, ref);
      await write({ t: 'screen', ref, rows });
      return ref;
    };

    let stepCount = 0;
    const CHUNK = 40;
    for (let i = 0; i < tasks.length; i += CHUNK) {
      const ids = tasks.slice(i, i + CHUNK).map((t) => t.id);
      const steps = await this.logRepo
        .createQueryBuilder('s')
        .select([
          's.id', 's.agent_task_id', 's.device_id', 's.step_index', 's.action_type', 's.action_payload', 's.thought_reasoning',
          's.status', 's.ui_tree_snapshot', 's.ui_tree_before', 's.duration_ms', 's.result_message', 's.error_message', 's.created_at',
          's.package_before', 's.package_after', 's.screen_before', 's.screen_after', 's.think_ms', 's.llm_call',
          's.prompt_tokens', 's.completion_tokens', 's.cache_read_tokens', 's.cache_write_tokens', 's.reasoning_tokens', 's.cost_usd', 's.source', 's.waste', 's.sight',
        ])
        .where('s.agent_task_id IN (:...ids)', { ids })
        .orderBy('s.agent_task_id', 'ASC')
        .addOrderBy('s.step_index', 'ASC')
        .addOrderBy('s.id', 'ASC')
        .getMany();
      for (const s of steps) {
        await write({
          t: 'step', id: s.id, task_id: s.agent_task_id, device_id: s.device_id, idx: s.step_index, action: s.action_type,
          payload: clean.payload(s.action_payload), status: s.status, source: s.source, waste: s.waste,
          ms: s.duration_ms, think_ms: s.think_ms, llm_call: s.llm_call, prompt_tokens: s.prompt_tokens, completion_tokens: s.completion_tokens,
          cache_read_tokens: s.cache_read_tokens, cache_write_tokens: s.cache_write_tokens, reasoning_tokens: s.reasoning_tokens, cost_usd: s.cost_usd,
          // Whether the AI saw this step's screen as an image ('ai'), through a helper, or not at all.
          sight: s.sight,
          package_before: s.package_before, package_after: s.package_after, screen_before: s.screen_before, screen_after: s.screen_after,
          // Runs recorded before diagnostics existed have no "before" tree; their
          // ui_tree_snapshot is the screen AFTER the step.
          tree_before: await treeRef(s.ui_tree_before),
          tree_after: await treeRef(s.ui_tree_snapshot),
          thought: clean.scrub(s.thought_reasoning, 400), result: clean.scrub(s.result_message, 300), error: clean.scrub(s.error_message, 300),
          at: s.created_at,
        });
        stepCount += 1;
      }
    }

    const flows = await AppDataSource.getRepository(SavedFlow).find();
    for (const f of flows) {
      let parsed: { action_type?: string; action_payload?: unknown }[] = [];
      try {
        parsed = JSON.parse(f.steps_json);
      } catch {
        parsed = [];
      }
      await write({
        t: 'flow', id: f.id, user: clean.hash(f.user_id), name: clean.scrub(f.name, 80), source_prompt: clean.scrub(f.source_prompt, 300),
        source_task_id: f.source_task_id, step_count: f.step_count, coordinate_steps: f.coordinate_step_count, run_count: f.run_count,
        last_run_at: f.last_run_at, created_at: f.created_at,
        steps: Array.isArray(parsed) ? parsed.map((st) => ({ action: st.action_type, payload: clean.payload(st.action_payload) })) : [],
      });
    }

    const taskIds = tasks.map((t) => t.id);
    if (taskIds.length) {
      const items = await AppDataSource.getRepository(MissionItem).find({ where: { agent_task_id: In(taskIds) } });
      const missionIds = [...new Set(items.map((m) => m.mission_id))];
      if (missionIds.length) {
        const missions = await AppDataSource.getRepository(Mission).find({ where: { id: In(missionIds) } });
        for (const m of missions) {
          await write({
            t: 'mission', id: m.id, user: clean.hash(m.user_id), request: clean.scrub(m.request, 400), prompt: clean.scrub(m.prompt, 400),
            target_mode: m.target_mode, requested_count: m.requested_count, no_internet: Boolean(m.no_internet), max_steps: m.max_steps,
            duration_seconds: m.duration_seconds, status: m.status, note: clean.scrub(m.note, 300), created_at: m.created_at, finished_at: m.finished_at,
          });
        }
      }
      for (const it of items) {
        await write({
          t: 'mission_item', id: it.id, mission_id: it.mission_id, device_id: it.device_id, replaces_item_id: it.replaces_item_id,
          status: it.status, attempts: it.attempts, agent_task_id: it.agent_task_id, last_reason: it.last_reason,
          last_message: clean.scrub(it.last_message, 300), dispatched_at: it.dispatched_at,
        });
      }
    }

    // Browser-side failures in the same window (see ClientReport).
    const reportQuery = AppDataSource.getRepository(ClientReport)
      .createQueryBuilder('r')
      .where('r.created_at >= :from', { from: await this.toDbClock(from) });
    if (to) reportQuery.andWhere('r.created_at < :to', { to: await this.toDbClock(to) });
    const reports = await reportQuery.orderBy('r.id', 'ASC').limit(2000).getMany();
    for (const r of reports) {
      await write({
        t: 'client_report', id: r.id, user: r.user_id ? clean.hash(r.user_id) : null, kind: r.kind, page: r.page, tab: r.tab_id,
        user_agent: r.user_agent, app_version: r.app_version, at: r.created_at,
        payload: r.payload ? scrubbedJson(clean, r.payload) : null,
      });
    }

    out.off('error', onError);
    return { tasks: tasks.length, steps: stepCount };
  }

  // ---------------------------------------------------------------------------

  /**
   * created_at is stamped by the database clock (CURRENT_TIMESTAMP) while the
   * app sends dates as UTC, so a database running in another time zone would
   * shift every window. Convert a UTC instant to the database's clock.
   */
  private dbOffsetMs: number | null = null;
  private async toDbClock(date: Date): Promise<Date> {
    if (this.dbOffsetMs === null) {
      try {
        const [row] = await AppDataSource.query('SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), NOW()) AS offset_s');
        this.dbOffsetMs = Math.round(Number(row?.offset_s ?? 0) / 60) * 60_000;
      } catch {
        this.dbOffsetMs = 0;
      }
    }
    return new Date(date.getTime() + this.dbOffsetMs);
  }

  private async recentTasks(days: number, limit = MAX_REPORT_RUNS): Promise<AgentTask[]> {
    const since = await this.toDbClock(new Date(Date.now() - clampDays(days) * 86_400_000));
    return this.taskRepo.find({
      where: { created_at: MoreThanOrEqual(since) },
      select: ['id', 'prompt', 'status', 'reason_code', 'message', 'provider', 'model', 'device_id', 'total_steps', 'total_duration_seconds', 'created_at', 'diagnostics', 'engine', 'verification', 'outcome', 'flow_id', 'flow_mode'],
      order: { id: 'DESC' },
      take: limit,
    });
  }

  private async deviceNames(ids: number[]): Promise<Map<number, string>> {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) return new Map();
    const devices = await AppDataSource.getRepository(AndroidDevice).find({ where: { id: In(unique) }, select: ['id', 'device_name', 'device_model'] });
    return new Map(devices.map((d) => [d.id, d.device_name || d.device_model || `Phone ${d.id}`]));
  }
}

export function clampDays(days: unknown): number {
  const n = Math.floor(Number(days));
  return Number.isFinite(n) ? Math.min(Math.max(n, 1), 30) : 7;
}

/** Same instruction with different spacing, case or numbers counts as one task. */
export function normalisePrompt(prompt: unknown): string {
  return String(prompt ?? '')
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/** Scrubs every string inside a stored JSON value; numbers (timestamps, sizes) stay numbers. */
function scrubbedJson(clean: DiagnosticsSanitizer, value: unknown, depth = 0): unknown {
  if (depth > 8) return '[deep]';
  if (typeof value === 'string') return clean.scrub(value, 2000);
  if (Array.isArray(value)) return value.slice(0, 200).map((v) => scrubbedJson(clean, v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, scrubbedJson(clean, v, depth + 1)]));
  }
  return value;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
