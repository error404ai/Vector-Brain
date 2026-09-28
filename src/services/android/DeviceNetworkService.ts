import { AndroidDevice } from '@/entities/AndroidDevice';
import AppError from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import { ApiResponse } from '@/types/ApiResponse';
import { Service } from 'typedi';
import { AndroidGatewayService } from './AndroidGatewayService';
import { buildNetworkInfo, type DeviceNetworkInfo } from './deviceNetwork';

/**
 * Each phone's network and locale — IPs, DNS, language, region, timezone,
 * clock — as the phone reports them itself (companion 0.28+). Stored on the
 * device, shown on the fleet, and handed to the AI chats so "which IP is on
 * lane3" is answered from data instead of by a run tapping through Settings.
 */
@Service()
export class DeviceNetworkService {
  private deviceRepo = AppDataSource.getRepository(AndroidDevice);

  constructor(private gatewayService: AndroidGatewayService) {}

  /** A phone's report. `seenFrom` is the address the report arrived from. */
  async record(token: { deviceId: string; userId: number }, report: Record<string, unknown>, seenFrom: string | null): Promise<ApiResponse> {
    const device = await this.deviceRepo.findOne({ where: { device_id: token.deviceId, user_id: token.userId } });
    if (!device) throw new AppError('This device is no longer paired', 404);
    const info = buildNetworkInfo(report ?? {}, seenFrom, device.network_info ?? null);
    await this.deviceRepo.update(device.id, { network_info: info });
    this.gatewayService.broadcastToUser(device.user_id, 'device:network_info', { deviceId: device.id, info });
    return { message: 'Recorded', data: { public_ip: info.public_ip } };
  }

  /** Asks phones to report now. Offline ones keep their last reading. */
  async refresh(userId: number, deviceIds?: number[]): Promise<ApiResponse> {
    const devices = await this.deviceRepo.find({ where: { user_id: userId } });
    const wanted = deviceIds?.length ? devices.filter((d) => deviceIds.includes(d.id)) : devices;
    if (deviceIds?.length && !wanted.length) throw new AppError('Device not found', 404);
    let asked = 0;
    for (const device of wanted) if (this.gatewayService.requestDeviceInfo(device.device_id)) asked += 1;
    return {
      message: asked ? `Asked ${asked} phone${asked === 1 ? '' : 's'} to report` : 'No connected phone to ask',
      data: { asked, offline: wanted.length - asked },
    };
  }

  /** After a proxy rotates, the phones on it read their address again. */
  refreshProxyDevices(userId: number, proxyId: number, delayMs = 5_000): void {
    setTimeout(() => {
      void this.deviceRepo
        .find({ where: { user_id: userId, proxy_id: proxyId } })
        .then((devices) => devices.forEach((d) => this.gatewayService.requestDeviceInfo(d.device_id)))
        .catch(() => undefined);
    }, delayMs).unref?.();
  }

  static view(info: DeviceNetworkInfo | null | undefined): DeviceNetworkInfo | null {
    return info ?? null;
  }
}
