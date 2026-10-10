import { runKey, summarizeRuns } from './testSetResults';
import { TEST_SET } from './testSet';

describe('test set results', () => {
  it('groups missions by run and counts each task’s phones', () => {
    const at = new Date('2026-10-10T07:40:00Z');
    const missions = [
      { id: 1, source: 'testset:202610100740', prompt: TEST_SET[0].prompt, request: TEST_SET[0].prompt, created_at: at },
      { id: 2, source: 'testset:202610100740', prompt: TEST_SET[7].prompt, request: TEST_SET[7].prompt, created_at: at },
      { id: 3, source: 'testset:202610090900', prompt: TEST_SET[0].prompt, request: TEST_SET[0].prompt, created_at: new Date('2026-10-09T09:00:00Z') },
    ];
    const items = [
      { mission_id: 1, device_id: 48, status: 'SUCCEEDED', agent_task_id: 10, last_reason: null },
      { mission_id: 1, device_id: 49, status: 'SUCCEEDED', agent_task_id: 11, last_reason: null },
      { mission_id: 2, device_id: 48, status: 'FAILED', agent_task_id: 12, last_reason: null },
      { mission_id: 2, device_id: 49, status: 'PENDING', agent_task_id: null, last_reason: null },
      { mission_id: 3, device_id: 48, status: 'SUCCEEDED', agent_task_id: 13, last_reason: null },
    ] as never[];
    const task = (id: number, verified: boolean, cost: number, reason: string | null = null) =>
      ({ id, status: reason ? 'FAILED' : 'SUCCEEDED', reason_code: reason, model: 'anthropic/claude-haiku-5.5', engine: 'lite', total_steps: 10, verification: { status: verified ? 'verified' : 'unverified' }, diagnostics: { cost_usd: cost } }) as never;
    const runs = summarizeRuns(missions as never[], items, [task(10, true, 0.001), task(11, false, 0.002), task(12, false, 0.003, 'AGENT_REPORTED_FAILURE'), task(13, true, 0.001)]);
    expect(runs.map((r) => r.run)).toEqual(['202610100740', '202610090900']);
    const latest = runs[0];
    expect(latest).toMatchObject({ phones: 2, total: 4, finished: 3, passed: 2, verified: 1, costUsd: 0.006, model: 'anthropic/claude-haiku-5.5', engine: 'lite' });
    expect(latest.tasks[0]).toMatchObject({ key: 'open-youtube', passed: 2, verified: 1 });
    expect(latest.tasks[1]).toMatchObject({ key: 'visit-5-sites', failed: 1, pending: 1, reasons: [{ reason: 'AGENT_REPORTED_FAILURE', count: 1 }] });
  });

  it('run keys sort by time and fit the column', () => {
    expect(runKey(new Date('2026-10-10T07:40:12Z'))).toBe('202610100740');
    expect(`testset:${runKey(new Date())}`.length).toBeLessThanOrEqual(40);
  });

  it('every task has a unique key and no account-risky wording', () => {
    expect(new Set(TEST_SET.map((t) => t.key)).size).toBe(TEST_SET.length);
    for (const t of TEST_SET) expect(t.prompt).not.toMatch(/\b(send|buy|pay|delete|sign in|log in|post|comment)\b/i);
  });
});
