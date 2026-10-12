/**
 * Experience memory: short lessons the fleet learns from its own runs, per site
 * or app ("blogger.com: a new blog is under the blog name dropdown in Main menu").
 *
 * Lessons come from what the phone confirmed (screens that changed, a run the
 * judge passed, a page that said "not found"), never from the model's own
 * account of the run alone. A lesson starts as a candidate and is trusted once
 * it has helped, or when the user wrote it. One that keeps going with failed
 * runs is switched off by itself.
 */

export type LessonKind = 'path' | 'avoid' | 'widget' | 'behave' | 'limit' | 'field';
/** unverified: learned by a run that did not succeed; the agent does not see it until a successful run teaches it too. */
export type LessonStatus = 'unverified' | 'candidate' | 'trusted' | 'off';
export const LESSON_KINDS: LessonKind[] = ['path', 'avoid', 'widget', 'behave', 'limit', 'field'];

/** What the agent gets for a run: the lesson, and for an "avoid" with an address, the address it must not open. */
export interface AgentLesson {
  id: number;
  scope: string;
  kind: LessonKind;
  text: string;
  status: LessonStatus;
  avoidUrl?: string | null;
}

/** One step of a finished run, as the reflection sees it. */
export interface RunStep {
  index: number;
  tool: string;
  args: Record<string, unknown> | null;
  ok: boolean;
  result: string;
  packageAfter: string | null;
  waste?: string | null;
}

export interface DraftLesson {
  scope: string;
  kind: LessonKind;
  text: string;
  avoidUrl?: string | null;
}

/** Lessons sent at once; more would crowd the screen list out. */
export const MAX_LESSONS_PER_NOTE = 4;
export const MAX_TEXT = 200;
/** Lessons one run's reflection may add, and active lessons one site may have. */
export const MAX_FROM_REFLECTION = 2;
export const MAX_ACTIVE_PER_SCOPE = 12;
/** A candidate is trusted after helping this many finished runs. */
export const TRUST_AFTER = 2;
/** Switched off after this many failed runs that used it, when it has hurt more than helped. */
export const OFF_AFTER_HURT = 3;

const BROWSERS = /chrome|browser|firefox|sbrowser|opera|edge|brave|duckduckgo/;
const NOT_FOUND = /(can['’]?t (?:locate|find) (?:your|this|the) page|page not found|\b404\b|this page (?:does ?n['’]?o?t|doesn['’]t) exist|not found on this server|requested url was not found)/i;
const SECRET = /\b(?:pass(?:word|wd)?|pwd|otp|pin|code)\b\s*[:=]?\s*\S{3,}/i;
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/i;

/** blogger.com from "https://www.blogger.com/blog/posts/1", null for anything that is not a web address. */
export function domainOf(url: string): string | null {
  const m = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:www\.|m\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?=[/:?#]|$)/i.exec(String(url ?? '').trim());
  if (!m) return null;
  const host = m[1].toLowerCase();
  return /\.[a-z]{2,}$/.test(host) ? host : null;
}

/** An address without scheme, www, query, fragment or trailing slash, for "never open this again". */
export function normalUrl(url: string): string {
  return String(url ?? '')
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .replace(/^(?:www\.|m\.)/, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
}

/** The word a person uses for a scope: "blogger" for blogger.com, "instagram" for com.instagram.android. */
export function scopeWord(scope: string): string {
  const s = scope.toLowerCase();
  if (/^[a-z][a-z0-9_]*(\.[a-z0-9_]+){2,}$/.test(s) && !/\.(com|in|org|net|io|co|app)$/.test(s)) {
    const parts = s.split('.').filter((p) => !['com', 'android', 'app', 'apps', 'google', 'org', 'net', 'mobile', 'lite'].includes(p));
    return parts[0] ?? s;
  }
  return s.split('.')[0];
}

/** Scopes the task text names: web addresses, and known scopes by their word ("blogger", "youtube"). */
export function scopesInText(text: string, known: string[]): string[] {
  const found = new Set<string>();
  const lower = String(text ?? '').toLowerCase();
  for (const m of lower.matchAll(/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})(?=[\s/,.)?!:]|$)/g)) {
    const d = domainOf(m[1]);
    // The domain of an email address is not a site the task is about.
    if (d && lower[(m.index ?? 0) - 1] !== '@') found.add(d);
  }
  for (const scope of known) {
    const word = scopeWord(scope);
    if (word.length >= 3 && new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(lower)) found.add(scope);
  }
  return [...found];
}

/** Lessons for these scopes, trusted first, most helpful first. */
export function lessonsFor(lessons: AgentLesson[], scopes: string[], skip: Set<number> = new Set()): AgentLesson[] {
  const want = new Set(scopes.map((s) => s.toLowerCase()));
  return lessons
    .filter((l) => l.status !== 'off' && want.has(l.scope.toLowerCase()) && !skip.has(l.id))
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'trusted' ? -1 : 1))
    .slice(0, MAX_LESSONS_PER_NOTE);
}

const KIND_WORD: Record<LessonKind, string> = { path: 'way', avoid: 'avoid', widget: 'screen', behave: 'note', limit: 'limit', field: 'field' };

/** The note the agent reads: a few lines, marked as earlier runs' experience. */
export function lessonNote(scope: string, lessons: AgentLesson[]): string {
  if (!lessons.length) return '';
  const lines = lessons.map((l) => `- [${KIND_WORD[l.kind]}${l.status === 'candidate' ? ', unconfirmed' : ''}] ${l.text}`);
  return `EXPERIENCE on ${scope} (learned by earlier runs on your phones; use it, but trust the screen when it differs):\n${lines.join('\n')}`;
}

const STOP_WORDS = new Set(['the', 'and', 'this', 'that', 'for', 'with', 'from', 'into', 'are', 'was', 'not', 'does', 'can', 'cannot', 'its', 'one', 'you', 'your', 'then', 'there', 'when', 'way']);
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP_WORDS.has(w)));
/**
 * Same place and most of the words in common: one lesson, not two — whatever type the
 * reflection gave it (Oct 13: the same Reels swipe note as both "avoid" and "behaviour").
 */
export function sameLesson(a: { scope: string; kind: string; text: string }, b: { scope: string; kind: string; text: string }): boolean {
  if (a.scope.toLowerCase() !== b.scope.toLowerCase()) return false;
  const x = words(a.text);
  const y = words(b.text);
  if (!x.size || !y.size) return false;
  let both = 0;
  for (const w of x) if (y.has(w)) both += 1;
  return both / (x.size + y.size - both) >= 0.45;
}

/** Text a lesson may not hold: addresses of people, passwords, codes. */
export function unsafeText(text: string): boolean {
  return EMAIL.test(text) || SECRET.test(text) || /\b\d{4,}\b/.test(text.replace(/\b(19|20)\d{2}\b/g, ''));
}

/** Where the run was: apps it used and the sites it opened or read in the address bar. */
export function scopesOfRun(steps: RunStep[]): { apps: Set<string>; domains: Set<string> } {
  const apps = new Set<string>();
  const domains = new Set<string>();
  for (const s of steps) {
    if (s.packageAfter && !BROWSERS.test(s.packageAfter) && !/launcher|systemui|tarung/.test(s.packageAfter)) apps.add(s.packageAfter.toLowerCase());
    if (s.tool === 'open_url') {
      const d = domainOf(String(s.args?.url ?? ''));
      if (d) domains.add(d);
    }
    for (const m of s.result.matchAll(/Opened (https?:\/\/\S+)/g)) {
      const d = domainOf(m[1]);
      if (d) domains.add(d);
    }
  }
  return { apps, domains };
}

/**
 * Lessons the run itself proves, with no model: an address that answered "page
 * not found" is not to be opened again on that site.
 */
export function provenLessons(steps: RunStep[]): DraftLesson[] {
  const out: DraftLesson[] = [];
  const seen = new Set<string>();
  for (const s of steps) {
    if (s.tool !== 'open_url' || !s.ok || !NOT_FOUND.test(s.result)) continue;
    const url = String(s.args?.url ?? '');
    const domain = domainOf(url);
    const norm = normalUrl(url);
    if (!domain || seen.has(norm) || norm === domain) continue;
    seen.add(norm);
    out.push({ scope: domain, kind: 'avoid', text: `${norm} does not exist (page not found). Do not open it; use the site's own menus.`, avoidUrl: norm });
  }
  return out;
}

/** The run as the reflection reads it: one short line per step, waste marked. */
export function traceText(steps: RunStep[], max = 70): string {
  const pick = steps.length > max ? [...steps.slice(0, 20), ...steps.slice(-(max - 20))] : steps;
  return pick
    .map((s) => {
      const args = s.args ? Object.entries(s.args).filter(([k]) => !k.startsWith('px_')).map(([k, v]) => `${k}=${String(typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 80)}`).join(' ') : '';
      const res = s.result.replace(/\s+/g, ' ').replace(/UPDATED SCREEN ELEMENTS:.*$/i, '').slice(0, 160);
      return `${s.index} ${s.tool} ${args} → ${s.ok ? '' : 'FAILED '}${s.waste ? `[${s.waste}] ` : ''}${res}${s.packageAfter ? ` (${s.packageAfter})` : ''}`;
    })
    .join('\n');
}

export const REFLECT_PROMPT = `You review one finished run of an AI agent that controls an Android phone, and write down what the NEXT run on the same site or app should know.

Write 0, 1 or 2 lessons — only the ones that would have saved the most steps. Each lesson is ONE short sentence (max 160 characters) about the site or app itself, true for any phone and any account:
- path: the way to reach something ("New blog: Main menu → blog name dropdown → New Blog...").
- avoid: a dead end that wasted steps ("Create new post (+) makes a post, not a blog").
- widget: how to work a specific control or pop-up ("The EU notice closes with Cancel notification button.").
- behave: how the site behaves ("After New Blog... the name dialog appears a second later; do not reopen the menu").
- limit: a field rule ("Blog address: letters and digits only").
- field: which field is which ("Post editor: title is the top input, the article the large field below").

Rules:
- Only lessons the steps PROVE: a screen that changed, a result that says what happened. Ignore what the agent only believed.
- A "path" only from a run that succeeded, using button labels from the steps, never coordinates or idx numbers.
- Never include emails, names, passwords, codes, phone numbers or anything about the user.
- Nothing generic ("wait for pages to load", "read the screen"); only things specific to this site or app.
- scope is the site's domain (blogger.com) or the app's package (com.instagram.android) as it appears in the steps.
- Never write about things the system already handles by itself: toggles (Like/Save undo on a second tap), the keyboard, cookie or consent banners, pop-ups, swipe or scroll direction, counting, waiting for loads.
- "X does not work" only when the steps show X tried at least two different ways and failing each time; a single failed attempt is the agent's mistake, not a fact about the site.
- No lesson is better than a weak one.

Answer with JSON only: {"lessons":[{"scope":"...","kind":"path|avoid|widget|behave|limit|field","text":"..."}]}`;

/** The reflection's lessons, kept only when well formed, about a place the run went, and free of personal text. */
export function parseLessons(raw: string, run: { domains: Set<string>; apps: Set<string>; succeeded: boolean }): DraftLesson[] {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  const list = (parsed as { lessons?: unknown }).lessons;
  if (!Array.isArray(list)) return [];
  const out: DraftLesson[] = [];
  for (const item of list.slice(0, 6)) {
    if (out.length >= MAX_FROM_REFLECTION) break;
    const scopeRaw = String((item as { scope?: unknown }).scope ?? '').trim().toLowerCase();
    const kind = String((item as { kind?: unknown }).kind ?? '').trim().toLowerCase() as LessonKind;
    const text = String((item as { text?: unknown }).text ?? '').replace(/\s+/g, ' ').trim();
    if (!LESSON_KINDS.includes(kind) || text.length < 12 || text.length > MAX_TEXT || unsafeText(text)) continue;
    const scope = run.apps.has(scopeRaw) ? scopeRaw : domainOf(scopeRaw);
    if (!scope || !(run.apps.has(scope) || run.domains.has(scope))) continue;
    if (kind === 'path' && !run.succeeded) continue;
    if (/\bidx\b|\b\d{2,4}\s*,\s*\d{2,4}\b/i.test(text)) continue;
    out.push({ scope, kind, text });
  }
  return out;
}

/** After a finished run that used the lesson: its new standing. */
export function scoreLesson(l: { status: LessonStatus; helped: number; hurt: number; source: string }, succeeded: boolean): { status: LessonStatus; helped: number; hurt: number } {
  const helped = l.helped + (succeeded ? 1 : 0);
  const hurt = l.hurt + (succeeded ? 0 : 1);
  let status = l.status;
  if (status === 'candidate' && helped >= TRUST_AFTER) status = 'trusted';
  if (status !== 'off' && l.source !== 'user' && hurt >= OFF_AFTER_HURT && hurt > helped) status = 'off';
  return { status, helped, hurt };
}
