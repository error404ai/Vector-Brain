import { pruneStaleScreens, keepOnlyFreshImage } from './contextPruning';
import { visionFromName } from './modelVision';

const dump = (n: number) => `\n\nUPDATED SCREEN ELEMENTS:\n${`${n}|Button|Item ${n}|t|100,200\n`.repeat(400)}`;
const toolMsg = (text: string, type = 'text') => ({
  role: 'tool',
  content: [{ type: 'tool-result', toolCallId: `c${Math.random()}`, toolName: 'tap_coordinate', output: { type, value: text } }],
});

describe('pruneStaleScreens', () => {
  it('keeps only the newest screen dump in the model context', () => {
    const messages: any[] = [
      { role: 'user', content: [{ type: 'text', text: 'open settings' }] },
      toolMsg(`Action succeeded: tapped${dump(1)}`),
      toolMsg(`Action succeeded: scrolled${dump(2)}`),
      toolMsg(`CURRENT VISIBLE APP: com.android.settings\n\nVISIBLE UI ELEMENTS (columns: idx|type):\n${`3|Button|Item 3|t|1,2\n`.repeat(400)}`),
      toolMsg(`Action succeeded: tapped${dump(4)}\n\nNOTE: keep going`),
    ];
    const before = JSON.stringify(messages).length;
    pruneStaleScreens(messages);
    const texts = messages.slice(1).map((m) => m.content[0].output.value as string);
    expect(texts[3]).toContain('4|Button|Item 4');
    expect(texts[3]).toContain('NOTE: keep going');
    for (const old of texts.slice(0, 3)) {
      expect(old).not.toMatch(/\|Button\|Item/);
      expect(old).toContain('older screen omitted');
    }
    // The action outcome the model wrote its plan around stays.
    expect(texts[0]).toContain('Action succeeded: tapped');
    expect(JSON.stringify(messages).length).toBeLessThan(before / 3);
  });

  it('prunes dumps inside multi-part tool results too', () => {
    const messages: any[] = [
      toolMsg('', 'content'),
      toolMsg(`Action succeeded${dump(9)}`),
    ];
    messages[0].content[0].output = { type: 'content', value: [{ type: 'text', text: `Screen${dump(8)}` }, { type: 'media', data: 'x', mediaType: 'image/jpeg' }] };
    pruneStaleScreens(messages);
    expect(messages[0].content[0].output.value[0].text).toContain('older screen omitted');
    expect(messages[1].content[0].output.value).toContain('9|Button');
  });
});

describe('keepOnlyFreshImage', () => {
  const image = (data: string) => ({ role: 'user', content: [{ type: 'file', mediaType: 'image/jpeg', data }, { type: 'text', text: 'call `capture_screen` tool result' }] });
  const conversation = () => [
    { role: 'user', content: [{ type: 'text', text: 'task' }] },
    { role: 'assistant', content: [{ type: 'tool-call', toolName: 'capture_screen' }] },
    { role: 'tool', content: [{ type: 'tool-result', output: { type: 'text', value: 'Screenshot captured successfully.' } }] },
    image('OLD'),
    { role: 'assistant', content: [{ type: 'tool-call', toolName: 'capture_screen' }] },
    { role: 'tool', content: [{ type: 'tool-result', output: { type: 'content', value: [{ type: 'text', text: 'ok' }, { type: 'media', mediaType: 'image/jpeg', data: 'INLINE' }] } }] },
    image('NEW'),
  ];

  it('keeps only the newest screenshot of the latest step for a vision model, and never one inside a tool result', () => {
    const messages = conversation();
    expect(keepOnlyFreshImage(messages, true)).toEqual({ kept: 1, removed: 2 });
    const text = JSON.stringify(messages);
    expect(text).toContain('NEW');
    expect(text).not.toContain('OLD');
    expect(text).not.toContain('INLINE');
  });

  it('drops a screenshot once the model has moved on to the next step', () => {
    const messages = [...conversation(), { role: 'assistant', content: [{ type: 'tool-call', toolName: 'tap_coordinate' }] }];
    expect(keepOnlyFreshImage(messages, true).kept).toBe(0);
    expect(JSON.stringify(messages)).not.toContain('NEW');
  });

  it('sends no image at all to a text-only model', () => {
    const messages = conversation();
    expect(keepOnlyFreshImage(messages, false)).toEqual({ kept: 0, removed: 3 });
  });
});

describe('visionFromName', () => {
  it('knows text-only DeepSeek V4 from the vision variants', () => {
    expect(visionFromName('deepseek/deepseek-v4-flash-0731')).toBe(false);
    expect(visionFromName('deepseek/deepseek-v4-flash-vision-exp')).toBe(true);
    expect(visionFromName('deepseek/deepseek-v4.1-flash')).toBe(true);
    expect(visionFromName('google/gemini-2.5-flash')).toBe(true);
    expect(visionFromName('deepseek-chat')).toBe(false);
  });
});
