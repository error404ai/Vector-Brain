import { AgentTask } from '@/entities/AgentTask';
import { Mission } from '@/entities/Mission';
import { MissionItem } from '@/entities/MissionItem';
import AppError from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import { In, Like } from 'typeorm';
import { Service } from 'typedi';
import { MissionService } from '../MissionService';
import { TEST_SET, type TestTask } from './testSet';
import { runKey, summarizeRuns, type TestRunResult } from './testSetResults';

const MAX_PHONES = 10;
const RUNS_SHOWN = 12;

/**
 * Starts the fixed test set (testSet.ts) on a few phones — one mission per task,
 * tagged "testset:<run>" — and reads back how each run did, so two versions of
 * the agent can be compared on the same tasks. Missions on the same phone wait
 * for each other (DEVICE_BUSY puts an item back in line), so a run is simply all
 * missions created at once.
 */
@Service()
export class TestSetService {
  private missionRepo = AppDataSource.getRepository(Mission);
  private itemRepo = AppDataSource.getRepository(MissionItem);
  private taskRepo = AppDataSource.getRepository(AgentTask);

  constructor(private missionService: MissionService) {}

  tasks(): readonly TestTask[] {
    return TEST_SET;
  }

  async start(userId: number, deviceIds: number[], keys?: string[]): Promise<{ run: string; missions: number }> {
    const phones = [...new Set(deviceIds.map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    if (!phones.length) throw new AppError('Pick at least one phone', 400);
    if (phones.length > MAX_PHONES) throw new AppError(`At most ${MAX_PHONES} phones per test run`, 400);
    const chosen = keys?.length ? TEST_SET.filter((t) => keys.includes(t.key)) : [...TEST_SET];
    if (!chosen.length) throw new AppError('None of those tasks are in the test set', 400);
    const run = runKey(new Date());
    for (const task of chosen) {
      await this.missionService.create(userId, { request: task.prompt, device_ids: phones, source: `testset:${run}` });
    }
    return { run, missions: chosen.length };
  }

  async runs(userId: number): Promise<TestRunResult[]> {
    const missions = await this.missionRepo.find({ where: { user_id: userId, source: Like('testset:%') }, order: { id: 'DESC' }, take: RUNS_SHOWN * TEST_SET.length });
    if (!missions.length) return [];
    const items = await this.itemRepo.find({ where: { mission_id: In(missions.map((m) => m.id)) } });
    const taskIds = items.map((i) => i.agent_task_id).filter((id): id is number => id != null);
    const tasks = taskIds.length
      ? await this.taskRepo.find({
          where: { id: In(taskIds) },
          select: { id: true, status: true, reason_code: true, model: true, engine: true, total_steps: true, verification: true, diagnostics: true },
        })
      : [];
    return summarizeRuns(missions, items, tasks).slice(0, RUNS_SHOWN);
  }
}

