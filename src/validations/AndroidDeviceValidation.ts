import { z } from 'zod';

export const RequestPairingCodeValidation = z.object({
  device_name: z.string().min(1, 'Device name is required').max(150),
  device_model: z.string().max(100).optional(),
});

export const ConfirmPairingValidation = z.object({
  pairing_code: z.string().length(6, 'Pairing code must be exactly 6 characters').toUpperCase(),
  device_id: z.string().min(1, 'Device ID is required'),
  device_name: z.string().min(1, 'Device name is required').max(150),
  device_model: z.string().max(100).optional(),
  android_version: z.string().max(50).optional(),
  capabilities: z
    .object({
      accessibility: z.boolean(),
      screenCapture: z.boolean(),
      screenWidth: z.number().optional(),
      screenHeight: z.number().optional(),
    })
    .optional(),
});

export const UpdateDeviceValidation = z.object({
  device_name: z.string().min(1).max(150).optional(),
});

export const DeviceListValidation = z.object({
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export const DispatchAndroidPromptValidation = z.object({
  device_id: z.number({ required_error: 'Target device ID is required' }),
  prompt: z.string().min(1, 'Prompt cannot be empty'),
  task_id: z.number().optional(),
  // Matches the 1-500 range the dashboard offers. The old cap of 50 silently
  // rejected any longer run with a generic validation error.
  // No upper bound: steps are the run's only budget now that the wall-clock
  // timeout is gone, and long tasks legitimately need thousands of them.
  max_steps: z.number().int().min(1, 'At least 1 step is required').default(500),
  /** Pin a specific provider instead of the account's active one. */
  ai_config_id: z.number().optional(),
  /** Keep every screen frame so the run can be replayed or shared. */
  record: z.boolean().optional(),
});

const nodeSelectorShape = {
  nodePath: z.string().min(1).optional(),
  viewId: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
};

export const AutomationActionValidation = z.discriminatedUnion('type', [
  z.object({ type: z.literal('OpenApp'), packageName: z.string().min(1).max(255) }),
  z.object({ type: z.literal('OpenUrl'), url: z.string().url().refine((url) => /^https?:\/\//i.test(url), 'URL must use http or https') }),
  z.object({ type: z.literal('ClickNode'), ...nodeSelectorShape }),
  z.object({ type: z.literal('Tap'), x: z.number().nonnegative(), y: z.number().nonnegative() }),
  z.object({
    type: z.literal('SetText'),
    nodePath: z.string().min(1).optional(),
    viewId: z.string().min(1).optional(),
    text: z.string().max(10_000),
  }),
  z.object({
    type: z.literal('Swipe'),
    direction: z.enum(['UP', 'DOWN', 'LEFT', 'RIGHT']),
    durationMillis: z.number().int().min(50).max(10_000).optional(),
  }),
  z.object({ type: z.literal('Global'), action: z.enum(['BACK', 'HOME', 'RECENTS', 'NOTIFICATIONS']) }),
  z.object({ type: z.literal('Wait'), durationMillis: z.number().int().min(1).max(60_000) }),
  z.object({ type: z.literal('ReadUiTree') }),
  z.object({ type: z.literal('CaptureScreen') }),
  // The union had fallen behind the protocol: WaitForNode and ObserveScreen
  // shipped without being listed, so a direct action of either type was
  // rejected here even though every device supports it.
  z.object({
    type: z.literal('WaitForNode'),
    nodePath: z.string().min(1).optional(),
    viewId: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    timeoutMillis: z.number().int().min(250).max(15_000).optional(),
  }),
  z.object({ type: z.literal('ObserveScreen') }),
  z.object({ type: z.literal('PressKey'), key: z.enum(['ENTER', 'BACKSPACE', 'CLEAR']) }),
  z.object({
    type: z.literal('ScrollNode'),
    nodePath: z.string().min(1).optional(),
    viewId: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    direction: z.enum(['FORWARD', 'BACKWARD']).optional(),
  }),
  z.object({
    type: z.literal('LongPress'),
    nodePath: z.string().min(1).optional(),
    viewId: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    x: z.number().nonnegative().optional(),
    y: z.number().nonnegative().optional(),
    durationMillis: z.number().int().min(400).max(3_000).optional(),
  }),
  z.object({ type: z.literal('ListApps') }),
  z.object({ type: z.literal('SetClipboard'), text: z.string().max(10_000) }),
  z.object({ type: z.literal('Paste') }),
  z.object({
    type: z.literal('OpenSettings'),
    screen: z.enum([
      'DATE_TIME', 'LANGUAGE', 'WIFI', 'MOBILE_NETWORK', 'DISPLAY', 'SOUND',
      'LOCATION', 'BATTERY', 'STORAGE', 'APPS', 'ACCESSIBILITY', 'DEVELOPER',
      'ABOUT', 'ROOT',
    ]),
  }),
  z.object({
    type: z.literal('ReadNotifications'),
    packageName: z.string().min(1).max(255).optional(),
    limit: z.number().int().min(1).max(50).optional(),
  }),
]).superRefine((action, context) => {
  if (action.type === 'ClickNode' && !action.nodePath && !action.viewId && !action.text) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'ClickNode requires a nodePath, viewId, or text' });
  }
  if (action.type === 'SetText' && !action.nodePath && !action.viewId) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'SetText requires a nodePath or viewId' });
  }
});

export const DirectActionValidation = z.object({
  device_id: z.number(),
  action: AutomationActionValidation,
});
