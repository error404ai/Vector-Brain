import { AgentTask } from '@/entities/AgentTask';
import { AndroidDevice } from '@/entities/AndroidDevice';
import { DeviceProxy } from '@/entities/DeviceProxy';
import { QueuedTask } from '@/entities/QueuedTask';
import AppError from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import Logger from '@/logger/index';
import { ApiResponse } from '@/types/ApiResponse';
import { Service } from 'typedi';
import { AndroidGatewayService } from './AndroidGatewayService';
import { ProxyRotationService } from './ProxyRotationService';

/** Signature of the planner call the queue uses to launch a waiting task. */
type TaskRunner = (
  prompt: string,
  deviceId: number,
  userId: number,
  maxSteps?: number,
  existingTaskId?: number,
  aiConfigId?: number,
  runSeconds?: number,
) => Promise<unknown>;

/** Tells the queue how many of a lane's devices are running right now. */
type BusyCheck = (deviceDbId: number) => boolean;

/** Catches lanes that stalled — a lost end event, or a restart mid-run. */
const SWEEP_INTERVAL_MS = 30_000;

/** How long a lane slot may be held by a run that has not started yet. */
const RESERVATION_MAX_AGE_MS = 2 * 60 * 1000;

/** A queued task this old is dropped rather than run against a stale screen. */
const MAX_QUEUE_AGE_MS = 6 * 60 * 60 * 1000;

/**
 * Holds tasks until their proxy lane is free.
 *
 * A proxy is a lane: the phones behind it share one exit IP, so running two at
 * once would put both on the same address, which is the thing a proxy is bought
 * to avoid. The lane therefore admits `concurrency` devices at a time, rotates
 * when one finishes, waits for the new IP to settle, then admits the next.
 *
 * Devices with no proxy never come through here at all.
 */
@Service()
export class TaskQueueService {
  constructor(
    private gatewayService: AndroidGatewayService,
    private rotationService: ProxyRotationService,
  ) {}

  private queueRepo = AppDataSource.getRepository(QueuedTask);
  private deviceRepo = AppDataSource.getRepository(AndroidDevice);
  private proxyRepo = AppDataSource.getRepository(DeviceProxy);
  private taskRepo = AppDataSource.getRepository(AgentTask);

  /**
   * Devices on this lane with a live run recorded in the database.
   *
   * Memory alone was not enough: during a deploy the old and new containers
   * overlap, and the new one has never heard of the runs the old one is still
   * driving — so it would hand the lane to a second phone and put two of them
   * on the same exit IP. The stored status is the shared truth; the lease keeps
   * a crashed run from holding a lane forever.
   */
  private async laneBusyFromDatabase(proxyId: number): Promise<Set<number>> {
    const rows = await this.taskRepo
      .createQueryBuilder('task')
      .select('task.device_id', 'device_id')
      .innerJoin(AndroidDevice, 'device', 'device.id = task.device_id')
      .where('device.proxy_id = :proxyId', { proxyId })
      .andWhere('task.status = :status', { status: 'RUNNING' })
      .andWhere('task.lease_until > :now', { now: new Date() })
      // A run that needs no exit IP shares the phone, not the address, so it
      // must not make the lane look occupied.
      .andWhere('task.lane_exempt = 0')
      .getRawMany<{ device_id: number }>();
    return new Set(rows.map((row) => Number(row.device_id)));
  }

  private runTask: TaskRunner | null = null;

  /**
   * Why recent queue entries were dropped, by entry id. Entries are deleted
   * when their phone cannot start, which left a mission following one with
   * nothing but "the entry disappeared"; this keeps the real reason around
   * long enough for it to be read.
   */
  private recentDrops = new Map<number, { reason: string; at: number }>();

  dropReason(queueId: number): string | null {
    const hit = this.recentDrops.get(queueId);
    return hit ? hit.reason : null;
  }

  private rememberDrop(queueId: number, reason: string): void {
    const now = Date.now();
    this.recentDrops.set(queueId, { reason, at: now });
    for (const [id, entry] of this.recentDrops) if (now - entry.at > 30 * 60_000) this.recentDrops.delete(id);
  }
  private isDeviceBusy: BusyCheck | null = null;

  /** Lanes being drained right now, so two drains never admit the same slot. */
  private draining = new Set<number>();

  /**
   * Devices that hold a lane slot but have not registered as running yet.
   *
   * The planner marks a device active well after it accepts the task, and the
   * fleet dispatches every selected device at once — so without this, six
   * devices on one lane all check "is there room?" before any of them has taken
   * the slot, and all six start. A reservation is taken the moment admission is
   * granted and released when the run ends.
   */
  private reserved = new Map<number, number>();

  /**
   * Wired up by the planner at boot.
   *
   * The planner depends on this service, so this one must not depend on the
   * planner — injecting both ways would be a cycle typedi cannot resolve.
   */
  register(runner: TaskRunner, busyCheck: BusyCheck): void {
    this.runTask = runner;
    this.isDeviceBusy = busyCheck;
    setInterval(() => void this.sweep(), SWEEP_INTERVAL_MS);
  }

  // ---------------------------------------------------------------------------
  // Admission
  // ---------------------------------------------------------------------------

  /**
   * Whether this device may start immediately.
   *
   * True for anything without a proxy, and for a lane with room left.
   *
   * The check-and-reserve must be atomic. The fleet dispatches every selected
   * device at once, so many tryAdmit calls run concurrently; if any await sits
   * between counting the lane and taking the slot, they all see the lane empty
   * and all start — the exact bug that put 22 devices on 2 lanes at once and
   * rotated the providers into a 429. So all awaits (loading the proxy id and
   * the lane's members) happen first, then a single synchronous block counts
   * reservations and reserves — with no await in between, JS runs it to
   * completion before the next caller gets the CPU.
   */
  async tryAdmit(deviceDbId: number): Promise<boolean> {
    const device = await this.deviceRepo.findOne({ where: { id: deviceDbId } });
    if (!device?.proxy_id) return true;

    const proxyId = device.proxy_id;
    const proxy = await this.proxyRepo.findOne({ where: { id: proxyId } });
    if (!proxy) return true;
    // Rotation off: the IP never changes, so there is nothing to wait for — the
    // lane has no queue and its phones run at once (user's choice).
    if (proxy.rotate_every_tasks <= 0) return true;
    const capacity = Math.max(1, proxy.concurrency);

    // Cache lane membership and stored runs so the count below needs no await.
    const laneDeviceIds = (await this.deviceRepo.find({ where: { proxy_id: proxyId } })).map((d) => d.id);
    const busyInDatabase = await this.laneBusyFromDatabase(proxyId);

    // ---- synchronous critical section: no await from here to the return ----
    const taken = laneDeviceIds.filter(
      (id) => id !== deviceDbId && (this.reserved.has(id) || this.isBusy(id) || busyInDatabase.has(id)),
    ).length;
    if (taken >= capacity) return false;
    this.reserved.set(deviceDbId, Date.now());
    return true;
  }

  /** Give the slot back — the run ended, or never started. */
  release(deviceDbId: number): void {
    this.reserved.delete(deviceDbId);
  }

  private isBusy(deviceDbId: number): boolean {
    return this.isDeviceBusy ? this.isDeviceBusy(deviceDbId) : false;
  }

  async enqueue(input: {
    userId: number;
    deviceId: number;
    proxyId: number;
    prompt: string;
    aiConfigId?: number;
    maxSteps?: number;
    runSeconds?: number;
  }): Promise<ApiResponse> {
    // One waiting entry per device: queueing the same phone twice would run the
    // second task against whatever the first one left on screen.
    const existing = await this.queueRepo.findOne({ where: { device_id: input.deviceId, status: 'QUEUED' } });
    if (existing) {
      throw new AppError('This device already has a task waiting in the queue.', 409);
    }

    const entry = this.queueRepo.create({
      user_id: input.userId,
      device_id: input.deviceId,
      proxy_id: input.proxyId,
      prompt: input.prompt,
      ai_config_id: input.aiConfigId ?? null,
      max_steps: input.maxSteps ?? 500,
      run_seconds: input.runSeconds ?? null,
      status: 'QUEUED',
    });
    await this.queueRepo.save(entry);

    const ahead = await this.queueRepo.count({
      where: { proxy_id: input.proxyId, status: 'QUEUED' },
    });

    return {
      message: `Queued — waiting for the proxy lane (${ahead} in line)`,
      data: { queued: true, queueId: entry.id, position: ahead },
    };
  }

  // ---------------------------------------------------------------------------
  // Draining
  // ---------------------------------------------------------------------------

  /** A run on this device ended: hand its lane to whoever is waiting. */
  async onDeviceFinished(deviceDbId: number): Promise<void> {
    if (!deviceDbId) return;
    const device = await this.deviceRepo.findOne({ where: { id: deviceDbId } });
    if (device?.proxy_id) await this.onLaneFreed(device.proxy_id);
  }

  /**
   * Start the next task on a lane, once the finished one has rotated.
   *
   * The wait is the proxy's own settle time: the provider needs a moment before
   * the new address is actually handed out, and starting inside that window puts
   * the next phone on the old IP — the exact thing the queue exists to prevent.
   */
  async onLaneFreed(proxyId: number): Promise<void> {
    if (!proxyId || this.draining.has(proxyId)) return;
    this.draining.add(proxyId);

    try {
      const proxy = await this.proxyRepo.findOne({ where: { id: proxyId } });
      if (!proxy) return;

      if (proxy.settle_seconds > 0) {
        await new Promise((resolve) => setTimeout(resolve, proxy.settle_seconds * 1000));
      }

      await this.drainLane(proxy);
    } catch (error) {
      Logger.warn(`[Queue] Draining lane ${proxyId} failed`, error);
    } finally {
      this.draining.delete(proxyId);
    }
  }

  private async drainLane(proxy: DeviceProxy): Promise<void> {
    if (!this.runTask) return;

    // Rotation off: whatever is still waiting (queued before it was switched
    // off) starts now, all together.
    const capacity = proxy.rotate_every_tasks <= 0 ? Number.POSITIVE_INFINITY : Math.max(1, proxy.concurrency);

    for (;;) {
      const running = await this.countRunningOnLane(proxy.id);
      if (running >= capacity) return;

      // The lane's IP has to be good before the next phone touches it. While a
      // rotation is failing the lane stays shut and the tasks keep waiting —
      // the rotation service retries on a backoff and reopens it.
      if (!(await this.rotationService.ensureRotated(proxy.id))) {
        Logger.info(`[Queue] Lane ${proxy.id} held: ${this.rotationService.laneBlockStatus(proxy.id) ?? 'waiting for rotation'}`);
        // Come back when the backoff is up instead of leaving the lane to the
        // 30s sweep — a lane that can reopen in 15s should not wait twice that.
        const waitMs = this.rotationService.retryAfterMs(proxy.id);
        if (waitMs !== null) {
          setTimeout(() => void this.onLaneFreed(proxy.id), Math.min(waitMs + 500, 60_000)).unref();
        }
        return;
      }

      const next = await this.queueRepo.findOne({
        where: { proxy_id: proxy.id, status: 'QUEUED' },
        order: { id: 'ASC' },
      });
      if (!next) return;

      // Claimed before launching so a second drain cannot take the same entry.
      next.status = 'STARTING';
      await this.queueRepo.save(next);

      const device = await this.deviceRepo.findOne({ where: { id: next.device_id } });
      if (!device || device.status !== 'ONLINE') {
        // The phone went away while it waited. Drop the entry and carry on down
        // the lane rather than blocking everything behind it.
        next.last_error = 'Device was offline when its turn came';
        await this.queueRepo.save(next);
        this.rememberDrop(next.id, next.last_error);
        await this.queueRepo.delete(next.id);

        try {
          this.gatewayService.broadcastToUser(next.user_id, 'queue:dropped', {
            deviceId: next.device_id,
            deviceName: device?.device_name ?? 'Device',
            reason: next.last_error,
          });
        } catch {
          // Best effort, as above.
        }

        continue;
      }

      try {
        await this.runTask(
          next.prompt,
          next.device_id,
          next.user_id,
          next.max_steps,
          undefined,
          next.ai_config_id ?? undefined,
          next.run_seconds ?? undefined,
        );
        await this.queueRepo.delete(next.id);
      } catch (error: any) {
        this.release(next.device_id);
        Logger.warn(`[Queue] Could not start queued task ${next.id}: ${error?.message ?? error}`);

        // The refusal belongs to this phone, not to the lane — an unresponsive
        // accessibility service on one device says nothing about the next one.
        // Stopping here let a single bad handset hold up everything behind it,
        // so the entry is dropped and the lane carries on.
        next.last_error = String(error?.message ?? 'Could not start').slice(0, 255);
        await this.queueRepo.save(next);
        this.rememberDrop(next.id, next.last_error);
        await this.queueRepo.delete(next.id);

        // Dropping it quietly would leave the user waiting for a run that is
        // never coming, so the reason goes to the dashboard.
        try {
          this.gatewayService.broadcastToUser(next.user_id, 'queue:dropped', {
            deviceId: next.device_id,
            deviceName: device.device_name,
            reason: next.last_error,
          });
        } catch {
          // Telling the dashboard is best effort; the lane must keep moving.
        }

        continue;
      }
    }
  }

  /**
   * Picks up lanes nothing else is going to wake.
   *
   * A run that ended without its finish event — a restart, a crash — would
   * otherwise leave its lane idle with tasks still waiting.
   */
  private async sweep(): Promise<void> {
    try {
      // A reservation is only meant to cover the seconds between admission and
      // the run registering as active. Anything older belongs to a launch that
      // died on the way, and holding it would strand the lane.
      const staleReservation = Date.now() - RESERVATION_MAX_AGE_MS;
      for (const [deviceDbId, takenAt] of this.reserved) {
        if (takenAt < staleReservation && !this.isBusy(deviceDbId)) this.reserved.delete(deviceDbId);
      }

      const cutoff = new Date(Date.now() - MAX_QUEUE_AGE_MS);
      await this.queueRepo
        .createQueryBuilder()
        .delete()
        .where('created_at < :cutoff', { cutoff })
        .execute();

      // STARTING entries older than a minute belong to a launch that never
      // completed; put them back in line.
      const stale = new Date(Date.now() - 60_000);
      await this.queueRepo
        .createQueryBuilder()
        .update()
        .set({ status: 'QUEUED' })
        .where('status = :status AND created_at < :stale', { status: 'STARTING', stale })
        .execute();

      const waiting = await this.queueRepo
        .createQueryBuilder('entry')
        .select('DISTINCT entry.proxy_id', 'proxy_id')
        .where('entry.status = :status', { status: 'QUEUED' })
        .getRawMany<{ proxy_id: number }>();

      for (const row of waiting) {
        const proxy = await this.proxyRepo.findOne({ where: { id: Number(row.proxy_id) } });
        if (!proxy || this.draining.has(proxy.id)) continue;

        const running = await this.countRunningOnLane(proxy.id);
        if (running >= Math.max(1, proxy.concurrency)) continue;

        this.draining.add(proxy.id);
        try {
          await this.drainLane(proxy);
        } finally {
          this.draining.delete(proxy.id);
        }
      }
    } catch (error) {
      Logger.warn('[Queue] Sweep failed', error);
    }
  }

  /** Devices on this lane with a run in progress right now. */
  private async countRunningOnLane(proxyId: number, ignoreDeviceId?: number): Promise<number> {
    const devices = await this.deviceRepo.find({ where: { proxy_id: proxyId } });
    const busyInDatabase = await this.laneBusyFromDatabase(proxyId);
    return devices.filter(
      (device) =>
        device.id !== ignoreDeviceId &&
        (this.reserved.has(device.id) || this.isBusy(device.id) || busyInDatabase.has(device.id)),
    ).length;
  }

  // ---------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------

  async list(userId: number): Promise<ApiResponse> {
    const entries = await this.queueRepo.find({
      where: { user_id: userId },
      order: { id: 'ASC' },
    });

    return {
      message: 'Queued tasks',
      data: entries.map((entry) => ({
        id: entry.id,
        device_id: entry.device_id,
        proxy_id: entry.proxy_id,
        prompt: entry.prompt,
        status: entry.status,
        last_error: entry.last_error,
        created_at: entry.created_at,
      })),
    };
  }

  async cancel(userId: number, id: number): Promise<ApiResponse> {
    const entry = await this.queueRepo.findOne({ where: { id, user_id: userId } });
    if (!entry) throw new AppError('Queued task not found', 404);

    await this.queueRepo.delete(entry.id);
    return { message: 'Removed from the queue' };
  }

  async clearForDevice(userId: number, deviceId: number): Promise<ApiResponse> {
    await this.queueRepo.delete({ user_id: userId, device_id: deviceId });
    return { message: 'Queue cleared for this device' };
  }

  /**
   * Wipes every queued task for a user.
   *
   * Stop All must actually stop everything: cancelling the running tasks alone
   * let the queue drain and the waiting phones started right after — the
   * opposite of what the user asked for. Clearing the queue first means a
   * cancelled task has nothing to hand the lane to.
   */
  async clearAll(userId: number): Promise<ApiResponse> {
    const { affected } = await this.queueRepo.delete({ user_id: userId, status: 'QUEUED' });
    return { message: `Cleared ${affected ?? 0} queued task${affected === 1 ? '' : 's'}`, data: { cleared: affected ?? 0 } };
  }
}
