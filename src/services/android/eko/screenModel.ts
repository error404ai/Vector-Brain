import type { UiNodeSnapshot } from '../AndroidProtocol';

/**
 * The screen as the agent sees it: one row per thing it can tap or read, with
 * positions on a 0–1000 grid instead of device pixels.
 *
 * Two problems this fixes (seen in recorded runs):
 * - Compose screens (Play Store, many new apps) expose a tappable container
 *   with NO label and put the text ("Install") on a separate child. The old
 *   table listed them as two rows — an unlabelled "view||t" and a plain text —
 *   so the model tapped by guesswork. A tappable node now takes its
 *   children's text, and those children are not listed again.
 * - Coordinates were device pixels, so the same button was x=360 on a 720 px
 *   phone and x=540 on a 1080 px one, and the model mixed them up. On the
 *   grid the middle of every screen is 500, whatever the phone.
 */
export const GRID = 1000;
const MAX_ROWS = 80;
const MAX_LABEL = 60;

export interface ScreenSize {
  width: number;
  height: number;
}

export interface ScreenElement {
  /** What the agent passes to tap_element: a number, or "v1" for one found in the screenshot. */
  idx: string;
  type: string;
  label: string;
  tappable: boolean;
  editable: boolean;
  disabled: boolean;
  /** Device pixels (for the phone) and grid units (for the model). */
  px: { x: number; y: number };
  grid: { x: number; y: number };
  /** Grid-unit box, for "what is at this point". */
  box: { left: number; top: number; right: number; bottom: number };
  /** Came from the vision helper, not the accessibility tree. */
  seen?: boolean;
}

export interface ScreenModel {
  size: ScreenSize;
  elements: ScreenElement[];
  /** Rows that carry a label — how much the tree actually tells us. */
  labelledCount: number;
  /** A dialog or pop-up window is in front: the list holds only its rows. */
  popup?: boolean;
  /** Rows the app itself labels as an ad (Sponsored, Ad, Promoted…). */
  adRows?: string[];
  /** An ad is playing: the row of its "Skip ad" button, or '' while it cannot be skipped yet. */
  adPlaying?: string | null;
}

/**
 * Words apps put on an ad. Matched against a whole part of a label ("Sponsored",
 * "Sponsored · 1 of 2", "Ad · 0:15"), never inside other text, so "Ad Astra"
 * or "Add to cart" is not an ad. Oct 9: two YouTube runs tapped a Sponsored
 * result or reported an ad as the song (#3273, #3277).
 */
const AD_WORD = /^(?:ads?|sponsored|promoted|advertisement|anuncio|anúncio|publicidad|patrocinado|gesponsert|werbung|anzeige|sponsorisé|annonce|sponsorizzato|реклама|विज्ञापन|प्रायोजित)$/i;
const SKIP_AD = /^skip\s+ads?$/i;
/** An ad's own progress ("1 of 2", "0:12") next to its label: it is playing. */
const AD_PROGRESS = /^(?:\d+\s+of\s+\d+|\d{1,2}:\d{2})$/i;
const labelParts = (label: string) => label.split(/\s*[·•|]\s*/).map((p) => p.trim()).filter(Boolean);

/**
 * Ids Android's own dialogs and bottom sheets carry. Their window is the active
 * one, so the list shows only the dialog; saying so stops the agent hunting for
 * the app's rows behind it.
 */
const DIALOG_ID = /:id\/(?:alertTitle|parentPanel|buttonPanel|design_bottom_sheet|touch_outside)$/;

export function toGrid(px: number, span: number): number {
  if (!span) return 0;
  return Math.max(0, Math.min(GRID, Math.round((px / span) * GRID)));
}

export function toPixels(grid: number, span: number): number {
  return Math.max(0, Math.min(span - 1, Math.round((grid / GRID) * span)));
}

function shortType(className?: string): string {
  const type = (className || 'View').split('.').pop() || 'View';
  if (type === 'TextView') return 'text';
  if (type === 'Button') return 'btn';
  if (type === 'EditText') return 'input';
  if (type === 'ImageView') return 'img';
  if (type === 'ImageButton') return 'imgbtn';
  if (type.includes('Layout') || type.includes('View')) return 'view';
  return type.toLowerCase();
}

/**
 * Text cut to n UTF-16 units without splitting an emoji: a half emoji (a lone
 * surrogate) is not valid JSON for MySQL, and the step write failed and ended
 * the run (Oct 10, #3350/#3355/#3360: a label cut at 60 characters).
 */
export function cutText(text: string, n: number): string {
  return text.length > n ? text.slice(0, n).replace(/[\uD800-\uDBFF]$/, '') : text;
}

/** Text with any half emoji (lone surrogate) replaced by "\uFFFD", so it is valid JSON for MySQL. */
export function wellFormed(text: string): string {
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
}

/** The phone cuts long labels at 200 characters too, so a half emoji can arrive already. */
const ownLabel = (n: UiNodeSnapshot) => wellFormed((n.text?.trim() || n.contentDescription?.trim() || '').replace(/\s+/g, ' '));

/** Text of the descendants that are not tappable themselves — what a user would read on the button. */
function childText(node: UiNodeSnapshot, out: string[], consumed: Set<UiNodeSnapshot>): void {
  for (const child of node.children ?? []) {
    if (child.clickable || child.editable) continue; // a nested control keeps its own row
    const label = ownLabel(child);
    if (label && !out.includes(label)) out.push(label);
    consumed.add(child);
    childText(child, out, consumed);
  }
}

/** The screen size: the root window's bounds, else what the capture reports. */
export function screenSizeOf(root?: UiNodeSnapshot, fallback?: Partial<ScreenSize>): ScreenSize {
  const w = root ? root.bounds.right - Math.min(0, root.bounds.left) : 0;
  const h = root ? root.bounds.bottom - Math.min(0, root.bounds.top) : 0;
  return {
    width: w > 100 ? w : fallback?.width || 1080,
    height: h > 100 ? h : fallback?.height || 2400,
  };
}

/**
 * A window smaller than the full screen (a dialog, a pop-up menu, a sheet) is
 * in front. Needs the full size from an earlier full-screen window; without it
 * only Android's dialog ids can tell.
 */
function isPopup(root: UiNodeSnapshot, fullScreen?: ScreenSize): boolean {
  const b = root.bounds;
  // A window still at the top-left corner is the app (perhaps resized for the
  // keyboard); a dialog sits in the middle or at the bottom.
  if (fullScreen && fullScreen.width > 100 && fullScreen.height > 100 && (b.left > 0 || b.top > 0)) {
    const area = Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);
    if (area > 0 && area < fullScreen.width * fullScreen.height * 0.85) return true;
  }
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if (node.viewId && DIALOG_ID.test(node.viewId)) return true;
    stack.push(...(node.children ?? []));
  }
  return false;
}

/**
 * @param fullScreen the phone's full screen size, when an earlier window showed
 *   it: a dialog's window is smaller, and grid numbers stay on the whole screen.
 */
export function buildScreenModel(root: UiNodeSnapshot | undefined, fallbackSize?: Partial<ScreenSize>, fullScreen?: ScreenSize): ScreenModel {
  const popup = root ? isPopup(root, fullScreen) : false;
  const size = popup && fullScreen ? fullScreen : screenSizeOf(root, fallbackSize);
  const elements: ScreenElement[] = [];
  const consumed = new Set<UiNodeSnapshot>();
  const adRows: string[] = [];
  let skipRow: string | null = null;
  let adProgress = false;
  let labelledCount = 0;

  const visit = (node: UiNodeSnapshot) => {
    const control = node.clickable || node.editable;
    let label = ownLabel(node);
    if (control) {
      const parts: string[] = [];
      childText(node, parts, consumed);
      if (!label) label = parts.join(' · ');
      else if (parts.length && !parts.includes(label)) label = `${label} · ${parts.join(' · ')}`;
    }
    const informative = control || (label.length > 0 && !consumed.has(node));
    const b = node.bounds;
    const onScreen = b.right > b.left && b.bottom > b.top;
    if (informative && onScreen && elements.length < MAX_ROWS) {
      const parts = labelParts(label);
      if (parts.some((p) => AD_WORD.test(p))) {
        adRows.push(String(elements.length));
        if (parts.some((p) => AD_PROGRESS.test(p))) adProgress = true;
      }
      if (control && skipRow === null && parts.some((p) => SKIP_AD.test(p))) skipRow = String(elements.length);
      if (label.length > MAX_LABEL) label = `${cutText(label, MAX_LABEL)}…`;
      const cx = Math.round((b.left + b.right) / 2);
      const cy = Math.round((b.top + b.bottom) / 2);
      if (label) labelledCount += 1;
      elements.push({
        idx: String(elements.length),
        type: shortType(node.className),
        label,
        tappable: node.clickable,
        editable: node.editable,
        disabled: !node.enabled,
        px: { x: cx, y: cy },
        grid: { x: toGrid(cx, size.width), y: toGrid(cy, size.height) },
        box: { left: toGrid(b.left, size.width), top: toGrid(b.top, size.height), right: toGrid(b.right, size.width), bottom: toGrid(b.bottom, size.height) },
      });
    }
    for (const child of node.children ?? []) visit(child);
  };
  if (root) visit(root);
  const model: ScreenModel = { size, elements, labelledCount };
  if (popup) model.popup = true;
  if (adRows.length) model.adRows = adRows;
  if (skipRow !== null) model.adPlaying = skipRow;
  else if (adProgress) model.adPlaying = '';
  return model;
}

/** Rows the vision helper found in a screenshot, appended as v1, v2… */
export function withSeenElements(model: ScreenModel, seen: { label: string; x: number; y: number; kind?: string }[]): ScreenModel {
  const extra: ScreenElement[] = seen.slice(0, 30).map((s, i) => {
    const gx = Math.max(0, Math.min(GRID, Math.round(s.x)));
    const gy = Math.max(0, Math.min(GRID, Math.round(s.y)));
    return {
      idx: `v${i + 1}`,
      type: (s.kind || 'seen').toLowerCase().slice(0, 8),
      label: cutText(wellFormed(String(s.label || '').replace(/\s+/g, ' ')), MAX_LABEL),
      tappable: true,
      editable: /field|input|box/i.test(s.kind ?? ''),
      disabled: false,
      px: { x: toPixels(gx, model.size.width), y: toPixels(gy, model.size.height) },
      grid: { x: gx, y: gy },
      box: { left: gx - 20, top: gy - 12, right: gx + 20, bottom: gy + 12 },
      seen: true,
    };
  });
  return { ...model, elements: [...model.elements.filter((e) => !e.seen), ...extra] };
}

/** The table the model reads. Same columns as before; tap_at is now on the 0–1000 grid. */
export function formatScreen(model: ScreenModel): string {
  if (!model.elements.length) return 'No visible UI elements found.';
  const rows = model.elements.map((e) => {
    let flags = '';
    if (e.tappable) flags += 't';
    if (e.editable) flags += 'e';
    if (e.disabled) flags += 'd';
    return `${e.idx}|${e.type}|${e.label}|${flags}|${e.grid.x},${e.grid.y}`;
  });
  return ['idx|type|label|flags|tap_at', ...rows, ...screenMarks(model)].join('\n');
}

/** What the phone itself says about this screen, one line each, under the list. */
export function screenMarks(model: ScreenModel): string[] {
  const marks: string[] = [];
  if (model.popup) marks.push('POP-UP: a dialog or pop-up is in front; only its rows are listed. Answer or close it (its button or BACK) to reach the screen behind.');
  if (model.adRows?.length || model.adPlaying != null) {
    let line = model.adRows?.length
      ? `ADS: row${model.adRows.length > 1 ? 's' : ''} ${model.adRows.join(', ')} ${model.adRows.length > 1 ? 'are' : 'is'} labelled as an ad by the app; unless the task is about ads, don't tap it or count it as the content asked for.`
      : 'ADS:';
    if (model.adPlaying) line += ` An ad is playing: tap "Skip ad" (row ${model.adPlaying}).`;
    else if (model.adPlaying === '') line += ' An ad is playing and cannot be skipped yet: wait for it to end (or for "Skip ad"), then check.';
    marks.push(line);
  }
  return marks;
}

/** The element under a grid point: the smallest box that holds it, else the nearest centre within reach. */
export function elementAt(model: ScreenModel | null, x: number, y: number): ScreenElement | null {
  if (!model) return null;
  const holding = model.elements.filter((e) => x >= e.box.left && x <= e.box.right && y >= e.box.top && y <= e.box.bottom && (e.tappable || e.editable));
  if (holding.length) {
    return holding.reduce((a, b) => ((a.box.right - a.box.left) * (a.box.bottom - a.box.top) <= (b.box.right - b.box.left) * (b.box.bottom - b.box.top) ? a : b));
  }
  let best: ScreenElement | null = null;
  let bestD = 40;
  for (const e of model.elements) {
    const d = Math.hypot(e.grid.x - x, e.grid.y - y);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

type Box = ScreenElement['box'];
const inside = (b: Box, x: number, y: number) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
const encloses = (outer: Box, inner: Box) => outer.left <= inner.left && outer.top <= inner.top && outer.right >= inner.right && outer.bottom >= inner.bottom;

/**
 * Where to tap an element whose middle is covered by another control floating
 * over part of it (a mini player, a chat bubble, a floating button). The cover
 * is a tappable element over the middle that neither holds the element (a
 * container) nor sits inside it (its own child). Returns the uncovered point
 * nearest the middle, or null when the middle is free or nothing is free.
 * Oct 9: YouTube's mini player sat on a result's middle on a moto g9, and
 * every tap opened nothing (runs #3232, #3234).
 */
export function uncoveredPoint(model: ScreenModel | null, target: ScreenElement): { grid: { x: number; y: number }; cover: ScreenElement } | null {
  if (!model) return null;
  const covers = model.elements.filter(
    (e) => e !== target && (e.tappable || e.editable) && !e.seen && inside(e.box, target.grid.x, target.grid.y) && !encloses(e.box, target.box) && !encloses(target.box, e.box),
  );
  if (!covers.length) return null;
  const b = target.box;
  const w = b.right - b.left;
  const h = b.bottom - b.top;
  if (w < 4 || h < 4) return null;
  const free: { x: number; y: number; d: number }[] = [];
  for (const fx of [0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9]) {
    for (const fy of [0.15, 0.3, 0.5, 0.7, 0.85]) {
      const x = Math.round(b.left + w * fx);
      const y = Math.round(b.top + h * fy);
      if (covers.some((c) => inside(c.box, x, y))) continue;
      free.push({ x, y, d: Math.hypot(x - target.grid.x, y - target.grid.y) });
    }
  }
  if (!free.length) return null;
  free.sort((p, q) => p.d - q.d);
  return { grid: { x: free[0].x, y: free[0].y }, cover: covers[0] };
}

/**
 * The tapped button became another one in place, on what is still the same
 * screen: "Follow" → "Following". Null when the tap opened something else (a new
 * screen shares few rows with the old one), when nothing is at the spot any more,
 * or when the label did not change. Short labels only: a button, not a list row.
 */
export function buttonChange(
  before: ScreenModel | null,
  after: ScreenModel | null,
  grid: { x: number; y: number },
  tappedLabel: string,
): { from: string; to: string } | null {
  const from = tappedLabel.trim();
  if (!before || !after || !from || from.length > 30) return null;
  const now = elementAt(after, grid.x, grid.y);
  const to = now?.label.trim() ?? '';
  if (!to || to.length > 30 || to.toLowerCase() === from.toLowerCase()) return null;
  // Still the same screen: most labelled rows from before are still there.
  const was = new Set(before.elements.map((e) => e.label).filter(Boolean));
  const still = after.elements.filter((e) => e.label && was.has(e.label)).length;
  if (was.size < 3 || still / was.size < 0.6) return null;
  return { from, to };
}

/** Buttons that submit what was typed. Whole labels only: "Search" submits, "Search with your voice" does not. */
const SUBMIT = /^(?:search|go|send|submit|done|enter|find|ok|next|सर्च|खोजें|buscar|rechercher|suchen|cerca|pesquisar|поиск)$/i;
const squash = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * What to tap when Enter cannot submit the field: a Search/Go/Send button, else
 * the suggestion row whose text is exactly what was typed (search screens list
 * it first). The field itself never counts. Null when neither is on screen.
 */
export function submitTarget(model: ScreenModel | null, typed: string | null): ScreenElement | null {
  if (!model) return null;
  const usable = model.elements.filter((e) => e.tappable && !e.editable && !e.disabled && !e.seen);
  const button = usable.find((e) => SUBMIT.test(e.label.trim()));
  if (button) return button;
  const text = typed ? squash(typed) : '';
  if (!text) return null;
  return usable.find((e) => squash(e.label) === text || squash(labelParts(e.label)[0] ?? '') === text) ?? null;
}

/**
 * A screen the tree does not describe well enough to act on: few labelled
 * rows, or tappable rows that are mostly unlabelled (canvas, web view, game).
 */
export function isThin(model: ScreenModel): boolean {
  const tappable = model.elements.filter((e) => e.tappable || e.editable);
  const unlabelled = tappable.filter((e) => !e.label).length;
  return model.labelledCount < 8 || (tappable.length >= 4 && unlabelled / tappable.length > 0.5);
}

/** A stable key for "did the screen change": package plus the visible rows. */
export function screenKey(pkg: string | null, table: string | null): string {
  return `${pkg ?? ''}\n${table ?? ''}`;
}
