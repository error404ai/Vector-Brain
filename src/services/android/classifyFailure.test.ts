import { classifyFailure } from './failureReason';

describe('classifyFailure', () => {
  it('files every way a phone can drop as DEVICE_OFFLINE, so missions retry it', () => {
    // Dropped between two actions: the next one finds no socket.
    expect(classifyFailure('Device android_27c3eef2 is not currently connected to Vector-Brain')).toBe('DEVICE_OFFLINE');
    expect(classifyFailure('Device "free1" is currently offline. Please open the companion app on the device.')).toBe('DEVICE_OFFLINE');
    expect(classifyFailure('WebSocket disconnected')).toBe('DEVICE_OFFLINE');
  });

  it('keeps the other reasons apart', () => {
    expect(classifyFailure('Action execution on device timed out after 15000ms')).toBe('TIMEOUT');
    expect(classifyFailure('429 Too Many Requests')).toBe('LLM_RATE_LIMIT');
    expect(classifyFailure('Insufficient credits')).toBe('LLM_AUTH_OR_CREDIT');
    expect(classifyFailure('Something else broke')).toBe('ERROR');
  });

  it('files a model that stayed too slow as LLM_SLOW, not a phone timeout', () => {
    expect(classifyFailure('The AI model did not finish answering within 90 s, twice in a row. The model is too slow right now; try again or switch to a faster model.')).toBe('LLM_SLOW');
    expect(classifyFailure('The AI model sent nothing for 45 s, twice in a row.')).toBe('LLM_SLOW');
  });
});
