import { AndroidDevice } from '@/entities/AndroidDevice';
import { DeviceProxy } from '@/entities/DeviceProxy';
import AppError from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import Logger from '@/logger/index';
import { ApiResponse } from '@/types/ApiResponse';
import { Service } from 'typedi';
import { z } from 'zod';
import { CreateProxyValidation, UpdateProxyValidation } from '@/validations/DeviceProxyValidation';

/** A rotation link should answer quickly; anything slower is treated as failed. */
const REQUEST_TIMEOUT_MS = 20_000;

/** Enough of the provider's answer to find an address in, without logging a page. */
const MAX_BODY_CHARS = 2000;

/** Plain IPv4, which is what these providers hand back. */
const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;

@Service()
export class ProxyRotationService {
  private proxyRepo = AppDataSource.getRepository(DeviceProxy);
  private deviceRepo = AppDataSource.getRepository(AndroidDevice);

  // ---------------------------------------------------------------------------
  // Dashboard
  // ---------------------------------------------------------------------------

  async list(userId: number): Promise<ApiResponse> {
    const proxies = await this.proxyRepo.find({ where: { user_id: userId }, order: { id: 'ASC' } });
    const devices = await this.deviceRepo.find({ where: { user_id: userId } });

    return {
      message: 'Proxies',
      data: proxies.map((proxy) => ({
        ...proxy,
        // The URL itself is never sent to the browser; only whether one is set.
        device_count: devices.filter((device) => device.proxy_id === proxy.id).length,
      })),
    };
  }

  /**
   * Types come from the schema rather than being written out here.
   *
   * The backend compiles with strict off, which makes zod infer every field as
   * optional, so a hand-written signature with required fields will not match
   * what the controller passes in.
   */
  async create(userId: number, input: z.infer<typeof CreateProxyValidation>): Promise<ApiResponse> {
    const proxy = this.proxyRepo.create({
      user_id: userId,
      name: String(input.name ?? '').trim(),
      rotation_url: String(input.rotation_url ?? '').trim(),
      concurrency: input.concurrency ?? 1,
      settle_seconds: input.settle_seconds ?? 5,
      rotate_every_tasks: input.rotate_every_tasks ?? 1,
    });
    await this.proxyRepo.save(proxy);

    return { message: 'Proxy added', data: { id: proxy.id, name: proxy.name } };
  }

  async update(userId: number, id: number, input: z.infer<typeof UpdateProxyValidation>): Promise<ApiResponse> {
    const proxy = await this.proxyRepo.findOne({ where: { id, user_id: userId } });
    if (!proxy) throw new AppError('Proxy not found', 404);

    if (input.name !== undefined) proxy.name = String(input.name).trim();
    // An empty string means "leave the saved URL alone", so the browser never
    // has to send a secret back just to rename a proxy.
    if (input.rotation_url) proxy.rotation_url = input.rotation_url.trim();
    if (input.concurrency !== undefined) proxy.concurrency = input.concurrency;
    if (input.settle_seconds !== undefined) proxy.settle_seconds = input.settle_seconds;
    if (input.rotate_every_tasks !== undefined) proxy.rotate_every_tasks = input.rotate_every_tasks;

    await this.proxyRepo.save(proxy);
    return { message: 'Proxy updated' };
  }

  async remove(userId: number, id: number): Promise<ApiResponse> {
    const proxy = await this.proxyRepo.findOne({ where: { id, user_id: userId } });
    if (!proxy) throw new AppError('Proxy not found', 404);

    // The foreign key clears proxy_id on the phones that were using it, so they
    // simply go back to running without a proxy.
    await this.proxyRepo.delete(proxy.id);
    return { message: 'Proxy removed' };
  }

  /** Point a device at a proxy, or at none when proxyId is null. */
  async assignDevice(userId: number, deviceId: number, proxyId: number | null): Promise<ApiResponse> {
    const device = await this.deviceRepo.findOne({ where: { id: deviceId, user_id: userId } });
    if (!device) throw new AppError('Device not found', 404);

    if (proxyId !== null) {
      const proxy = await this.proxyRepo.findOne({ where: { id: proxyId, user_id: userId } });
      if (!proxy) throw new AppError('Proxy not found', 404);
    }

    device.proxy_id = proxyId;
    await this.deviceRepo.save(device);
    return { message: proxyId === null ? 'Device removed from proxy' : 'Device assigned to proxy' };
  }

  /** Rotate on demand from the dashboard, ignoring the every-N-tasks counter. */
  async rotateNow(userId: number, id: number): Promise<ApiResponse> {
    const proxy = await this.loadWithUrl(id, userId);
    if (!proxy) throw new AppError('Proxy not found', 404);

    const result = await this.callRotationUrl(proxy);
    return {
      message: result.ok ? `Rotated${result.ip ? ` — now ${result.ip}` : ''}` : `Rotation failed: ${result.status}`,
      data: { ok: result.ok, ip: result.ip, status: result.status },
    };
  }

  // ---------------------------------------------------------------------------
  // Called when a task finishes
  // ---------------------------------------------------------------------------

  /**
   * Rotate the lane a finished task was running on.
   *
   * Never throws and is never awaited by the run: a proxy provider having a bad
   * minute must not turn a completed task into a failed one. Runs for finished,
   * failed and cancelled alike, because the phone used the IP either way.
   */
  async onTaskFinished(deviceDbId?: number): Promise<void> {
    if (!deviceDbId) return;

    try {
      const device = await this.deviceRepo.findOne({ where: { id: deviceDbId } });
      if (!device?.proxy_id) return;

      const proxy = await this.loadWithUrl(device.proxy_id);
      if (!proxy || proxy.rotate_every_tasks <= 0) return;

      const count = proxy.tasks_since_rotation + 1;
      if (count < proxy.rotate_every_tasks) {
        await this.proxyRepo.update(proxy.id, { tasks_since_rotation: count });
        return;
      }

      await this.callRotationUrl(proxy);
    } catch (error) {
      Logger.warn('[Proxy] Rotation after task failed', error);
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /** rotation_url is select:false, so it has to be asked for explicitly. */
  private async loadWithUrl(id: number, userId?: number): Promise<DeviceProxy | null> {
    const query = this.proxyRepo
      .createQueryBuilder('proxy')
      .addSelect('proxy.rotation_url')
      .where('proxy.id = :id', { id });

    if (userId !== undefined) query.andWhere('proxy.user_id = :userId', { userId });
    return query.getOne();
  }

  private async callRotationUrl(proxy: DeviceProxy): Promise<{ ok: boolean; ip: string | null; status: string }> {
    let ok = false;
    let ip: string | null = null;
    let status: string;

    try {
      const response = await fetch(proxy.rotation_url, {
        method: 'GET',
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const body = (await response.text().catch(() => '')).slice(0, MAX_BODY_CHARS);

      if (response.ok) {
        ok = true;
        ip = this.extractIp(body);
        status = ip ? `Rotated to ${ip}` : 'Rotated';
      } else {
        status = `Provider returned ${response.status}`;
      }
    } catch (error: any) {
      // The URL carries credentials, so only the error text is ever logged.
      status = error?.name === 'TimeoutError' ? 'Provider did not answer in time' : `Request failed: ${error?.message ?? 'unknown'}`;
    }

    await this.proxyRepo.update(proxy.id, {
      tasks_since_rotation: 0,
      last_rotation_status: status.slice(0, 255),
      last_ip: ip ?? proxy.last_ip,
      last_rotated_at: new Date(),
    });

    if (!ok) Logger.warn(`[Proxy] "${proxy.name}" rotation failed: ${status}`);
    return { ok, ip, status };
  }

  /**
   * Pull the new address out of whatever the provider answered.
   *
   * Formats vary by provider — JSON for some, a line of text for others — so
   * JSON is tried first and a bare address match second. Finding nothing is not
   * an error: the rotation still happened, it just cannot be labelled.
   */
  private extractIp(body: string): string | null {
    const trimmed = body.trim();
    if (!trimmed) return null;

    try {
      const parsed = JSON.parse(trimmed);
      for (const key of ['new_ip', 'newIp', 'current_ip', 'currentIp', 'ip', 'address']) {
        const value = parsed?.[key];
        if (typeof value === 'string' && IPV4.test(value)) return value.match(IPV4)?.[0] ?? null;
      }
    } catch {
      // Not JSON — fall through to the text match below.
    }

    // Providers that print "old: a.b.c.d new: e.f.g.h" put the new one last.
    const matches = trimmed.match(new RegExp(IPV4.source, 'g'));
    return matches?.[matches.length - 1] ?? null;
  }
}
