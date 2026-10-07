import type { UiNodeSnapshot } from '../AndroidProtocol';
import { ruleFor, verifyCompletion } from '../agent/successVerifier';
import { AndroidAgent } from './AndroidAgent';
import { findObstacle } from './obstacles';
import { buildScreenModel } from './screenModel';

let pathCounter = 0;
function node(partial: Omit<Partial<UiNodeSnapshot>, 'bounds'> & { bounds: [number, number, number, number] }): UiNodeSnapshot {
  const [left, top, right, bottom] = partial.bounds;
  return {
    path: String(pathCounter++),
    className: partial.className ?? 'android.view.View',
    text: partial.text,
    contentDescription: partial.contentDescription,
    viewId: partial.viewId,
    bounds: { left, top, right, bottom },
    clickable: partial.clickable ?? false,
    editable: partial.editable ?? false,
    enabled: partial.enabled ?? true,
    children: partial.children ?? [],
  };
}

/** A screen of plain text lines plus buttons, stacked top to bottom. */
function screen(lines: string[], buttons: string[]): UiNodeSnapshot {
  return node({
    bounds: [0, 0, 1080, 2400],
    children: [
      ...lines.map((t, i) => node({ text: t, bounds: [40, 200 + i * 80, 1040, 260 + i * 80] })),
      ...buttons.map((t, i) => node({ text: t, clickable: true, className: 'android.widget.Button', bounds: [100 + i * 300, 1800, 360 + i * 300, 1900] })),
      ...Array.from({ length: 6 }, (_, i) => node({ text: `Row ${i}`, bounds: [40, 900 + i * 80, 1040, 960 + i * 80] })),
    ],
  });
}

const model = (root: UiNodeSnapshot) => buildScreenModel(root);

describe('findObstacle', () => {
  it('dismisses "rate this app" with the choice that keeps options open', () => {
    const m = findObstacle(model(screen(['Enjoying Reddit?', 'Rate this app'], ['Rate now', 'Not now'])), 'com.reddit.frontpage');
    expect(m?.rule.id).toBe('rate_app');
    expect(m?.element.label).toBe('Not now');
  });

  it('grants a permission for the least lasting time on offer', () => {
    const m = findObstacle(model(screen(['Allow Camera to take pictures?'], ['While using the app', 'Only this time', "Don't allow"])), 'com.google.android.permissioncontroller');
    expect(m?.element.label).toBe('While using the app');
  });

  it('leaves an obstacle alone when the task is about it', () => {
    const update = model(screen(['Update available', 'A new version of the app is ready'], ['Update', 'Not now']));
    expect(findObstacle(update, 'com.whatsapp', 'open whatsapp')?.rule.id).toBe('app_update');
    expect(findObstacle(update, 'com.whatsapp', 'update whatsapp to the latest version')).toBeNull();
  });

  it('needs the obstacle wording AND an exact button, so an ordinary "Not now" is never pressed', () => {
    expect(findObstacle(model(screen(['Your orders', 'Track package'], ['Not now', 'Continue'])), 'in.amazon.mShop.android.shopping')).toBeNull();
    // "Retry" alone is not enough; a network error has to be on screen.
    expect(findObstacle(model(screen(['Payment pending'], ['Retry'])), 'com.bank')).toBeNull();
    expect(findObstacle(model(screen(['No internet connection', 'Check your connection'], ['Retry'])), 'com.bank')?.rule.id).toBe('network_retry');
  });

  it('only acts on permission dialogs from the system permission screen', () => {
    expect(findObstacle(model(screen(['Allow us to track you?'], ['Allow'])), 'com.some.app')).toBeNull();
  });
});

describe('install rule for the completion check', () => {
  it('applies to a plain install request only', () => {
    expect(ruleFor('Install WhatsApp')).toBe('install');
    expect(ruleFor('whatsapp install karo')).toBe('install');
    expect(ruleFor('Install Reddit from the Play Store')).toBe('install');
    expect(ruleFor('Install Reddit and sign in')).toBeNull();
    expect(ruleFor('Open the Play Store, search for Reddit and install it')).toBeNull();
  });

  it('verifies from the phone\'s app list, and not on a partial name match', async () => {
    const check = (goal: string, apps: { label: string; packageName: string }[]) =>
      verifyCompletion({ goal, summary: 'done', observe: async () => ({ packageName: 'com.android.vending', tree: '' }), listApps: async () => apps });
    expect((await check('Install Reddit', [{ label: 'Reddit', packageName: 'com.reddit.frontpage' }])).status).toBe('verified');
    // "Phone" is installed, "Phone Cleaner" is what was asked for: no rule verdict.
    expect((await check('Install Phone Cleaner', [{ label: 'Phone', packageName: 'com.android.dialer' }])).status).toBe('unverified');
  });
});

// ---------------------------------------------------------------------------
// Agent level: a scripted phone
// ---------------------------------------------------------------------------

interface Script {
  /** What ObserveScreen returns next; the last one repeats. */
  screens: { pkg: string; root: UiNodeSnapshot }[];
  /** Advance to the next screen on a Tap. */
  tapAdvances?: boolean;
  apps: () => string;
  openUrlPkg?: string;
}

function scriptedPhone(script: Script) {
  let index = 0;
  const actions: { type: string; [k: string]: unknown }[] = [];
  const gateway = {
    executeAction: jest.fn(async (_hw: string, action: { type: string; [k: string]: unknown }) => {
      actions.push(action);
      if (action.type === 'ObserveScreen') {
        const s = script.screens[Math.min(index, script.screens.length - 1)];
        return { status: 'SUCCESS', uiTree: { packageName: s.pkg, root: s.root }, screenCapture: { base64Data: 'AAAA' } };
      }
      if (action.type === 'ListApps') return { status: 'SUCCESS', summary: script.apps() };
      if (action.type === 'Tap' && script.tapAdvances !== false) index += 1;
      if (action.type === 'OpenUrl') index += 1;
      return { status: 'SUCCESS', summary: `${action.type} done` };
    }),
  };
  return { gateway, actions };
}

const tool = (agent: AndroidAgent, name: string) =>
  (agent as unknown as { tools: { name: string; execute: (a: Record<string, unknown>, c: unknown, t: unknown) => Promise<{ content: { type: string; text?: string }[]; isError?: boolean }> }[] }).tools.find((t) => t.name === name)!;
const text = (r: { content: { type: string; text?: string }[] }) => r.content.map((c) => c.text ?? '').join('\n');

describe('AndroidAgent obstacles', () => {
  it('clears a popup before the model sees the screen, and reports it as a recovery', async () => {
    const popup = screen(['Enjoying Reddit?', 'Rate this app'], ['Rate now', 'Not now']);
    const feed = screen(['Home', 'Popular'], ['Search']);
    const phone = scriptedPhone({ screens: [{ pkg: 'com.reddit.frontpage', root: popup }, { pkg: 'com.reddit.frontpage', root: feed }], apps: () => '' });
    const recoveries: string[] = [];
    const agent = new AndroidAgent(phone.gateway as never, 'hw', { onRecovery: (id) => recoveries.push(id) });
    const out = text(await tool(agent, 'read_ui_tree').execute({}, {}, {}));
    expect(out).toMatch(/AUTO-CLEARED: "Rate this app" prompt \(pressed "Not now"\)/);
    expect(out).toMatch(/\|Search\|/);
    expect(out).not.toMatch(/Rate now/);
    expect(recoveries).toEqual(['rate_app']);
  });

  it('does not press the same rule again when it did not change the screen', async () => {
    const popup = screen(['Enjoying Reddit?', 'Rate this app'], ['Rate now', 'Not now']);
    const phone = scriptedPhone({ screens: [{ pkg: 'com.reddit.frontpage', root: popup }], tapAdvances: false, apps: () => '' });
    const agent = new AndroidAgent(phone.gateway as never, 'hw');
    const first = text(await tool(agent, 'read_ui_tree').execute({}, {}, {}));
    expect(first).toMatch(/nothing changed — deal with it yourself/);
    await tool(agent, 'read_ui_tree').execute({}, {}, {});
    expect(phone.actions.filter((a) => a.type === 'Tap')).toHaveLength(1);
  });
});

describe('install_app', () => {
  beforeEach(() => jest.useFakeTimers({ advanceTimers: 200 }));
  afterEach(() => jest.useRealTimers());

  const listing = (button: string) => screen(['Reddit', 'Reddit Inc.', '4.2 star'], [button]);

  it('opens the listing, presses Install once and reports it only when the phone lists the app', async () => {
    let installed = false;
    let lists = 0;
    const phone = scriptedPhone({
      screens: [
        { pkg: 'com.android.launcher3', root: screen(['Home'], []) },
        { pkg: 'com.android.vending', root: listing('Install') },
        { pkg: 'com.android.vending', root: listing('Cancel') },
      ],
      apps: () => {
        lists += 1;
        if (lists >= 3) installed = true;
        return installed ? 'Reddit | com.reddit.frontpage\nChrome | com.android.chrome' : 'Chrome | com.android.chrome';
      },
    });
    const agent = new AndroidAgent(phone.gateway as never, 'hw');
    const res = await tool(agent, 'install_app').execute({ packageName: 'com.reddit.frontpage', appName: 'Reddit' }, {}, {});
    expect(res.isError).toBeFalsy();
    expect(text(res)).toMatch(/VERIFIED: Reddit \(com\.reddit\.frontpage\) is installed — the phone lists it/);
    expect(phone.actions.find((a) => a.type === 'OpenUrl')?.url).toBe('https://play.google.com/store/apps/details?id=com.reddit.frontpage');
    expect(phone.actions.filter((a) => a.type === 'Tap')).toHaveLength(1);
  }, 20_000);

  it('gets past Play\'s "Complete account setup" sheet (Continue, then Skip) instead of handing off', async () => {
    const phone: ReturnType<typeof scriptedPhone> = scriptedPhone({
      screens: [
        { pkg: 'com.android.launcher3', root: screen(['Home'], []) },
        { pkg: 'com.android.vending', root: listing('Install') },
        { pkg: 'com.android.vending', root: screen(['Complete account setup', 'Review your account to continue installing apps on Google Play'], ['Continue']) },
        { pkg: 'com.android.vending', root: screen(['Add card', 'Add PayPal', 'Redeem code'], ['Skip']) },
        { pkg: 'com.android.vending', root: listing('Cancel') },
      ],
      // Installed only once Install, Continue and Skip have all been pressed.
      apps: () => (phone.actions.filter((a) => a.type === 'Tap').length >= 3 ? 'Reddit | com.reddit.frontpage' : ''),
    });
    const agent = new AndroidAgent(phone.gateway as never, 'hw');
    const res = await tool(agent, 'install_app').execute({ packageName: 'com.reddit.frontpage', appName: 'Reddit' }, {}, {});
    expect(text(res)).not.toMatch(/hand this step to the user/i);
    expect(res.isError).toBeFalsy();
    expect(text(res)).toMatch(/VERIFIED: Reddit/);
    expect(phone.actions.filter((a) => a.type === 'Tap')).toHaveLength(3);
  }, 60_000);

  it('does nothing when the app is already installed', async () => {
    const phone = scriptedPhone({ screens: [{ pkg: 'com.android.launcher3', root: screen(['Home'], []) }], apps: () => 'Reddit | com.reddit.frontpage' });
    const agent = new AndroidAgent(phone.gateway as never, 'hw');
    const res = await tool(agent, 'install_app').execute({ packageName: 'com.reddit.frontpage' }, {}, {});
    expect(text(res)).toMatch(/already installed/);
    expect(phone.actions.some((a) => a.type === 'OpenUrl' || a.type === 'Tap')).toBe(false);
  });

  it('never buys a paid app', async () => {
    const phone = scriptedPhone({
      screens: [{ pkg: 'com.android.launcher3', root: screen(['Home'], []) }, { pkg: 'com.android.vending', root: listing('₹49.00') }],
      apps: () => '',
    });
    const agent = new AndroidAgent(phone.gateway as never, 'hw');
    const res = await tool(agent, 'install_app').execute({ packageName: 'com.paid.app' }, {}, {});
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/paid app/);
    expect(phone.actions.some((a) => a.type === 'Tap')).toBe(false);
  }, 20_000);

  it('rejects an app name where a package name belongs', async () => {
    const phone = scriptedPhone({ screens: [{ pkg: 'x', root: screen([], []) }], apps: () => '' });
    const agent = new AndroidAgent(phone.gateway as never, 'hw');
    const res = await tool(agent, 'install_app').execute({ packageName: 'WhatsApp' }, {}, {});
    expect(res.isError).toBe(true);
    expect(phone.actions).toHaveLength(0);
  });
});
