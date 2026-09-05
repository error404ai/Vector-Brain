import { AgentTask } from '@/entities/AgentTask';
import { AndroidDevice, AndroidDeviceStatus } from '@/entities/AndroidDevice';
import { AndroidStepStatus, AndroidTaskLog } from '@/entities/AndroidTaskLog';
import { FlowStep, SavedFlow } from '@/entities/SavedFlow';
import AppError from '@/helpers/AppError';
import Logger from '@/logger/index';
import { AppDataSource } from '@/loaders/database';
import { ApiResponse } from '@/types/ApiResponse';
import { Repository } from 'typeorm';
import { Service } from 'typedi';
import { AndroidGatewayService } from './AndroidGatewayService';
import { AutomationAction } from './AndroidProtocol';

/** Actions that can be replayed verbatim. Anything else is framework bookkeeping. */
const REPLAYABLE = new Set([
  'open_app',
  'open_url',
  'tap_coordinate',
  'type_text',
  'swipe',
  'global_action',
  'wait',
]);

/** Breathing room between actions so the screen can settle, as it would live. */
const STEP_GAP_MS = 600;

@Service()
export class FlowReplayService {
  private flowRepo: Repository<SavedFlow> = AppDataSource.getRepository(SavedFlow);
  private taskRepo: Repository<AgentTask> = AppDataSource.getRepository(AgentTask);
  private logRepo: Repository<AndroidTaskLog> = AppDataSource.getRepository(AndroidTaskLog);
  private deviceRepo: Repository<AndroidDevice> = AppDataSource.getRepository(AndroidDevice);

  constructor(private gatewayService: AndroidGatewayService) {}

  async listFlows(userId: number): Promise<ApiResponse> {
    const flows = await this.flowRepo.find({ where: { user_id: userId }, order: { updated_at: 'DESC' } });
    return {
      message: 'Flows fetched',
      data: flows.map((flow) => ({
        id: flow.id,
        name: flow.name,
        source_prompt: flow.source_prompt,
        step_count: flow.step_count,
        coordinate_step_count: flow.coordinate_step_count,
        run_count: flow.run_count,
        last_run_at: flow.last_run_at,
        created_at: flow.created_at,
      })),
    };
  }

  /**
   * Turn a completed run into a flow.
   *
   * Only the device actions are kept. The thoughts, screen dumps and screenshots
   * that made the original run expensive are exactly what a replay does not need.
   */
  async saveFromTask(taskId: number, userId: number, name?: string): Promise<ApiResponse> {
    const task = await this.taskRepo.findOne({ where: { id: taskId, user_id: userId } });
    if (!task) throw new AppError('Task not found', 404);

    const logs = await this.logRepo.find({
      where: { agent_task_id: task.id },
      order: { step_index: 'ASC' },
    });

    const steps: FlowStep[] = [];
    for (const log of logs) {
      if (!REPLAYABLE.has(log.action_type)) continue;
      // A step that failed live will fail again; leave it out of the recording.
      if (log.status === AndroidStepStatus.FAILED) continue;

      const payload = (log.action_payload ?? {}) as Record<string, unknown>;
      steps.push({
        action_type: log.action_type,
        action_payload: payload,
        label: describeStep(log.action_type, payload),
      });
    }

    if (steps.length === 0) {
      throw new AppError('This run has no replayable steps yet', 400);
    }

    const needsText = steps.some(
      (step) => step.action_type === 'type_text' && (step.action_payload as any)?.text === '[REDACTED]',
    );

    const flow = this.flowRepo.create({
      user_id: userId,
      name: (name || task.prompt || 'Saved flow').slice(0, 150),
      source_prompt: task.prompt,
      source_task_id: task.id,
      steps_json: JSON.stringify(steps),
      step_count: steps.length,
      coordinate_step_count: steps.filter((step) => step.action_type === 'tap_coordinate').length,
    });
    await this.flowRepo.save(flow);

    return {
      message: 'Flow saved',
      data: {
        id: flow.id,
        step_count: flow.step_count,
        coordinate_step_count: flow.coordinate_step_count,
        needs_text: needsText,
      },
    };
  }

  async deleteFlow(id: number, userId: number): Promise<ApiResponse> {
    const flow = await this.flowRepo.findOne({ where: { id, user_id: userId } });
    if (!flow) throw new AppError('Flow not found', 404);
    await this.flowRepo.remove(flow);
    return { message: 'Flow deleted' };
  }

  async renameFlow(id: number, userId: number, name: string): Promise<ApiResponse> {
    const flow = await this.flowRepo.findOne({ where: { id, user_id: userId } });
    if (!flow) throw new AppError('Flow not found', 404);
    flow.name = name.slice(0, 150);
    await this.flowRepo.save(flow);
    return { message: 'Flow renamed', data: { id: flow.id, name: flow.name } };
  }

  /**
   * Replay a flow on a device. No model is involved, so this costs nothing and
   * runs at the speed of the phone rather than the speed of inference.
   */
  async runFlow(id: number, userId: number, deviceDbId: number): Promise<ApiResponse> {
    const flow = await this.flowRepo.findOne({ where: { id, user_id: userId } });
    if (!flow) throw new AppError('Flow not found', 404);

    const device = await this.deviceRepo.findOne({ where: { id: deviceDbId, user_id: userId } });
    if (!device) throw new AppError('Device not found', 404);
    if (device.status !== AndroidDeviceStatus.ONLINE) {
      throw new AppError('Device is offline', 400);
    }

    const steps: FlowStep[] = JSON.parse(flow.steps_json);

    // Recorded as a normal task so it shows up in history and the live view
    // behaves exactly as it does for an AI run.
    const task = this.taskRepo.create({
      user_id: userId,
      device_id: device.id,
      prompt: `▶ ${flow.name}`,
      provider: 'replay',
      model: 'replay (no AI)',
      success: false,
      total_steps: 0,
      total_duration_seconds: 0,
    });
    await this.taskRepo.save(task);

    void this.execute(flow, steps, task, device, userId).catch((error) => {
      Logger.warn(`[FlowReplay] Flow ${flow.id} failed`, error);
    });

    return { message: 'Flow started', data: { taskId: task.id, steps: steps.length } };
  }

  private async execute(
    flow: SavedFlow,
    steps: FlowStep[],
    task: AgentTask,
    device: AndroidDevice,
    userId: number,
  ): Promise<void> {
    const startedAt = Date.now();

    this.gatewayService.broadcastToUser(userId, 'task:started', {
      taskId: task.id,
      deviceId: device.id,
      prompt: task.prompt,
    });

    let executed = 0;
    let failure: string | null = null;

    for (let index = 0; index < steps.length; index++) {
      const step = steps[index];
      const stepStart = Date.now();

      const log = this.logRepo.create({
        agent_task_id: task.id,
        device_id: device.id,
        step_index: index + 1,
        action_type: step.action_type,
        action_payload: step.action_payload,
        thought_reasoning: step.label,
        status: AndroidStepStatus.EXECUTING,
      });
      await this.logRepo.save(log);

      this.gatewayService.broadcastToUser(userId, 'task:step', {
        taskId: task.id,
        deviceId: device.id,
        stepIndex: index + 1,
        thought: step.label,
        action: { type: step.action_type, ...(step.action_payload ?? {}) },
      });

      const action = toAutomationAction(step);
      let ok = false;
      let resultText = '';

      if (!action) {
        resultText = `Skipped: ${step.action_type} cannot be replayed`;
        ok = true;
      } else {
        try {
          const res = await this.gatewayService.executeAction(device.device_id, action);
          if (res.status === 'SUCCESS') {
            ok = true;
            resultText = res.summary || 'Done';
          } else if (res.status === 'FAILURE') {
            resultText = `${res.code}: ${res.message}`;
          } else {
            resultText = 'Action cancelled';
          }
        } catch (error: any) {
          resultText = String(error?.message ?? 'Device did not respond');
        }
      }

      log.status = ok ? AndroidStepStatus.SUCCESS : AndroidStepStatus.FAILED;
      log.result_message = resultText;
      log.duration_ms = Date.now() - stepStart;
      await this.logRepo.save(log);

      this.gatewayService.broadcastToUser(userId, 'task:step_result', {
        taskId: task.id,
        deviceId: device.id,
        stepIndex: index + 1,
        status: ok ? AndroidStepStatus.SUCCESS : AndroidStepStatus.FAILED,
        result: resultText,
        error: ok ? undefined : resultText,
      });

      if (!ok) {
        // A recorded route only makes sense in order, so a broken step ends the
        // replay rather than carrying on against a screen that has diverged.
        failure = `Step ${index + 1} (${step.label}) failed: ${resultText}`;
        break;
      }

      executed += 1;
      // Push a fresh frame so the dashboard keeps up with the replay.
      void this.pushFrame(device.device_id, userId);
      await new Promise((resolve) => setTimeout(resolve, STEP_GAP_MS));
    }

    const durationSeconds = (Date.now() - startedAt) / 1000;
    const success = !failure;

    task.success = success;
    task.total_steps = executed;
    task.total_duration_seconds = durationSeconds;
    task.message = success
      ? `Replayed "${flow.name}" — ${executed} steps in ${durationSeconds.toFixed(1)}s with no AI calls.`
      : `${failure}\n\nThe screen may have changed since this flow was recorded. Run the original instruction with the agent and save it again.`;
    await this.taskRepo.save(task);

    flow.run_count += 1;
    flow.last_run_at = new Date();
    await this.flowRepo.save(flow);

    this.gatewayService.broadcastToUser(userId, success ? 'task:completed' : 'task:error', {
      taskId: task.id,
      deviceId: device.id,
      success,
      message: task.message,
      error: failure ?? undefined,
    });
  }

  /** Best-effort screen refresh; a missing frame must not break the replay. */
  private async pushFrame(hardwareDeviceId: string, userId: number): Promise<void> {
    try {
      const res = await this.gatewayService.executeAction(hardwareDeviceId, { type: 'CaptureScreen' }, 5000);
      const frame = res.status === 'SUCCESS' ? res.screenCapture?.base64Data : undefined;
      if (frame) {
        this.gatewayService.broadcastToUser(userId, 'device:screen_capture', {
          deviceId: hardwareDeviceId,
          result: { screenCapture: { base64Data: frame } },
        });
      }
    } catch {
      // Ignore — the replay itself is what matters.
    }
  }
}

/** Rebuild the device action from what was recorded. */
function toAutomationAction(step: FlowStep): AutomationAction | null {
  const payload = (step.action_payload ?? {}) as Record<string, any>;

  switch (step.action_type) {
    case 'open_app':
      return payload.packageName ? { type: 'OpenApp', packageName: String(payload.packageName) } : null;
    case 'open_url':
      return payload.url ? { type: 'OpenUrl', url: String(payload.url) } : null;
    case 'tap_coordinate':
      return typeof payload.x === 'number' && typeof payload.y === 'number'
        ? { type: 'Tap', x: payload.x, y: payload.y }
        : null;
    case 'type_text':
      // Typed text is never stored, so there is nothing to replay here.
      return typeof payload.text === 'string' && payload.text !== '[REDACTED]'
        ? { type: 'SetText', text: payload.text }
        : null;
    case 'swipe':
      return payload.direction
        ? {
            type: 'Swipe',
            direction: String(payload.direction).toUpperCase() === 'DOWN' ? 'UP' : 'DOWN',
            durationMillis: Number(payload.durationMillis) || 400,
          }
        : null;
    case 'global_action':
      return payload.action
        ? { type: 'Global', action: String(payload.action).toUpperCase() as any }
        : null;
    case 'wait':
      return { type: 'Wait', durationMillis: Number(payload.durationMillis) || 2000 };
    default:
      return null;
  }
}

/** Short human label for a step, shown while the flow replays. */
function describeStep(actionType: string, payload: Record<string, unknown>): string {
  const value = payload as Record<string, any>;
  switch (actionType) {
    case 'open_app':
      return `Open ${String(value.packageName ?? 'app').split('.').pop()}`;
    case 'open_url':
      return `Open ${String(value.url ?? 'page').slice(0, 60)}`;
    case 'tap_coordinate':
      return `Tap (${value.x}, ${value.y})`;
    case 'type_text':
      return value.text && value.text !== '[REDACTED]' ? `Type "${value.text}"` : 'Type into the field';
    case 'swipe':
      return `Scroll ${String(value.direction ?? '').toLowerCase() || 'down'}`;
    case 'global_action':
      return `Press ${String(value.action ?? 'back').toLowerCase()}`;
    case 'wait':
      return `Wait ${Math.round((Number(value.durationMillis) || 2000) / 1000)}s`;
    default:
      return actionType;
  }
}
