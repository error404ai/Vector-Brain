import { DiagnosticsSanitizer, scrubUrl } from './diagnosticsSanitizer';
import { StepLite, screenFingerprint, summarizeRun, tagWaste } from './runDiagnostics';

const tree = (buttons: string[], clock = '12:00') =>
  ['idx|type|label|flags|tap_at', `0|text|${clock}||40,20`, ...buttons.map((b, i) => `${i + 1}|btn|${b}|t|100,${200 + i * 50}`)].join('\n');

describe('screenFingerprint', () => {
  it('ignores plain text such as a clock, so the same screen keeps one fingerprint', () => {
    expect(screenFingerprint(tree(['Search'], '12:00'), 'com.app')).toBe(screenFingerprint(tree(['Search'], '12:07'), 'com.app'));
  });

  it('changes when a button, typed text or the app changes', () => {
    const base = screenFingerprint(tree(['Search']), 'com.app');
    expect(screenFingerprint(tree(['Search', 'Send']), 'com.app')).not.toBe(base);
    expect(screenFingerprint(tree(['Search']), 'com.other')).not.toBe(base);
    const typed = 'idx|type|label|flags|tap_at\n0|input|hello|te|10,10';
    const typedMore = 'idx|type|label|flags|tap_at\n0|input|hello world|te|10,10';
    expect(screenFingerprint(typed, 'com.app')).not.toBe(screenFingerprint(typedMore, 'com.app'));
  });

  it('returns null when there is no tree', () => {
    expect(screenFingerprint(undefined)).toBeNull();
    expect(screenFingerprint('No visible UI elements found.')).toBeNull();
  });
});

describe('tagWaste', () => {
  const A = 'aaaa';
  const B = 'bbbb';
  const C = 'cccc';
  const ok = (action: string, before: string | null, after: string | null, extra: Partial<StepLite> = {}): StepLite => ({
    action_type: action,
    status: 'SUCCESS',
    screen_before: before,
    screen_after: after,
    ...extra,
  });

  it('tags each kind of wasted step and leaves useful steps alone', () => {
    const steps: StepLite[] = [
      ok('open_app', A, B, { action_payload: { packageName: 'com.app' }, package_before: 'com.launcher' }), // useful
      ok('read_ui_tree', B, B), // nothing changed since the last result: reread
      ok('tap_coordinate', B, B, { action_payload: { x: 1, y: 1 } }), // no_effect
      ok('tap_coordinate', B, B, { action_payload: { x: 1, y: 1 } }), // same again: repeat
      ok('tap_coordinate', B, C, { action_payload: { x: 5, y: 5 } }), // useful
      ok('open_app', C, C, { action_payload: { packageName: 'com.app' }, package_before: 'com.app' }), // reopen
      ok('global_action', C, B, { action_payload: { action: 'BACK' } }), // backtrack
      { action_type: 'tap_coordinate', status: 'FAILED', screen_before: B, screen_after: B }, // failed
      ok('wait', B, B), // waiting is not tagged
      ok('capture_screen', B, B), // looking at a screenshot is counted separately, not as waste
    ];
    expect(tagWaste(steps)).toEqual([null, 'reread', 'no_effect', 'repeat', null, 'reopen', 'backtrack', 'failed', null, null]);
  });

  it('never calls a step wasted when the screens are unknown (old runs)', () => {
    expect(tagWaste([ok('tap_coordinate', null, null), ok('read_ui_tree', null, null)])).toEqual([null, null]);
  });
});

describe('summarizeRun', () => {
  it('adds up steps, time, sources, waste and model usage', () => {
    const steps: StepLite[] = [
      { action_type: 'open_app', status: 'SUCCESS', duration_ms: 900, think_ms: 2000, source: 'ai', package_after: 'com.app' },
      { action_type: 'wait', status: 'SUCCESS', duration_ms: 3000, think_ms: 500, source: 'ai' },
      { action_type: 'capture_screen', status: 'SUCCESS', duration_ms: 400, think_ms: 1500, source: 'ai' },
      { action_type: 'tap_coordinate', status: 'FAILED', duration_ms: 100, think_ms: 0, source: 'replay' },
    ];
    const summary = summarizeRun(steps, [null, null, null, 'failed'], { llmCalls: 3, promptTokens: 9000, completionTokens: 120, tokensReported: true });
    expect(summary).toMatchObject({
      steps: 4,
      sources: { ai: 3, replay: 1 },
      think_ms: 4000,
      phone_ms: 1400,
      wait_ms: 3000,
      failed: 1,
      wasted: 1,
      waste: { failed: 1 },
      vision: 1,
      llm_calls: 3,
      prompt_tokens: 9000,
      packages: ['com.app'],
    });
  });
});

describe('DiagnosticsSanitizer', () => {
  const clean = new DiagnosticsSanitizer();

  it('removes emails, phone numbers, long numbers and URL query values', () => {
    const out = clean.scrub('Mail rahul@gmail.com, call +91 98765 43210, OTP 482913, see https://x.com/p?token=abc123');
    expect(out).toBe('Mail <email>, call <phone>, OTP <n>, see https://x.com/p?token=*');
    expect(scrubUrl('https://wa.me/919876543210?text=hello')).toBe('https://wa.me/<n>?text=*');
  });

  it('keeps button names but hashes other screen text and typed fields', () => {
    const rows = clean.tree(['idx|type|label|flags|tap_at', '0|btn|Install|t|10,10', '1|text|Hi Rahul, your code is 1234|  |5,5', '2|input|secret@x.com|te|7,7'].join('\n'));
    expect(rows?.[0].l).toBe('Install');
    expect(rows?.[1].l).toBeUndefined();
    expect(rows?.[1].lh).toHaveLength(12);
    expect(rows?.[2].l).toBeUndefined();
    expect(JSON.stringify(rows)).not.toMatch(/Rahul|secret|1234/);
  });

  it('keeps redacted typing redacted and hashes any other long text in a payload', () => {
    expect(clean.payload({ text: '[REDACTED]' })).toEqual({ text: '[REDACTED]' });
    const hashed = clean.payload({ text: 'a long message that someone typed into the app' }) as { text: { h: string } };
    expect(hashed.text.h).toHaveLength(12);
    expect(clean.payload({ packageName: 'com.whatsapp', x: 3 })).toEqual({ packageName: 'com.whatsapp', x: 3 });
  });
});
