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
    /** When set, every screen observation fails with this phone-side message. */
    this.observeFailMessage = null;
    this.actionsReceived = 0;
    this.actionLog = []; // action types in the order received
    this.otherEvents = [];
    this.ws = null;
    this.heartbeat = null;
    /** A scripted app with real screens (see setApp); null = no screen content, as before. */
    this.app = null;
    this.typedLog = [];
  }

  /**
   * A tiny app with screens the agent can read and act on:
   *   { pkg, start, screens: { name: [{ text, type?: 'btn'|'text'|'input', to?, onType?, onEnter? }] } }
   * A tap or click on an element with `to` moves to that screen; typing into
   * an input moves to its `onType`, ENTER to its `onEnter`.
   */
  setApp(app) {
    this.app = app ? { ...app, current: null } : null;
    this.typedLog = [];
  }

  appRoot() {
    const app = this.app;
    if (!app?.current) return { packageName: 'com.android.launcher3', root: { className: 'android.widget.FrameLayout', bounds: { left: 0, top: 0, right: 1080, bottom: 2400 }, clickable: false, editable: false, enabled: true, children: [] } };
    const elements = app.screens[app.current] ?? [];
    const children = elements.map((el, i) => {
      const top = 100 + i * 200;
      const className = el.type === 'input' ? 'android.widget.EditText' : el.type === 'text' ? 'android.widget.TextView' : 'android.widget.Button';
      return {
        className,
        text: el.type === 'input' && app.typed ? app.typed : el.text,
        bounds: { left: 100, top, right: 980, bottom: top + 120 },
        clickable: el.type !== 'text',
        editable: el.type === 'input',
        enabled: true,
        children: [],
      };
    });
    return { packageName: app.pkg, root: { className: 'android.widget.FrameLayout', bounds: { left: 0, top: 0, right: 1080, bottom: 2400 }, clickable: false, editable: false, enabled: true, children } };
  }

  /** Moves the scripted app on for one action. */
  stepApp(action) {
    const app = this.app;
    if (!app || !action) return;
    const elements = app.current ? app.screens[app.current] ?? [] : [];
    const go = (to) => {
      if (to) {
        app.current = to;
        app.typed = null;
      }
    };
    if (action.type === 'OpenApp' && action.packageName === app.pkg) {
      app.current = app.start;
      app.typed = null;
    } else if (action.type === 'Tap') {
      const i = Math.floor((action.y - 100) / 200);
      const el = elements[i];
      if (el && action.y >= 100 + i * 200 && action.y <= 220 + i * 200) go(el.to);
    } else if (action.type === 'ClickNode') {
      go(elements.find((el) => el.text === action.text)?.to);
    } else if (action.type === 'SetText') {
      const input = elements.find((el) => el.type === 'input');
      if (input) {
        this.typedLog.push(action.text);
        if (input.onType) go(input.onType);
        app.typed = action.text;
      }
    } else if (action.type === 'PressKey' && action.key === 'ENTER') {
      go(elements.find((el) => el.onEnter)?.onEnter);
    }
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
          this.actionLog.push(msg.payload?.action?.type);
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
    if (this.observeFailMessage && msg.payload?.action?.type === 'ObserveScreen') {
      this.ws.send(JSON.stringify({ event: 'device:action_response', requestId: msg.requestId, payload: { status: 'FAILURE', code: 'INTERNAL_ERROR', message: this.observeFailMessage, recoverable: false } }));
      return;
    }
    if (this.rateLimitNext > 0 && msg.payload?.action?.type === 'ObserveScreen') {
      this.rateLimitNext -= 1;
      this.ws.send(JSON.stringify({ event: 'device:action_response', requestId: msg.requestId, payload: { status: 'FAILURE', code: 'INTERNAL_ERROR', message: 'Screenshots were requested too quickly', recoverable: true } }));
      return;
    }
    if (!this.failActions) this.stepApp(msg.payload?.action);
    const screen = this.app ? this.appRoot() : null;
    const payload = this.failActions
      ? { status: 'FAILURE', code: 'INTERNAL_ERROR', message: 'Fake phone refused the action', recoverable: true }
      : {
          status: 'SUCCESS',
          screenCapture: { base64Data: TINY_PNG, width: 1, height: 1 },
          foregroundApp: screen ? screen.packageName : 'com.android.chrome',
          ...(screen ? { uiTree: { packageName: screen.packageName, root: screen.root } } : {}),
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
