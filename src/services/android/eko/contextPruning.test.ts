import { pruneStaleScreens } from './contextPruning';

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
