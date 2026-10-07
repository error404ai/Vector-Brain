import { failureKind } from './failureKind';
import { outcomeBreakdown } from './runDiagnostics';

describe('failureKind', () => {
  it('files stored reason codes by whose problem they were', () => {
    expect(failureKind('LLM_QUOTA')).toBe('ai_service');
    expect(failureKind('PLAN_FAILED')).toBe('ai_service');
    expect(failureKind('DEVICE_OFFLINE')).toBe('phone');
    expect(failureKind('SERVER_RESTART')).toBe('platform');
    expect(failureKind('SCREEN_UNCHANGED', 'The app blocks screen capture')).toBe('agent');
    expect(failureKind('VERIFICATION_FAILED')).toBe('agent');
    expect(failureKind(null)).toBe('agent');
  });

  // Final messages taken from the Oct 7 run export.
  it("reads the agent's own failure message for known causes", () => {
    const own = (m: string) => failureKind('AGENT_REPORTED_FAILURE', m);
    expect(own('Instagram is not installed on the phone. The full list of 44 installed apps was checked')).toBe('phone');
    expect(own('The phone is stuck in Xiaomi pocket mode (proximity sensor covered)')).toBe('phone');
    expect(own('The page shows a CAPTCHA that only the user can solve.')).toBe('needs_user');
    expect(own('The Play Store opened but is showing a sign-in screen requiring login.')).toBe('needs_user');
    expect(own("I see the search interface is now active. Let me type \"Instagram\" in the search field.")).toBe('agent');
  });

  it('keeps Play\'s "Complete account setup" misread as a login on the agent', () => {
    expect(
      failureKind('AGENT_REPORTED_FAILURE', 'The Play Store prompted to "Complete account setup" requiring login. Skipping this device.'),
    ).toBe('agent');
    expect(failureKind('AGENT_REPORTED_FAILURE', 'The Play Store requires account setup/login to continue installing apps.')).toBe('agent');
  });
});

describe('outcomeBreakdown failure kinds', () => {
  it('reports agent completion next to overall completion, never instead of it', () => {
    const out = outcomeBreakdown([
      { status: 'SUCCEEDED', outcome: 'first_try' },
      { status: 'SUCCEEDED', outcome: 'first_try' },
      { status: 'FAILED', reason_code: 'SCREEN_UNCHANGED' },
      { status: 'FAILED', reason_code: 'DEVICE_OFFLINE' },
      { status: 'FAILED', reason_code: 'AGENT_REPORTED_FAILURE', message: 'Solve the CAPTCHA first' },
      { status: 'CANCELLED' },
    ]);
    expect(out.completion_pct).toBe(40);
    expect(out.agent_completion_pct).toBe(66.7);
    expect(out.failure_kinds).toEqual({ agent: 1, needs_user: 1, phone: 1, ai_service: 0, platform: 0 });
  });

  it('has no agent completion when nothing ended', () => {
    expect(outcomeBreakdown([{ status: 'RUNNING' }]).agent_completion_pct).toBeNull();
  });
});
