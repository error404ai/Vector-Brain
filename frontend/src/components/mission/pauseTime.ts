/** "~6 min left" for a paused timed mission: the phone with the most time left decides. */
export function timeLeft(durationSeconds: number | null, items: { run_seconds?: number; status: string }[]): string | null {
  if (!durationSeconds) return null;
  const open = items.filter((i) => i.status !== 'SUCCEEDED' && i.status !== 'FAILED' && i.status !== 'CANCELLED');
  if (!open.length) return null;
  const left = Math.max(...open.map((i) => durationSeconds - (i.run_seconds ?? 0)));
  if (left <= 0) return null;
  return left >= 90 ? `~${Math.round(left / 60)} min left` : `${Math.max(1, Math.round(left))}s left`;
}
