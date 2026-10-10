import type { VerificationOutcome } from './AgentEngine';

/**
 * The system's own check of a task the agent reported as done.
 *
 * Two levels, cheapest first:
 * - rule: things the phone can prove without a model — "open example.com" means
 *   the screen shows that address; "open X" means X is in
 *   the foreground; "close X" means X is no longer on screen; "install X"
 *   means the phone's app list has X (not found by name → the judge decides). Applied only
 *   when the whole task is that one action, so "open YouTube and play lofi"
 *   is never marked verified just because YouTube is open.
 * - judge: a separate, small model call that compares the goal with the
 *   final screen. It is a model too and can be wrong, which is why the result
 *   can be "unverified" rather than a forced yes/no.
 */

export interface ScreenState {
  packageName: string | null;
  /** The agent's formatted element list for the final screen. */
  tree: string;
}

export interface VerifyInput {
  goal: string;
  summary: string;
  observe: () => Promise<ScreenState | null>;
  /** "Label | package" pairs of the phone's launchable apps. */
  listApps: () => Promise<{ label: string; packageName: string }[]>;
  judge?: (prompt: string) => Promise<string>;
  /** The run's steps as one line each, for goals the final screen alone cannot prove (visit 10 sites, send then close). */
  steps?: string[];
  /** Actions counted by code (countActions): the judge uses these instead of counting lines itself. */
  counts?: string;
  /** The same counts as numbers, for the goal's own numbers ("visit 10 sites", "scroll 5 times"). */
  tally?: RunTally;
}

/** What the run did, counted by code from its steps. */
export interface RunTally {
  /** open_url calls that succeeded. */
  openUrl: number;
  /** swipe and scroll_element calls that succeeded. */
  scrolls: number;
  /** Buttons a tap turned into something else ("Follow" → "Following"). */
  changes: { from: string; to: string }[];
}

const NUMBER_WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20 };
const NUM = `(\\d{1,3}|${Object.keys(NUMBER_WORDS).join('|')})`;
const toNumber = (t: string) => NUMBER_WORDS[t.toLowerCase()] ?? Number(t);
/**
 * Up to N words between a verb and its number, never across a clause: no
 * comma or full stop, no "and/then", no other action verb. "scroll through
 * Reels, and like 2 posts" asked for no scrolls; the old gap read it as
 * "scroll 2" and failed a correct run (Oct 10, #3485).
 */
const STOP_WORDS = 'and|then|or|but|after|before|aur|phir|fir|like|follow|comment|share|subscribe|save|join|connect|watch|play|open|visit|browse|tap|click|search|type|post|send|scroll|swipe|install|close';
const GAP = (n: number) => `(?:[^\\w,;.!?\\n]+(?!(?:${STOP_WORDS})\\b)\\w+){0,${n}}?[^\\w,;.!?\\n]+`;
/** "visit 10 random websites", "open 5 sites", "browse three pages". */
const SITES = new RegExp(`\\b(?:visit|open|browse|load|go\\s+to)\\b${GAP(4)}${NUM}\\s+(?:[\\w-]+\\s+){0,2}?(?:websites?|web\\s*sites?|sites?|web\\s*pages?|pages?|urls?|links?)\\b`, 'gi');
/** "scroll through Reels 5 times", "swipe 10 shorts", "scroll down 3 times". */
const SCROLLS = new RegExp(`\\b(?:scroll|swipe)\\b${GAP(4)}${NUM}\\s+(?:[\\w-]+\\s+){0,2}?(?:times|reels?|videos?|posts?|shorts?|stories|photos?|items?|tweets?|pins?)\\b`, 'gi');
/** "follow 3 people", "like 5 posts", "subscribe to 2 channels": a button a tap turns into its done state. */
const BUTTONS = new RegExp(`\\b(follow|like|subscribe|join|save|connect)\\b${GAP(3)}${NUM}\\b`, 'gi');

/**
 * The goal's own numbers against what the system counted. "short": counts the
 * phone proves (pages opened, scrolls) that fall below the goal — the task is
 * not done, whatever a model thinks. "met": counts that are reached, said to the
 * judge so it does not recount (Oct 10: the judge passed 8 of 10 sites and 4 of
 * 5 swipes, and failed a run with 13 different sites as "only 9").
 * Button changes are only evidence: a tap that opened a profile first is not
 * seen as a change, so they never fail a run on their own.
 */
export function countChecks(goal: string, tally: RunTally): { short: string[]; met: string[] } {
  const short: string[] = [];
  const met: string[] = [];
  for (const m of goal.matchAll(SITES)) {
    const want = toNumber(m[1]);
    (tally.openUrl >= want ? met : short).push(`pages opened (open_url): ${tally.openUrl} of ${want}`);
  }
  for (const m of goal.matchAll(SCROLLS)) {
    const want = toNumber(m[1]);
    (tally.scrolls >= want ? met : short).push(`scrolls (swipe/scroll_element): ${tally.scrolls} of ${want}`);
  }
  for (const m of goal.matchAll(BUTTONS)) {
    const verb = m[1].toLowerCase();
    const want = toNumber(m[2]);
    const done = tally.changes.filter((c) => c.from.toLowerCase().split(/\s+/)[0] === verb).length;
    if (done >= want) met.push(`"${m[1]}" buttons changed by taps: ${done} of ${want}`);
  }
  return { short, met };
}

const INSTALL = /\b(install|download|daal(?:o|do)?|dalo)\b/i;
/** Words that come with an install request without asking for anything more. */
const INSTALL_FILLER = /\b(the|app|application|from|on|play\s*store|google\s*play|store|please|kar(?:o|do|na)?|karke|this|phone|device)\b/gi;
const OPEN = /\b(open|launch|start|khol(?:o|na|do)?|chalu\s+kar(?:o|do)?)\b/i;
const CLOSE = /\b(close|stop|force[\s-]?stop|kill|quit|exit|band\s+kar(?:o|do|na)?|hata(?:o|do)?)\b/i;
/** Anything past a single open/close means the task asks for more than the rule can prove. */
const MORE = /\b(and|then|after|search|play|type|send|write|post|install|sign|log\s*in|scroll|find|watch|like|comment|share|download|aur|phir|fir)\b|[,;]/i;

export function parseAppList(text: string): { label: string; packageName: string }[] {
  const apps: { label: string; packageName: string }[] = [];
  for (const line of String(text ?? '').split('\n')) {
    const match = /^(.+?)\s*\|\s*([a-zA-Z][\w.]+)\s*$/.exec(line.trim());
    if (match) apps.push({ label: match[1].trim(), packageName: match[2] });
  }
  return apps;
}

/**
 * The app the goal names: the launcher label that comes first in it as whole
 * words; of labels starting at the same place, the longest ("YouTube Music"
 * over "YouTube"). First, not longest overall: "force stop Chrome from the app
 * settings" names Chrome, and picking "Settings" for being longer failed 24
 * correct runs (Oct 10, missions 269–270).
 */
export function appNamedIn(goal: string, apps: { label: string; packageName: string }[]): { label: string; packageName: string } | null {
  const text = goal.toLowerCase();
  let best: { label: string; packageName: string; at: number } | null = null;
  for (const app of apps) {
    const label = app.label.toLowerCase().trim();
    if (label.length < 2) continue;
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').exec(text);
    if (!match) continue;
    const at = match.index + match[1].length;
    if (!best || at < best.at || (at === best.at && label.length > best.label.length)) best = { ...app, at };
  }
  return best ? { label: best.label, packageName: best.packageName } : null;
}

/** The part of a close goal that names what to close: its last clause, from the close word on. */
export function closeTarget(goal: string): string {
  const last = lastClause(goal.replace(/\(.*?\)/g, ' '));
  const match = CLOSE.exec(last);
  return match ? last.slice(match.index) : last;
}

/**
 * Things inside an app that get "closed" while the app stays open. "Close all
 * tabs, leaving one new tab open" ends with Chrome on screen by design; the
 * close rule used to read it as "close Chrome" and failed three correct runs.
 */
const NOT_THE_APP = /\b(tabs?|pop-?ups?|dialog(?:ue)?s?|windows?|ads?|adverts?|notifications?|keyboard|menus?|banners?|overlays?|sidebar|panels?|drawers?|sheets?|prompts?)\b/i;

/** The last instruction of a goal: what the final screen should reflect. */
function lastClause(text: string): string {
  const parts = text.split(/\b(?:and\s+)?then\b|\band\b|\bphir\b|\bfir\b|\baur\b|[,;.]/i).map((p) => p.trim()).filter(Boolean);
  return parts[parts.length - 1] ?? text;
}

/** Which rule, if any, can check this goal on its own. */
export function ruleFor(goal: string): 'open' | 'close' | 'install' | null {
  const stripped = goal.replace(/\(.*?\)/g, ' ');
  if (INSTALL.test(stripped) && !MORE.test(stripped.replace(INSTALL, ' ').replace(INSTALL_FILLER, ' ').replace(INSTALL, ' '))) return 'install';
  // "Close X" is provable only when closing the app itself is the last thing asked.
  const last = lastClause(stripped);
  if (
    CLOSE.test(stripped) &&
    !NOT_THE_APP.test(stripped) &&
    CLOSE.test(last) &&
    // "…, then stop" ends the task; it does not close an app (Oct 10, #3347 failed for it).
    last.replace(CLOSE, ' ').replace(/[^\p{L}\p{N}]/gu, '') !== '' &&
    !/\b(search|play|type|send|post|install)\b/i.test(stripped)
  ) return 'close';
  if (CLOSE.test(stripped)) return null;
  if (OPEN.test(stripped) && !MORE.test(stripped.replace(OPEN, ' '))) return 'open';
  return null;
}

const SITE = /\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:\/[^\s,;]*)?/i;
const SITE_WORDS = /\b(?:open|launch|visit|go\s+to|goto|load|browse|khol(?:o|na|do)?|the|a|website|web\s*site|site|page|homepage|home\s*page|url|link|in|on|with|using|chrome|browser|please|kar(?:o|do)?)\b/gi;

/**
 * The site a goal asks to open, when opening it is all the goal asks
 * ("open https://example.com", "visit wikipedia.org in Chrome"); else null.
 */
export function siteOnlyGoal(goal: string): string | null {
  const match = SITE.exec(goal);
  if (!match) return null;
  const leftover = goal.replace(match[0], ' ').replace(SITE_WORDS, ' ').replace(/[^\p{L}\p{N}]/gu, '');
  if (leftover) return null;
  return match[1].toLowerCase().replace(/^www\./, '');
}

export function judgePrompt(goal: string, summary: string, screen: ScreenState, steps: string[] = [], counts = '', met: string[] = []): string {
  const shown = steps.slice(-40);
  return [
    'You check whether an Android phone task was really completed. You see the final screen as a list of UI elements' + (shown.length ? ', and the steps the phone actually performed.' : '.'),
    'Answer with ONLY minified JSON: {"verdict":"yes"|"no"|"unsure","reason":"<one short sentence>"}',
    '"yes" only if the final screen shows the goal achieved (or the goal needed no lasting screen, like closing an app, and nothing contradicts it).' +
      (shown.length ? ' For goals made of several actions the final screen cannot show (visit several sites, send then go back), the STEPS are the evidence: count them against the goal.' : ''),
    '"no" if the screen or the steps show it was not achieved (wrong app or page, an error, a login wall, fewer actions than asked, the thing still missing).',
    'Judge what can be checked: apps, pages, counts, text. Loose words in the goal ("random", "any", "some", "a little time", "one after another") are not grounds for "no": any choice of sites or items counts as random, a page that was opened counts as visited (open_url waits for it to load), and a link that serves a new page each visit counts once per visit.',
    '"unsure" if neither can tell.',
    '',
    `GOAL: ${goal}`,
    `AGENT SAYS: ${summary}`,
    ...(counts ? [`COUNTED BY THE SYSTEM (exact, for the whole run; use these numbers, do not recount): ${counts}`] : []),
    ...(met.length ? [`THE GOAL'S NUMBERS ARE MET (checked by the system): ${met.join('; ')}. Do not answer "no" over these counts; judge only the rest of the goal.`] : []),
    ...(shown.length ? [`STEPS (${steps.length > shown.length ? `last ${shown.length} of ${steps.length}` : steps.length}):`, ...shown] : []),
    `FOREGROUND APP: ${screen.packageName ?? 'unknown'}`,
    'FINAL SCREEN:',
    screen.tree.slice(0, 6000),
  ].join('\n');
}

export function parseVerdict(text: string): { verdict: 'yes' | 'no' | 'unsure'; reason: string } {
  const match = /\{[\s\S]*\}/.exec(text ?? '');
  try {
    const parsed = JSON.parse(match ? match[0] : '{}') as { verdict?: string; reason?: string };
    const verdict = parsed.verdict === 'yes' || parsed.verdict === 'no' ? parsed.verdict : 'unsure';
    return { verdict, reason: String(parsed.reason ?? '').slice(0, 300) || 'No reason given' };
  } catch {
    return { verdict: 'unsure', reason: 'The check returned no usable answer' };
  }
}

export async function verifyCompletion(input: VerifyInput, retries = 0): Promise<VerificationOutcome> {
  const screen = await input.observe().catch(() => null);
  if (!screen) return { status: 'unverified', method: 'none', reason: 'Could not read the final screen', retries };

  // The goal's numbers, counted by code: fewer than asked is not done.
  const checks = input.tally ? countChecks(input.goal, input.tally) : { short: [], met: [] };
  if (checks.short.length) {
    return { status: 'failed', method: 'rule', reason: `Counted by the system: ${checks.short.join('; ')}. Do the rest, then call task_done again`, retries };
  }

  // "Open <site>": the address bar on the final screen shows it. Not shown
  // proves nothing (a page can hide the bar), so that goes to the judge.
  const site = siteOnlyGoal(input.goal);
  if (site && screen.tree.toLowerCase().includes(site)) {
    return { status: 'verified', method: 'rule', reason: `${site} is open (the screen shows its address)`, retries };
  }

  const rule = site ? null : ruleFor(input.goal);
  if (rule) {
    const apps = await input.listApps().catch(() => []);
    // A close goal is about the app after the close word, not one named earlier ("open YouTube, then close Chrome").
    const app = (rule === 'close' ? appNamedIn(closeTarget(input.goal), apps) : null) ?? appNamedIn(input.goal, apps);
    if (app) {
      const onScreen = screen.packageName === app.packageName;
      if (rule === 'install') {
        // "install Phone Cleaner" must not pass because "Phone" is installed:
        // the goal has to be nothing but the install words and this app's name.
        const leftover = input.goal
          .replace(/\(.*?\)/g, ' ')
          .replace(new RegExp(app.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ')
          .replace(INSTALL, ' ')
          .replace(INSTALL_FILLER, ' ')
          .replace(/[^\p{L}\p{N}]/gu, '');
        if (!leftover) return { status: 'verified', method: 'rule', reason: `${app.label} is installed (the phone lists ${app.packageName})`, retries };
      } else if (rule === 'open') {
        return onScreen
          ? { status: 'verified', method: 'rule', reason: `${app.label} is in the foreground`, retries }
          : { status: 'failed', method: 'rule', reason: `${app.label} (${app.packageName}) is not in the foreground; ${screen.packageName ?? 'another screen'} is`, retries };
      } else {
        return onScreen
          ? { status: 'failed', method: 'rule', reason: `${app.label} is still on screen`, retries }
          : { status: 'verified', method: 'rule', reason: `${app.label} is no longer on screen`, retries };
      }
    }
  }

  if (!input.judge) return { status: 'unverified', method: 'none', reason: 'No check applies to this task', retries };
  try {
    const verdict = parseVerdict(await input.judge(judgePrompt(input.goal, input.summary, screen, input.steps, input.counts, checks.met)));
    return {
      status: verdict.verdict === 'yes' ? 'verified' : verdict.verdict === 'no' ? 'failed' : 'unverified',
      method: 'judge',
      reason: verdict.reason,
      retries,
    };
  } catch (error) {
    return { status: 'unverified', method: 'judge', reason: `The check could not run: ${String((error as Error)?.message ?? error).slice(0, 120)}`, retries };
  }
}
