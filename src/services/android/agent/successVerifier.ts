import type { VerificationOutcome } from './AgentEngine';

/**
 * The system's own check of a task the agent reported as done.
 *
 * Two levels, cheapest first:
 * - rule: things the phone can prove without a model — "open X" means X is in
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

/** The app the goal names: the longest launcher label found in it as whole words. */
export function appNamedIn(goal: string, apps: { label: string; packageName: string }[]): { label: string; packageName: string } | null {
  const text = goal.toLowerCase();
  let best: { label: string; packageName: string } | null = null;
  for (const app of apps) {
    const label = app.label.toLowerCase().trim();
    if (label.length < 2) continue;
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(text) && (!best || label.length > best.label.length)) best = app;
  }
  return best;
}

/** Which rule, if any, can check this goal on its own. */
export function ruleFor(goal: string): 'open' | 'close' | 'install' | null {
  const stripped = goal.replace(/\(.*?\)/g, ' ');
  if (INSTALL.test(stripped) && !MORE.test(stripped.replace(INSTALL, ' ').replace(INSTALL_FILLER, ' ').replace(INSTALL, ' '))) return 'install';
  if (CLOSE.test(stripped) && !/\b(search|play|type|send|post|install)\b/i.test(stripped)) return 'close';
  if (OPEN.test(stripped) && !MORE.test(stripped.replace(OPEN, ' '))) return 'open';
  return null;
}

export function judgePrompt(goal: string, summary: string, screen: ScreenState): string {
  return [
    'You check whether an Android phone task was really completed. You see the final screen as a list of UI elements.',
    'Answer with ONLY minified JSON: {"verdict":"yes"|"no"|"unsure","reason":"<one short sentence>"}',
    '"yes" only if the final screen shows the goal achieved (or the goal needed no lasting screen, like closing an app, and nothing contradicts it).',
    '"no" if the screen shows it was not achieved (wrong app or page, an error, a login wall, the thing still missing).',
    '"unsure" if the screen cannot tell either way.',
    '',
    `GOAL: ${goal}`,
    `AGENT SAYS: ${summary}`,
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

  const rule = ruleFor(input.goal);
  if (rule) {
    const apps = await input.listApps().catch(() => []);
    const app = appNamedIn(input.goal, apps);
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
    const verdict = parseVerdict(await input.judge(judgePrompt(input.goal, input.summary, screen)));
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
