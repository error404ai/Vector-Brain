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
}

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

const ownLabel = (n: UiNodeSnapshot) => (n.text?.trim() || n.contentDescription?.trim() || '').replace(/\s+/g, ' ');

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

export function buildScreenModel(root: UiNodeSnapshot | undefined, fallbackSize?: Partial<ScreenSize>): ScreenModel {
  const size = screenSizeOf(root, fallbackSize);
  const elements: ScreenElement[] = [];
  const consumed = new Set<UiNodeSnapshot>();
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
      if (label.length > MAX_LABEL) label = `${label.slice(0, MAX_LABEL)}…`;
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
  return { size, elements, labelledCount };
}

/** Rows the vision helper found in a screenshot, appended as v1, v2… */
export function withSeenElements(model: ScreenModel, seen: { label: string; x: number; y: number; kind?: string }[]): ScreenModel {
  const extra: ScreenElement[] = seen.slice(0, 30).map((s, i) => {
    const gx = Math.max(0, Math.min(GRID, Math.round(s.x)));
    const gy = Math.max(0, Math.min(GRID, Math.round(s.y)));
    return {
      idx: `v${i + 1}`,
      type: (s.kind || 'seen').toLowerCase().slice(0, 8),
      label: String(s.label || '').replace(/\s+/g, ' ').slice(0, MAX_LABEL),
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
  return ['idx|type|label|flags|tap_at', ...rows].join('\n');
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
