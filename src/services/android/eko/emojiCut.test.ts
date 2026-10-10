import type { UiNodeSnapshot } from '../AndroidProtocol';
import { buildScreenModel, cutText, formatScreen, wellFormed } from './screenModel';

const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

describe('emoji in labels (Oct 10: a half emoji ended three runs on one phone)', () => {
  it('never cuts an emoji in half', () => {
    const label = `${'a'.repeat(59)}😀 and more text after it`;
    expect(LONE.test(cutText(label, 60))).toBe(false);
    expect(cutText(label, 60)).toBe('a'.repeat(59));
    expect(cutText('short 😀', 60)).toBe('short 😀');
  });

  it('a screen list with an emoji at the cut is valid UTF-8 text', () => {
    const root: UiNodeSnapshot = {
      path: '0', bounds: { left: 0, top: 0, right: 1080, bottom: 2400 }, clickable: false, editable: false, enabled: true,
      children: [{ path: '0/0', text: `${'x'.repeat(59)}🔥🔥 caption`, bounds: { left: 0, top: 100, right: 1080, bottom: 200 }, clickable: true, editable: false, enabled: true, children: [] }],
    };
    const table = formatScreen(buildScreenModel(root));
    expect(LONE.test(table)).toBe(false);
    expect(() => Buffer.from(table, 'utf8').toString('utf8')).not.toThrow();
  });

  it('a half emoji that arrives from the phone is replaced, whole ones are kept', () => {
    expect(wellFormed('ok \uD83D')).toBe('ok �');
    expect(wellFormed('\uDE00 start')).toBe('� start');
    expect(wellFormed('fine 😀')).toBe('fine 😀');
  });
});
