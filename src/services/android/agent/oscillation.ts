/**
 * True when the last `window` steps alternate between exactly two step
 * signatures (A, B, A, B, …): the run is bouncing between two screens with the
 * same two actions and getting nowhere.
 */
export function isOscillating(signatures: string[], window: number): boolean {
  if (window < 4 || signatures.length < window) return false;
  const recent = signatures.slice(-window);
  if (new Set(recent).size !== 2) return false;
  for (let i = 1; i < recent.length; i++) if (recent[i] === recent[i - 1]) return false;
  return true;
}
