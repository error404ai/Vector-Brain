import type { RunTally } from './successVerifier';

/**
 * The task's rule list: one short model call before the run turns the user's
 * prompt into what must be true at the end — not how to get there.
 *
 * Why: the goal's numbers used to be read by regexes ("like 5", "visit 10
 * sites"), and every new phrasing or Hinglish word needed another patch. The
 * planner wrote steps (how), which go wrong on screens it has never seen. The
 * rule list says what, in a fixed shape the system can check:
 * - parts: what must be done, in order — the judge checks each one at task_done
 * - counts: the user's own numbers — pages and scrolls are counted by code
 * - proof: what shows it is done
 * - avoid: what the agent must not do on the way
 * - report: what the user wants told back
 *
 * A model can misread a task, so nothing here is trusted blindly: a count whose
 * number the user never wrote is dropped, and pages/scrolls fail a run only when
 * the prompt itself talks about sites or scrolling.
 */

export type RuleCountKind = 'pages' | 'scrolls' | 'button' | 'other';

export interface RuleCount {
  kind: RuleCountKind;
  /** button only: the button's word (follow, like, subscribe, join, save, connect). */
  verb?: string;
  n: number;
  /** What is counted, in a few words ("posts liked", "comments posted"). */
  what: string;
}

export interface TaskRules {
  parts: string[];
  counts: RuleCount[];
  proof: string | null;
  avoid: string[];
  report: string | null;
}

export const RULES_PROMPT = `You turn a phone task into its rule list: what must be true when it is finished. Not how to do it.
Reply with ONLY minified JSON, no other text:
{"parts":["..."],"counts":[{"kind":"pages|scrolls|button|other","verb":"like","n":5,"what":"posts liked"}],"proof":"...","avoid":["..."],"report":null}
- parts: 1 to 6 short items, in order, each one thing that must be DONE (e.g. "Blogger is open", "a new blog exists", "an article is published"). No taps, buttons or menus.
- counts: ONLY numbers the user wrote. kind "pages" = websites or web pages to open; "scrolls" = scrolls, swipes, or items scrolled through; "button" = taps on a Follow/Like/Subscribe/Join/Save/Connect button (verb = that word, lowercase); "other" = any other number (comments, messages, posts, minutes). No number written → "counts":[].
- proof: one sentence: what the final screen or the steps show when it is done.
- avoid: up to 4 things a careless agent might do that the task does not ask for (guess a password, buy or pay, delete, change account settings, post something not asked). [] if nothing applies.
- report: what the user wants told back (an answer, a URL, a value), else null.
Write the list in English even when the task is in Hindi or Hinglish.`;

const MAX_PARTS = 6;
const MAX_AVOID = 4;
const KINDS: RuleCountKind[] = ['pages', 'scrolls', 'button', 'other'];
const BUTTON_VERBS = new Set(['follow', 'like', 'subscribe', 'join', 'save', 'connect']);

/** Number words the user may write instead of digits. Not Hindi "do" (2): it is also English "do". */
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, fifty: 50, hundred: 100,
  ek: 1, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, saat: 7, aath: 8, nau: 9, das: 10, bees: 20, pachas: 50, sau: 100,
};

/** Every number the user wrote, as digits or as a word. */
export function numbersIn(goal: string): Set<number> {
  const out = new Set<number>();
  for (const m of goal.matchAll(/\d{1,4}/g)) out.add(Number(m[0]));
  for (const m of goal.toLowerCase().matchAll(/\p{L}+/gu)) {
    const n = NUMBER_WORDS[m[0]];
    if (n !== undefined) out.add(n);
  }
  return out;
}

const SITE_WORDS = /\b(?:web\s*sites?|sites?|web\s*pages?|pages?|urls?|links?|domains?)\b/i;
const SCROLL_WORDS = /\b(?:scroll|swipe)/i;

const clean = (v: unknown, max: number): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** The model's reply as a rule list, or null when it is not one. Counts the user never wrote are dropped. */
export function parseRules(text: string, goal: string): TaskRules | null {
  const match = /\{[\s\S]*\}/.exec(text ?? '');
  if (!match) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
  const parts = (Array.isArray(raw.parts) ? raw.parts : []).map((p) => clean(p, 120)).filter(Boolean).slice(0, MAX_PARTS);
  if (!parts.length) return null;
  const written = numbersIn(goal);
  const counts: RuleCount[] = [];
  for (const c of Array.isArray(raw.counts) ? raw.counts : []) {
    const item = (c ?? {}) as Record<string, unknown>;
    const n = Number(item.n);
    if (!Number.isInteger(n) || n < 1 || n > 1000 || !written.has(n)) continue;
    let kind = (KINDS as string[]).includes(String(item.kind)) ? (item.kind as RuleCountKind) : 'other';
    const verb = clean(item.verb, 20).toLowerCase();
    // A count that fails a run by code only where the prompt itself says sites or scrolling.
    if (kind === 'pages' && !SITE_WORDS.test(goal)) kind = 'other';
    if (kind === 'scrolls' && !SCROLL_WORDS.test(goal)) kind = 'other';
    if (kind === 'button' && !BUTTON_VERBS.has(verb)) kind = 'other';
    const what = clean(item.what, 60) || (kind === 'button' ? `${verb} taps` : kind);
    if (counts.some((x) => x.kind === kind && x.n === n && (x.verb ?? '') === (kind === 'button' ? verb : ''))) continue;
    counts.push(kind === 'button' ? { kind, verb, n, what } : { kind, n, what });
  }
  const avoid = (Array.isArray(raw.avoid) ? raw.avoid : []).map((a) => clean(a, 100)).filter(Boolean).slice(0, MAX_AVOID);
  const proof = clean(raw.proof, 200) || null;
  const report = raw.report == null ? null : clean(raw.report, 120) || null;
  return { parts, counts, proof, avoid, report };
}

/** The rule list as the agent reads it with the task (the same on every call, so it stays in the prompt cache). */
export function rulesBlock(rules: TaskRules): string {
  return [
    'RULES FOR THIS TASK (made before the run; when you call task_done the system checks every part):',
    ...rules.parts.map((p, i) => `${i + 1}. ${p}`),
    ...(rules.counts.length ? [`COUNTS: ${rules.counts.map((c) => `${c.what} × ${c.n}`).join('; ')}`] : []),
    ...(rules.proof ? [`DONE WHEN: ${rules.proof}`] : []),
    ...(rules.avoid.length ? [`DO NOT: ${rules.avoid.join('; ')}`] : []),
    ...(rules.report ? [`TELL THE USER: ${rules.report} (put it in task_done's summary)`] : []),
  ].join('\n');
}

const buttonDone = (tally: RunTally, verb: string) => tally.changes.filter((c) => c.from.toLowerCase().split(/\s+/)[0] === verb).length;

/** How far the counts are, counted by code: "posts liked 2 of 5; pages opened 3 of 10". Only kinds code can count. */
export function rulesProgress(rules: TaskRules, tally: RunTally): string {
  const parts: string[] = [];
  for (const c of rules.counts) {
    if (c.kind === 'pages') parts.push(`${c.what}: ${tally.openUrl} of ${c.n}${tally.openUrl >= c.n ? ' ✓' : ''}`);
    else if (c.kind === 'scrolls') parts.push(`${c.what}: ${tally.scrolls} of ${c.n}${tally.scrolls >= c.n ? ' ✓' : ''}`);
    else if (c.kind === 'button' && c.verb) {
      const done = buttonDone(tally, c.verb);
      parts.push(`${c.what}: ${done} of ${c.n}${done >= c.n ? ' ✓' : ''}`);
    }
  }
  return parts.join('; ');
}

/**
 * The counts against what the run did. Same contract as countChecks: "short"
 * fails a run (pages and scrolls only — the phone proves them), "met" tells the
 * judge not to recount. Button changes are evidence only: a tap that opened a
 * profile first is not seen as a change. "other" counts go to the judge.
 */
export function rulesCountChecks(rules: TaskRules, tally: RunTally): { short: string[]; met: string[] } {
  const short: string[] = [];
  const met: string[] = [];
  for (const c of rules.counts) {
    if (c.kind === 'pages') (tally.openUrl >= c.n ? met : short).push(`pages opened (open_url): ${tally.openUrl} of ${c.n}`);
    else if (c.kind === 'scrolls') (tally.scrolls >= c.n ? met : short).push(`scrolls (swipe/scroll_element): ${tally.scrolls} of ${c.n}`);
    else if (c.kind === 'button' && c.verb) {
      const done = buttonDone(tally, c.verb);
      if (done >= c.n) met.push(`"${c.verb}" buttons changed by taps: ${done} of ${c.n}`);
    }
  }
  return { short, met };
}

/** What the judge reads: every part must be done; "other" counts are checked from the steps. */
export function rulesForJudge(rules: TaskRules): string[] {
  const other = rules.counts.filter((c) => c.kind === 'other' || (c.kind === 'button' && !c.verb));
  return [
    "THE TASK'S RULE LIST (made from the goal before the run). \"yes\" needs EVERY part done; if one is missing or wrong, answer \"no\" and name that part in the reason:",
    ...rules.parts.map((p, i) => `  ${i + 1}. ${p}`),
    ...(other.length ? [`  Counts to check from the steps: ${other.map((c) => `${c.what} × ${c.n}`).join('; ')}`] : []),
    ...(rules.proof ? [`  Done when: ${rules.proof}`] : []),
    ...(rules.report ? [`  The agent's summary must tell the user: ${rules.report}`] : []),
  ];
}

/**
 * Rule lists by prompt, shared across runs: a mission sends the same prompt to
 * every phone, and they all wait on one call. Kept 6 hours, at most 300.
 */
const CACHE_MS = 6 * 60 * 60 * 1000;
const CACHE_MAX = 300;
const cache = new Map<string, { at: number; rules: Promise<TaskRules | null> }>();

export function cachedRules(prompt: string, make: () => Promise<TaskRules | null>, now = Date.now()): { rules: Promise<TaskRules | null>; fresh: boolean } {
  const key = prompt.replace(/\s+/g, ' ').trim();
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_MS) return { rules: hit.rules, fresh: false };
  const rules = make().catch(() => null);
  cache.set(key, { at: now, rules });
  // A failed call is not kept: the next run asks again.
  void rules.then((r) => {
    if (!r && cache.get(key)?.rules === rules) cache.delete(key);
  });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return { rules, fresh: true };
}

export function clearRulesCache(): void {
  cache.clear();
}
