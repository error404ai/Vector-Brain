import { AndroidDevice, AndroidDeviceStatus } from '@/entities/AndroidDevice';
import AppError from '@/helpers/AppError';
import Logger from '@/logger/index';
import { AppDataSource } from '@/loaders/database';
import { ApiResponse } from '@/types/ApiResponse';
import { Repository } from 'typeorm';
import { Service } from 'typedi';
import { AndroidGatewayService } from './AndroidGatewayService';

/** Gap between frames. Roughly two frames a second. */
const DEFAULT_INTERVAL_MS = 500;
const MIN_INTERVAL_MS = 300;

/**
 * A viewer stops being counted this long after its last keep-alive, so a closed
 * tab or a dead laptop cannot leave a phone capturing forever.
 */
const VIEWER_TTL_MS = 45_000;

interface StreamState {
  deviceId: string;
  userId: number;
  timer: ReturnType<typeof setTimeout>;
  lastSeenAt: number;
  intervalMs: number;
  /** True while a capture is in flight, so slow devices do not queue up. */
  busy: boolean;
}

/**
 * Pushes a phone's screen to the dashboard while someone is watching.
 *
 * Frames normally only arrive when the agent acts, which makes the live view
 * look frozen. This polls the device instead — not real video, but enough to
 * feel live. It only runs while a browser keeps saying it is watching.
 */
@Service()
export class LiveScreenService {
  private deviceRepo: Repository<AndroidDevice> = AppDataSource.getRepository(AndroidDevice);
  private streams = new Map<string, StreamState>();

  constructor(private gatewayService: AndroidGatewayService) {}

  /**
   * Start streaming, or refresh the keep-alive if it is already running.
   * The dashboard calls this on open and then every few seconds.
   */
  async watch(deviceDbId: number, userId: number, intervalMs?: number): Promise<ApiResponse> {
    const device = await this.deviceRepo.findOne({ where: { id: deviceDbId, user_id: userId } });
    if (!device) throw new AppError('Device not found', 404);
    if (device.status !== AndroidDeviceStatus.ONLINE) {
      return { message: 'Device is offline', data: { streaming: false } };
    }

    const key = device.device_id;
    const existing = this.streams.get(key);
    if (existing) {
      existing.lastSeenAt = Date.now();
      return { message: 'Streaming', data: { streaming: true, intervalMs: existing.intervalMs } };
    }

    const state: StreamState = {
      deviceId: device.device_id,
      userId,
      timer: setTimeout(() => undefined, 0),
      lastSeenAt: Date.now(),
      intervalMs: Math.max(MIN_INTERVAL_MS, intervalMs ?? DEFAULT_INTERVAL_MS),
      busy: false,
    };
    this.streams.set(key, state);
    this.scheduleNext(key);

    return { message: 'Streaming', data: { streaming: true, intervalMs: state.intervalMs } };
  }

  /** Stop streaming for a device. Called when the dashboard closes the view. */
  async unwatch(deviceDbId: number, userId: number): Promise<ApiResponse> {
    const device = await this.deviceRepo.findOne({ where: { id: deviceDbId, user_id: userId } });
    if (!device) throw new AppError('Device not found', 404);
    this.stop(device.device_id);
    return { message: 'Stopped', data: { streaming: false } };
  }

  private stop(deviceId: string): void {
    const state = this.streams.get(deviceId);
    if (!state) return;
    clearTimeout(state.timer);
    this.streams.delete(deviceId);
  }

  private scheduleNext(key: string): void {
    const state = this.streams.get(key);
    if (!state) return;

    state.timer = setTimeout(() => {
      void this.tick(key);
    }, state.intervalMs);
  }

  private async tick(key: string): Promise<void> {
    const state = this.streams.get(key);
    if (!state) return;

    // Nobody has said they are watching recently — let the phone rest.
    if (Date.now() - state.lastSeenAt > VIEWER_TTL_MS) {
      this.stop(key);
      return;
    }

    if (state.busy) {
      this.scheduleNext(key);
      return;
    }

    state.busy = true;
    try {
      const result = await this.gatewayService.executeAction(state.deviceId, { type: 'CaptureScreen' });
      const frame = result.status === 'SUCCESS' ? result.screenCapture?.base64Data : undefined;
      if (frame) {
        this.gatewayService.broadcastToUser(state.userId, 'device:screen_capture', {
          deviceId: state.deviceId,
          result: { screenCapture: { base64Data: frame } },
        });
      }
    } catch (error) {
      Logger.warn(`[LiveScreen] Capture failed for ${state.deviceId}`, error);
      // A device that keeps failing is usually gone; stop rather than hammer it.
      this.stop(key);
      return;
    } finally {
      const current = this.streams.get(key);
      if (current) current.busy = false;
    }

    this.scheduleNext(key);
  }
}
