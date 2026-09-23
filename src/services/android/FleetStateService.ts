import { AgentTask } from '@/entities/AgentTask';
import { AndroidDevice, AndroidDeviceStatus } from '@/entities/AndroidDevice';
import { DeviceProxy } from '@/entities/DeviceProxy';
import { QueuedTask } from '@/entities/QueuedTask';
import { AppDataSource } from '@/loaders/database';
import { Service } from 'typedi';
import { ProxyRotationService } from './ProxyRotationService';

/**
 * How long a finished run keeps showing on its device card. After this the card
 * goes back to Ready — a result from this morning is history, not status.
 */
const RECENT_OUTCOME_MS = 30 * 60_000;

export type FleetDeviceState =
  | 'offline'
  | 'running'
  | 'waiting'
  | 'needs_setup'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'cancelled'
  | 'idle';

/**
 * The fleet's state, computed once on the server.
 *
 * Every surface — fleet page, agent page, Telegram — used to work this out for
 * itself from separate device, task and queue lists, and each of them got it
 * wrong in a different way: a phone that reconnected looked Ready while its
 * accessibility service was off, a queued run looked like it was executing, and
 * a reload forgot how the last run ended. One answer, derived from stored state,
 * means the surfaces can only disagree with each other by being out of date.
 */
@Service()
export class FleetStateService {
  constructor(private rotationService: ProxyRotationService) {}

  private deviceRepo = AppDataSource.getRepository(AndroidDevice);
  private taskRepo = AppDataSource.getRepository(AgentTask);
  private queueRepo = AppDataSource.getRepository(QueuedTask);
  private proxyRepo = AppDataSource.getRepository(DeviceProxy);

  async getState(userId: number) {
    const now = Date.now();
    const devices = (await this.deviceRepo.find({ where: { user_id: userId }, order: { created_at: 'ASC' } })).filter(
      (device) => !device.device_id.startsWith('pending_'),
    );
    const deviceIds = devices.map((device) => device.id);

    const [running, queued, proxies] = await Promise.all([
      deviceIds.length
        ? this.taskRepo
            .createQueryBuilder('task')
            .where('task.user_id = :userId', { userId })
            .andWhere('task.device_id IN (:...deviceIds)', { deviceIds })
            .andWhere('task.status = :status', { status: 'RUNNING' })
            .andWhere('task.lease_until > :now', { now: new Date() })
            .getMany()
        : [],
      this.queueRepo.find({ where: { user_id: userId }, order: { id: 'ASC' } }),
      this.proxyRepo.find({ where: { user_id: userId }, order: { id: 'ASC' } }),
    ]);

    // The newest finished run per device, for the outcome a card keeps showing.
    const lastFinished = new Map<number, AgentTask>();
    if (deviceIds.length) {
      const finished = await this.taskRepo
        .createQueryBuilder('task')
        .where('task.user_id = :userId', { userId })
        .andWhere('task.device_id IN (:...deviceIds)', { deviceIds })
        .andWhere('task.status IN (:...statuses)', { statuses: ['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'] })
        .andWhere('task.finished_at > :cutoff', { cutoff: new Date(now - RECENT_OUTCOME_MS) })
        .orderBy('task.finished_at', 'DESC')
        .getMany();
      for (const task of finished) {
        if (task.device_id != null && !lastFinished.has(task.device_id)) lastFinished.set(task.device_id, task);
      }
    }

    const runningByDevice = new Map(running.filter((t) => t.device_id != null).map((t) => [t.device_id, t]));
    const queuePositions = new Map<number, number>();
    const queueByDevice = new Map<number, QueuedTask>();
    const perLaneCount = new Map<number, number>();
    for (const entry of queued) {
      const ahead = (perLaneCount.get(entry.proxy_id) ?? 0) + 1;
      perLaneCount.set(entry.proxy_id, ahead);
      queuePositions.set(entry.device_id, ahead);
      queueByDevice.set(entry.device_id, entry);
    }

    const outcomeState: Record<string, FleetDeviceState> = {
      SUCCEEDED: 'completed',
      FAILED: 'failed',
      CANCELLED: 'cancelled',
      INTERRUPTED: 'interrupted',
    };

    const deviceStates = devices.map((device) => {
      const live = runningByDevice.get(device.id);
      const waiting = queueByDevice.get(device.id);
      const finished = lastFinished.get(device.id);
      const online = device.status === AndroidDeviceStatus.ONLINE;

      let state: FleetDeviceState;
      if (!online) state = 'offline';
      else if (live) state = 'running';
      else if (waiting) state = 'waiting';
      else if (device.capabilities && device.capabilities.accessibility === false) state = 'needs_setup';
      else if (finished) state = outcomeState[finished.status] ?? 'idle';
      else state = 'idle';

      const task = live ?? finished ?? null;
      return {
        id: device.id,
        device_id: device.device_id,
        name: device.device_name,
        model: device.device_model,
        online,
        accessibility: device.capabilities?.accessibility ?? null,
        app_version: device.capabilities?.appVersion ?? null,
        battery: typeof device.capabilities?.battery === 'number' ? device.capabilities.battery : null,
        tag: device.tag,
        proxy_id: device.proxy_id ?? null,
        last_seen_at: device.last_seen_at,
        state,
        queue_position: queuePositions.get(device.id) ?? null,
        task: task
          ? {
              id: task.id,
              status: task.status,
              reason_code: task.reason_code,
              prompt: task.prompt,
              message: task.message,
              total_steps: task.total_steps,
              started_at: task.started_at,
              finished_at: task.finished_at,
            }
          : null,
      };
    });

    const lanes = proxies.map((proxy) => ({
      id: proxy.id,
      name: proxy.name,
      concurrency: proxy.concurrency,
      running: deviceStates.filter((d) => d.proxy_id === proxy.id && d.state === 'running').length,
      waiting: deviceStates.filter((d) => d.proxy_id === proxy.id && d.state === 'waiting').length,
      // Non-null while a rotation is failing: the lane holds its phones back
      // rather than putting the next one on an IP that never changed.
      blocked_reason: this.rotationService.laneBlockStatus(proxy.id),
    }));

    const counts = deviceStates.reduce(
      (acc, device) => {
        acc[device.state] += 1;
        acc.total += 1;
        return acc;
      },
      {
        total: 0,
        offline: 0,
        running: 0,
        waiting: 0,
        needs_setup: 0,
        completed: 0,
        failed: 0,
        interrupted: 0,
        cancelled: 0,
        idle: 0,
      } as Record<FleetDeviceState | 'total', number>,
    );

    return { generated_at: new Date(), counts, devices: deviceStates, lanes };
  }
}
