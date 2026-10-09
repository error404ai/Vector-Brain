import { moveSystemCacheMark } from './aiSdkModel';

describe('OpenRouter system cache mark', () => {
  it('moves the mark from the system message onto a text part, as OpenRouter documents it', () => {
    const body = JSON.stringify({ model: 'm', messages: [{ role: 'system', content: 'RULES', cache_control: { type: 'ephemeral' } }, { role: 'user', content: 'TASK' }] });
    const out = JSON.parse(moveSystemCacheMark(body));
    expect(out.messages[0]).toEqual({ role: 'system', content: [{ type: 'text', text: 'RULES', cache_control: { type: 'ephemeral' } }] });
    expect(out.messages[1]).toEqual({ role: 'user', content: 'TASK' });
    expect(out.model).toBe('m');
  });

  it('leaves every other body untouched', () => {
    const plain = JSON.stringify({ messages: [{ role: 'system', content: 'RULES' }] });
    expect(moveSystemCacheMark(plain)).toBe(plain);
    expect(moveSystemCacheMark('not json')).toBe('not json');
  });
});
