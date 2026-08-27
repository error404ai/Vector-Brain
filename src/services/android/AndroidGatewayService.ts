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

  constructor(private deviceService: AndroidDeviceService) {}

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

    this.deviceSockets.set(deviceId, ws);
    this.socketToDeviceId.set(ws, deviceId);

    // Update DB status to ONLINE
    await this.deviceService.updateDeviceStatus(deviceId, AndroidDeviceStatus.ONLINE, metadata.capabilities);

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
          await this.deviceService.updateDeviceStatus(devId, AndroidDeviceStatus.ONLINE, msg.payload.capabilities);
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

          // Forward live UI tree / screenshot to connected web clients
          const deviceId = this.socketToDeviceId.get(ws);
          if (deviceId) {
            const device = await this.deviceService.getDeviceByHardwareId(deviceId);
            if (device) {
              this.broadcastToUser(device.user_id, 'device:perception_update', {
                deviceId,
                requestId: msg.requestId,
                result: msg.payload,
              });
            }
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

    // Update DB status to OFFLINE
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

      try {
        ws.send(JSON.stringify(message));
      } catch (err: any) {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(requestId);
        resolve({
          status: 'FAILURE',
          code: 'INTERNAL_ERROR',
          message: `Failed to send action over WebSocket: ${err.message}`,
        });
      }
    });
  }

  /**
   * Broadcast an event to all connected browser Web UI tabs for a given user.
   */
  broadcastToUser(userId: number, event: string, payload: any) {
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
}
