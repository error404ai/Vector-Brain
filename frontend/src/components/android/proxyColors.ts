/**
 * A fixed colour for each proxy lane.
 *
 * Picked from the proxy's id rather than stored, so a lane looks the same on
 * every screen and in every browser without the user having to choose one. The
 * palette is small on purpose: past half a dozen lanes the colours stop being
 * distinguishable anyway, and repeating is less confusing than near-identical
 * shades.
 */
const LANE_COLORS = [
  '#2563eb', // blue
  '#16a34a', // green
  '#d97706', // amber
  '#db2777', // pink
  '#7c3aed', // violet
  '#0891b2', // cyan
  '#dc2626', // red
  '#65a30d', // lime
];

export function proxyColor(proxyId: number | null | undefined): string | undefined {
  if (!proxyId) return undefined;
  return LANE_COLORS[(proxyId - 1) % LANE_COLORS.length];
}

/** Short label for a chip, with the full name left to a tooltip. */
export function proxyShortName(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 10 ? `${trimmed.slice(0, 9)}…` : trimmed;
}
