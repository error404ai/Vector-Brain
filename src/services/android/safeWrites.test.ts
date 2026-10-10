import { saveStepLog, saveTaskResult } from './safeWrites';

describe('bookkeeping never ends a run', () => {
  it('a step record MySQL refuses is saved again without the screen', async () => {
    const saved: Record<string, unknown>[] = [];
    const repo = {
      save: jest.fn(async (log: Record<string, unknown>) => {
        if (log.ui_tree_snapshot) throw new Error('Invalid JSON text: "The surrogate pair in string is invalid."');
        saved.push({ ...log });
      }),
    };
    const warn = jest.fn();
    const log = { ui_tree_snapshot: 'x\uD83D', ui_tree_before: 'y', thought_reasoning: 'ok \uD83D', result_message: 'done' };
    await expect(saveStepLog(repo, log, warn)).resolves.toBe(true);
    expect(saved[0]).toMatchObject({ ui_tree_snapshot: null, thought_reasoning: 'ok �' });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('a database that refuses everything: the step is skipped, nothing throws', async () => {
    const repo = { save: jest.fn(async () => { throw new Error('connection lost'); }) };
    await expect(saveStepLog(repo, { ui_tree_snapshot: 'x' }, jest.fn())).resolves.toBe(false);
  });

  it('a task result falls back to its status columns', async () => {
    const update = jest.fn(async () => undefined);
    const repo = { save: jest.fn(async () => { throw new Error('Data too long'); }), update };
    const task = { id: 7, status: 'SUCCEEDED', success: true, reason_code: null, final_screenshot: 'big', message: 'm', finished_at: new Date(0) };
    await expect(saveTaskResult(repo, task, jest.fn())).resolves.toBe(true);
    expect(update).toHaveBeenCalledWith(7, expect.objectContaining({ status: 'SUCCEEDED', success: true }));
  });
});
