import { AutomationActionValidation, DirectActionValidation } from './AndroidDeviceValidation';

describe('Android action validation', () => {
  it('accepts node, view ID, and text click selectors', () => {
    expect(AutomationActionValidation.safeParse({ type: 'ClickNode', nodePath: '0/1/2' }).success).toBe(true);
    expect(AutomationActionValidation.safeParse({ type: 'ClickNode', viewId: 'com.android:id/button1' }).success).toBe(true);
    expect(AutomationActionValidation.safeParse({ type: 'ClickNode', text: 'Continue' }).success).toBe(true);
  });

  it('rejects selector-free clicks and text actions', () => {
    expect(AutomationActionValidation.safeParse({ type: 'ClickNode' }).success).toBe(false);
    expect(AutomationActionValidation.safeParse({ type: 'SetText', text: 'hello' }).success).toBe(false);
  });

  it('accepts secure web URLs and rejects unsupported URL schemes', () => {
    expect(AutomationActionValidation.safeParse({ type: 'OpenUrl', url: 'https://www.google.com' }).success).toBe(true);
    expect(AutomationActionValidation.safeParse({ type: 'OpenUrl', url: 'javascript:alert(1)' }).success).toBe(false);
  });

  it('rejects unsupported or unsafe direct-action payload shapes', () => {
    expect(
      DirectActionValidation.safeParse({
        device_id: 1,
        action: { type: 'RunShell', command: 'whoami' },
      }).success,
    ).toBe(false);
    expect(
      DirectActionValidation.safeParse({
        device_id: 1,
        action: { type: 'Wait', durationMillis: 120_000 },
      }).success,
    ).toBe(false);
  });
});
