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
  deviceDbId: number;
  userId: number;
  timer: ReturnType<typeof setTimeout>;
  lastSeenAt: number;
  intervalMs: number;
  /** True while a capture is in flight, so slow devices do not queue up. */
  busy: boolean;
  /**
   * The phone pushes its own frames (server:preview): it captures only while idle,
   * so taps never queue behind a capture, and it looks again right after an action.
   * Companion 0.31+ (its loop shipped earlier, but 0.31 is the build it was checked on).
   */
  push: boolean;
  /** Push mode: when the last server:preview went out (the phone keeps going 30 s per message). */
  renewedAt: number;
}

/** Push mode: renew the phone's 30 s loop this often. */
const PUSH_RENEW_MS = 20_000;

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
      if (existing.push && Date.now() - existing.renewedAt >= PUSH_RENEW_MS / 2) {
        existing.renewedAt = Date.now();
        this.gatewayService.setPreview(key, true);
      }
      return { message: 'Streaming', data: { streaming: true, intervalMs: existing.intervalMs, push: existing.push } };
    }
    const push = this.gatewayService.hasFeature(key, 'preview_push') || this.gatewayService.hasFeature(key, 'observe_after');

    const state: StreamState = {
      deviceId: device.device_id,
      deviceDbId: device.id,
      userId,
      timer: setTimeout(() => undefined, 0),
      lastSeenAt: Date.now(),
      intervalMs: Math.max(MIN_INTERVAL_MS, intervalMs ?? DEFAULT_INTERVAL_MS),
      busy: false,
      push,
      renewedAt: Date.now(),
    };
    this.streams.set(key, state);
    if (push) this.gatewayService.setPreview(key, true);
    this.scheduleNext(key);

    return { message: 'Streaming', data: { streaming: true, intervalMs: state.intervalMs, push } };
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
    if (state.push) this.gatewayService.setPreview(deviceId, false);
  }

  private scheduleNext(key: string): void {
    const state = this.streams.get(key);
    if (!state) return;

    state.timer = setTimeout(() => {
      void this.tick(key);
    }, state.push ? PUSH_RENEW_MS : state.intervalMs);
  }

  private async tick(key: string): Promise<void> {
    const state = this.streams.get(key);
    if (!state) return;

    // Nobody has said they are watching recently — let the phone rest.
    if (Date.now() - state.lastSeenAt > VIEWER_TTL_MS) {
      this.stop(key);
      return;
    }

    // Push mode: the phone sends frames itself; only keep its loop alive.
    if (state.push) {
      state.renewedAt = Date.now();
      if (!this.gatewayService.setPreview(key, true)) {
        this.stop(key);
        return;
      }
      this.scheduleNext(key);
      return;
    }

    // A person's tap or an agent run is using the phone: its own frames come with it.
    if (state.busy || this.gatewayService.liveShouldWait(key)) {
      this.scheduleNext(key);
      return;
    }

    // A running task drives the same device socket. Competing with it slows the
    // agent down and lets an older frame land after a newer one, so stand aside
    // and let the agent's own frames come through.
    const device = await this.deviceRepo.findOne({ where: { id: state.deviceDbId } });
    if (!device || device.status !== AndroidDeviceStatus.ONLINE) {
      this.scheduleNext(key);
      return;
    }

    state.busy = true;
    try {
      // Small preview frames: the viewer is looking at a thumbnail, and a full
      // capture is many times the bytes on the phone's single socket.
      const result = await this.gatewayService.executeAction(state.deviceId, {
        type: 'CaptureScreen',
        preview: true,
        awaitStability: false,
      });
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
