import { classifyFailure } from '@/services/android/failureReason';
import { describeModelError, modelErrorText } from './modelErrors';

describe('describeModelError', () => {
  it('turns the OpenRouter free daily cap into a plain message without the raw text', () => {
    const raw = new Error('429 Rate limit exceeded: free-models-per-day-high-balance.\n\nTroubleshooting URL: https://js.langchain.com/docs/troubleshooting/errors/MODEL_RATE_LIMIT/');
    const info = describeModelError(raw);
    expect(info.code).toBe('daily_limit');
    expect(info.retryable).toBe(false);
    const text = modelErrorText(raw);
    expect(text).not.toMatch(/langchain|429|free-models|http/i);
    expect(classifyFailure(text)).toBe('LLM_QUOTA');
    expect(classifyFailure(raw.message)).toBe('LLM_QUOTA');
  });

  it('keeps a short rate limit apart from a daily cap', () => {
    expect(describeModelError(Object.assign(new Error('Too Many Requests'), { statusCode: 429 })).code).toBe('rate_limit');
    expect(describeModelError(new Error('429 Rate limit exceeded: free-models-per-min-high-balance')).code).toBe('rate_limit');
  });

  it('names key, credit, model, length, timeout and network problems', () => {
    expect(describeModelError(new Error('401 Unauthorized: invalid api key')).code).toBe('auth');
    expect(describeModelError(new Error('402 Insufficient credits')).code).toBe('credits');
    expect(describeModelError(new Error('404 No endpoints found for deepseek/x')).code).toBe('model_missing');
    expect(describeModelError(new Error("This model's maximum context length is 65536 tokens")).code).toBe('too_long');
    expect(describeModelError(new Error('The AI model did not finish answering within 90 s, twice in a row.')).code).toBe('timeout');
    expect(describeModelError(new Error('fetch failed')).code).toBe('unreachable');
    expect(describeModelError(new Error('something odd')).code).toBe('unknown');
  });

  it('reads the underlying cause of a wrapped error', () => {
    const wrapped = Object.assign(new Error('Chat failed'), { cause: new Error('429 free-models-per-day') });
    expect(describeModelError(wrapped).code).toBe('daily_limit');
  });
});
