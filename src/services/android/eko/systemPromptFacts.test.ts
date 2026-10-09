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

describe('Lite (compact) prompt', () => {
  it('keeps every rule of the full prompt in fewer words, and no phone facts', async () => {
    const agent = new AndroidAgent({} as never, 'hw', undefined, { vision: true, screenshots: 'stuck', deviceFacts: FACTS });
    const full = await agent.systemPrompt({ withFacts: false });
    agent.compactText = true;
    const short = await agent.systemPrompt();
    expect(short.length).toBeLessThan(full.length * 0.8);
    expect(short).not.toContain('203.0.113.7');
    // Each rule's anchor: tools, numbers, examples and markers the model is told about.
    for (const anchor of [
      'read_ui_tree', 'UPDATED SCREEN ELEMENTS', 'tap_element', 'click_node', 'tap_coordinate', 'type_text', 'install_app',
      'FORWARD', 'BACKWARD', 'swipe', 'global_action BACK', 'wait_for_element', 'CURRENT screen list', 'Install→Cancel',
      '120000', '7 scrolls', 'press_key ENTER', 'newTab: true', 'one by one', 'Research', 'ALL requested', 'AUTO-CLEARED:',
      'task_snapshot', 'STOP', 'idx|type|label|flags|tap_at', 't=tappable', 'e=editable', 'd=disabled', '0–1000', '500,500',
      '5|input|Search Google|te|500,190', 'capture_screen', 'phone_info',
    ]) {
      expect(short).toContain(anchor);
    }
  });

  it('uses the short screen heading that the step pruning still recognises', async () => {
    const { SCREEN_DUMP } = await import('./contextPruning');
    expect(SCREEN_DUMP.test('CURRENT APP: x\n\nUPDATED SCREEN ELEMENTS:\nidx|type|label|flags|tap_at\n0|btn|OK|t|500,500')).toBe(true);
  });
});
