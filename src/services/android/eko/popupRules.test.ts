import type { UiNodeSnapshot } from '../AndroidProtocol';
import { AndroidAgent } from './AndroidAgent';
import { findObstacle, noticeWithoutButtons } from './obstacles';
import { buildScreenModel } from './screenModel';

let n = 0;
const node = (over: Partial<UiNodeSnapshot> & { box: [number, number, number, number] }): UiNodeSnapshot => {
  const { box, ...rest } = over;
  return { path: String(n++), bounds: { left: box[0], top: box[1], right: box[2], bottom: box[3] }, clickable: false, editable: false, enabled: true, children: [], ...rest };
};

/** Text lines from the top, then buttons in a row near the bottom. */
function screen(lines: string[], buttons: string[] = []): UiNodeSnapshot {
  return node({
    box: [0, 0, 1080, 2400],
    children: [
      ...lines.map((t, i) => node({ text: t, box: [40, 120 + i * 90, 1040, 190 + i * 90] })),
      ...buttons.map((t, i) => node({ text: t, clickable: true, className: 'android.widget.Button', box: [60 + i * 340, 2150, 380 + i * 340, 2260] })),
    ],
  });
}
const model = (root: UiNodeSnapshot) => buildScreenModel(root);
const CHROME = 'com.android.chrome';

/** The whatismyipaddress notice of Oct 15: a long text, its buttons below it. */
const CONSENT_TEXT = [
  'We value your privacy',
  'We and our 1748 partners store and/or access information on a device',
  'such as cookies and process personal data, such as unique identifiers',
  'Personalised advertising and content, advertising and content measurement',
  'You may click to consent to our and our partners processing as described above',
];

describe('popup rules', () => {
  it('a privacy notice: the least tracking choice', () => {
    const m = findObstacle(model(screen(CONSENT_TEXT, ['Consent', 'Do not consent', 'Manage options'])), CHROME);
    expect(m?.rule.id).toBe('privacy_consent');
    expect(m?.element.label).toBe('Do not consent');
  });

  it('a privacy notice whose buttons are below the screen is found by its wording', () => {
    expect(noticeWithoutButtons(model(screen(CONSENT_TEXT)), CHROME)?.id).toBe('privacy_consent');
    // Not in another app, and not when the task is about privacy settings.
    expect(noticeWithoutButtons(model(screen(CONSENT_TEXT)), 'com.whatsapp')).toBeNull();
    expect(noticeWithoutButtons(model(screen(CONSENT_TEXT)), CHROME, 'open the site and change its privacy settings')).toBeNull();
  });

  it('a page that only mentions privacy is not a notice', () => {
    const page = model(screen(['Privacy policy', 'Terms of use', 'Your account'], ['Accept', 'OK']));
    expect(findObstacle(page, CHROME)).toBeNull();
    expect(noticeWithoutButtons(page, CHROME)).toBeNull();
  });

  it("Chrome's password prompts are declined, unless the task is about passwords", () => {
    const save = model(screen(['Save password?', 'standard_user'], ['Never', 'Save']));
    expect(findObstacle(save, CHROME)?.element.label).toBe('Never');
    expect(findObstacle(model(screen(['Change your password', 'A data breach on a site exposed your password'], ['Check passwords', 'Close'])), CHROME)?.element.label).toBe('Close');
    expect(findObstacle(save, CHROME, 'save the password for this site')).toBeNull();
  });

  it('a website asking to send notifications is blocked', () => {
    const m = findObstacle(model(screen(['example.com wants to show notifications'], ['Block', 'Allow'])), CHROME);
    expect(m?.rule.id).toBe('site_notifications');
    expect(m?.element.label).toBe('Block');
  });

  it('a sign-in nag is skipped, never signed in, and left alone when the task is to sign in', () => {
    const nag = model(screen(['Sign in for the best experience', 'Sign in securely'], ['Sign in', 'Continue as guest']));
    expect(findObstacle(nag, 'in.amazon.mShop.android.shopping')?.element.label).toBe('Continue as guest');
    expect(findObstacle(nag, 'in.amazon.mShop.android.shopping', 'log in to amazon and open orders')).toBeNull();
  });

  it("Play's account setup: Skip when offered, Continue to reach it, Skip on the payment choices; nothing for payment tasks", () => {
    const sheet = model(screen(['Complete account setup', 'Review your account to continue installing apps on Google Play'], ['Continue']));
    expect(findObstacle(sheet, 'com.android.vending')?.element.label).toBe('Continue');
    const pay = model(screen(['Add credit or debit card', 'Add PayPal', 'Redeem code'], ['Skip']));
    expect(findObstacle(pay, 'com.android.vending')?.element.label).toBe('Skip');
    expect(findObstacle(pay, 'com.android.vending', 'add a payment method in play store')).toBeNull();
    // The Play home page with its own "Continue" is not touched.
    expect(findObstacle(model(screen(['For you', 'Top charts'], ['Continue'])), 'com.android.vending')).toBeNull();
  });
});

type Tools = { tools: { name: string; execute: (a: Record<string, unknown>, c: unknown, t: unknown) => Promise<{ content: { text?: string }[]; isError?: boolean }> }[] };

/** A phone on Chrome with the consent notice; `buttonsAfter` scrolls bring its buttons up (never, when null). */
function consentPhone(buttonsAfter: number | null, features: string[] = ['gesture']) {
  let scrolls = 0;
  let dismissed = false;
  const exec = jest.fn(async (_hw: string, action: Record<string, unknown>) => {
    if (action.type === 'ObserveScreen' || action.type === 'ReadUiTree') {
      const root = dismissed
        ? screen(['My IP Address is:', '81.2.69.160', 'Location: London, United Kingdom'])
        : buttonsAfter !== null && scrolls >= buttonsAfter
        ? screen([...CONSENT_TEXT.slice(2), `More text ${scrolls}`], ['Consent', 'Do not consent'])
        : screen([...CONSENT_TEXT.slice(scrolls > 0 ? 1 : 0), ...(scrolls > 0 ? [`More text ${scrolls}`] : [])]);
      return { status: 'SUCCESS', uiTree: { packageName: CHROME, root } };
    }
    if (action.type === 'Gesture' || action.type === 'ScrollNode') scrolls += 1;
    if (action.type === 'Tap') dismissed = true;
    return { status: 'SUCCESS', summary: `${String(action.type)} done` };
  });
  const gateway = { executeAction: exec, hasFeature: (_: string, f: string) => features.includes(f) };
  const agent = new AndroidAgent(gateway as never, 'hw', undefined, {});
  const tools = (agent as unknown as Tools).tools;
  const run = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await tools.find((t) => t.name === name)!.execute(args, {}, {});
    return r.content.map((c) => c.text ?? '').join('');
  };
  return { exec, run };
}

describe('a long privacy notice before the model sees the page', () => {
  it('is scrolled to its buttons, declined, and the page behind it is what the model gets', async () => {
    const p = consentPhone(2);
    const out = await p.run('read_ui_tree');
    expect(p.exec.mock.calls.filter(([, a]) => a.type === 'Gesture')).toHaveLength(2);
    expect(out).toMatch(/scrolled it to them/);
    expect(out).toMatch(/AUTO-CLEARED: Privacy \/ consent notice \(pressed "Do not consent"\)/);
    expect(out).toMatch(/Location: London/);
  }, 20_000);

  it('older phones scroll it with the list scroll', async () => {
    const p = consentPhone(1, []);
    const out = await p.run('read_ui_tree');
    expect(p.exec.mock.calls.some(([, a]) => a.type === 'ScrollNode')).toBe(true);
    expect(out).toMatch(/AUTO-CLEARED: Privacy \/ consent notice/);
  }, 20_000);

  it('when its buttons never show, the model is told to close it first, and it is not scrolled again on every step', async () => {
    const p = consentPhone(null);
    const out = await p.run('read_ui_tree');
    expect(out).toMatch(/buttons could not be found by scrolling it\. Close it before anything else/);
    const first = p.exec.mock.calls.filter(([, a]) => a.type === 'Gesture').length;
    expect(first).toBeLessThanOrEqual(4);
    await p.run('read_ui_tree');
    await p.run('read_ui_tree');
    await p.run('read_ui_tree');
    expect(p.exec.mock.calls.filter(([, a]) => a.type === 'Gesture').length).toBeLessThanOrEqual(12);
  }, 30_000);
});
