export type SwipeDirection = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

export type GlobalAction = 'BACK' | 'HOME' | 'RECENTS' | 'NOTIFICATIONS';

/**
 * Keys the companion app can press on the focused text field.
 *
 * Kept to what the accessibility API can genuinely do — Android will not let a
 * service inject arbitrary key events — so this is not the full keyboard.
 */
export type DeviceKey = 'ENTER' | 'BACKSPACE' | 'CLEAR';

export type SafetyLevel = 'LOW' | 'USER_CONFIRMATION_REQUIRED' | 'BLOCKED';

export type AutomationAction =
  | { type: 'OpenApp'; packageName: string }
  // sameTab, not newTab: the companion app reads sameTab, and because its JSON
  // parser ignores unknown keys a newTab field was silently dropped, leaving
  // sameTab on its default of true — which is why every page opened in the
  // in-app browser instead of Chrome.
  | { type: 'OpenUrl'; url: string; sameTab?: boolean }
  | { type: 'ClickNode'; nodePath?: string; viewId?: string; text?: string }
  | { type: 'Tap'; x: number; y: number }
  | { type: 'SetText'; nodePath?: string; viewId?: string; text: string }
  | { type: 'Swipe'; direction: SwipeDirection; durationMillis?: number }
  | { type: 'Global'; action: GlobalAction }
  | { type: 'Wait'; durationMillis: number }
  | { type: 'WaitForNode'; nodePath?: string; viewId?: string; text?: string; timeoutMillis?: number }
  | { type: 'ReadUiTree' }
  | { type: 'CaptureScreen' }
  | { type: 'ObserveScreen' }
  | { type: 'PressKey'; key: DeviceKey };

export interface NodeBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface UiNodeSnapshot {
  path: string;
  className?: string;
  viewId?: string;
  text?: string;
  contentDescription?: string;
  bounds: NodeBounds;
  clickable: boolean;
  editable: boolean;
  enabled: boolean;
  children: UiNodeSnapshot[];
}

export interface UiTreeSnapshot {
  packageName?: string;
  capturedAtEpochMillis: number;
  root?: UiNodeSnapshot;
  truncated: boolean;
}

export interface ScreenCaptureSnapshot {
  width: number;
  height: number;
  capturedAtEpochMillis: number;
  base64Data?: string;
  privateFilePath?: string;
}

export type FailureCode =
  | 'ACCESSIBILITY_DISABLED'
  | 'APP_NOT_FOUND'
  | 'NODE_NOT_FOUND'
  | 'ACTION_REJECTED'
  | 'CAPTURE_NOT_CONFIGURED'
  | 'CONFIRMATION_REQUIRED'
  | 'INVALID_WORKFLOW'
  | 'TIMEOUT'
  | 'INTERNAL_ERROR';

export type ActionResult =
  | {
      status: 'SUCCESS';
      summary: string;
      uiTree?: UiTreeSnapshot;
      screenCapture?: ScreenCaptureSnapshot;
    }
  | {
      status: 'FAILURE';
      code: FailureCode;
      message: string;
      recoverable?: boolean;
    }
  | {
      status: 'CANCELLED';
    };

export interface DeviceCapabilities {
  accessibility: boolean;
  screenCapture: boolean;
  screenWidth?: number;
  screenHeight?: number;
}

// WebSocket Message Envelopes
export type AndroidWsClientMessage =
  | {
      event: 'device:register';
      payload: {
        deviceId: string;
        deviceName: string;
        deviceModel?: string;
        androidVersion?: string;
        deviceToken: string;
        capabilities: DeviceCapabilities;
      };
    }
  | {
      event: 'device:heartbeat';
      payload: {
        deviceId: string;
        foregroundPackage?: string;
        batteryLevel?: number;
        capabilities?: DeviceCapabilities;
      };
    }
  | {
      event: 'device:action_response';
      requestId: string;
      payload: ActionResult;
    };

export type AndroidWsServerMessage =
  | {
      event: 'server:registered';
      payload: {
        success: boolean;
        message: string;
        deviceId: string;
      };
    }
  | {
      event: 'server:heartbeat_ack';
      timestamp: number;
    }
  | {
      event: 'server:execute_action';
      requestId: string;
      payload: {
        action: AutomationAction;
        timeoutMillis?: number;
        safetyLevel?: SafetyLevel;
      };
    }
  | {
      event: 'server:cancel_action';
      requestId?: string;
    }
  | {
      event: 'server:automation_session';
      payload: {
        active: boolean;
      };
    };
