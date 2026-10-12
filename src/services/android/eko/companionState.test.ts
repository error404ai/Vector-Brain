import type { UiNodeSnapshot, WindowSnapshot } from '../AndroidProtocol';
import { AndroidAgent, intentFor } from './AndroidAgent';
import { buildScreenModel, eventsLine, formatScreen } from './screenModel';

let n = 0;
const node = (over: Partial<UiNodeSnapshot> & { box: [number, number, number, number] }): UiNodeSnapshot => {
  const { box, ...rest } = over;
  return { path: String(n++), bounds: { left: box[0], top: box[1], right: box[2], bottom: box[3] }, clickable: false, editable: false, enabled: true, children: [], ...rest };
};
const screen = (children: UiNodeSnapshot[]) => node({ box: [0, 0, 1080, 2400], children });

describe('what companion 0.30 says about each row', () => {
  it('older phones: the list reads exactly as before', () => {
    const table = formatScreen(buildScreenModel(screen([node({ text: 'Like', clickable: true, box: [900, 900, 1000, 1000] }), node({ text: 'Share', clickable: true, box: [900, 1100, 1000, 1200] })])));
    expect(table).toBe('idx|type|label|flags|tap_at\n0|view|Like|t|880,396\n1|view|Share|t|880,479');
  });

  it('on/off, selected tab, hint, error, slider and list size, with a legend', () => {
    const model = buildScreenModel(
      screen([
        node({ contentDescription: 'Like', clickable: true, checked: true, box: [900, 900, 1000, 1000] }),
        node({ text: 'Wi-Fi', clickable: true, checked: false, stateDescription: 'Off', box: [0, 300, 1080, 400] }),
        node({ text: 'Reels', clickable: true, selected: true, box: [0, 2250, 540, 2400] }),
        node({ text: '', editable: true, clickable: true, hint: 'Email', error: 'Enter a valid email', inputKind: 'email', focused: true, box: [0, 500, 1080, 600] }),
        node({ contentDescription: 'Volume', clickable: true, range: { type: 'int', min: 0, max: 15, current: 7 }, box: [0, 700, 1080, 760] }),
        node({ viewId: 'app:id/list', text: 'Feed', collection: '120', scroll: 'down', box: [0, 800, 1080, 2200] }),
      ]),
    );
    const table = formatScreen(model);
    expect(table).toMatch(/\|Like\|tC\|/);
    expect(table).toMatch(/\|Wi-Fi\|tU\|/);
    expect(table).toMatch(/\|Reels\|tS\|/);
    expect(table).toMatch(/\|teF\|/);
    expect(table).toMatch(/^STATE FLAGS: C on\/checked, U off\/unchecked, S selected/m);
    const details = table.split('\n').find((l) => l.startsWith('DETAILS:'))!;
    expect(details).toMatch(/row 1 "Off"/);
    expect(details).toMatch(/hint "Email", email field, ERROR "Enter a valid email"/);
    expect(details).toMatch(/value 7 of 0–15/);
    expect(details).toMatch(/list of 120 items, can scroll down/);
  });

  it("a button's state sitting on the icon inside it is the button's (Instagram's heart)", () => {
    const button = node({ clickable: true, box: [900, 900, 1000, 1000], children: [node({ contentDescription: 'Like', selected: true, box: [910, 910, 990, 990] })] });
    const model = buildScreenModel(screen([button, node({ text: 'a reel', box: [0, 1900, 900, 2000] })]));
    expect(model.elements[0]).toMatchObject({ label: 'Like', selected: true });
  });

  it('windows: keyboard, picture-in-picture, and another app’s dialog over the app (its rows first)', () => {
    const dialogRoot = node({ box: [90, 900, 990, 1500], children: [node({ text: 'Allow Instagram to send notifications?', box: [120, 950, 960, 1050] }), node({ text: 'Allow', clickable: true, box: [600, 1350, 950, 1450] })] });
    const windows: WindowSnapshot[] = [
      { type: 'app', packageName: 'com.google.android.permissioncontroller', layer: 5, bounds: { left: 90, top: 900, right: 990, bottom: 1500 }, root: dialogRoot },
      { type: 'keyboard', packageName: 'com.google.android.inputmethod.latin', layer: 4, bounds: { left: 0, top: 1500, right: 1080, bottom: 2400 } },
      { type: 'app', packageName: 'com.google.android.youtube', layer: 3, bounds: { left: 600, top: 1600, right: 1060, bottom: 1860 }, pictureInPicture: true },
      { type: 'app', packageName: 'com.instagram.android', layer: 1, bounds: { left: 0, top: 0, right: 1080, bottom: 2400 }, active: true },
    ];
    const model = buildScreenModel(screen([node({ text: 'Home', clickable: true, box: [0, 2250, 540, 2400] })]), undefined, undefined, { windows, activity: 'com.instagram.mainactivity.InstagramMainActivity' });
    expect(model.elements[0].label).toBe('Allow Instagram to send notifications?');
    expect(model.elements.find((e) => e.label === 'Allow')?.window).toBe('com.google.android.permissioncontroller');
    expect(model.elements.at(-1)?.label).toBe('Home');
    const table = formatScreen(model);
    expect(table).toMatch(/^WINDOWS: keyboard open \(covers the screen below y=625; press_key BACK closes it — BACKSPACE only deletes a letter\); a picture-in-picture video floats at 769,721.*; a window from com\.google\.android\.permissioncontroller is over the app/m);
    expect(table).toMatch(/^SCREEN: InstagramMainActivity$/m);
  });

  it('what the phone saw between reads, in one line', () => {
    expect(
      eventsLine([
        { kind: 'toast', text: 'Comment posted', millisAgo: 300 },
        { kind: 'scroll', toIndex: 119, itemCount: 120, atEnd: true, millisAgo: 100 },
        { kind: 'screen', className: 'com.app.ProfileActivity', millisAgo: 50 },
      ]),
    ).toBe('PHONE SAW: message "Comment posted"; list scrolled to item 120 of 120 (at the END: no more items that way); screen ProfileActivity');
    expect(eventsLine([])).toBe('');
  });
});

describe('open_intent', () => {
  it('short names, and "body" where each app reads it', () => {
    expect(intentFor({ action: 'sendto', data: 'smsto:+441234', extras: { body: 'hi' } })).toEqual({ type: 'OpenIntent', action: 'android.intent.action.SENDTO', data: 'smsto:+441234', extras: { sms_body: 'hi' } });
    expect(intentFor({ action: 'SENDTO', data: 'mailto:a@b.com', extras: { subject: 'S', body: 'B' } })).toMatchObject({ extras: { 'android.intent.extra.SUBJECT': 'S', 'android.intent.extra.TEXT': 'B' } });
    expect(intentFor({ action: 'SEND', packageName: 'com.whatsapp', extras: { text: 'yo' } })).toMatchObject({ mimeType: 'text/plain', packageName: 'com.whatsapp' });
    expect(intentFor({ action: 'android.settings.APPLICATION_DETAILS_SETTINGS', data: 'package:com.android.chrome' })).toMatchObject({ action: 'android.settings.APPLICATION_DETAILS_SETTINGS' });
  });

  it('refuses calls, deletes and anything that is not an intent or settings action', () => {
    expect(intentFor({ action: 'android.intent.action.CALL', data: 'tel:1' })).toHaveProperty('error');
    expect(intentFor({ action: 'android.intent.action.DELETE' })).toHaveProperty('error');
    expect(intentFor({ action: 'rm -rf' })).toHaveProperty('error');
  });

  it('is offered only to phones whose companion can start intents', () => {
    const names = (features: string[]) => {
      const gateway = { executeAction: jest.fn(), hasFeature: (_: string, f: string) => features.includes(f) };
      return (new AndroidAgent(gateway as never, 'hw') as unknown as { tools: { name: string }[] }).tools.map((t) => t.name);
    };
    expect(names([])).not.toContain('open_intent');
    expect(names(['intent'])).toEqual(expect.arrayContaining(['open_intent', 'open_app_info']));
  });
});

describe('a Like whose state the phone reports', () => {
  const reel = (liked: boolean) =>
    screen([
      node({ contentDescription: 'Like', clickable: true, checked: liked, box: [960, 900, 1040, 980] }),
      node({ contentDescription: 'Comment', clickable: true, box: [960, 1000, 1040, 1080] }),
      node({ contentDescription: 'Share', clickable: true, box: [960, 1100, 1040, 1180] }),
      node({ text: 'a reel', box: [0, 1900, 900, 2000] }),
      node({ text: 'Reels', clickable: true, box: [0, 2250, 540, 2400] }),
    ]);

  function phone(tapWorks: boolean) {
    let liked = false;
    const gateway = {
      executeAction: jest.fn(async (_hw: string, action: { type: string }) => {
        if (action.type === 'ObserveScreen') return { status: 'SUCCESS', uiTree: { packageName: 'com.instagram.android', root: reel(liked) } };
        if (action.type === 'Tap' && tapWorks) liked = !liked;
        return { status: 'SUCCESS', summary: 'done' };
      }),
    };
    const agent = new AndroidAgent(gateway as never, 'hw');
    const tools = (agent as unknown as { tools: { name: string; execute: (a: Record<string, unknown>, c: unknown, t: unknown) => Promise<{ content: { text?: string }[]; isError?: boolean }> }[] }).tools;
    const run = async (name: string, args: Record<string, unknown> = {}) => {
      const r = await tools.find((t) => t.name === name)!.execute(args, {}, {});
      return { text: r.content.map((c) => c.text ?? '').join(''), isError: Boolean(r.isError) };
    };
    return { run, taps: () => gateway.executeAction.mock.calls.filter(([, a]) => a.type === 'Tap').length };
  }
  const likeIdx = (t: string) => t.split('\n').find((r) => r.includes('|Like|'))!.split('|')[0];

  it('a tap that liked it says so from the phone, and is counted', async () => {
    const p = phone(true);
    const r = await p.run('tap_element', { idx: likeIdx((await p.run('read_ui_tree')).text) });
    expect(r.text).toMatch(/TOGGLED: "Like"\nSTATE: "Like" off → on/);
    expect(r.text).toMatch(/the phone reports "Like" is now on/);
  });

  it('a tap that missed is not counted, and trying again is not refused', async () => {
    const p = phone(false);
    const idx = likeIdx((await p.run('read_ui_tree')).text);
    const first = await p.run('tap_element', { idx });
    expect(first.text).not.toMatch(/TOGGLED/);
    expect(first.text).toMatch(/is still off \(the phone reports it\), so this tap did not register/);
    const again = await p.run('tap_element', { idx });
    expect(again.isError).toBe(false);
    expect(p.taps()).toBe(2);
  });
});
