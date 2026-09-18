import { AndroidDevice } from '@/entities/AndroidDevice';
import { DeviceProxy } from '@/entities/DeviceProxy';
import { QueuedTask } from '@/entities/QueuedTask';
import AppError from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import Logger from '@/logger/index';
import { ApiResponse } from '@/types/ApiResponse';
import { Service } from 'typedi';
import { AndroidGatewayService } from './AndroidGatewayService';

/** Signature of the planner call the queue uses to launch a waiting task. */
type TaskRunner = (
  prompt: string,
  deviceId: number,
  userId: number,
  maxSteps?: number,
  existingTaskId?: number,
  aiConfigId?: number,
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
  constructor(private gatewayService: AndroidGatewayService) {}

  private queueRepo = AppDataSource.getRepository(QueuedTask);
  private deviceRepo = AppDataSource.getRepository(AndroidDevice);
  private proxyRepo = AppDataSource.getRepository(DeviceProxy);

  private runTask: TaskRunner | null = null;
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
   */
  async tryAdmit(deviceDbId: number): Promise<boolean> {
    const device = await this.deviceRepo.findOne({ where: { id: deviceDbId } });
    if (!device?.proxy_id) return true;

    const proxy = await this.proxyRepo.findOne({ where: { id: device.proxy_id } });
    if (!proxy) return true;

    const laneDevices = await this.deviceRepo.find({ where: { proxy_id: proxy.id } });

    // Everything from here runs without awaiting, so two callers cannot both
    // see the same free slot: the first one's reservation is already in place
    // by the time the second gets here.
    const taken = laneDevices.filter(
      (candidate) => candidate.id !== deviceDbId && (this.reserved.has(candidate.id) || this.isBusy(candidate.id)),
    ).length;

    if (taken >= Math.max(1, proxy.concurrency)) return false;

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

    const capacity = Math.max(1, proxy.concurrency);

    for (;;) {
      const running = await this.countRunningOnLane(proxy.id);
      if (running >= capacity) return;

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
    if (!this.isDeviceBusy) return 0;

    const devices = await this.deviceRepo.find({ where: { proxy_id: proxyId } });
    return devices.filter(
      (device) => device.id !== ignoreDeviceId && (this.reserved.has(device.id) || this.isDeviceBusy!(device.id)),
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
}
