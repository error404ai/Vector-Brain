import { cutText, wellFormed } from './eko/screenModel';

/**
 * Bookkeeping must never end a run. A step's record or a task's final row can
 * fail to save — a character MySQL refuses, a field too large, a moment the
 * database is busy — and before this the error went up through the run and the
 * task ended as ERROR while the phone was doing fine (Oct 10: three runs on one
 * phone, a half emoji in the screen list). Now: save; on failure save again
 * without the heavy or unusual text; if that fails too, log it and carry on.
 */

type Repo<T> = { save: (entity: T) => Promise<unknown>; update?: (id: number, patch: Record<string, unknown>) => Promise<unknown> };
type Warn = (message: string) => void;

const clean = (value: unknown, max: number) => (typeof value === 'string' ? cutText(wellFormed(value), max) : value);
const why = (error: unknown) => String((error as Error)?.message ?? error).slice(0, 200);

/** A step's record. Returns false when it could not be stored at all (the run goes on). */
export async function saveStepLog<T extends Record<string, unknown>>(repo: Repo<T>, log: T, warn: Warn): Promise<boolean> {
  try {
    await repo.save(log);
    return true;
  } catch (error) {
    warn(`step record not saved, retrying without the screen: ${why(error)}`);
  }
  const l = log as Record<string, unknown>;
  l.ui_tree_snapshot = null;
  l.ui_tree_before = null;
  l.screenshot_base64 = null;
  for (const key of ['thought_reasoning', 'result_message', 'error_message']) l[key] = clean(l[key], 4000);
  try {
    await repo.save(log);
    return true;
  } catch (error) {
    warn(`step record still not saved; the run goes on without it: ${why(error)}`);
    return false;
  }
}

/** A task's final row: the result the user sees. Falls back to the status columns alone. */
export async function saveTaskResult<T extends { id: number } & Record<string, unknown>>(repo: Repo<T>, task: T, warn: Warn): Promise<boolean> {
  try {
    await repo.save(task);
    return true;
  } catch (error) {
    warn(`task ${task.id} result not saved, retrying without the screenshot: ${why(error)}`);
  }
  const t = task as Record<string, unknown>;
  t.final_screenshot = null;
  t.message = clean(t.message, 8000);
  t.errors = clean(t.errors, 8000);
  try {
    await repo.save(task);
    return true;
  } catch (error) {
    warn(`task ${task.id} result still not saved, storing its status only: ${why(error)}`);
  }
  if (!repo.update) return false;
  try {
    const patch: Record<string, unknown> = {};
    for (const key of ['status', 'success', 'reason_code', 'finished_at', 'lease_until', 'total_steps', 'total_duration_seconds', 'outcome']) {
      if (key in t) patch[key] = t[key];
    }
    await repo.update(task.id, patch);
    return true;
  } catch (error) {
    warn(`task ${task.id} status not saved: ${why(error)}`);
    return false;
  }
}
