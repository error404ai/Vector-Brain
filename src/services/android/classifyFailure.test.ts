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
});
