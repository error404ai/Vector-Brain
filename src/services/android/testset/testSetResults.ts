import type { AgentTask } from '@/entities/AgentTask';
import type { Mission } from '@/entities/Mission';
import type { MissionItem } from '@/entities/MissionItem';
import { TEST_SET, type TestTask } from './testSet';

/** One task of a test-set run: how its phones did. */
export interface TestTaskResult {
  key: string;
  kind: TestTask['kind'] | 'other';
  prompt: string;
  phones: number;
  /** Phones still running or waiting. */
  pending: number;
  passed: number;
  /** Of passed: the system's check confirmed it (rule or judge), not just the agent's word. */
  verified: number;
  failed: number;
  costUsd: number;
  steps: number;
  /** Why the failed phones failed, most common first. */
  reasons: { reason: string; count: number }[];
}

export interface TestRunResult {
  run: string;
  startedAt: Date;
  phones: number;
  model: string | null;
  engine: string | null;
  finished: number;
  total: number;
  passed: number;
  verified: number;
  costUsd: number;
  tasks: TestTaskResult[];
}

/** "202610100734": sorts by time and fits in missions.source. */
export function runKey(at: Date): string {
  return at.toISOString().replace(/[-:T]/g, '').slice(0, 12);
}

/** Pure: missions, their items and runs → one result per test run, newest first. */
export function summarizeRuns(
  missions: Pick<Mission, 'id' | 'source' | 'prompt' | 'request' | 'created_at'>[],
  items: Pick<MissionItem, 'mission_id' | 'device_id' | 'status' | 'agent_task_id' | 'last_reason'>[],
  tasks: Pick<AgentTask, 'id' | 'status' | 'reason_code' | 'model' | 'engine' | 'total_steps' | 'verification' | 'diagnostics'>[],
): TestRunResult[] {
  const taskById = new Map(tasks.map((t) => [t.id, t]));
  const byRun = new Map<string, typeof missions>();
  for (const m of missions) {
    const run = String(m.source ?? '').replace(/^testset:/, '');
    if (!run) continue;
    byRun.set(run, [...(byRun.get(run) ?? []), m]);
  }
  const results: TestRunResult[] = [];
  for (const [run, ms] of byRun) {
    const phones = new Set<number>();
    let model: string | null = null;
    let engine: string | null = null;
    const rows: TestTaskResult[] = ms
      .sort((a, b) => a.id - b.id)
      .map((m) => {
        const prompt = m.prompt ?? m.request;
        const known = TEST_SET.find((t) => t.prompt === prompt);
        const row: TestTaskResult = { key: known?.key ?? `mission-${m.id}`, kind: known?.kind ?? 'other', prompt, phones: 0, pending: 0, passed: 0, verified: 0, failed: 0, costUsd: 0, steps: 0, reasons: [] };
        const reasons = new Map<string, number>();
        for (const item of items.filter((i) => i.mission_id === m.id)) {
          phones.add(item.device_id);
          row.phones += 1;
          const task = item.agent_task_id != null ? taskById.get(item.agent_task_id) : undefined;
          if (task) {
            model ??= task.model ?? null;
            engine ??= task.engine ?? null;
            row.costUsd += task.diagnostics?.cost_usd ?? 0;
            row.steps += task.total_steps ?? 0;
          }
          if (item.status === 'SUCCEEDED') {
            row.passed += 1;
            if (task?.verification?.status === 'verified') row.verified += 1;
          } else if (item.status === 'FAILED' || item.status === 'CANCELLED') {
            row.failed += 1;
            const reason = task?.reason_code ?? item.last_reason ?? item.status;
            reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
          } else {
            row.pending += 1;
          }
        }
        row.costUsd = Math.round(row.costUsd * 1e6) / 1e6;
        row.reasons = [...reasons].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count);
        return row;
      });
    const sum = (f: (r: TestTaskResult) => number) => rows.reduce((s, r) => s + f(r), 0);
    results.push({
      run,
      startedAt: ms.reduce((min, m) => (m.created_at < min ? m.created_at : min), ms[0].created_at),
      phones: phones.size,
      model,
      engine,
      total: sum((r) => r.phones),
      finished: sum((r) => r.passed + r.failed),
      passed: sum((r) => r.passed),
      verified: sum((r) => r.verified),
      costUsd: Math.round(sum((r) => r.costUsd) * 1e6) / 1e6,
      tasks: rows,
    });
  }
  return results.sort((a, b) => (a.run < b.run ? 1 : -1));
}
