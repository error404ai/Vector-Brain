import type { UiNodeSnapshot } from '../AndroidProtocol';
import { AndroidAgent, announcedToggle, asksToInstall, intentFor } from './AndroidAgent';

let n = 0;
const node = (over: Partial<UiNodeSnapshot> & { box: [number, number, number, number] }): UiNodeSnapshot => {
  const { box, ...rest } = over;
  return { path: String(n++), bounds: { left: box[0], top: box[1], right: box[2], bottom: box[3] }, clickable: false, editable: false, enabled: true, children: [], ...rest };
};
const screen = (children: UiNodeSnapshot[]) => node({ box: [0, 0, 1080, 2400], children });
const reel = () =>
  screen([
    node({ contentDescription: 'Like', clickable: true, box: [960, 900, 1040, 980] }),
    node({ contentDescription: 'Comment', clickable: true, box: [960, 1000, 1040, 1080] }),
    node({ contentDescription: 'Share', clickable: true, box: [960, 1100, 1040, 1180] }),
    node({ text: 'a reel', box: [0, 1900, 900, 2000] }),
    node({ text: 'Reels', clickable: true, box: [0, 2250, 540, 2400] }),
  ]);

type Tools = { tools: { name: string; execute: (a: Record<string, unknown>, c: unknown, t: unknown) => Promise<{ content: { text?: string }[]; isError?: boolean }> }[] };
function agentWith(executeAction: jest.Mock, features: string[] = [], task?: string) {
  const gateway = { executeAction, hasFeature: (_: string, f: string) => features.includes(f) };
  const agent = new AndroidAgent(gateway as never, 'hw', undefined, task ? { task } : {});
  const tools = (agent as unknown as Tools).tools;
  return {
    names: tools.map((t) => t.name),
    run: async (name: string, args: Record<string, unknown> = {}) => {
      const r = await tools.find((t) => t.name === name)!.execute(args, {}, {});
      return { text: r.content.map((c) => c.text ?? '').join(''), isError: Boolean(r.isError) };
    },
  };
}
const likeIdx = (t: string) => t.split('\n').find((r) => r.includes('|Like|'))!.split('|')[0];

describe('store links open in the Play Store (Oct 11: a chooser on phones with a second store)', () => {
  it('market:// and play.google.com links get the Play Store package unless one is given', () => {
    expect(intentFor({ action: 'VIEW', data: 'market://details?id=com.whatsapp' })).toMatchObject({ packageName: 'com.android.vending' });
    expect(intentFor({ action: 'VIEW', data: 'https://play.google.com/store/apps/details?id=com.whatsapp' })).toMatchObject({ packageName: 'com.android.vending' });
    expect(intentFor({ action: 'VIEW', data: 'market://details?id=x', packageName: 'com.sec.android.app.samsungapps' })).toMatchObject({ packageName: 'com.sec.android.app.samsungapps' });
    expect(intentFor({ action: 'VIEW', data: 'https://bbc.co.uk' })).not.toHaveProperty('packageName');
  });
});

describe('what the phone announces about a toggle', () => {
  it('"Liked" is on, "Unliked" is off, anything else says nothing', () => {
    expect(announcedToggle([{ kind: 'announcement', text: 'Liked', millisAgo: 10 }])).toEqual({ on: true, text: 'Liked' });
    expect(announcedToggle([{ kind: 'announcement', text: 'Unliked', millisAgo: 10 }])).toEqual({ on: false, text: 'Unliked' });
    expect(announcedToggle([{ kind: 'toast', text: 'Removed from saved', millisAgo: 10 }])?.on).toBe(false);
    expect(announcedToggle([{ kind: 'announcement', text: 'Loading', millisAgo: 10 }])).toBeNull();
    expect(announcedToggle([])).toBeNull();
  });

  it('a Like the phone announced as "Unliked" is not counted and can be tapped again', async () => {
    let announce = 'Unliked';
    const exec = jest.fn(async (_hw: string, action: { type: string }) => {
      if (action.type === 'ObserveScreen') return { status: 'SUCCESS', uiTree: { packageName: 'com.instagram.android', root: reel() }, events: announce ? [{ kind: 'announcement', text: announce, millisAgo: 50 }] : [] };
      return { status: 'SUCCESS', summary: 'done' };
    });
    const a = agentWith(exec);
    announce = '';
    const idx = likeIdx((await a.run('read_ui_tree')).text);
    announce = 'Unliked';
    const r = await a.run('tap_element', { idx });
    expect(r.text).not.toMatch(/TOGGLED/);
    expect(r.text).toMatch(/turned "Like" OFF \(it was already on\)/);
    announce = 'Liked';
    const again = await a.run('tap_element', { idx });
    expect(again.isError).toBe(false);
    expect(again.text).toMatch(/TOGGLED: "Like"\nSTATE: "Like" → on \(the phone announced "Liked"\)/);
  });
});

describe('one round trip and no-frame reads (companion 0.31)', () => {
  it('the screen that came with the result is used; no second ObserveScreen', async () => {
    const exec = jest.fn(async (_hw: string, action: { type: string }, _t?: number, _s?: string, opts?: { observeAfter?: boolean }) => {
      if (action.type === 'ObserveScreen') return { status: 'SUCCESS', uiTree: { packageName: 'x', root: reel() } };
      return { status: 'SUCCESS', summary: 'Tapped', ...(opts?.observeAfter ? { uiTree: { packageName: 'x', root: reel() } } : {}) };
    });
    const a = agentWith(exec, ['observe_after']);
    const idx = likeIdx((await a.run('read_ui_tree')).text);
    const before = exec.mock.calls.filter(([, act]) => act.type === 'ObserveScreen').length;
    await a.run('tap_element', { idx });
    expect(exec.mock.calls.filter(([, act]) => act.type === 'ObserveScreen').length).toBe(before);
    expect(exec.mock.calls.find(([, act]) => act.type === 'Tap')?.[4]).toEqual({ observeAfter: true });
  });

  it('older phones: observeAfter is not sent and the screen is read as before', async () => {
    const exec = jest.fn(async (_hw: string, action: { type: string }, _t?: number, _s?: string, _o?: { observeAfter?: boolean }) =>
      action.type === 'ObserveScreen' ? { status: 'SUCCESS', uiTree: { packageName: 'x', root: reel() } } : { status: 'SUCCESS', summary: 'Tapped' },
    );
    const a = agentWith(exec);
    const idx = likeIdx((await a.run('read_ui_tree')).text);
    await a.run('tap_element', { idx });
    expect(exec.mock.calls.find(([, act]) => act.type === 'Tap')?.[4]).toBeUndefined();
    expect(exec.mock.calls.filter(([, act]) => act.type === 'ObserveScreen').length).toBe(2);
  });

  it('a screenshot that times out still gives the element list (Oct 11: 19 blind steps)', async () => {
    const exec = jest.fn(async (_hw: string, action: { type: string }) => {
      if (action.type === 'ObserveScreen') return { status: 'FAILURE', code: 'TIMEOUT', message: 'No screen frame arrived before the capture timed out', recoverable: true };
      if (action.type === 'ReadUiTree') return { status: 'SUCCESS', summary: 'tree', uiTree: { packageName: 'x', root: reel() } };
      return { status: 'SUCCESS', summary: 'ok' };
    });
    const a = agentWith(exec);
    const r = await a.run('read_ui_tree');
    expect(r.text).toMatch(/\|Like\|/);
  });

  it('scroll_until only for phones that have it', () => {
    const exec = jest.fn();
    expect(agentWith(exec).names).not.toContain('scroll_until');
    expect(agentWith(exec, ['scroll_until']).names).toContain('scroll_until');
  });
});

describe('an app that is not on the phone (Oct 11, #3576: 24 steps, then a Play Store sign-in)', () => {
  const exec = (apps: string) =>
    jest.fn(async (_hw: string, action: { type: string }) => {
      if (action.type === 'OpenApp') return { status: 'FAILURE', code: 'APP_NOT_FOUND', message: 'No launchable app found', recoverable: true };
      if (action.type === 'ListApps') return { status: 'SUCCESS', summary: `Installed apps (2):\n${apps}` };
      if (action.type === 'ObserveScreen') return { status: 'SUCCESS', uiTree: { packageName: 'launcher', root: reel() } };
      return { status: 'SUCCESS', summary: 'ok' };
    });

  it('says it is not installed and to finish, when the task does not ask to install', async () => {
    const a = agentWith(exec('Chrome | com.android.chrome\nYouTube | com.google.android.youtube'), [], 'Open Instagram and like 2 reels');
    const r = await a.run('open_app', { packageName: 'com.instagram.android' });
    expect(r.text).toMatch(/NOT installed on this phone.*Finish now/);
  });

  it('points to the package the phone does have', async () => {
    const a = agentWith(exec('Instagram Lite | com.instagram.lite\nChrome | com.android.chrome'), [], 'Open Instagram and like 2 reels');
    const r = await a.run('open_app', { packageName: 'com.instagram.android' });
    expect(r.text).toMatch(/This phone has "Instagram Lite" \(com\.instagram\.lite\)/);
  });

  it('install tasks keep the old advice', async () => {
    expect(asksToInstall('Play Store se WhatsApp install karo')).toBe(true);
    expect(asksToInstall('whatsapp laga do')).toBe(true);
    expect(asksToInstall('Open Instagram and like 2 reels')).toBe(false);
  });
});
