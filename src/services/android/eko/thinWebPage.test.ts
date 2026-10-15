import type { UiNodeSnapshot } from '../AndroidProtocol';
import { AndroidAgent } from './AndroidAgent';
import { buildScreenModel, webContentMissing } from './screenModel';

let n = 0;
const node = (over: Partial<UiNodeSnapshot> & { box: [number, number, number, number] }): UiNodeSnapshot => {
  const { box, ...rest } = over;
  return { path: String(n++), bounds: { left: box[0], top: box[1], right: box[2], bottom: box[3] }, clickable: false, editable: false, enabled: true, children: [], ...rest };
};

/** Chrome's toolbar, as run #3998 listed it. */
const toolbar = () => [
  node({ contentDescription: 'Open the homepage', clickable: true, className: 'android.widget.ImageButton', box: [0, 100, 120, 240] }),
  node({ text: 'amazon.in/s?k=boat+airdopes+141', clickable: true, editable: true, className: 'android.widget.EditText', box: [200, 100, 700, 240] }),
  node({ contentDescription: 'New tab', clickable: true, className: 'android.widget.ImageButton', box: [720, 100, 820, 240] }),
  node({ contentDescription: 'See 22 tabs', clickable: true, className: 'android.widget.ImageButton', box: [840, 100, 940, 240] }),
];
/** The page as one empty box: what Chrome hands over now and then. */
const emptyPage = () => node({ box: [0, 0, 1080, 2400], children: [...toolbar(), node({ clickable: true, box: [0, 260, 1080, 2400] })] });
/** The same page with its content. */
const fullPage = (first = 1) =>
  node({
    box: [0, 0, 1080, 2400],
    children: [
      ...toolbar(),
      node({
        clickable: true,
        box: [0, 260, 1080, 2400],
        children: [0, 1, 2, 3].map((i) => node({ text: `boAt Airdopes ${140 + first + i} · ₹${899 + i}`, clickable: true, box: [40, 400 + i * 400, 1040, 700 + i * 400] })),
      }),
    ],
  });

describe('webContentMissing', () => {
  it('a browser screen with the toolbar and an empty page box', () => {
    expect(webContentMissing(buildScreenModel(emptyPage()), 'com.android.chrome')).toBe(true);
    expect(webContentMissing(buildScreenModel(fullPage()), 'com.android.chrome')).toBe(false);
    // Not for apps: a big unlabelled view there is a video or a map.
    expect(webContentMissing(buildScreenModel(emptyPage()), 'com.google.android.youtube')).toBe(false);
  });
});

type Tools = { tools: { name: string; execute: (a: Record<string, unknown>, c: unknown, t: unknown) => Promise<{ content: { text?: string }[]; isError?: boolean }> }[] };

function phone(pages: (() => UiNodeSnapshot)[], features: string[] = [], ocr?: (frame: number) => string[]) {
  let read = 0;
  let frame = 0;
  const exec = jest.fn(async (_hw: string, action: Record<string, unknown>) => {
    if (action.type === 'ObserveScreen' || action.type === 'ReadUiTree') {
      const root = pages[Math.min(read, pages.length - 1)]();
      read += 1;
      return { status: 'SUCCESS', uiTree: { packageName: 'com.android.chrome', root }, screenCapture: { base64Data: `frame-${frame}`, width: 1080, height: 2400 } };
    }
    if (action.type === 'ReadText')
      return { status: 'SUCCESS', summary: 'read', textLines: (ocr?.(frame) ?? []).map((text, i) => ({ text, bounds: { left: 40, top: 500 + i * 300, right: 1000, bottom: 560 + i * 300 } })) };
    if (action.type === 'ScrollNode' || action.type === 'Gesture') frame += 1;
    return { status: 'SUCCESS', summary: `${String(action.type)} done` };
  });
  const gateway = { executeAction: exec, hasFeature: (_: string, f: string) => features.includes(f) };
  const agent = new AndroidAgent(gateway as never, 'hw', undefined, { screenshots: 'off' } as never);
  const tools = (agent as unknown as Tools).tools;
  const run = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await tools.find((t) => t.name === name)!.execute(args, {}, {});
    return { text: r.content.map((c) => c.text ?? '').join(''), isError: Boolean(r.isError) };
  };
  return { exec, run };
}

describe('a browser page that came without its content', () => {
  it('is read again, and the second read with the content is what the model gets', async () => {
    const p = phone([emptyPage, fullPage]);
    const r = await p.run('read_ui_tree');
    expect(p.exec.mock.calls.filter(([, a]) => a.type === 'ObserveScreen')).toHaveLength(2);
    expect(r.text).toMatch(/boAt Airdopes 141/);
    expect(r.text).not.toMatch(/did not give this page's content/);
  }, 20_000);

  it('still missing after two more reads: the model is told the page is not blank', async () => {
    const p = phone([emptyPage]);
    const r = await p.run('read_ui_tree');
    expect(p.exec.mock.calls.filter(([, a]) => a.type === 'ObserveScreen')).toHaveLength(3);
    expect(r.text).toMatch(/the browser did not give this page's content to the element list \(only its toolbar\)\. This does not mean the page is blank or still loading, so do not wait or reload for it/);
  }, 20_000);

  it("the phone's OCR reads the page again after it scrolls, though the list looks the same", async () => {
    const p = phone([emptyPage], ['ocr'], (frame) => [`Result ${frame * 3 + 1} ₹766`, `Result ${frame * 3 + 2} ₹899`]);
    const first = await p.run('read_ui_tree');
    expect(first.text).toMatch(/Result 1 ₹766/);
    const second = await p.run('scroll_element', { direction: 'FORWARD' });
    expect(second.text).toMatch(/Result 4 ₹766/);
    expect(p.exec.mock.calls.filter(([, a]) => a.type === 'ReadText')).toHaveLength(2);
  }, 30_000);
});

/** A long list in an app: every scroll moves it by 800 px. */
function listPhone(pkg = 'com.android.vending') {
  let offset = 0;
  let app = pkg;
  const page = () => {
    const rows: UiNodeSnapshot[] = [];
    for (let i = 1; i <= 40; i++) {
      const top = i * 200 - offset;
      if (top < 150 || top + 150 > 2400) continue;
      rows.push(node({ text: `Row ${i}`, clickable: true, box: [40, top, 1040, top + 150] }));
    }
    return node({ box: [0, 0, 1080, 2400], children: rows });
  };
  const exec = jest.fn(async (_hw: string, action: Record<string, unknown>) => {
    if (action.type === 'ObserveScreen' || action.type === 'ReadUiTree') return { status: 'SUCCESS', uiTree: { packageName: app, root: page() } };
    if (action.type === 'ScrollNode') offset = Math.max(0, offset + (action.direction === 'BACKWARD' ? -800 : 800));
    if (action.type === 'OpenApp') {
      app = String(action.packageName);
      offset = 0;
    }
    return { status: 'SUCCESS', summary: `${String(action.type)} done` };
  });
  const gateway = { executeAction: exec, hasFeature: (_: string, f: string) => ['gesture', 'scroll_until'].includes(f) };
  const agent = new AndroidAgent(gateway as never, 'hw', undefined, {});
  const tools = (agent as unknown as Tools).tools;
  const run = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await tools.find((t) => t.name === name)!.execute(args, {}, {});
    return { text: r.content.map((c) => c.text ?? '').join(''), isError: Boolean(r.isError) };
  };
  return { exec, run };
}

describe('down and up past it again and again', () => {
  const zigzag = async (p: ReturnType<typeof listPhone>, times: number) => {
    const out: { text: string; isError: boolean }[] = [];
    for (let i = 0; i < times; i++) out.push(await p.run('scroll_element', { direction: i % 2 ? 'BACKWARD' : 'FORWARD' }));
    return out;
  };

  it('after two BACK AND FORTH notes, scrolling back the other way is refused; the same way still works', async () => {
    const p = listPhone();
    await p.run('read_ui_tree');
    await p.run('scroll_element', { direction: 'FORWARD' });
    const out = await zigzag(p, 8);
    // F F B F B (note 1), F B F (note 2), then B: refused.
    expect(out.filter((r) => /BACK AND FORTH/.test(r.text))).toHaveLength(2);
    expect(out.slice(0, 7).every((r) => !r.isError)).toBe(true);
    expect(out[7].isError).toBe(true);
    expect(out[7].text).toMatch(/^Refused: on this page you have scrolled down and back up/);
    const same = await p.run('scroll_element', { direction: 'FORWARD' });
    expect(same.isError).toBe(false);
  }, 30_000);

  it('the scroll result is kept as a NOTE, so it survives when the screen list is stored apart', async () => {
    const p = listPhone();
    await p.run('read_ui_tree');
    const r = await p.run('scroll_element', { direction: 'FORWARD' });
    expect(r.text).toMatch(/\n\nNOTE: MOVED: about 33% of the screen further down the page\./);
  }, 20_000);

  it('another app starts with a clean slate', async () => {
    const p = listPhone();
    await p.run('read_ui_tree');
    await p.run('scroll_element', { direction: 'FORWARD' });
    await zigzag(p, 8);
    await p.run('open_app', { packageName: 'com.android.chrome' });
    await p.run('scroll_element', { direction: 'FORWARD' });
    const back = await p.run('scroll_element', { direction: 'BACKWARD' });
    expect(back.isError).toBe(false);
  }, 30_000);
});
