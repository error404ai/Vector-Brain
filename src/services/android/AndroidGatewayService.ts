import Logger from '@/logger/index';
import { ActionResult, AndroidWsClientMessage, AndroidWsServerMessage, AutomationAction } from './AndroidProtocol';
import { AndroidDeviceService } from './AndroidDeviceService';
import { AndroidDeviceStatus } from '@/entities/AndroidDevice';
import { Service } from 'typedi';
import { WebSocket } from 'ws';

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
  private lastHeartbeatPersistence = new Map<string, { at: number; capabilities: string }>();

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

    ws.on('close', () => {
      this.userWebSockets.get(userId)?.delete(ws);
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
          const capabilities = JSON.stringify(msg.payload.capabilities || {});
          const lastPersistence = this.lastHeartbeatPersistence.get(devId);
          if (
            !lastPersistence ||
            now - lastPersistence.at >= 30_000 ||
            capabilities !== lastPersistence.capabilities
          ) {
            await this.deviceService.updateDeviceStatus(devId, AndroidDeviceStatus.ONLINE, msg.payload.capabilities);
            this.lastHeartbeatPersistence.set(devId, { at: now, capabilities });
          }
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ event: 'server:heartbeat_ack', timestamp: Date.now() }));
          }
          break;

        case 'device:action_response':
          const pending = this.pendingRequests.get(msg.requestId);
          if (pending) {
            clearTimeout(pending.timeoutId);
            this.pendingRequests.delete(msg.requestId);
            pending.resolve(msg.payload);
          }

          break;

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
  async handleDeviceDisconnect(ws: WebSocket) {
    const deviceId = this.socketToDeviceId.get(ws);
    if (!deviceId) return;

    this.socketToDeviceId.delete(ws);

    // A replaced socket may close after the new connection is registered.
    // Only mark the device offline when this is still its active socket.
    if (this.deviceSockets.get(deviceId) !== ws) return;

    Logger.info(`[AndroidGateway] Device disconnected: ${deviceId}`);
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

    const requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

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
  setAutomationSession(deviceId: string, active: boolean) {
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
