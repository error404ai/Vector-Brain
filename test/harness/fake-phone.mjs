// A fake Android companion for the test harness.
//
// Speaks the same WebSocket protocol as the real app: connects with a device
// JWT, sends device:register, heartbeats every 10s, and answers every
// server:execute_action with a device:action_response. Behaviour is tunable so
// scenarios can simulate slow phones, failing actions and dropped connections.

import WebSocket from 'ws';

// 1x1 transparent PNG — enough for anything that expects a screenshot.
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

export class FakePhone {
  /**
   * @param {object} options
   * @param {string} options.wsUrl      e.g. ws://127.0.0.1:4600/ws/android
   * @param {string} options.token      device JWT (type android_companion)
   * @param {string} options.deviceId   hardware id, must match the token
   * @param {number} [options.latencyMs] delay before answering an action
   * @param {boolean} [options.accessibility] reported capability
   */
  constructor({ wsUrl, token, deviceId, latencyMs = 50, accessibility = true }) {
    this.wsUrl = wsUrl;
    this.token = token;
    this.deviceId = deviceId;
    this.latencyMs = latencyMs;
    this.accessibility = accessibility;
    this.failActions = false;
    /** What this phone claims it is doing, as the real companion reports. */
    this.automationActive = false;
    this.silent = false; // receive actions but never answer (a hung phone)
    /** Mirror server:automation_session into automationActive, as the v10 companion does. */
    this.followSession = false;
    /** Refuse the next N screen observations the way Android rate-limits screenshots. */
    this.rateLimitNext = 0;
    this.actionsReceived = 0;
    this.otherEvents = [];
    this.ws = null;
    this.heartbeat = null;
  }

  capabilities() {
    return { accessibility: this.accessibility, screenCapture: true, screenWidth: 1080, screenHeight: 2400 };
  }

  connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${this.wsUrl}?token=${encodeURIComponent(this.token)}&type=device`);
      this.ws = ws;
      const timer = setTimeout(() => reject(new Error(`${this.deviceId}: register timed out`)), 10_000);

      ws.on('open', () => {
        ws.send(
          JSON.stringify({
            event: 'device:register',
            payload: {
              deviceId: this.deviceId,
              deviceName: `Fake ${this.deviceId}`,
              deviceModel: 'FakePhone',
              androidVersion: '14',
              capabilities: this.capabilities(),
            },
          }),
        );
      });

      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.event === 'server:registered') {
          clearTimeout(timer);
          this.heartbeat = setInterval(() => this.sendHeartbeat(), 10_000);
          resolve(this);
          return;
        }
        if (msg.event === 'server:execute_action') {
          this.actionsReceived += 1;
          if (this.silent) return;
          setTimeout(() => this.answer(msg), this.latencyMs);
          return;
        }
        if (msg.event === 'server:automation_session' && this.followSession) {
          this.automationActive = Boolean(msg.payload?.active);
          this.sendHeartbeat();
        }
        this.otherEvents.push(msg);
      });

      ws.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      ws.on('close', () => {
        if (this.heartbeat) clearInterval(this.heartbeat);
        this.heartbeat = null;
      });
    });
  }

  sendHeartbeat() {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify({
        event: 'device:heartbeat',
        payload: {
          deviceId: this.deviceId,
          capabilities: this.capabilities(),
          automationActive: this.automationActive,
          appVersion: '0.9.0-harness',
          ...(this.batteryLevel != null ? { batteryLevel: this.batteryLevel } : {}),
        },
      }),
    );
  }

  answer(msg) {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    if (this.rateLimitNext > 0 && msg.payload?.action?.type === 'ObserveScreen') {
      this.rateLimitNext -= 1;
      this.ws.send(JSON.stringify({ event: 'device:action_response', requestId: msg.requestId, payload: { status: 'FAILURE', code: 'INTERNAL_ERROR', message: 'Screenshots were requested too quickly', recoverable: true } }));
      return;
    }
    const payload = this.failActions
      ? { status: 'FAILURE', code: 'INTERNAL_ERROR', message: 'Fake phone refused the action', recoverable: true }
      : {
          status: 'SUCCESS',
          screenCapture: { base64Data: TINY_PNG, width: 1, height: 1 },
          foregroundApp: 'com.android.chrome',
        };
    this.ws.send(JSON.stringify({ event: 'device:action_response', requestId: msg.requestId, payload }));
  }

  /** Drop the connection the way a phone losing Wi-Fi would. */
  drop() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.ws?.terminate();
  }

  close() {
    this.drop();
  }
}
