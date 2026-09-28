/**
 * How a pushed companion update reads on the dashboard. Stage names come from
 * the phone (ApkUpdates.Stage) through services/android/installStatus.ts.
 */
export type InstallStage =
  | 'received'
  | 'not_newer'
  | 'waiting_permission'
  | 'waiting_tap'
  | 'installing'
  | 'installed'
  | 'failed';

export type InstallTone = 'success' | 'warning' | 'error' | 'info' | 'default';

const STAGES: Record<InstallStage, { label: string; tone: InstallTone; needsYou: boolean }> = {
  received: { label: 'Update downloaded', tone: 'info', needsYou: false },
  installing: { label: 'Installing', tone: 'info', needsYou: false },
  waiting_tap: { label: 'Tap to install on phone', tone: 'warning', needsYou: true },
  waiting_permission: { label: 'Allow installs on phone', tone: 'warning', needsYou: true },
  installed: { label: 'Updated', tone: 'success', needsYou: false },
  not_newer: { label: 'Already up to date', tone: 'default', needsYou: false },
  failed: { label: 'Update failed', tone: 'error', needsYou: true },
};

export function describeInstallStage(stage: string | null | undefined) {
  if (!stage) return null;
  return STAGES[stage as InstallStage] ?? { label: stage, tone: 'default' as InstallTone, needsYou: false };
}
