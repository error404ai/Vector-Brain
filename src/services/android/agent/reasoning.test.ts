import { isHardStep } from './VectorEngine';
import type { StepRecord } from './contextBuilder';

const step = (over: Partial<StepRecord>): StepRecord => ({ callId: 'c', toolName: 'tap_element', input: { idx: '1' }, thought: '', resultText: 'Action succeeded', isError: false, ...over });

describe('Lite thinks first on hard steps', () => {
  it('the first step, an error, a screen that did not move, a system note', () => {
    expect(isHardStep(0, [], [])).toBe(true);
    expect(isHardStep(3, [step({ isError: true })], [])).toBe(true);
    expect(isHardStep(3, [step({ resultText: 'CHECK: the screen did NOT change after this.' })], [])).toBe(true);
    expect(isHardStep(3, [step({})], ['SYSTEM CHECK FAILED: …'])).toBe(true);
  });

  it('the same action three times running', () => {
    expect(isHardStep(5, [step({ toolName: 'swipe', input: { direction: 'UP' } }), step({ toolName: 'swipe', input: { direction: 'UP' } }), step({ toolName: 'swipe', input: { direction: 'UP' } })], [])).toBe(true);
  });

  it('an ordinary step that worked is not hard', () => {
    expect(isHardStep(4, [step({ toolName: 'open_app', input: { packageName: 'x' } }), step({})], [])).toBe(false);
  });
});
