import { AgentTask } from '@/entities/AgentTask';
import { AppDataSource } from '@/loaders/database';
import Logger from '@/logger/index';
import { ActionResult, AndroidWsClientMessage, AndroidWsServerMessage, AutomationAction } from './AndroidProtocol';
import { AndroidDeviceService } from './AndroidDeviceService';
import { AndroidDeviceStatus } from '@/entities/AndroidDevice';
import { Service } from 'typedi';
import { WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';

interface PendingRequest {
  resolve: (result: ActionResult) => void;
  timeoutId: NodeJS.Timeout;
  deviceId: string;
}

@Service()
export class AndroidGatewayService {
  // Device ID -> active Android companion WebSocket
  private deviceSockets = new Map<string, WebSocket>();

  // WebSocket -> Device ID (reverse lookup)
  private socketToDeviceId = new Map<WebSocket, string>();

  // User ID -> Set of browser Web UI WebSockets for live monitoring
  private userWebSockets = new Map<number, Set<WebSocket>>();

  // Request ID -> Pending Action promise handler
  private pendingRequests = new Map<string, PendingRequest>();

  // Device ID -> pending "mark offline" timer. A dropped socket does not flip
  // the dashboard to Offline immediately: a fleet phone often reconnects within
  // seconds (WiFi blip, quick app restart, doze wake), and flipping to Offline
  // and back was the flicker users saw. We wait out a grace window and only
  // mark offline if the device has not come back on a fresh socket.
  private offlineTimers = new Map<string, NodeJS.Timeout>();
  private static readonly OFFLINE_GRACE_MS = 15_000;

  // Heartbeats arrive every five seconds. Persist periodically (or whenever
  // capabilities change) instead of writing the same row on every heartbeat.
  private lastHeartbeatPersistence = new Map<string, { at: number; capabilities: string; battery?: number }>();

  /**
   * Server-side subscribers to user events (task finished, new frame, ...).
   * The Telegram bot uses this to report on runs it started, whether or not a
   * browser tab is open.
   */
  private broadcastListeners = new Set<(userId: number, event: string, payload: any) => void>();

  constructor(private deviceService: AndroidDeviceService) {}

  /** Subscribe to every user event. Returns an unsubscribe function. */
  onBroadcast(listener: (userId: number, event: string, payload: any) => void): () => void {
    this.broadcastListeners.add(listener);
    return () => this.broadcastListeners.delete(listener);
  }

  /**
   * Registers a newly authenticated Android device WebSocket connection.
   */
  async registerDevice(deviceId: string, ws: WebSocket, metadata: any) {
    Logger.info(`[AndroidGateway] Registering device connection: ${deviceId}`);

    // If an existing socket exists for this device, gracefully close it
    const existing = this.deviceSockets.get(deviceId);
    if (existing && existing !== ws && existing.readyState === WebSocket.OPEN) {
      existing.close(1000, 'Replaced by newer connection');
    }

    // Device is back on a live socket — cancel any pending offline flip.
    const pendingOffline = this.offlineTimers.get(deviceId);
    if (pendingOffline) {
      clearTimeout(pendingOffline);
      this.offlineTimers.delete(deviceId);
    }

    this.deviceSockets.set(deviceId, ws);
    this.socketToDeviceId.set(ws, deviceId);

    // Update DB status to ONLINE
    await this.deviceService.updateDeviceStatus(deviceId, AndroidDeviceStatus.ONLINE, metadata.capabilities);
    this.lastHeartbeatPersistence.set(deviceId, {
      at: Date.now(),
      capabilities: JSON.stringify(metadata.capabilities || {}),
    });

    // Send confirmation back to device
    const ack: AndroidWsServerMessage = {
      event: 'server:registered',
      payload: {
        success: true,
        message: 'Device authenticated and registered with Vector-Brain',
        deviceId,
      },
    };
    ws.send(JSON.stringify(ack));

    // Notify user web clients that device came online
    const device = await this.deviceService.getDeviceByHardwareId(deviceId);
    if (device) {
      this.broadcastToUser(device.user_id, 'device:status_change', {
        deviceId,
        status: AndroidDeviceStatus.ONLINE,
      });
    }
  }

  /**
   * Registers a browser client (from Vector-Brain React frontend) for live screen & execution streaming.
   */
  registerWebClient(userId: number, ws: WebSocket) {
    if (!this.userWebSockets.has(userId)) {
      this.userWebSockets.set(userId, new Set());
    }
    this.userWebSockets.get(userId)!.add(ws);
    Logger.info(`[AndroidGateway] Web UI client connected for user ${userId}`);
    const openedAt = Date.now();

    ws.on('close', (code: number, reason: Buffer) => {
      this.userWebSockets.get(userId)?.delete(ws);
      // The dashboard socket was seen reconnecting every ~20s; the code and
      // lifetime show whether the browser, a proxy timeout or the server ends it.
      Logger.info(
        `[AndroidGateway] Web UI client closed for user ${userId} code=${code}${reason?.length ? ` reason="${reason.toString()}"` : ''} after=${Math.round((Date.now() - openedAt) / 1000)}s buffered=${ws.bufferedAmount}`,
      );
    });
  }

  /**
   * Handles incoming WebSocket messages from Android Companion devices.
   */
  async handleDeviceMessage(ws: WebSocket, rawData: string, authenticatedDeviceId: string) {
    try {
      const msg: AndroidWsClientMessage = JSON.parse(rawData);

      switch (msg.event) {
        case 'device:register':
          if (msg.payload.deviceId !== authenticatedDeviceId) {
            Logger.warn(`[AndroidGateway] Device token ${authenticatedDeviceId} attempted to register as ${msg.payload.deviceId}`);
            ws.close(1008, 'Device ID does not match authenticated token');
            return;
          }
          await this.registerDevice(msg.payload.deviceId, ws, msg.payload);
          break;

        case 'device:heartbeat':
          if (msg.payload.deviceId !== authenticatedDeviceId) {
            ws.close(1008, 'Device ID does not match authenticated token');
            return;
          }
          const devId = this.socketToDeviceId.get(ws) || authenticatedDeviceId;
          const now = Date.now();
          // The phone reports its build alongside its capabilities; keeping it
          // on the device record is what makes "who is still on the old APK?"
          // answerable without walking round the desk.
          // Battery arrives as its own heartbeat field (v10+); it is kept on
          // the device record so the fleet can see a phone draining before it
          // dies. It moves every heartbeat, so it rides the 30s cadence and is
          // left out of the "did anything change" comparison.
          const battery =
            typeof msg.payload.batteryLevel === 'number' && Number.isFinite(msg.payload.batteryLevel)
              ? Math.max(0, Math.min(100, Math.round(msg.payload.batteryLevel)))
              : undefined;
          const base =
            msg.payload.capabilities || msg.payload.appVersion
              ? { ...(msg.payload.capabilities ?? {}), ...(msg.payload.appVersion ? { appVersion: msg.payload.appVersion } : {}) }
              : undefined;
          const reported = base && battery !== undefined ? { ...base, battery } : battery !== undefined ? { battery } : base;
          const capabilities = JSON.stringify(base || {});
          const lastPersistence = this.lastHeartbeatPersistence.get(devId);
          if (
            !lastPersistence ||
            now - lastPersistence.at >= 30_000 ||
            capabilities !== lastPersistence.capabilities ||
            (battery !== undefined && lastPersistence.battery === undefined)
          ) {
            await this.deviceService.updateDeviceStatus(devId, AndroidDeviceStatus.ONLINE, reported);
            this.lastHeartbeatPersistence.set(devId, { at: now, capabilities, battery });
          }
          if (msg.payload.automationActive) await this.reconcileAutomationSession(devId);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ event: 'server:heartbeat_ack', timestamp: Date.now() }));
          }
          break;

        case 'device:action_response': {
          const pending = this.pendingRequests.get(msg.requestId);
          // Only the device the request was actually sent to may answer it.
          // Without this, any authenticated device could resolve another
          // device's pending action with a forged result (a fake screenshot,
          // a false success), since request IDs travel over the wire.
          if (pending && pending.deviceId === authenticatedDeviceId) {
            clearTimeout(pending.timeoutId);
            this.pendingRequests.delete(msg.requestId);
            pending.resolve(msg.payload);
          } else if (pending) {
            Logger.warn(`[AndroidGateway] action_response for ${msg.requestId} came from ${authenticatedDeviceId}, not its owner ${pending.deviceId}; ignored`);
          }
          break;
        }

        default:
          Logger.warn(`[AndroidGateway] Unknown message from device:`, rawData);
      }
    } catch (err) {
      Logger.error(`[AndroidGateway] Error parsing message:`, err);
    }
  }

  /**
   * Cleans up disconnected device WebSocket.
   */
  async handleDeviceDisconnect(ws: WebSocket, code?: number, reason?: string) {
    const deviceId = this.socketToDeviceId.get(ws);
    if (!deviceId) return;

    this.socketToDeviceId.delete(ws);

    // A replaced socket may close after the new connection is registered.
    // Only mark the device offline when this is still its active socket.
    if (this.deviceSockets.get(deviceId) !== ws) return;

    // Close code says who ended it: 1000/1001 the phone closed cleanly, 1006
    // the connection just died (network, proxy, phone killed the app), 1008 the
    // server refused it. Silence before the close tells a hung link from a drop.
    const lastMessageAt = (ws as any).lastMessageAt as number | undefined;
    const silentFor = lastMessageAt ? `${Math.round((Date.now() - lastMessageAt) / 1000)}s` : 'never spoke';
    Logger.info(
      `[AndroidGateway] Device disconnected: ${deviceId} code=${code ?? '?'}${reason ? ` reason="${reason}"` : ''} silent=${silentFor}`,
    );
    this.deviceSockets.delete(deviceId);
    this.lastHeartbeatPersistence.delete(deviceId);

    for (const [requestId, pending] of this.pendingRequests) {
      if (pending.deviceId !== deviceId) continue;
      clearTimeout(pending.timeoutId);
      this.pendingRequests.delete(requestId);
      pending.resolve({
        status: 'FAILURE',
        code: 'INTERNAL_ERROR',
        message: `Device ${deviceId} disconnected while executing the action`,
        recoverable: true,
      });
    }

    // Grace window before marking offline: if a fresh socket registers for this
    // device before it elapses, registerDevice cancels this and no flicker is
    // seen. Only if the phone is genuinely gone does the Offline flip land.
    const existing = this.offlineTimers.get(deviceId);
    if (existing) clearTimeout(existing);
    this.offlineTimers.set(
      deviceId,
      setTimeout(() => {
        void this.markDeviceOffline(deviceId);
      }, AndroidGatewayService.OFFLINE_GRACE_MS),
    );
  }

  /** Writes OFFLINE and notifies the dashboard, unless the device reconnected. */
  private async markDeviceOffline(deviceId: string) {
    this.offlineTimers.delete(deviceId);
    // Reconnected during the grace window — nothing to do.
    if (this.deviceSockets.has(deviceId)) return;

    await this.deviceService.updateDeviceStatus(deviceId, AndroidDeviceStatus.OFFLINE);

    const device = await this.deviceService.getDeviceByHardwareId(deviceId);
    if (device) {
      this.broadcastToUser(device.user_id, 'device:status_change', {
        deviceId,
        status: AndroidDeviceStatus.OFFLINE,
      });
    }
  }

  /**
   * Sends an atomic action to the Android device and waits for the ActionResult.
   */
  async executeAction(
    deviceId: string,
    action: AutomationAction,
    timeoutMillis = 15000,
    safetyLevel: 'LOW' | 'USER_CONFIRMATION_REQUIRED' | 'BLOCKED' = 'LOW',
  ): Promise<ActionResult> {
    const ws = this.deviceSockets.get(deviceId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return {
        status: 'FAILURE',
        code: 'ACCESSIBILITY_DISABLED',
        message: `Device ${deviceId} is not currently connected to Vector-Brain`,
        recoverable: true,
      };
    }

    const requestId = `req_${randomUUID()}`;

    const message: AndroidWsServerMessage = {
      event: 'server:execute_action',
      requestId,
      payload: {
        action,
        timeoutMillis,
        safetyLevel,
      },
    };

    return new Promise<ActionResult>((resolve) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        resolve({
          status: 'FAILURE',
          code: 'TIMEOUT',
          message: `Action execution on device timed out after ${timeoutMillis}ms`,
          recoverable: true,
        });
      }, timeoutMillis + 2000); // 2s buffer over device timeout

      this.pendingRequests.set(requestId, { resolve, timeoutId, deviceId });

      const failSend = (err: Error) => {
        if (!this.pendingRequests.has(requestId)) return;
        clearTimeout(timeoutId);
        this.pendingRequests.delete(requestId);
        resolve({
          status: 'FAILURE',
          code: 'INTERNAL_ERROR',
          message: `Failed to send action over WebSocket: ${err.message}`,
        });
      };
      try {
        ws.send(JSON.stringify(message), (err) => {
          if (err) failSend(err);
        });
      } catch (err) {
        failSend(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Broadcast an event to all connected browser Web UI tabs for a given user.
   */
  broadcastToUser(userId: number, event: string, payload: any) {
    // Listeners run before the socket check: they must hear about events even
    // when no dashboard tab is open.
    for (const listener of this.broadcastListeners) {
      try {
        listener(userId, event, payload);
      } catch (err) {
        Logger.warn(`[AndroidGateway] Broadcast listener failed for ${event}:`, err);
      }
    }

    const sockets = this.userWebSockets.get(userId);
    if (!sockets || sockets.size === 0) return;

    const data = JSON.stringify({ event, payload, timestamp: Date.now() });
    for (const ws of sockets) {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(data);
        } catch (err) {
          Logger.error(`[AndroidGateway] Error broadcasting to web client:`, err);
        }
      }
    }
  }

  /**
   * Check if an Android companion device is currently online.
   */
  isDeviceConnected(deviceId: string): boolean {
    const ws = this.deviceSockets.get(deviceId);
    return !!ws && ws.readyState === WebSocket.OPEN;
  }

  /**
   * Waits a little for a phone's socket to appear.
   *
   * Sockets live in this process, so a phone that is perfectly healthy looks
   * absent to a container that has just replaced another one — which is why a
   * deploy used to answer "device is currently offline" for phones that were
   * plainly online, until they reconnected a few seconds later.
   */
  async waitForDevice(deviceId: string, timeoutMs = 12_000): Promise<boolean> {
    if (this.isDeviceConnected(deviceId)) return true;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      if (this.isDeviceConnected(deviceId)) return true;
    }
    return false;
  }


  disconnectDevice(deviceId: string, reason = 'Device unpaired') {
    this.deviceSockets.get(deviceId)?.close(1008, reason);
  }

  cancelDeviceActions(deviceId: string) {
    const ws = this.deviceSockets.get(deviceId);
    for (const [requestId, pending] of this.pendingRequests) {
      if (pending.deviceId !== deviceId) continue;
      clearTimeout(pending.timeoutId);
      this.pendingRequests.delete(requestId);
      pending.resolve({ status: 'CANCELLED' });
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: 'server:cancel_action', requestId }));
      }
    }
  }

  /**
   * Tell the companion when a complete AI task starts/stops. The Android side
   * uses this to keep the device awake between individual model actions.
   */
  /**
   * The phone says it is mid-run; the database is the judge.
   *
   * After a restart the companion keeps its "task in progress" state — wake
   * locks held, banner up — for a run nothing is driving any more. Rather than
   * trusting either side blindly, the stored task decides: no live run means the
   * phone is told to stand down.
   */
  private async reconcileAutomationSession(hardwareDeviceId: string): Promise<void> {
    try {
      // Opened (or just closed) by this server: the phone is reporting what we
      // told it, possibly one heartbeat late. Standing it down here cancelled
      // the start-up screen check and failed runs as "Accessibility is not ready".
      const session = this.serverSessions.get(hardwareDeviceId);
      if (session && (session.active || Date.now() - session.at < AndroidGatewayService.SESSION_ECHO_GRACE_MS)) return;

      const device = await this.deviceService.getDeviceByHardwareId(hardwareDeviceId);
      if (!device) return;
      const live = await AppDataSource.getRepository(AgentTask)
        .createQueryBuilder('task')
        .where('task.device_id = :deviceId', { deviceId: device.id })
        .andWhere('task.status = :status', { status: 'RUNNING' })
        .andWhere('task.lease_until > :now', { now: new Date() })
        .getCount();
      if (live > 0) return;

      Logger.warn(`[AndroidGateway] ${hardwareDeviceId} reported a run nothing owns — telling it to stand down.`);
      this.cancelDeviceActions(hardwareDeviceId);
      this.setAutomationSession(hardwareDeviceId, false);
    } catch (error) {
      Logger.warn('[AndroidGateway] Could not reconcile the automation session', error);
    }
  }

  /**
   * The session state this server last asked each phone for, and when. A phone
   * echoing a session the server itself opened is not an orphaned run — while a
   * run is starting (wake, first screen check) no RUNNING task exists yet.
   */
  private serverSessions = new Map<string, { active: boolean; at: number }>();
  /** A closed session may still be echoed by a heartbeat already on its way. */
  private static readonly SESSION_ECHO_GRACE_MS = 5_000;

  setAutomationSession(deviceId: string, active: boolean) {
    this.serverSessions.set(deviceId, { active, at: Date.now() });
    const ws = this.deviceSockets.get(deviceId);
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    const message: AndroidWsServerMessage = {
      event: 'server:automation_session',
      payload: { active },
    };
    try {
      ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      Logger.warn(`[AndroidGateway] Failed to update automation session for ${deviceId}:`, error);
      return false;
    }
  }
}
