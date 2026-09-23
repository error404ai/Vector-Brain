import { AgentTask } from '@/entities/AgentTask';
import { AndroidDevice } from '@/entities/AndroidDevice';
import { Mission, MissionTargetMode } from '@/entities/Mission';
import { MissionItem } from '@/entities/MissionItem';
import { QueuedTask } from '@/entities/QueuedTask';
import AppError from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import Logger from '@/logger/index';
import { AiService, MissionPlan } from '@/services/AiService';
import { ApiResponse } from '@/types/ApiResponse';
import { In } from 'typeorm';
import { Service } from 'typedi';
import { AndroidGatewayService } from './AndroidGatewayService';
import { AndroidPlannerService } from './AndroidPlannerService';
import { FleetStateService } from './FleetStateService';
import { TaskQueueService } from './TaskQueueService';

/** Total tries per phone: the first run plus two retries. */
const MAX_ATTEMPTS = 3;
/** Most phones one mission may drive, whatever the request says. */
const MAX_MISSION_DEVICES = 50;
const TICK_MS = Number(process.env.MISSION_TICK_MS) || 3000;
/** Wait before a retry, multiplied by the attempt number (15s, 30s, ...). */
const RETRY_DELAY_MS = Number(process.env.MISSION_RETRY_DELAY_MS) || 15_000;
/** Same switch the planner uses: the harness plans without a model. */
const SIMULATION = process.env.AGENT_SIMULATION === '1' && process.env.NODE_ENV !== 'production';

/**
 * Failures another attempt can plausibly fix: the phone was away, busy, or the
 * run was cut short by something outside it. Everything else — the agent said
 * it could not do it, the step budget ran out, the AI key is bad — would fail
 * the same way again and only costs tokens, so it is reported instead.
 */
const RETRYABLE = new Set([
  'DEVICE_OFFLINE',
  'DEVICE_BUSY',
  'TIMEOUT',
  'LLM_RATE_LIMIT',
  'SERVER_RESTART',
  'INTERRUPTED',
  'TASK_MISSING',
  'QUEUE_DROPPED',
  'PLAN_FAILED',
]);

const PLAIN_REASON: Record<string, string> = {
  DEVICE_OFFLINE: 'phone was offline',
  DEVICE_BUSY: 'phone was busy with another task',
  TIMEOUT: 'phone did not answer in time',
  LLM_RATE_LIMIT: 'AI provider rate limit',
  LLM_AUTH_OR_CREDIT: 'AI key or credit problem',
  SERVER_RESTART: 'server restarted mid-run',
  INTERRUPTED: 'run was interrupted',
  UNFINISHED: 'ran out of steps',
  AGENT_REPORTED_FAILURE: 'agent could not complete it',
  GUARD_STOP: 'agent stopped itself (stuck or looping)',
  USER_CANCELLED: 'cancelled',
  NEEDS_SETUP: 'accessibility is off on the phone',
  QUEUE_DROPPED: 'lost its place in the proxy queue',
  TASK_MISSING: 'run record disappeared',
  DISPATCH_ERROR: 'could not be started',
  PLAN_FAILED: 'AI returned an empty plan (model hiccup)',
  CAPTURE_PERMISSION: 'screen capture permission not approved on the phone',
};

const TERMINAL_ITEM = new Set(['SUCCEEDED', 'FAILED', 'CANCELLED']);
/** Fleet states in which a phone can take a new run right now. */
const READY_STATES = new Set(['idle', 'completed', 'failed', 'cancelled', 'interrupted']);

export interface CreateMissionInput {
  request: string;
  device_ids?: number[];
  max_steps?: number;
  ai_config_id?: number;
  no_internet?: boolean;
  /** Keep each phone working this long ("for 1 hour"); server-enforced. */
  duration_seconds?: number;
}

interface FleetDevice {
  id: number;
  name: string;
  tag: string | null;
  proxy_id: number | null;
  state: string;
}

/**
 * Carries one plain-language instruction across many phones.
 *
 * The model is asked exactly once — to turn the request into "these phones,
 * this instruction". Everything after that is a loop over database rows:
 * dispatch, follow, retry what a retry can fix, report the rest. Keeping the
 * model out of the loop keeps missions cheap, bounded and restart-safe.
 */
@Service()
export class MissionService {
  private missionRepo = AppDataSource.getRepository(Mission);
  private itemRepo = AppDataSource.getRepository(MissionItem);
  private taskRepo = AppDataSource.getRepository(AgentTask);
  private queueRepo = AppDataSource.getRepository(QueuedTask);
  private deviceRepo = AppDataSource.getRepository(AndroidDevice);

  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  /** Missions being advanced right now — the first dispatch and a tick must not overlap. */
  private inFlight = new Set<number>();

  constructor(
    private plannerService: AndroidPlannerService,
    private fleetStateService: FleetStateService,
    private aiService: AiService,
    private gatewayService: AndroidGatewayService,
    private taskQueueService: TaskQueueService,
  ) {}

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
    Logger.info(`[Mission] Runner started (tick ${TICK_MS}ms)`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------

  async create(userId: number, input: CreateMissionInput): Promise<ApiResponse> {
    const request = String(input.request ?? '').trim();
    if (!request) throw new AppError('Say what the phones should do', 400);

    const fleet = (await this.fleetStateService.getState(userId)).devices as FleetDevice[];
    const ready = fleet.filter((d) => READY_STATES.has(d.state));

    let mode: MissionTargetMode;
    let prompt: string;
    let noInternet = Boolean(input.no_internet);
    let requestedCount: number | null = null;
    let chosen: FleetDevice[];
    const notes: string[] = [];

    if (input.device_ids?.length) {
      // Phones picked in the UI: the request is already the per-phone instruction.
      mode = 'ids';
      prompt = request;
      const wanted = new Set(input.device_ids);
      const owned = fleet.filter((d) => wanted.has(d.id));
      if (owned.length === 0) throw new AppError('None of those phones belong to you', 404);
      chosen = owned;
      const notReady = owned.filter((d) => !READY_STATES.has(d.state));
      if (notReady.length) notes.push(`${notReady.length} of the chosen phones were not ready and will be retried.`);
    } else {
      const plan = await this.plan(request, fleet, userId);
      mode = plan.mode;
      prompt = plan.prompt;
      noInternet = noInternet || plan.no_internet;
      chosen = this.selectDevices(plan, fleet, ready);
      if (plan.mode === 'count') {
        requestedCount = plan.count;
        if (chosen.length < plan.count) {
          notes.push(`Asked for ${plan.count} phones, only ${chosen.length} were ready.`);
        }
      }
      if (plan.mode === 'tag' && chosen.length === 0) {
        throw new AppError(`No ready phones tagged "${plan.tag}"`, 400);
      }
    }

    if (chosen.length === 0) throw new AppError('No phones are ready right now', 400);
    if (chosen.length > MAX_MISSION_DEVICES) {
      notes.push(`Limited to ${MAX_MISSION_DEVICES} phones per mission.`);
      chosen = chosen.slice(0, MAX_MISSION_DEVICES);
    }

    const mission = await this.missionRepo.save(
      this.missionRepo.create({
        user_id: userId,
        request,
        prompt,
        target_mode: mode,
        requested_count: requestedCount,
        no_internet: noInternet,
        max_steps: Math.max(1, Math.min(500, Math.floor(Number(input.max_steps) || 500))),
        duration_seconds:
          input.duration_seconds && input.duration_seconds > 0 ? Math.min(12 * 3600, Math.floor(input.duration_seconds)) : null,
        ai_config_id: input.ai_config_id ?? null,
        status: 'RUNNING',
        note: notes.join(' ') || null,
      }),
    );
    await this.itemRepo.save(
      chosen.map((device) => this.itemRepo.create({ mission_id: mission.id, device_id: device.id, status: 'PENDING' })),
    );

    Logger.info(`[Mission] #${mission.id} created for user ${userId}: ${chosen.length} phones, mode=${mode}`);
    // Start straight away instead of waiting for the next tick.
    void this.advanceById(mission.id);
    return { message: 'Mission started', data: await this.describe(mission.id, userId) };
  }

  async list(userId: number, limit = 20): Promise<ApiResponse> {
    const missions = await this.missionRepo.find({
      where: { user_id: userId },
      order: { id: 'DESC' },
      take: Math.max(1, Math.min(100, limit)),
    });
    const data = await Promise.all(missions.map((m) => this.describe(m.id, userId)));
    return { message: 'Missions', data };
  }

  async get(id: number, userId: number): Promise<ApiResponse> {
    const data = await this.describe(id, userId);
    if (!data) throw new AppError('Mission not found', 404);
    return { message: 'Mission', data };
  }

  async cancel(id: number, userId: number): Promise<ApiResponse> {
    const mission = await this.missionRepo.findOne({ where: { id, user_id: userId } });
    if (!mission) throw new AppError('Mission not found', 404);
    if (mission.status !== 'RUNNING') return { message: 'Mission already finished', data: await this.describe(id, userId) };

    // Mark it first so a tick running concurrently does not dispatch anything new.
    mission.status = 'CANCELLED';
    await this.missionRepo.save(mission);

    const items = await this.itemRepo.find({ where: { mission_id: id } });
    for (const item of items) {
      if (TERMINAL_ITEM.has(item.status)) continue;
      if (item.status === 'RUNNING' && item.agent_task_id) {
        await this.plannerService.cancelTask(item.agent_task_id, userId).catch(() => undefined);
      }
      if (item.status === 'QUEUED' && item.queue_id) {
        await this.queueRepo.delete({ id: item.queue_id, status: 'QUEUED' }).catch(() => undefined);
      }
      item.status = 'CANCELLED';
      item.last_reason = 'USER_CANCELLED';
      await this.itemRepo.save(item);
    }
    await this.finish(mission, 'CANCELLED');
    return { message: 'Mission cancelled', data: await this.describe(id, userId) };
  }

  // ---------------------------------------------------------------------------
  // Planning
  // ---------------------------------------------------------------------------

  private async plan(request: string, fleet: FleetDevice[], userId: number): Promise<MissionPlan> {
    if (!SIMULATION) {
      const planned = await this.aiService.planMission(
        request,
        fleet.map((d) => ({ id: d.id, name: d.name, tag: d.tag, ready: READY_STATES.has(d.state) })),
        userId,
      );
      if (planned) return planned;
    }
    const local = parseRequestLocally(request);
    if (!local) {
      throw new AppError('Say which phones: a number ("on 5 phones"), "all phones", or a tag ("#PhoneBox")', 400);
    }
    return local;
  }

  private selectDevices(plan: MissionPlan, fleet: FleetDevice[], ready: FleetDevice[]): FleetDevice[] {
    switch (plan.mode) {
      case 'ids': {
        const wanted = new Set(plan.ids);
        return fleet.filter((d) => wanted.has(d.id));
      }
      case 'tag': {
        const tag = plan.tag.trim().toLowerCase();
        // Tags are stored as "colour:Label"; match on the label.
        return ready.filter((d) => (d.tag ?? '').split(':').pop()?.trim().toLowerCase() === tag);
      }
      case 'all':
        return ready;
      case 'count':
      default:
        return spreadAcrossLanes(ready).slice(0, Math.max(0, plan.count));
    }
  }

  // ---------------------------------------------------------------------------
  // Runner
  // ---------------------------------------------------------------------------

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const running = await this.missionRepo.find({ where: { status: 'RUNNING' } });
      for (const mission of running) {
        await this.advance(mission).catch((error) => Logger.warn(`[Mission] #${mission.id} tick failed:`, error));
      }
    } catch (error) {
      Logger.warn('[Mission] tick failed:', error);
    } finally {
      this.ticking = false;
    }
  }

  private async advanceById(id: number): Promise<void> {
    const mission = await this.missionRepo.findOne({ where: { id } });
    if (mission?.status === 'RUNNING') {
      await this.advance(mission).catch((error) => Logger.warn(`[Mission] #${id} first dispatch failed:`, error));
    }
  }

  private async advance(mission: Mission): Promise<void> {
    if (this.inFlight.has(mission.id)) return;
    this.inFlight.add(mission.id);
    try {
      await this.advanceUnlocked(mission);
    } finally {
      this.inFlight.delete(mission.id);
    }
  }

  private async advanceUnlocked(mission: Mission): Promise<void> {
    const items = await this.itemRepo.find({ where: { mission_id: mission.id }, order: { id: 'ASC' } });
    let changed = false;

    for (const item of items) {
      const before = `${item.status}:${item.attempts}:${item.agent_task_id}`;
      if (item.status === 'PENDING') {
        if (item.next_attempt_at && item.next_attempt_at.getTime() > Date.now()) continue;
        await this.dispatch(mission, item);
      } else if (item.status === 'QUEUED') {
        await this.followQueued(mission, item);
      } else if (item.status === 'RUNNING') {
        await this.followRun(mission, item);
      }
      if (`${item.status}:${item.attempts}:${item.agent_task_id}` !== before) changed = true;
    }

    // A replacement may have been added while settling a failure.
    const all = await this.itemRepo.find({ where: { mission_id: mission.id } });
    if (all.length && all.every((i) => TERMINAL_ITEM.has(i.status))) {
      await this.finish(mission, 'DONE');
    } else if (changed) {
      this.gatewayService.broadcastToUser(mission.user_id, 'mission:update', { id: mission.id });
    }
  }

  private async dispatch(mission: Mission, item: MissionItem): Promise<void> {
    // Re-read: a cancel may have landed between the tick's query and now.
    const fresh = await this.missionRepo.findOne({ where: { id: mission.id } });
    if (fresh?.status !== 'RUNNING') return;

    item.attempts += 1;
    item.dispatched_at = new Date();
    item.next_attempt_at = null;
    item.agent_task_id = null;
    item.queue_id = null;
    try {
      const result = await this.plannerService.runTask(
        mission.prompt ?? mission.request,
        item.device_id,
        mission.user_id,
        mission.max_steps,
        undefined,
        mission.ai_config_id ?? undefined,
        false,
        mission.no_internet,
        mission.duration_seconds ?? undefined,
      );
      const data = (result?.data ?? {}) as { taskId?: number; queued?: boolean; queueId?: number };
      // Stopped while this start was in flight: undo what just began, or a
      // cancelled mission leaves a run (possibly an hour-long one) going.
      const after = await this.missionRepo.findOne({ where: { id: mission.id } });
      if (after?.status !== 'RUNNING') {
        if (data.taskId) await this.plannerService.cancelTask(data.taskId, mission.user_id).catch(() => undefined);
        if (data.queueId) await this.queueRepo.delete({ id: data.queueId, status: 'QUEUED' }).catch(() => undefined);
        item.status = 'CANCELLED';
        item.last_reason = 'USER_CANCELLED';
        item.agent_task_id = data.taskId ?? null;
        await this.itemRepo.save(item);
        return;
      }
      if (data.queued) {
        item.status = 'QUEUED';
        item.queue_id = data.queueId ?? null;
      } else if (data.taskId) {
        item.status = 'RUNNING';
        item.agent_task_id = data.taskId;
      } else {
        await this.settleFailure(mission, item, 'DISPATCH_ERROR', result?.message ?? 'No run was started');
        return;
      }
      await this.itemRepo.save(item);
    } catch (error: any) {
      const message = String(error?.message ?? error);
      await this.settleFailure(mission, item, classifyDispatchError(message), message);
    }
  }

  private async followQueued(mission: Mission, item: MissionItem): Promise<void> {
    const entry = item.queue_id ? await this.queueRepo.findOne({ where: { id: item.queue_id } }) : null;
    if (entry && (entry.status === 'QUEUED' || entry.status === 'STARTING')) return;

    // The lane let it through: find the run it became. One phone runs one task
    // at a time, so the first run on this phone since dispatch is ours.
    const since = new Date((item.dispatched_at?.getTime() ?? Date.now()) - 1000);
    const task = await this.taskRepo
      .createQueryBuilder('task')
      .where('task.device_id = :deviceId', { deviceId: item.device_id })
      .andWhere('task.user_id = :userId', { userId: mission.user_id })
      .andWhere('task.created_at >= :since', { since })
      .orderBy('task.id', 'ASC')
      .getOne();
    if (task) {
      item.status = 'RUNNING';
      item.agent_task_id = task.id;
      item.queue_id = null;
      await this.itemRepo.save(item);
      await this.followRun(mission, item);
      return;
    }
    // The lane dropped it because the phone could not start when its turn came;
    // file the real reason (offline, no answer, permission...) rather than a
    // generic "lost its place", so the retry decision and the label are right.
    const dropped = item.queue_id ? this.taskQueueService.dropReason(item.queue_id) : null;
    const reason = dropped ?? entry?.last_error ?? null;
    if (reason) {
      await this.settleFailure(mission, item, classifyDispatchError(reason), reason);
      return;
    }
    await this.settleFailure(mission, item, 'QUEUE_DROPPED', 'The proxy queue entry disappeared');
  }

  private async followRun(mission: Mission, item: MissionItem): Promise<void> {
    if (!item.agent_task_id) {
      await this.settleFailure(mission, item, 'TASK_MISSING', 'Run record missing');
      return;
    }
    const task = await this.taskRepo.findOne({ where: { id: item.agent_task_id } });
    if (!task) {
      await this.settleFailure(mission, item, 'TASK_MISSING', 'Run record missing');
      return;
    }
    if (task.status === 'RUNNING' || task.status === 'QUEUED') return;

    if (task.status === 'SUCCEEDED') {
      item.status = 'SUCCEEDED';
      item.last_reason = null;
      item.last_message = truncate(task.message);
      await this.itemRepo.save(item);
      return;
    }
    const reason = task.status === 'INTERRUPTED' ? task.reason_code || 'INTERRUPTED' : task.reason_code || task.status;
    await this.settleFailure(mission, item, reason, task.message);
  }

  private async settleFailure(mission: Mission, item: MissionItem, reason: string, message?: string | null): Promise<void> {
    item.last_reason = reason.slice(0, 40);
    item.last_message = truncate(message);
    item.agent_task_id = item.status === 'RUNNING' ? item.agent_task_id : null;

    if (RETRYABLE.has(reason) && item.attempts < MAX_ATTEMPTS) {
      item.status = 'PENDING';
      item.next_attempt_at = new Date(Date.now() + RETRY_DELAY_MS * item.attempts);
      await this.itemRepo.save(item);
      Logger.info(`[Mission] #${mission.id} item ${item.id} retry ${item.attempts + 1}/${MAX_ATTEMPTS} after ${reason}`);
      return;
    }

    item.status = 'FAILED';
    item.next_attempt_at = null;
    await this.itemRepo.save(item);

    // "Any 5 phones": a phone that keeps failing for reasons outside the task
    // hands its share to a spare ready phone, once.
    if (mission.target_mode === 'count' && RETRYABLE.has(reason) && !item.replaces_item_id) {
      await this.assignReplacement(mission, item);
    }
  }

  private async assignReplacement(mission: Mission, failed: MissionItem): Promise<void> {
    const used = new Set((await this.itemRepo.find({ where: { mission_id: mission.id } })).map((i) => i.device_id));
    const fleet = (await this.fleetStateService.getState(mission.user_id)).devices as FleetDevice[];
    const spare = spreadAcrossLanes(fleet.filter((d) => READY_STATES.has(d.state) && !used.has(d.id)))[0];
    if (!spare) return;
    await this.itemRepo.save(
      this.itemRepo.create({
        mission_id: mission.id,
        device_id: spare.id,
        replaces_item_id: failed.id,
        status: 'PENDING',
      }),
    );
    Logger.info(`[Mission] #${mission.id} item ${failed.id} handed to phone ${spare.id}`);
  }

  private async finish(mission: Mission, status: 'DONE' | 'CANCELLED'): Promise<void> {
    const items = await this.itemRepo.find({ where: { mission_id: mission.id }, order: { id: 'ASC' } });
    const names = await this.deviceNames(items.map((i) => i.device_id));
    mission.status = status;
    mission.finished_at = new Date();
    mission.summary = summarize(mission, items, names);
    await this.missionRepo.save(mission);
    Logger.info(`[Mission] #${mission.id} ${status}: ${mission.summary.split('\n')[0]}`);
    this.gatewayService.broadcastToUser(mission.user_id, 'mission:update', { id: mission.id });
  }

  // ---------------------------------------------------------------------------
  // Views
  // ---------------------------------------------------------------------------

  private async describe(id: number, userId: number) {
    const mission = await this.missionRepo.findOne({ where: { id, user_id: userId } });
    if (!mission) return null;
    const items = await this.itemRepo.find({ where: { mission_id: id }, order: { id: 'ASC' } });
    const names = await this.deviceNames(items.map((i) => i.device_id));
    const hardwareIds = await this.hardwareIds(items.map((i) => i.device_id));
    const count = (status: string) => items.filter((i) => i.status === status).length;
    return {
      id: mission.id,
      request: mission.request,
      prompt: mission.prompt,
      target_mode: mission.target_mode,
      requested_count: mission.requested_count,
      no_internet: mission.no_internet,
      duration_seconds: mission.duration_seconds,
      status: mission.status,
      note: mission.note,
      summary: mission.summary,
      created_at: mission.created_at,
      finished_at: mission.finished_at,
      progress: {
        total: items.filter((i) => !(i.status === 'FAILED' && items.some((r) => r.replaces_item_id === i.id))).length,
        succeeded: count('SUCCEEDED'),
        failed: count('FAILED'),
        running: count('RUNNING'),
        queued: count('QUEUED'),
        pending: count('PENDING'),
        retries: items.reduce((sum, i) => sum + Math.max(0, i.attempts - 1), 0),
      },
      items: items.map((item) => ({
        id: item.id,
        device_id: item.device_id,
        device_name: names.get(item.device_id) ?? `Phone ${item.device_id}`,
        /** Live frames arrive keyed by the phone's hardware id. */
        device_hw_id: hardwareIds.get(item.device_id) ?? null,
        status: item.status,
        attempts: item.attempts,
        agent_task_id: item.agent_task_id,
        replaces_item_id: item.replaces_item_id,
        last_reason: item.last_reason,
        reason_text: item.last_reason ? PLAIN_REASON[item.last_reason] ?? item.last_reason : null,
        last_message: item.last_message,
        next_attempt_at: item.next_attempt_at,
      })),
    };
  }

  private async hardwareIds(ids: number[]): Promise<Map<number, string>> {
    if (!ids.length) return new Map();
    const devices = await this.deviceRepo.find({ where: { id: In([...new Set(ids)]) }, select: ['id', 'device_id'] });
    return new Map(devices.map((d) => [d.id, d.device_id]));
  }

  private async deviceNames(ids: number[]): Promise<Map<number, string>> {
    if (!ids.length) return new Map();
    const devices = await this.deviceRepo.find({ where: { id: In([...new Set(ids)]) }, select: ['id', 'device_name'] });
    return new Map(devices.map((d) => [d.id, d.device_name]));
  }
}

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function truncate(text?: string | null): string | null {
  if (!text) return null;
  return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}

function classifyDispatchError(message: string): string {
  const text = message.toLowerCase();
  if (/offline|reconnect|not connected/.test(text)) return 'DEVICE_OFFLINE';
  if (/did not answer|timed out|timeout/.test(text)) return 'TIMEOUT';
  if (/already running|waiting in the queue|busy taking another screenshot|was cancelled before the phone answered/.test(text)) return 'DEVICE_BUSY';
  if (/screen capture permission|screen-capture prompt|approve android.s permission prompt/.test(text)) return 'CAPTURE_PERMISSION';
  if (/accessibility is not ready|enable its accessibility/.test(text)) return 'NEEDS_SETUP';
  if (/\b429\b|rate limit/.test(text)) return 'LLM_RATE_LIMIT';
  if (/api key|credit|\b401\b|\b402\b/.test(text)) return 'LLM_AUTH_OR_CREDIT';
  return 'DISPATCH_ERROR';
}

/**
 * Orders ready phones so consecutive picks sit on different exit IPs: phones
 * with no proxy first (they run at once), then one per lane in turn. Picking
 * five phones then starts as many as possible in parallel instead of stacking
 * them behind a single lane.
 */
function spreadAcrossLanes(devices: FleetDevice[]): FleetDevice[] {
  const lanes = new Map<string, FleetDevice[]>();
  for (const device of devices) {
    const key = device.proxy_id == null ? 'none' : String(device.proxy_id);
    if (!lanes.has(key)) lanes.set(key, []);
    lanes.get(key)!.push(device);
  }
  const ordered: FleetDevice[] = [...(lanes.get('none') ?? [])];
  lanes.delete('none');
  const queues = [...lanes.values()];
  while (queues.some((q) => q.length)) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next) ordered.push(next);
    }
  }
  return ordered;
}

const COUNT_PHRASE = /\b(?:on|in|from|with|using|par|pe|se|mein)?\s*(\d{1,3})\s*(?:phones?|devices?|mobiles?)\b/i;
const ALL_PHRASE = /\b(?:on|in|from|with|using)?\s*(?:all|every|saare|sabhi|sab)\s*(?:the\s+)?(?:phones?|devices?|mobiles?)\b/i;
const TAG_PHRASE = /(?:^|\s)#([\w-]+)/;

/**
 * Plain-text fallback when no model is available (and the only planner in the
 * test harness): understands "on 5 phones", "all phones" and "#tag".
 */
export function parseRequestLocally(request: string): MissionPlan | null {
  const base = { ids: [] as number[], tag: '', count: 0, no_internet: false };
  const tag = TAG_PHRASE.exec(request);
  if (tag) {
    return { ...base, mode: 'tag', tag: tag[1], prompt: tidy(request.replace(TAG_PHRASE, ' ')) };
  }
  if (ALL_PHRASE.test(request)) {
    return { ...base, mode: 'all', prompt: tidy(request.replace(ALL_PHRASE, ' ')) };
  }
  const count = COUNT_PHRASE.exec(request);
  if (count) {
    return { ...base, mode: 'count', count: Number(count[1]), prompt: tidy(request.replace(COUNT_PHRASE, ' ')) };
  }
  return null;
}

function tidy(text: string): string {
  return text.replace(/\s{2,}/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();
}

function summarize(mission: Mission, items: MissionItem[], names: Map<number, string>): string {
  const replaced = new Set(items.filter((i) => i.replaces_item_id).map((i) => i.replaces_item_id));
  // A phone whose share was taken over by a spare is not counted twice.
  const counted = items.filter((i) => !replaced.has(i.id) || i.status === 'SUCCEEDED');
  const ok = counted.filter((i) => i.status === 'SUCCEEDED');
  const failed = counted.filter((i) => i.status === 'FAILED');
  const retries = items.reduce((sum, i) => sum + Math.max(0, i.attempts - 1), 0);

  const lines: string[] = [];
  if (mission.status === 'CANCELLED') {
    lines.push(`Cancelled — ${ok.length}/${counted.length} phones had finished.`);
  } else {
    lines.push(`${ok.length}/${counted.length} phones done.`);
  }
  if (mission.note) lines.push(mission.note);
  if (retries) lines.push(`${retries} ${retries === 1 ? 'retry' : 'retries'} along the way.`);
  for (const item of items.filter((i) => replaced.has(i.id))) {
    const by = items.find((i) => i.replaces_item_id === item.id);
    lines.push(`${names.get(item.device_id) ?? item.device_id} kept failing (${PLAIN_REASON[item.last_reason ?? ''] ?? item.last_reason}); handed to ${names.get(by?.device_id ?? -1) ?? 'a spare phone'}.`);
  }
  for (const item of failed) {
    const why = PLAIN_REASON[item.last_reason ?? ''] ?? item.last_reason ?? 'failed';
    const detail = item.last_message && item.last_reason === 'AGENT_REPORTED_FAILURE' ? ` — ${item.last_message.slice(0, 160)}` : '';
    lines.push(`✗ ${names.get(item.device_id) ?? item.device_id}: ${why}${item.attempts > 1 ? ` after ${item.attempts} tries` : ''}${detail}`);
  }
  return lines.join('\n');
}
