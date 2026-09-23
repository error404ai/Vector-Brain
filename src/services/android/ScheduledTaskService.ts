import { AndroidDevice, AndroidDeviceStatus } from '@/entities/AndroidDevice';
import { ScheduledTask } from '@/entities/ScheduledTask';
import AppError from '@/helpers/AppError';
import { ApiResponse } from '@/types/ApiResponse';
import Logger from '@/logger/index';
import { AppDataSource } from '@/loaders/database';
import { Repository } from 'typeorm';
import { Service } from 'typedi';
import { AndroidPlannerService } from './AndroidPlannerService';

/**
 * Shape accepted from the API layer. Every field is optional here because the
 * backend compiles with `strict: false`, and zod's inferred types mark all keys
 * optional in that mode. Zod still enforces the real requirements at runtime,
 * and createSchedule re-checks the two fields it cannot default.
 */
export interface ScheduledTaskInput {
  device_id?: number;
  prompt?: string;
  run_at?: string;
  days_of_week?: number[];
  timezone?: string;
  max_steps?: number;
  ai_config_id?: number | null;
  enabled?: boolean;
}

/** How often the runner wakes up. One minute is the resolution of run_at. */
const TICK_MS = 60_000;

@Service()
export class ScheduledTaskService {
  private scheduleRepo: Repository<ScheduledTask>;
  private deviceRepo: Repository<AndroidDevice>;
  private timer: ReturnType<typeof setInterval> | null = null;
  /** Guards against a slow tick overlapping the next one. */
  private ticking = false;

  constructor(private plannerService: AndroidPlannerService) {
    this.scheduleRepo = AppDataSource.getRepository(ScheduledTask);
    this.deviceRepo = AppDataSource.getRepository(AndroidDevice);
  }

  async listSchedules(userId: number): Promise<ApiResponse> {
    const schedules = await this.scheduleRepo.find({
      where: { user_id: userId },
      order: { run_at: 'ASC' },
    });
    return { message: 'Schedules fetched', data: schedules };
  }

  async createSchedule(userId: number, input: ScheduledTaskInput): Promise<ApiResponse> {
    if (!input.device_id) throw new AppError('Target device is required', 400);
    if (!input.prompt || !input.prompt.trim()) throw new AppError('Prompt cannot be empty', 400);
    if (!input.run_at) throw new AppError('Time is required', 400);

    await this.assertDeviceBelongsToUser(input.device_id, userId);

    const schedule = this.scheduleRepo.create({
      user_id: userId,
      device_id: input.device_id,
      prompt: input.prompt.trim(),
      run_at: input.run_at,
      days_of_week: (input.days_of_week ?? []).join(','),
      timezone: input.timezone || 'Asia/Kolkata',
      max_steps: input.max_steps ?? 500,
      ai_config_id: input.ai_config_id ?? null,
      enabled: input.enabled ?? true,
    });

    await this.scheduleRepo.save(schedule);
    return { message: 'Schedule created', data: schedule };
  }

  async updateSchedule(id: number, userId: number, input: Partial<ScheduledTaskInput>): Promise<ApiResponse> {
    const schedule = await this.scheduleRepo.findOne({ where: { id, user_id: userId } });
    if (!schedule) throw new AppError('Schedule not found', 404);

    if (input.device_id !== undefined) {
      await this.assertDeviceBelongsToUser(input.device_id, userId);
      schedule.device_id = input.device_id;
    }
    if (input.prompt !== undefined) schedule.prompt = input.prompt;
    if (input.run_at !== undefined) schedule.run_at = input.run_at;
    if (input.days_of_week !== undefined) schedule.days_of_week = input.days_of_week.join(',');
    if (input.timezone !== undefined) schedule.timezone = input.timezone;
    if (input.max_steps !== undefined) schedule.max_steps = input.max_steps;
    if (input.ai_config_id !== undefined) schedule.ai_config_id = input.ai_config_id;
    if (input.enabled !== undefined) schedule.enabled = input.enabled;

    await this.scheduleRepo.save(schedule);
    return { message: 'Schedule updated', data: schedule };
  }

  async deleteSchedule(id: number, userId: number): Promise<ApiResponse> {
    const schedule = await this.scheduleRepo.findOne({ where: { id, user_id: userId } });
    if (!schedule) throw new AppError('Schedule not found', 404);
    await this.scheduleRepo.remove(schedule);
    return { message: 'Schedule deleted' };
  }

  /** Fire a schedule immediately, ignoring its clock. */
  async runNow(id: number, userId: number): Promise<ApiResponse> {
    const schedule = await this.scheduleRepo.findOne({ where: { id, user_id: userId } });
    if (!schedule) throw new AppError('Schedule not found', 404);
    await this.fire(schedule);
    return { message: 'Schedule triggered', data: { last_result: schedule.last_result } };
  }

  private async assertDeviceBelongsToUser(deviceId: number, userId: number): Promise<AndroidDevice> {
    const device = await this.deviceRepo.findOne({ where: { id: deviceId, user_id: userId } });
    if (!device) throw new AppError('Device not found', 404);
    return device;
  }

  /**
   * Start the minute ticker. Safe to call twice — the second call is ignored.
   */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
    Logger.info('Scheduled task runner started');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Check every enabled schedule against the current wall-clock minute in its
   * own timezone, and fire the ones that match.
   */
  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const schedules = await this.scheduleRepo.find({ where: { enabled: true } });
      for (const schedule of schedules) {
        try {
          if (this.isDue(schedule, new Date())) {
            await this.fire(schedule);
          }
        } catch (error) {
          Logger.warn(`Scheduled task ${schedule.id} failed to fire`, error);
        }
      }
    } catch (error) {
      Logger.warn('Scheduled task tick failed', error);
    } finally {
      this.ticking = false;
    }
  }

  /**
   * True when `now` falls on the schedule's minute and weekday in its own zone,
   * and it has not already run during that same minute.
   */
  private isDue(schedule: ScheduledTask, now: Date): boolean {
    const local = this.localParts(now, schedule.timezone);
    if (local.hhmm !== schedule.run_at) return false;

    const days = schedule.days_of_week
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
      .map(Number);
    if (days.length > 0 && !days.includes(local.weekday)) return false;

    // The ticker can wake more than once inside the same minute, so make sure a
    // schedule cannot fire twice for one clock minute.
    if (schedule.last_run_at) {
      const previous = this.localParts(new Date(schedule.last_run_at), schedule.timezone);
      if (previous.hhmm === local.hhmm && previous.date === local.date) return false;
    }

    return true;
  }

  /** Wall-clock parts of an instant in a given IANA zone. */
  private localParts(instant: Date, timezone: string): { hhmm: string; weekday: number; date: string } {
    let formatter: Intl.DateTimeFormat;
    try {
      formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: timezone || 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour12: false,
      });
    } catch {
      // An unknown zone should not stop every other schedule from running.
      formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'UTC',
        hour: '2-digit',
        minute: '2-digit',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour12: false,
      });
    }

    const parts = formatter.formatToParts(instant);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    const weekdayNames: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

    return {
      hhmm: `${get('hour')}:${get('minute')}`,
      weekday: weekdayNames[get('weekday')] ?? 0,
      date: `${get('year')}-${get('month')}-${get('day')}`,
    };
  }

  /**
   * Run a schedule's prompt. A schedule whose phone is offline is recorded as
   * skipped rather than left to fail deep inside the planner.
   */
  private async fire(schedule: ScheduledTask): Promise<void> {
    schedule.last_run_at = new Date();

    const device = await this.deviceRepo.findOne({ where: { id: schedule.device_id } });
    if (!device) {
      schedule.last_result = 'Skipped — device no longer paired';
      await this.scheduleRepo.save(schedule);
      return;
    }
    if (device.status !== AndroidDeviceStatus.ONLINE) {
      schedule.last_result = 'Skipped — device offline';
      await this.scheduleRepo.save(schedule);
      return;
    }

    // Save before running: the task itself can take minutes, and the record
    // must already show that this minute was claimed.
    schedule.last_result = 'Started';
    await this.scheduleRepo.save(schedule);

    try {
      await this.plannerService.runTask(
        schedule.prompt,
        schedule.device_id,
        schedule.user_id,
        schedule.max_steps,
        undefined,
        schedule.ai_config_id ?? undefined,
      );
      schedule.last_result = 'Completed';
    } catch (error: any) {
      schedule.last_result = `Failed — ${String(error?.message ?? 'unknown error').slice(0, 200)}`;
    }

    await this.scheduleRepo.save(schedule);
  }
}
