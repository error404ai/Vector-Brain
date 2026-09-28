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
}

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
    id: 'cookie_banner',
    label: 'Cookie banner',
    packages: /chrome|browser|firefox|sbrowser|opera|edge|brave|\.webview|dev\.tarung/,
    text: /\bcookies?\b/i,
    // The least tracking choice when there is one; otherwise just close it.
    press: ['Reject all', 'Reject All', 'Only necessary', 'Necessary only', 'Decline', 'Accept all', 'Accept All', 'Accept', 'I agree', 'Got it', 'OK'],
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
  }
  return null;
}
