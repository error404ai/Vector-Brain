/**
 * Shared, mutable scroll state for the FLEET landing page. The DOM side
 * (useFleetLanding) writes it on scroll and pointer move; the WebGL scene reads
 * it every frame. A plain object avoids React re-renders on every scroll tick.
 */
export interface FleetState {
  /** 0–4: sum of the four pinned chapters' progress (hero, sheet, manifesto, scale). */
  phase: number;
  /** Progress through the scale chapter (1 → ∞ phones), 0–1. */
  p3: number;
  /** True while an opaque section fills the viewport, so the scene can skip rendering. */
  covered: boolean;
  reduceMotion: boolean;
  /** Pointer position, -1…1 on each axis. */
  mouseX: number;
  mouseY: number;
}

export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const ease = (t: number) => {
  const k = clamp(t);
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
};

/** Phones shown in the scale chapter: log scale from 1 to 1,000. */
export function fleetCount(p: number) {
  const q = clamp((p - 0.06) / 0.72);
  return Math.max(1, Math.round(Math.pow(10, q * 3)));
}

/** Share of the shown phones that have finished the task. */
export function doneFrac(p: number) {
  return clamp((p - 0.2) / 0.7) ** 1.4;
}
