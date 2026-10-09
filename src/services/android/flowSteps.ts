/**
 * Checkable flow steps (docs/REPLAY_ENGINE.md).
 *
 * A step says where it expects to start (the app and a few labels that are on
 * that screen), what to act on (the element's label, its position only as a
 * tie-break), and what must be true afterwards. Replay acts on the element as
 * it is on this phone, and a step whose screen does not match is "broken"
 * instead of a tap on whatever happens to be at the old pixels.
 *
 * Everything here is pure: it works on the element tables the agent already
 * produces (`idx|type|label|flags|x,y`, see eko/screenModel.ts).
 */

export const FLOW_FORMAT = 2;

export interface Row {
  idx: string;
  type: string;
  label: string;
  tappable: boolean;
  editable: boolean;
  x: number;
  y: number;
}

export type FlowAction =
  | 'open_app'
  | 'open_url'
  | 'tap'
  | 'click_text'
  | 'type'
  | 'key'
  | 'global'
  | 'swipe'
  | 'scroll'
  | 'long_press'
  | 'install_app'
  | 'open_settings';

export interface FlowTarget {
  /** The element's label as the agent saw it (first part before " · "). Empty for an unlabelled control. */
  label: string;
  type: string;
  /** Position on the 0–1000 grid: a tie-break between equal labels, or the target itself when unlabelled. */
  grid: { x: number; y: number };
}

export interface FlowStepV2 {
  action: FlowAction;
  /** Tool arguments that do not depend on the screen (packageName, url, direction, key …). */
  args: Record<string, unknown>;
  target?: FlowTarget;
  /** What to type: a parameter taken from the task's wording, or missing (the AI types it). */
  value?: { param: string } | { missing: true };
  before: { package: string | null; anchors: string[] };
  after: { package: string | null; appear: string[] };
  label: string;
}

/**
 * Steps that work from any screen (they launch or install something). Their
 * start screen is never checked, even in flows recorded before this rule: a
 * recorded launcher (com.motorola.launcher3) broke an install flow on every
 * other phone in the Oct 7 export.
 */
const STARTS_ANYWHERE = new Set<FlowAction>(['open_app', 'open_url', 'install_app', 'open_settings']);
export const startsAnywhere = (step: FlowStepV2) => STARTS_ANYWHERE.has(step.action) || (!step.before.package && !step.before.anchors.length);

/** Steps a resync may never jump over: skipping them skips what the task is for. */
const MUST_DO = new Set<FlowAction>(['type', 'install_app']);

/** Agent tools that only look; they never count as doing a step. */
export const LOOK_ONLY_TOOLS = new Set(['read_ui_tree', 'capture_screen', 'list_apps', 'read_clipboard', 'read_notifications', 'wait', 'wait_for_element', 'phone_info']);

/** The agent tools that perform each kind of step (used to tell that the AI did it). */
const TOOLS_FOR: Record<FlowAction, string[]> = {
  open_app: ['open_app'],
  open_url: ['open_url'],
  tap: ['tap_element', 'tap_coordinate', 'click_node'],
  click_text: ['tap_element', 'tap_coordinate', 'click_node'],
  type: ['type_text', 'paste'],
  key: ['press_key'],
  global: ['global_action'],
  swipe: ['swipe', 'scroll_element'],
  scroll: ['scroll_element', 'swipe'],
  long_press: ['long_press'],
  install_app: ['install_app'],
  open_settings: ['open_settings'],
};

/**
 * Whether an AI action did the broken step. Looking never counts. A step with
 * labels to wait for is done when they appear; one without (install, type,
 * key …) only when the AI performed that same kind of action and it worked.
 */
export function aiDidStep(step: FlowStepV2, tool: string, failed: boolean, pkg: string | null, rows: Row[], moved: boolean): boolean {
  if (failed || LOOK_ONLY_TOOLS.has(tool)) return false;
  if (step.after.appear.length) return moved && afterMet(step, pkg, rows, moved);
  if (!TOOLS_FOR[step.action]?.includes(tool)) return false;
  return step.action === 'tap' || step.action === 'click_text' ? moved && afterMet(step, pkg, rows, moved) : afterMet(step, pkg, rows, moved);
}

export interface FlowParam {
  name: string;
  /** How a URL carries it: encodeURIComponent, spaces as "+", or as typed. */
  encoding?: 'uri' | 'plus' | 'raw';
}

/** One logged step of a finished run, as the recorder reads it. */
export interface RecordedStep {
  action: string;
  payload: Record<string, unknown> | null;
  ok: boolean;
  treeBefore: string | null;
  treeAfter: string | null;
  pkgBefore: string | null;
  pkgAfter: string | null;
  screenBefore: string | null;
  screenAfter: string | null;
  /** The real text of a type_text step (logs only keep "[REDACTED]"). */
  typed?: string | null;
}

// ---------------------------------------------------------------------------
// Reading the element table
// ---------------------------------------------------------------------------

export function parseTable(table: string | null | undefined): Row[] {
  if (!table || !table.includes('|')) return [];
  const rows: Row[] = [];
  for (const line of table.split('\n')) {
    const parts = line.split('|');
    if (parts.length < 5 || parts[0] === 'idx') continue;
    const at = parts[parts.length - 1].split(',').map(Number);
    const flags = parts[parts.length - 2];
    rows.push({
      idx: parts[0],
      type: parts[1],
      label: parts.slice(2, parts.length - 2).join('|').trim(),
      tappable: flags.includes('t'),
      editable: flags.includes('e'),
      x: Number.isFinite(at[0]) ? at[0] : 0,
      y: Number.isFinite(at[1]) ? at[1] : 0,
    });
  }
  return rows;
}

/** "Install · 4.2 star" → "Install": the part a user reads first. */
export const headOf = (label: string) => label.split(' · ')[0].trim();
const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * A label that is the same every time the screen is shown: short, no digits
 * (counters, times, prices, dates), not cut off.
 */
export function stableLabel(label: string): boolean {
  const head = headOf(label);
  return head.length >= 2 && head.length <= 40 && !/\d/.test(head) && !head.includes('…') && /\p{L}/u.test(head);
}

/** Up to `max` stable labels of a screen: the top bar first, then controls, then the rest. */
export function anchorsOf(rows: Row[], max = 4, exclude: Set<string> = new Set()): string[] {
  const ranked = [...rows].sort((a, b) => rank(a) - rank(b) || a.y - b.y);
  const out: string[] = [];
  for (const row of ranked) {
    const head = headOf(row.label);
    const key = norm(head);
    // A text field's label is whatever was typed into it: never an anchor.
    if (row.editable || !stableLabel(row.label) || exclude.has(key) || out.some((a) => norm(a) === key)) continue;
    out.push(head);
    if (out.length >= max) break;
  }
  return out;
}
function rank(row: Row): number {
  if (row.y <= 160) return 0;
  return row.tappable ? 1 : 2;
}

/** Whether enough of `anchors` are on screen: at least half, and at least one. */
export function anchorsPresent(anchors: string[], rows: Row[]): boolean {
  if (!anchors.length) return true;
  // Whole labels only: "Search" must not be found inside "Search YouTube".
  const heads = new Set(rows.flatMap((r) => [norm(headOf(r.label)), norm(r.label)]));
  const present = anchors.filter((a) => heads.has(norm(a))).length;
  return present >= Math.max(1, Math.ceil(anchors.length / 2));
}

export function screenMatches(before: FlowStepV2['before'], pkg: string | null, rows: Row[]): boolean {
  if (before.package && pkg && before.package !== pkg) return false;
  if (before.package && !pkg) return false;
  return anchorsPresent(before.anchors, rows);
}

/** The step's result is on screen. `changed`: the screen differs from where the step started. */
export function afterMet(step: FlowStepV2, pkg: string | null, rows: Row[], changed: boolean): boolean {
  if (step.after.package && pkg !== step.after.package) return false;
  if (step.after.appear.length) return anchorsPresent(step.after.appear, rows);
  // Nothing new to look for: the app is right; for a tap, the screen must have moved.
  return step.action === 'tap' || step.action === 'click_text' ? changed : true;
}

/** The element to act on, on this phone's screen: same label (nearest the old spot), else the unlabelled control nearest it. */
export function findTarget(target: FlowTarget, rows: Row[]): Row | null {
  const dist = (r: Row) => Math.hypot(r.x - target.grid.x, r.y - target.grid.y);
  const nearest = (list: Row[]) => (list.length ? list.reduce((a, b) => (dist(a) <= dist(b) ? a : b)) : null);
  if (target.label) {
    const want = norm(target.label);
    const exact = rows.filter((r) => norm(headOf(r.label)) === want || norm(r.label) === want);
    if (exact.length) return nearest(exact.filter((r) => r.tappable || r.editable)) ?? nearest(exact);
    const prefix = rows.filter((r) => (r.tappable || r.editable) && norm(r.label).startsWith(want.slice(0, 24)) && want.length >= 4);
    return nearest(prefix);
  }
  const unlabelled = rows.filter((r) => !r.label && (r.tappable || r.editable) && r.type === target.type && dist(r) <= 80);
  return nearest(unlabelled);
}

/** The row nearest a grid point, within reach (what a tap_coordinate hit). */
function rowAt(rows: Row[], x: number, y: number): Row | null {
  let best: Row | null = null;
  let bestD = 60;
  for (const r of rows) {
    if (!r.tappable && !r.editable) continue;
    const d = Math.hypot(r.x - x, r.y - y);
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// The task's wording: which flow fits, and with which values
// ---------------------------------------------------------------------------

const collapse = (s: string) => s.replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The key a flow is looked up by: the wording, case and spacing aside. */
export function promptKey(prompt: string): string {
  return collapse(prompt).toLowerCase();
}

/**
 * The task's wording with each value the run typed replaced by {{name}}:
 * "Search YouTube for cats" + typed "cats" → "Search YouTube for {{p1}}".
 */
export function promptTemplate(prompt: string, values: { name: string; value: string }[]): string {
  let template = collapse(prompt);
  for (const { name, value } of values) {
    const at = template.toLowerCase().indexOf(collapse(value).toLowerCase());
    if (at < 0) continue;
    template = `${template.slice(0, at)}{{${name}}}${template.slice(at + collapse(value).length)}`;
  }
  return template;
}

/** The values a new task fills a template with, or null when it is not the same task. */
export function matchTemplate(template: string, prompt: string): Record<string, string> | null {
  const names: string[] = [];
  const source = template
    .split(/(\{\{\w+\}\})/)
    .map((part) => {
      const m = /^\{\{(\w+)\}\}$/.exec(part);
      if (m) {
        names.push(m[1]);
        return '(.+?)';
      }
      return escapeRe(part).replace(/ /g, '\\s+');
    })
    .join('');
  const match = new RegExp(`^${source}$`, 'i').exec(collapse(prompt));
  if (!match) return null;
  const out: Record<string, string> = {};
  names.forEach((name, i) => (out[name] = match[i + 1].trim()));
  return out;
}

export function fillUrl(url: string, params: FlowParam[], values: Record<string, string>): string | null {
  let out = url;
  for (const p of params) {
    const token = `{{${p.name}}}`;
    if (!out.includes(token)) continue;
    const value = values[p.name];
    if (value === undefined) return null;
    const encoded = p.encoding === 'plus' ? encodeURIComponent(value).replace(/%20/g, '+') : p.encoding === 'raw' ? value : encodeURIComponent(value);
    out = out.split(token).join(encoded);
  }
  return out;
}

/** Find `value` in a URL the way it was encoded there, and swap it for the token. */
function templateUrl(url: string, value: string, name: string): { url: string; encoding: FlowParam['encoding'] } | null {
  const forms: [string, FlowParam['encoding']][] = [
    [encodeURIComponent(value), 'uri'],
    [encodeURIComponent(value).replace(/%20/g, '+'), 'plus'],
    [value, 'raw'],
  ];
  for (const [form, encoding] of forms) {
    const at = url.toLowerCase().indexOf(form.toLowerCase());
    if (form && at >= 0) return { url: `${url.slice(0, at)}{{${name}}}${url.slice(at + form.length)}`, encoding };
  }
  return null;
}

function urlValues(url: string): string[] {
  try {
    const parsed = new URL(url);
    return [...parsed.searchParams.values()].filter((v) => v.trim().length >= 2);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Recording: a finished run → checkable steps
// ---------------------------------------------------------------------------

const KEEP = new Set([
  'open_app', 'open_url', 'tap_element', 'tap_coordinate', 'click_node', 'type_text', 'press_key',
  'global_action', 'swipe', 'scroll_element', 'long_press', 'install_app', 'open_settings',
]);
/** Steps a cycle may never swallow: what they did is not undone by going back. */
const LASTING = new Set(['type_text', 'install_app', 'press_key', 'open_settings']);

export interface RecordedFlow {
  steps: FlowStepV2[];
  params: FlowParam[];
  template: string;
  /** Steps the AI still has to do on every run (typed text not in the task's wording). */
  aiSteps: number;
  packageName: string | null;
}

/**
 * The effective path of a run: failed steps, look-only steps and detours
 * (a tap undone by BACK) are left out; what is left becomes checkable steps.
 */
export function recordFlow(prompt: string, logged: RecordedStep[]): RecordedFlow {
  const kept: RecordedStep[] = [];
  for (const step of logged) {
    if (!step.ok || !KEEP.has(step.action)) continue;
    // A tap that changed nothing, repeated: keep only the one that worked.
    const prev = kept[kept.length - 1];
    if (prev && isTap(prev) && isTap(step) && prev.screenBefore && prev.screenBefore === prev.screenAfter && prev.screenBefore === step.screenBefore) kept.pop();
    kept.push(step);
    // A detour: BACK returned to a screen an earlier step started on.
    if (step.action === 'global_action' && String(step.payload?.action ?? '').toUpperCase() === 'BACK' && step.screenAfter) {
      const j = kept.findIndex((s, i) => i < kept.length - 1 && s.screenBefore === step.screenAfter);
      if (j >= 0 && !kept.slice(j).some((s) => LASTING.has(s.action))) kept.splice(j);
    }
  }

  // Values the run typed or searched for that come from the task's wording become parameters.
  const params: FlowParam[] = [];
  const named: { name: string; value: string }[] = [];
  const nameFor = (value: string): string | null => {
    const v = collapse(value);
    if (v.length < 2 || !collapse(prompt).toLowerCase().includes(v.toLowerCase())) return null;
    const existing = named.find((n) => n.value.toLowerCase() === v.toLowerCase());
    if (existing) return existing.name;
    const name = `p${named.length + 1}`;
    named.push({ name, value: v });
    params.push({ name });
    return name;
  };

  const steps: FlowStepV2[] = [];
  let aiSteps = 0;
  for (const s of kept) {
    const rows = parseTable(s.treeBefore);
    const afterRows = parseTable(s.treeAfter);
    const beforeLabels = new Set(rows.map((r) => norm(headOf(r.label))));
    const appear = anchorsOf(afterRows.filter((r) => !beforeLabels.has(norm(headOf(r.label)))), 3);
    const base = {
      before: { package: s.pkgBefore, anchors: anchorsOf(rows) },
      after: { package: s.pkgAfter, appear },
    };
    const p = s.payload ?? {};
    switch (s.action) {
      case 'open_app':
        steps.push({ ...base, before: { package: null, anchors: [] }, action: 'open_app', args: { packageName: p.packageName }, label: `Open ${String(p.packageName ?? 'app').split('.').pop()}` });
        break;
      case 'open_url': {
        let url = String(p.url ?? '');
        for (const v of urlValues(url)) {
          const name = nameFor(v);
          const t = name ? templateUrl(url, v, name) : null;
          if (t && name) {
            url = t.url;
            const param = params.find((x) => x.name === name);
            if (param) param.encoding = t.encoding;
          }
        }
        steps.push({ ...base, before: { package: null, anchors: [] }, action: 'open_url', args: { url }, label: `Open ${url.slice(0, 60)}` });
        break;
      }
      case 'tap_element':
      case 'tap_coordinate': {
        const row =
          s.action === 'tap_element'
            ? rows.find((r) => r.idx === String(p.idx ?? '')) ?? null
            : rowAt(rows, Number(p.x), Number(p.y));
        const grid = row ? { x: row.x, y: row.y } : { x: Number(p.x) || 500, y: Number(p.y) || 500 };
        const label = row ? headOf(row.label) : '';
        steps.push({ ...base, action: 'tap', args: {}, target: { label, type: row?.type ?? 'view', grid }, label: label ? `Tap "${label}"` : `Tap at ${grid.x},${grid.y}` });
        break;
      }
      case 'click_node':
        if (!p.text) continue;
        steps.push({ ...base, action: 'click_text', args: { text: p.text }, label: `Tap "${String(p.text)}"` });
        break;
      case 'type_text': {
        const typed = s.typed ?? (p.text && p.text !== '[REDACTED]' ? String(p.text) : null);
        const name = typed ? nameFor(typed) : null;
        if (!name) aiSteps += 1;
        // The field the run typed into, if the list showed one being edited.
        const field = rows.find((r) => r.editable) ?? null;
        steps.push({
          ...base,
          // Typing changes the field, not the screen: nothing new to wait for.
          after: { package: s.pkgAfter, appear: [] },
          action: 'type',
          args: {},
          value: name ? { param: name } : { missing: true },
          target: field ? { label: headOf(field.label), type: field.type, grid: { x: field.x, y: field.y } } : undefined,
          label: name ? `Type the ${name === 'p1' ? 'text' : name} from the task` : 'Type (the AI fills this in)',
        });
        break;
      }
      case 'press_key':
        steps.push({ ...base, action: 'key', args: { key: p.key }, label: `Press ${String(p.key ?? 'ENTER').toLowerCase()}` });
        break;
      case 'global_action':
        steps.push({ ...base, action: 'global', args: { action: p.action }, label: `Press ${String(p.action ?? 'BACK').toLowerCase()}` });
        break;
      case 'swipe':
        steps.push({ ...base, after: { package: s.pkgAfter, appear: [] }, action: 'swipe', args: { direction: p.direction }, label: `Swipe ${String(p.direction ?? '').toLowerCase()}` });
        break;
      case 'scroll_element':
        steps.push({ ...base, after: { package: s.pkgAfter, appear: [] }, action: 'scroll', args: { direction: p.direction ?? 'FORWARD', text: p.text }, label: `Scroll ${p.direction === 'BACKWARD' ? 'up' : 'down'}` });
        break;
      case 'long_press':
        steps.push({ ...base, action: 'long_press', args: { text: p.text, x: p.x, y: p.y, durationMillis: p.durationMillis }, label: `Long-press ${p.text ? `"${String(p.text)}"` : ''}`.trim() });
        break;
      case 'install_app':
        steps.push({ ...base, before: { package: null, anchors: [] }, after: { package: null, appear: [] }, action: 'install_app', args: { packageName: p.packageName, appName: p.appName }, label: `Install ${String(p.appName ?? p.packageName ?? '')}` });
        break;
      case 'open_settings':
        steps.push({ ...base, before: { package: null, anchors: [] }, action: 'open_settings', args: { screen: p.screen }, label: `Open settings ${String(p.screen ?? '').toLowerCase()}` });
        break;
    }
  }
  const packageName = steps.find((s) => s.action === 'open_app')?.args.packageName as string | undefined;
  return { steps, params, template: promptTemplate(prompt, named), aiSteps, packageName: packageName ?? kept[0]?.pkgBefore ?? null };
}

function isTap(s: RecordedStep): boolean {
  return s.action === 'tap_element' || s.action === 'tap_coordinate' || s.action === 'click_node';
}

/** The first step from `from` on whose starting screen the phone is now. */
export function resyncIndex(steps: FlowStepV2[], from: number, pkg: string | null, rows: Row[]): number {
  for (let j = from; j < steps.length; j += 1) {
    const s = steps[j];
    // Steps that launch something start anywhere; they cannot place the phone.
    if (startsAnywhere(s)) continue;
    if (screenMatches(s.before, pkg, rows)) return j;
    // Never land past a step whose work cannot be seen on a later screen.
    if (MUST_DO.has(s.action)) return -1;
  }
  return -1;
}

export function parseSteps(json: string | null | undefined): FlowStepV2[] {
  try {
    const parsed = JSON.parse(json || '[]');
    return Array.isArray(parsed) ? (parsed as FlowStepV2[]) : [];
  } catch {
    return [];
  }
}
