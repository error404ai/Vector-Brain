import type { ScreenElement, ScreenModel } from './screenModel';

/**
 * Known obstacles cleared by rule, before any model call is spent on them
 * (docs/RELIABILITY.md → Recovery engine).
 *
 * Each rule is deliberately narrow: it needs the obstacle's own wording on
 * screen AND one of a few exact button labels, and it always picks the
 * choice that keeps the user's options open (Not now, Later, No thanks). A
 * rule that is not sure does nothing; the agent then sees the screen as
 * before. Nothing here pays, deletes, signs in or sends.
 */

export type ObstacleId =
  | 'permission'
  | 'rate_app'
  | 'app_update'
  | 'not_responding'
  | 'app_crashed'
  | 'chrome_setup'
  | 'cookie_banner'
  | 'privacy_consent'
  | 'chrome_password'
  | 'site_notifications'
  | 'sign_in_nag'
  | 'play_account_setup'
  | 'network_retry'
  | 'skip_ad';

export interface ObstacleRule {
  id: ObstacleId;
  label: string;
  /** Package in front must match, when set. */
  packages?: RegExp;
  /** Some text on screen (any row) must match, when set. */
  text?: RegExp;
  /** Button labels to press, best first; compared whole, ignoring case. */
  press: string[];
  /** Skip the rule when the task itself is about this (e.g. "update WhatsApp"). */
  unlessTask?: RegExp;
  /** When none of `press` is on screen: a button whose whole label only closes the notice. */
  closeLike?: RegExp;
  /** The notice can be taller than the screen with its buttons below: scroll it to find them. */
  scrollToButtons?: boolean;
}

/** Browsers and in-app web views, where web pages put their notices. */
const BROWSERS = /chrome|browser|firefox|sbrowser|opera|edge|brave|\.webview|dev\.tarung/;

/**
 * Labels that only close a notice or banner. Oct 12, #3863/#3864: Blogger's EU
 * cookie notice had one way out, "Cancel notification button.", and a free model
 * tapped the notice text 9 times instead.
 */
export const CLOSE_NOTICE =
  /^(?:close|dismiss|cancel notification(?: button)?|close (?:notice|banner|notification|message|announcement|dialog|pop-?up|this)|dismiss (?:notice|banner|notification|message|announcement)|hide (?:notice|banner)|×|✕|x)\.?$/i;

export const OBSTACLE_RULES: ObstacleRule[] = [
  {
    id: 'permission',
    label: 'Permission request',
    packages: /permissioncontroller|packageinstaller/,
    // Least lasting grant first. Refusing would break the task that needs it.
    press: ['While using the app', 'Only this time', 'Allow', 'Allow only while using the app'],
  },
  {
    id: 'rate_app',
    label: '"Rate this app" prompt',
    text: /\b(rate (this app|us|the app)|enjoying\b|how would you rate|leave (us )?a review|love .{1,30}\?)/i,
    press: ['Not now', 'Maybe later', 'Later', 'No thanks', 'Remind me later', 'Not really', 'No, thanks'],
    unlessTask: /\b(rate|review|rating|stars?)\b/i,
  },
  {
    id: 'app_update',
    label: '"Update available" prompt',
    text: /\b(update available|new version|update (the |this )?app|time to update|app update)\b/i,
    press: ['Not now', 'Later', 'Skip', 'No thanks', 'Remind me later', 'Not Now'],
    unlessTask: /\b(update|upgrade)\b/i,
  },
  {
    id: 'not_responding',
    label: '"App isn\'t responding" dialog',
    text: /(isn['’]t responding|is not responding|not responding)/i,
    press: ['Wait'],
  },
  {
    id: 'app_crashed',
    label: 'App crash dialog',
    text: /(keeps stopping|has stopped|unfortunately,? .{1,40} stopped)/i,
    press: ['Close app', 'OK', 'Close'],
  },
  {
    id: 'chrome_setup',
    label: 'Chrome first-run / sync prompt',
    packages: /^com\.(android\.chrome|chrome\.beta)$/,
    text: /(sign in to chrome|turn on sync|welcome to chrome|use without an account|chrome notifications|make chrome your own|search engine)/i,
    press: ['Use without an account', 'No thanks', 'No, thanks', 'Not now', 'Skip'],
  },
  {
    // A whole-page privacy notice ("We value your privacy", the IAB consent dialog) whose
    // buttons sit below a long text, off the screen. Oct 15: whatismyipaddress.com on a
    // Xiaomi showed only the text; the run tapped and scrolled it until "got stuck"
    // (#3984 before it: 15 steps on the same notice).
    id: 'privacy_consent',
    label: 'Privacy / consent notice',
    packages: BROWSERS,
    text: /we value your privacy|your privacy (?:choices|matters|is important)|privacy (?:choices|preferences)|manage (?:your )?(?:options|preferences|consent)|do not consent|consent to (?:our|the) (?:use|processing)|personali[sz]ed (?:ads|advertising) and content/i,
    // The least tracking choice when there is one; otherwise agree, which only lets the page show.
    press: ['Do not consent', 'Reject all', 'Reject All', 'Decline all', 'Only necessary', 'Necessary only', 'Disagree', 'Consent', 'Accept all', 'Accept All', 'Agree', 'I agree', 'AGREE', 'Accept', 'Allow all'],
    closeLike: CLOSE_NOTICE,
    unlessTask: /\b(consent|privacy settings|cookies?)\b/i,
    scrollToButtons: true,
  },
  {
    id: 'chrome_password',
    label: 'Chrome password prompt',
    packages: /^com\.(android\.chrome|chrome\.beta)$/,
    text: /save password\?|update password\?|change your password|password (?:was )?(?:found )?in a data breach|compromised password/i,
    press: ['Never', 'No thanks', 'No, thanks', 'Not now', 'Close'],
    closeLike: CLOSE_NOTICE,
    unlessTask: /\bpasswords?\b/i,
  },
  {
    id: 'site_notifications',
    label: 'Website notification request',
    packages: BROWSERS,
    text: /wants to (?:show|send) (?:you )?notifications|allow notifications\?|turn on notifications|get notified/i,
    press: ['Block', "Don't allow", 'Never allow', 'No thanks', 'No, thanks', 'Not now', 'Later'],
    unlessTask: /\bnotifications?\b/i,
  },
  {
    // A site or app asking to sign in before it shows the page. Never signs in: only skips.
    id: 'sign_in_nag',
    label: 'Sign-in prompt',
    text: /sign in for the best experience|tap here to (?:log ?in|sign ?in)|(?:log ?in|sign ?in) to continue|continue as (?:a )?guest|skip sign[ -]?in/i,
    press: ['Skip sign in', 'Skip sign-in', 'Continue as guest', 'Continue as a guest', 'Not now', 'Maybe later', 'No thanks', 'Skip'],
    closeLike: CLOSE_NOTICE,
    unlessTask: /\b(log ?in|sign ?in|login|signin|account)\b/i,
  },
  {
    // Play's sheet that stops an install. Continue only leads to the payment choices
    // below, where Skip adds nothing. install_app handles it inside an install; this
    // covers the sheet anywhere else. Adds no card and changes no account setting.
    id: 'play_account_setup',
    label: 'Play "Complete account setup" sheet',
    packages: /^com\.android\.vending$/,
    text: /complete account setup|review your account to continue/i,
    press: ['Skip', 'Not now', 'Continue'],
    unlessTask: /\b(payment|card|paypal|redeem|gift card|account setup)\b/i,
  },
  {
    // The payment choices that sheet leads to: only ever skipped.
    id: 'play_account_setup',
    label: 'Play payment choices after account setup',
    packages: /^com\.android\.vending$/,
    text: /^add (?:a )?(?:card|credit or debit card|paypal)\b/im,
    press: ['Skip'],
    unlessTask: /\b(payment|card|paypal|redeem|gift card|account setup)\b/i,
  },
  {
    id: 'cookie_banner',
    label: 'Cookie banner',
    packages: BROWSERS,
    // Labels are cut at 60 characters, so "cookies" can be past the cut: the EU notice's own words count too.
    text: /\bcookies?\b|european union (?:laws?|visitors?)|\bEU (?:laws?|cookie)|^notices? \(\d+\)$/im,
    // The least tracking choice when there is one; otherwise just close it.
    press: ['Reject all', 'Reject All', 'Only necessary', 'Necessary only', 'Decline', 'Accept all', 'Accept All', 'Accept', 'I agree', 'Got it', 'OK'],
    closeLike: CLOSE_NOTICE,
    unlessTask: /\bcookies?\b/i,
  },
  {
    id: 'network_retry',
    label: 'Network error',
    text: /(no internet|no connection|connection (error|failed|lost|problem)|network error|check your (internet |network )?connection|couldn['’]t connect|you['’]re offline|something went wrong)/i,
    press: ['Retry', 'Try again', 'RETRY', 'TRY AGAIN', 'Reload'],
  },
  {
    id: 'skip_ad',
    label: 'Skippable ad',
    press: ['Skip ad', 'Skip ads', 'Skip Ad', 'Skip Ads'],
    unlessTask: /\b(watch|view) (the |an |full )?ads?\b/i,
  },
];

export interface ObstacleMatch {
  rule: ObstacleRule;
  element: ScreenElement;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * A notice whose wording is on screen but none of whose buttons are (they are below
 * its long text): the rule to scroll it for, or null.
 */
export function noticeWithoutButtons(screen: ScreenModel | null, packageName: string | null, task = ''): ObstacleRule | null {
  if (!screen?.elements.length) return null;
  const allText = screen.elements.map((e) => e.label).join('\n');
  for (const rule of OBSTACLE_RULES) {
    if (!rule.scrollToButtons || !rule.text) continue;
    if (rule.unlessTask && rule.unlessTask.test(task)) continue;
    if (rule.packages && !rule.packages.test(packageName ?? '')) continue;
    if (rule.text.test(allText)) return rule;
  }
  return null;
}

/**
 * The first obstacle this screen shows, with the button to press, or null.
 * `task` is the user's instruction; rules the task is about are skipped.
 */
export function findObstacle(screen: ScreenModel | null, packageName: string | null, task = ''): ObstacleMatch | null {
  if (!screen?.elements.length) return null;
  const pkg = packageName ?? '';
  const allText = screen.elements.map((e) => e.label).join('\n');
  for (const rule of OBSTACLE_RULES) {
    if (rule.unlessTask && rule.unlessTask.test(task)) continue;
    if (rule.packages && !rule.packages.test(pkg)) continue;
    if (rule.text && !rule.text.test(allText)) continue;
    for (const choice of rule.press) {
      const want = norm(choice);
      const element = screen.elements.find((e) => !e.seen && !e.disabled && e.tappable && norm(e.label) === want);
      if (element) return { rule, element };
    }
    if (rule.closeLike) {
      const element = screen.elements.find((e) => !e.seen && !e.disabled && e.tappable && rule.closeLike!.test(norm(e.label)));
      if (element) return { rule, element };
    }
  }
  return null;
}
