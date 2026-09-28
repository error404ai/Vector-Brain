/**
 * Stages a pushed companion update goes through on the phone. The names are the
 * ones ApkUpdates.Stage sends from the APK; keep the two lists in step.
 */
export const INSTALL_STAGES = [
  'received',
  'not_newer',
  'waiting_permission',
  'waiting_tap',
  'installing',
  'installed',
  'failed',
] as const;

export type InstallStage = (typeof INSTALL_STAGES)[number];

/** Stages that end the story for one transfer. */
const TERMINAL: ReadonlySet<InstallStage> = new Set(['installed', 'not_newer']);

export function isInstallStage(value: unknown): value is InstallStage {
  return typeof value === 'string' && (INSTALL_STAGES as readonly string[]).includes(value);
}

/**
 * Validates a report from the device. Returns null for anything that is not a
 * known stage, so a malformed or future stage never lands in the table.
 */
export function normalizeInstallReport(body: unknown): { stage: InstallStage; message: string | null } | null {
  if (!body || typeof body !== 'object') return null;
  const { stage, message } = body as { stage?: unknown; message?: unknown };
  if (!isInstallStage(stage)) return null;
  const text = typeof message === 'string' ? message.trim().slice(0, 500) : '';
  return { stage, message: text || null };
}

/**
 * Whether a new report may replace the stored stage. Reports can arrive out of
 * order (the old build queues one, the new build sends another), so once a
 * transfer is installed, or turned out not to be an update, nothing earlier may
 * overwrite that.
 */
export function acceptsInstallStage(current: string | null | undefined, next: InstallStage): boolean {
  if (current && isInstallStage(current) && TERMINAL.has(current)) return current === next;
  return true;
}
