import { markCacheBreakpoint, pruneStaleScreens } from './contextPruning';
import { CACHE_BREAKPOINT, usageDetails } from '../agent/usageDetails';

const MARK = CACHE_BREAKPOINT as unknown as Record<string, Record<string, unknown>>;
type M = { role: string; content: unknown; providerOptions?: Record<string, Record<string, unknown> | undefined> };

const screen = (n: number) => `Tapped ${n}\n\nUPDATED SCREEN ELEMENTS:\n[e${n}] Button "x"`;
const step = (n: number): M[] => [
  { role: 'assistant', content: [{ type: 'tool-call', toolCallId: `c${n}`, toolName: 'click', input: {} }] },
  { role: 'tool', content: [{ type: 'tool-result', toolCallId: `c${n}`, output: { type: 'text', value: screen(n) } }] },
];

describe('Eko moving cache mark', () => {
  it('marks only the newest assistant turn and moves the mark each call', () => {
    const messages: M[] = [{ role: 'system', content: 'sys', providerOptions: { openrouter: { cacheControl: { type: 'ephemeral' } } } }, { role: 'user', content: 'task' }, ...step(1)];
    expect(markCacheBreakpoint(messages, MARK)).toBe(2);
    messages.push(...step(2));
    expect(markCacheBreakpoint(messages, MARK)).toBe(4);
    const marked = messages.filter((m) => m.providerOptions);
    // system (Eko's own) + one moving mark: well under Anthropic's four.
    expect(marked.map((m) => m.role)).toEqual(['system', 'assistant']);
    expect(messages[2].providerOptions).toBeUndefined();
    expect(messages[4].providerOptions?.openrouter?.cacheControl).toEqual({ type: 'ephemeral' });
    expect(messages[4].providerOptions?.anthropic?.cacheControl).toEqual({ type: 'ephemeral' });
  });

  it('keeps what an assistant turn already carried and gives it back when the mark moves on', () => {
    const messages: M[] = [{ role: 'user', content: 'task' }, ...step(1)];
    messages[1].providerOptions = { openrouter: { reasoning_details: ['r'] } };
    markCacheBreakpoint(messages, MARK);
    expect(messages[1].providerOptions).toEqual({ openrouter: { reasoning_details: ['r'], cacheControl: { type: 'ephemeral' } }, anthropic: { cacheControl: { type: 'ephemeral' } } });
    messages.push(...step(2));
    markCacheBreakpoint(messages, MARK);
    expect(messages[1].providerOptions).toEqual({ openrouter: { reasoning_details: ['r'] } });
  });

  it('the marked turn is unchanged by the next call, so the cache written there is read', () => {
    const messages: M[] = [{ role: 'user', content: 'task' }, ...step(1)];
    pruneStaleScreens(messages);
    markCacheBreakpoint(messages, MARK);
    const prefix = JSON.stringify(messages.slice(0, 2).map((m) => m.content));
    messages.push(...step(2));
    pruneStaleScreens(messages);
    markCacheBreakpoint(messages, MARK);
    expect(JSON.stringify(messages.slice(0, 2).map((m) => m.content))).toBe(prefix);
  });

  it('does nothing without an assistant turn', () => {
    const messages: M[] = [{ role: 'user', content: 'task' }];
    expect(markCacheBreakpoint(messages, MARK)).toBe(-1);
    expect(messages[0].providerOptions).toBeUndefined();
  });
});

describe('Eko usage from the provider report', () => {
  it('reads OpenRouter cost and cached tokens from providerMetadata', () => {
    const d = usageDetails(undefined, { openrouter: { usage: { cost: 0.00042, promptTokensDetails: { cachedTokens: 7680 } } } });
    expect(d.cachedTokens).toBe(7680);
    expect(d.costUsd).toBe(0.00042);
  });

  it('reads Anthropic cache reads from its raw usage', () => {
    const d = usageDetails(undefined, { anthropic: { cacheCreationInputTokens: 900, usage: { cache_read_input_tokens: 5000 } } });
    expect(d.cachedTokens).toBe(5000);
    expect(d.cacheWriteTokens).toBe(900);
  });
});
