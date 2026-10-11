import Logger from '@/logger/index';
import { AgentTask } from '@/entities/AgentTask';
import { AiConfig, AiProvider } from '@/entities/AiConfig';
import { AndroidDevice } from '@/entities/AndroidDevice';
import { Mission } from '@/entities/Mission';
import { MissionItem } from '@/entities/MissionItem';
import { TestLabConfig } from '@/entities/TestLabConfig';
import { TestLabNight } from '@/entities/TestLabNight';
import AppError from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import { generateText } from 'ai';
import { In } from 'typeorm';
import { Service } from 'typedi';
import { AiConfigService } from '../../controllerService/AiConfigService';
import { createLanguageModel } from '../agent/aiSdkModel';
import { AndroidGatewayService } from '../AndroidGatewayService';
import { DiagnosticsSyncService } from '../DiagnosticsSyncService';
import { failureKind } from '../failureKind';
import { isTestLabSource, MissionService } from '../MissionService';
import { TASK_BANK } from './taskBank';
import {
  buildReport,
  indiaClock,
  normaliseSettings,
  planNight,
  QUOTA_CODES,
  reportMarkdown,
  seeded,
  triage,
  VARIANT_PROMPT,
  variantOk,
  type JobResult,
  type LabJob,
  type TestLabSettings,
} from './testLab';

const TICK_MS = Number(process.env.TESTLAB_TICK_MS) || 60_000;
/** A night that has not finished by then stops starting jobs: the phones are needed in the morning. */
const NIGHT_MAX_MS = 10 * 3600_000;
const NIGHTS_SHOWN = 14;
const CONFIG_LABEL = 'Test Lab';
const FREE_MODELS_TTL_MS = 3600_000;

/**
 * The Test Lab runner (testLab.ts has the rules). Once a night — or on Run now —
 * it plans the night's jobs, then keeps each test phone busy with one job at a
 * time, each job a one-phone mission on its own model ("testlab:<night>:<job>",
 * which missions run AI-only: no saved flows, no backup model). When every job
 * has ended it sorts the results (engine, model habit, setup, quota), stores the
 * report and, when the diagnostics repo is set up, pushes it to GitHub for the
 * daily analysis.
 */
@Service()
export class TestLabService {
  private configRepo = AppDataSource.getRepository(TestLabConfig);
  private nightRepo = AppDataSource.getRepository(TestLabNight);
  private missionRepo = AppDataSource.getRepository(Mission);
  private itemRepo = AppDataSource.getRepository(MissionItem);
  private taskRepo = AppDataSource.getRepository(AgentTask);
  private aiRepo = AppDataSource.getRepository(AiConfig);
  private deviceRepo = AppDataSource.getRepository(AndroidDevice);
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Nights being advanced right now: a tick and a mission's finish must not overlap. */
  private advancing = new Set<number>();
  private starting = new Set<number>();
  private freeModelsCache: { at: number; models: FreeModel[] } | null = null;

  constructor(
    private missionService: MissionService,
    private aiConfigService: AiConfigService,
    private gatewayService: AndroidGatewayService,
    private sync: DiagnosticsSyncService,
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
    this.missionService.onFinished((mission) => {
      if (!isTestLabSource(mission.source)) return;
      const nightId = Number(String(mission.source).split(':')[1]);
      if (nightId) void this.advance(nightId);
    });
  }

  // ---------------------------------------------------------------------------
  // Settings and views
  // ---------------------------------------------------------------------------

  async settings(userId: number): Promise<TestLabSettings> {
    const row = await this.configRepo.findOne({ where: { user_id: userId } });
    return normaliseSettings(row?.settings);
  }

  async saveSettings(userId: number, raw: unknown): Promise<TestLabSettings> {
    const settings = normaliseSettings(raw);
    if (settings.device_ids.length) {
      const owned = await this.deviceRepo.find({ where: { id: In(settings.device_ids), user_id: userId }, select: { id: true } });
      const ok = new Set(owned.map((d) => d.id));
      settings.device_ids = settings.device_ids.filter((id) => ok.has(id));
    }
    await this.configRepo.save(this.configRepo.create({ user_id: userId, settings }));
    return settings;
  }

  async overview(userId: number) {
    const [settings, nights, openrouter] = await Promise.all([
      this.settings(userId),
      this.nightRepo.find({ where: { user_id: userId }, order: { id: 'DESC' }, take: NIGHTS_SHOWN }),
      this.aiRepo.count({ where: { user_id: userId, provider: AiProvider.OPENROUTER } }),
    ]);
    return {
      settings,
      openrouter_ready: openrouter > 0,
      github: this.sync.status().configured,
      bank: TASK_BANK.map((t) => ({ key: t.key, kind: t.kind, prompt: t.prompt, needs: t.needs ?? [] })),
      nights: nights.map((n) => ({
        id: n.id,
        day: n.day,
        status: n.status,
        manual: n.manual,
        started_at: n.started_at,
        finished_at: n.finished_at,
        jobs: n.jobs.length,
        done: n.jobs.filter((j) => j.status === 'done' || j.status === 'skipped').length,
        running: n.jobs.filter((j) => j.status === 'running').length,
        totals: n.report?.totals ?? null,
      })),
    };
  }

  async night(userId: number, id: number): Promise<TestLabNight> {
    const night = await this.nightRepo.findOne({ where: { id, user_id: userId } });
    if (!night) throw new AppError('Test Lab run not found', 404);
    return night;
  }

  async runNow(userId: number): Promise<TestLabNight> {
    return this.startNight(userId, true);
  }

  /** Stops the running night: queued jobs are skipped, running missions cancelled, and the report is made from what ran. */
  async stop(userId: number): Promise<TestLabNight | null> {
    const night = await this.nightRepo.findOne({ where: { user_id: userId, status: 'RUNNING' }, order: { id: 'DESC' } });
    if (!night) return null;
    for (const job of night.jobs) {
      if (job.status === 'queued') Object.assign(job, { status: 'skipped', note: 'stopped' });
      if (job.status === 'running' && job.mission_id) await this.missionService.cancel(job.mission_id, userId).catch(() => undefined);
    }
    for (const job of night.jobs.filter((j) => j.status === 'running')) await this.collect(job);
    await this.finish(night, 'STOPPED');
    return night;
  }

  /** OpenRouter's free models that can call tools, for the settings picker. */
  async freeModels(): Promise<FreeModel[]> {
    if (this.freeModelsCache && Date.now() - this.freeModelsCache.at < FREE_MODELS_TTL_MS) return this.freeModelsCache.models;
    const response = await fetch('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new AppError(`OpenRouter model list failed (${response.status})`, 502);
    const body = (await response.json()) as { data?: { id: string; name?: string; context_length?: number; supported_parameters?: string[] }[] };
    const models = (body.data ?? [])
      .filter((m) => m.id.endsWith(':free') && (m.supported_parameters ?? []).includes('tools'))
      .map((m) => ({ id: m.id, name: m.name ?? m.id, context: m.context_length ?? null }))
      .sort((a, b) => a.id.localeCompare(b.id));
    this.freeModelsCache = { at: Date.now(), models };
    return models;
  }

  // ---------------------------------------------------------------------------
  // Running
  // ---------------------------------------------------------------------------

  private async tick(): Promise<void> {
    try {
      const running = await this.nightRepo.find({ where: { status: 'RUNNING' }, select: { id: true } });
      for (const n of running) await this.advance(n.id);

      const { day, hour } = indiaClock(new Date());
      const configs = await this.configRepo.find();
      for (const config of configs) {
        const settings = normaliseSettings(config.settings);
        if (!settings.enabled || hour !== settings.hour) continue;
        const already = await this.nightRepo.findOne({ where: { user_id: config.user_id, day, manual: false } });
        const busy = await this.nightRepo.findOne({ where: { user_id: config.user_id, status: 'RUNNING' } });
        if (already || busy) continue;
        await this.startNight(config.user_id, false).catch((error) => Logger.warn(`[TestLab] Nightly run for user ${config.user_id} did not start: ${(error as Error).message}`));
      }
    } catch (error) {
      Logger.warn('[TestLab] Tick failed:', error);
    }
  }

  private async startNight(userId: number, manual: boolean): Promise<TestLabNight> {
    if (this.starting.has(userId)) throw new AppError('A Test Lab run is already starting', 409);
    this.starting.add(userId);
    try {
      const busy = await this.nightRepo.findOne({ where: { user_id: userId, status: 'RUNNING' } });
      if (busy) throw new AppError('A Test Lab run is already going: stop it first or wait for it to finish', 409);
      const settings = await this.settings(userId);
      if (!settings.models.length) throw new AppError('Pick at least one model for the Test Lab', 400);
      if (!settings.device_ids.length) throw new AppError('Pick the test phones first', 400);
      // Make sure every model can run before planning (no OpenRouter key → a clear error now).
      for (const model of settings.models) await this.configFor(userId, model);

      const recent = await this.nightRepo.find({ where: { user_id: userId }, order: { id: 'DESC' }, take: 10, select: { id: true, jobs: true } });
      const lastRun = new Map<string, number>();
      for (const n of [...recent].reverse()) for (const j of n.jobs) lastRun.set(j.key, n.id);
      const random = seeded(Date.now());
      const jobs = planNight(settings, TASK_BANK, lastRun, random);
      if (!jobs.length) throw new AppError('No tasks to run with these settings', 400);
      await this.reword(userId, settings, jobs, random);

      const night = await this.nightRepo.save(this.nightRepo.create({ user_id: userId, status: 'RUNNING', day: indiaClock(new Date()).day, manual, jobs, report: null, finished_at: null }));
      Logger.info(`[TestLab] Night #${night.id} for user ${userId}: ${jobs.length} jobs on ${settings.device_ids.length} phones, models ${settings.models.join(', ')}`);
      this.gatewayService.broadcastToUser(userId, 'testlab:update', { id: night.id });
      void this.advance(night.id);
      return night;
    } finally {
      this.starting.delete(userId);
    }
  }

  /**
   * Gives a share of the bank tasks in other words (both jobs of a task get the
   * same wording, so the models are compared on the same text). A rewrite that
   * drops a number, an address or quoted text is not used.
   */
  private async reword(userId: number, settings: TestLabSettings, jobs: LabJob[], random: () => number): Promise<void> {
    const keys = [...new Set(jobs.filter((j) => j.kind !== 'core').map((j) => j.key))];
    const picked = keys.filter(() => random() < settings.variant_share);
    if (!picked.length) return;
    const config = await this.aiConfigService.resolveConfigById(userId, await this.configFor(userId, settings.models[0]));
    if (!config) return;
    const model = createLanguageModel({ provider: config.provider, model: config.model, apiKey: config.api_key, baseURL: config.base_url ?? undefined });
    for (const key of picked) {
      const original = jobs.find((j) => j.key === key)!.prompt;
      try {
        const { text } = await generateText({ model, system: VARIANT_PROMPT, prompt: original, maxOutputTokens: 400, temperature: 0.9, maxRetries: 1, abortSignal: AbortSignal.timeout(30_000) });
        const variant = text.trim().replace(/^["'“]+|["'”]+$/g, '').split('\n')[0].trim();
        if (!variantOk(original, variant) || variant.toLowerCase() === original.toLowerCase()) continue;
        for (const job of jobs.filter((j) => j.key === key)) Object.assign(job, { prompt: variant, original });
      } catch (error) {
        Logger.info(`[TestLab] Rewording ${key} failed (${String((error as Error)?.message ?? error).slice(0, 120)}); keeping the bank wording`);
        // A capped or slow model now: the rest keep their bank wording.
        if (/429|quota|rate/i.test(String((error as Error)?.message))) return;
      }
    }
  }

  /** The ai_configs row the missions use for one model: a copy of the account's OpenRouter key, labelled "Test Lab". */
  private async configFor(userId: number, model: string): Promise<number> {
    const existing = await this.aiRepo.findOne({ where: { user_id: userId, provider: AiProvider.OPENROUTER, model, label: CONFIG_LABEL } });
    if (existing) return existing.id;
    const source = await this.aiRepo.findOne({ where: { user_id: userId, provider: AiProvider.OPENROUTER }, order: { is_active: 'DESC', updated_at: 'DESC' } });
    if (!source) throw new AppError('Add an OpenRouter key in Settings → AI first: the Test Lab runs the free models with it', 400);
    const saved = await this.aiRepo.save(
      this.aiRepo.create({
        user_id: userId,
        provider: AiProvider.OPENROUTER,
        model,
        encrypted_api_key: source.encrypted_api_key,
        base_url: source.base_url,
        is_active: false,
        label: CONFIG_LABEL,
        config_type: source.config_type,
      }),
    );
    return saved.id;
  }

  async advance(nightId: number): Promise<void> {
    if (this.advancing.has(nightId)) return;
    this.advancing.add(nightId);
    try {
      const night = await this.nightRepo.findOne({ where: { id: nightId } });
      if (!night || night.status !== 'RUNNING') return;
      const settings = await this.settings(night.user_id);
      let changed = false;

      // 1. Jobs whose mission has ended.
      for (const job of night.jobs.filter((j) => j.status === 'running')) {
        const mission = job.mission_id ? await this.missionRepo.findOne({ where: { id: job.mission_id }, select: { id: true, status: true } }) : null;
        if (!mission || mission.status === 'DONE' || mission.status === 'CANCELLED') {
          await this.collect(job);
          changed = true;
        }
      }

      // 2. Models out of their daily cap tonight.
      const capped = new Set(night.jobs.filter((j) => j.result?.reason_code === 'LLM_QUOTA').map((j) => j.model));

      // 3. Out of time: the rest is skipped.
      if (Date.now() - new Date(night.started_at).getTime() > NIGHT_MAX_MS) {
        for (const job of night.jobs.filter((j) => j.status === 'queued')) Object.assign(job, { status: 'skipped', note: 'the night ran out of time' });
        changed = true;
      }

      // 4. Each free test phone gets the next job.
      const busyPhones = new Set(night.jobs.filter((j) => j.status === 'running').map((j) => j.device_id));
      for (const phone of settings.device_ids) {
        if (busyPhones.has(phone)) continue;
        const job = night.jobs.find((j) => j.status === 'queued');
        if (!job) break;
        changed = true;
        if (capped.has(job.model)) {
          const pairModel = job.pair ? night.jobs.find((j) => j.id === job.pair)?.model : undefined;
          const usable = settings.models.filter((m) => !capped.has(m));
          const other = usable.find((m) => m !== pairModel) ?? usable[0];
          if (!other) {
            Object.assign(job, { status: 'skipped', note: `every model is out of its daily limit` });
            continue;
          }
          job.note = `moved from ${job.model} (daily limit reached)`;
          job.model = other;
        }
        try {
          const configId = await this.configFor(night.user_id, job.model);
          const created = await this.missionService.create(night.user_id, {
            request: job.prompt,
            device_ids: [phone],
            ai_config_id: configId,
            max_steps: settings.max_steps,
            source: `testlab:${night.id}:${job.id}`,
          });
          const missionId = Number((created.data as { id?: number } | undefined)?.id);
          Object.assign(job, { status: 'running', device_id: phone, mission_id: missionId || null, started_at: new Date().toISOString() });
          busyPhones.add(phone);
        } catch (error) {
          Object.assign(job, { status: 'skipped', device_id: phone, note: `could not start: ${String((error as Error)?.message ?? error).slice(0, 160)}` });
        }
      }

      // 5. Nothing left: the report.
      if (!night.jobs.some((j) => j.status === 'queued' || j.status === 'running')) {
        await this.finish(night, 'DONE');
        return;
      }
      if (changed) {
        await this.nightRepo.update({ id: night.id }, { jobs: night.jobs });
        this.gatewayService.broadcastToUser(night.user_id, 'testlab:update', { id: night.id });
      }
    } catch (error) {
      Logger.warn(`[TestLab] Advancing night #${nightId} failed:`, error);
    } finally {
      this.advancing.delete(nightId);
    }
  }

  /** A job's outcome from its mission's run. */
  private async collect(job: LabJob): Promise<void> {
    const item = job.mission_id ? await this.itemRepo.findOne({ where: { mission_id: job.mission_id }, order: { id: 'ASC' } }) : null;
    const task = item?.agent_task_id
      ? await this.taskRepo.findOne({
          where: { id: item.agent_task_id },
          select: { id: true, status: true, reason_code: true, message: true, verification: true, diagnostics: true, total_steps: true },
        })
      : null;
    job.task_id = task?.id ?? item?.agent_task_id ?? null;
    if (!item || (item.status === 'CANCELLED' && !task)) {
      Object.assign(job, { status: 'skipped', note: job.note ?? 'the run was cancelled before it started' });
      return;
    }
    const reason = task?.reason_code ?? item.last_reason ?? null;
    const message = String(task?.message ?? item.last_message ?? '').slice(0, 600);
    const v = task?.verification ?? null;
    const result: JobResult = {
      status: task?.status ?? (item.status === 'SUCCEEDED' ? 'SUCCEEDED' : 'FAILED'),
      reason_code: reason,
      message,
      verification: v ? { status: v.status, method: v.method, reason: String(v.reason ?? '').slice(0, 300) } : null,
      parts: v?.rules?.parts ?? [],
      cost_usd: Number(task?.diagnostics?.cost_usd ?? 0) || 0,
      steps: task?.total_steps ?? 0,
      kind: reason || task?.status === 'FAILED' ? failureKind(reason, message) : null,
    };
    if (reason && QUOTA_CODES.has(reason)) result.kind = 'ai_service';
    Object.assign(job, { status: 'done', result });
  }

  private async finish(night: TestLabNight, status: 'DONE' | 'STOPPED'): Promise<void> {
    const finishedAt = new Date();
    const triaged = triage(night.jobs);
    const report = buildReport(night.id, night.day, new Date(night.started_at), finishedAt, triaged);
    night.jobs = triaged;
    night.report = report;
    night.status = status;
    night.finished_at = finishedAt;
    await this.nightRepo.save(night);
    const t = report.totals;
    Logger.info(`[TestLab] Night #${night.id} ${status}: pass ${t.pass}+${t.unsure} of ${t.counted} counted, engine ${t.engine}, model ${t.model}, setup ${t.setup}, quota ${t.quota}`);
    this.gatewayService.broadcastToUser(night.user_id, 'testlab:update', { id: night.id });
    const base = `testlab/${night.day}-night-${night.id}`;
    await this.sync.pushFile(`${base}.md`, Buffer.from(reportMarkdown(report, triaged)), `Test Lab ${night.day} night #${night.id}`).catch((error) => Logger.warn(`[TestLab] GitHub copy failed: ${(error as Error).message}`));
    await this.sync.pushFile(`${base}.json`, Buffer.from(JSON.stringify({ report, jobs: triaged }, null, 1)), `Test Lab ${night.day} night #${night.id} (data)`).catch(() => undefined);
  }
}

export interface FreeModel {
  id: string;
  name: string;
  context: number | null;
}
