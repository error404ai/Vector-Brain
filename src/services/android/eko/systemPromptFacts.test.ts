import { AndroidAgent } from './AndroidAgent';

const FACTS = 'checked 2026-10-08 13:55 UTC\nPublic IP: 203.0.113.7\nTimezone: Europe/London';

describe('system prompt and phone facts', () => {
  it('keeps the facts in the full prompt and leaves them out on request', async () => {
    const agent = new AndroidAgent({} as never, 'hw', undefined, { vision: true, screenshots: 'stuck', deviceFacts: FACTS });
    const full = await agent.systemPrompt();
    const bare = await agent.systemPrompt({ withFacts: false });
    expect(full).toContain('THIS PHONE (read by the phone itself, checked 2026-10-08 13:55 UTC):\nPublic IP: 203.0.113.7');
    expect(bare).not.toContain('203.0.113.7');
    expect(bare).not.toContain('13:55');
    // Same prompt otherwise: the facts block is the only difference.
    expect(full).toBe(`${bare}\n\n${agent.deviceFactsText()}`);
  });

  it('gives every phone the same bare prompt', async () => {
    const a = new AndroidAgent({} as never, 'a', undefined, { vision: true, screenshots: 'stuck', deviceFacts: FACTS });
    const b = new AndroidAgent({} as never, 'b', undefined, { vision: true, screenshots: 'stuck', deviceFacts: 'checked now\nPublic IP: 198.51.100.2' });
    expect(await a.systemPrompt({ withFacts: false })).toBe(await b.systemPrompt({ withFacts: false }));
    expect(new AndroidAgent({} as never, 'c').deviceFactsText()).toBeNull();
  });
});
