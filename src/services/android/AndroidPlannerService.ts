import { AgentTask } from '@/entities/AgentTask';
import { AndroidStepStatus, AndroidTaskLog } from '@/entities/AndroidTaskLog';
import AppError from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import Logger from '@/logger/index';
import { ApiResponse } from '@/types/ApiResponse';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { Runnable } from '@langchain/core/runnables';
import { Service } from 'typedi';
import * as z from 'zod';
import { AndroidDeviceService } from './AndroidDeviceService';
import { AndroidGatewayService } from './AndroidGatewayService';
import { ActionResult, AutomationAction, UiNodeSnapshot, UiTreeSnapshot } from './AndroidProtocol';
import { AiConfigService, DecryptedAiConfig } from '../controllerService/AiConfigService';
import { AiConfigType } from '@/entities/AiConfig';


const DecisionSchema = z.object({
  thought: z.string().describe('Analysis of current screen and reasoning for the next step'),
  isFinished: z.boolean().describe('True if the user goal has been fully accomplished or cannot proceed'),
  finishStatus: z.enum(['SUCCESS', 'FAILED']).optional(),
  finishMessage: z.string().optional(),
  safetyLevel: z.enum(['LOW', 'USER_CONFIRMATION_REQUIRED', 'BLOCKED']).default('LOW'),
  action: z
    .discriminatedUnion('type', [
      z.object({
        type: z.literal('OpenApp'),
        packageName: z.string().describe('Android application package name e.g. com.google.android.youtube'),
      }),
      z.object({
        type: z.literal('OpenUrl'),
        url: z.string().url().describe('An http or https URL to open in the default browser'),
      }),
      z.object({
        type: z.literal('ClickNode'),
        nodePath: z.string().optional().describe('Path index in the UI tree like 0/1/3'),
        viewId: z.string().optional().describe('Resource ID of the target view'),
        text: z.string().optional().describe('Text label on the button/view'),
      }),
      z.object({
        type: z.literal('Tap'),
        x: z.number().describe('X coordinate on screen in pixels'),
        y: z.number().describe('Y coordinate on screen in pixels'),
      }),
      z.object({
        type: z.literal('SetText'),
        nodePath: z.string().optional(),
        viewId: z.string().optional(),
        text: z.string().describe('Text content to type into the input field'),
      }),
      z.object({
        type: z.literal('Swipe'),
        direction: z.enum(['UP', 'DOWN', 'LEFT', 'RIGHT']),
        durationMillis: z.number().default(400),
      }),
      z.object({
        type: z.literal('Global'),
        action: z.enum(['BACK', 'HOME', 'RECENTS', 'NOTIFICATIONS']),
      }),
      z.object({
        type: z.literal('Wait'),
        durationMillis: z.number().default(1000),
      }),
    ])
    .describe('Atomic Android action to execute next; use Wait when isFinished is true because the action will be ignored'),
}).superRefine((decision, context) => {
  if (decision.isFinished && !decision.finishStatus) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['finishStatus'], message: 'A finish status is required when the goal is finished' });
  }
  if (decision.action?.type === 'ClickNode' && !decision.action.nodePath && !decision.action.viewId && !decision.action.text) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['action'], message: 'ClickNode requires a selector' });
  }
  if (decision.action?.type === 'SetText' && !decision.action.nodePath && !decision.action.viewId) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['action'], message: 'SetText requires a nodePath or viewId' });
  }
});

type AgentDecision = z.infer<typeof DecisionSchema>;

@Service()
export class AndroidPlannerService {
  private agentTaskRepo = AppDataSource.getRepository(AgentTask);
  private taskLogRepo = AppDataSource.getRepository(AndroidTaskLog);
  private activeTasks = new Map<number, { cancelled: boolean; deviceId: string }>();
  private activeDeviceTasks = new Map<string, number>();

  constructor(
    private deviceService: AndroidDeviceService,
    private gatewayService: AndroidGatewayService,
    private aiConfigService: AiConfigService,
  ) {}

  /**
   * Main autonomous reasoning loop for Android task execution.
   */
  async runTask(prompt: string, deviceId: number, userId: number, maxSteps = 15): Promise<ApiResponse> {
    const aiConfig = await this.aiConfigService.resolveActiveConfig(userId);
    if (!aiConfig) {
      throw new AppError(
        'No active AI configuration found. Please add and activate an AI provider (OpenAI, Gemini, DeepSeek, Groq, Anthropic, OpenRouter) in Settings.',
        400,
      );
    }
    if (!this.isActionablePrompt(prompt)) {
      throw new AppError('Please enter a concrete Android task, for example: "Open Chrome and go to google.com".', 400);
    }

    const device = await this.deviceService.getDeviceById(deviceId, userId);

    if (!this.gatewayService.isDeviceConnected(device.device_id)) {
      throw new AppError(`Device "${device.device_name}" is currently offline. Please open the companion app on the device.`, 400);
    }
    if (this.activeDeviceTasks.has(device.device_id)) {
      throw new AppError(`Device "${device.device_name}" is already running another automation task.`, 409);
    }

    await this.assertDeviceReady(device.device_id);

    // 1. Create AgentTask record with user's configured provider & model
    const agentTask = this.agentTaskRepo.create({
      user_id: userId,
      prompt,
      provider: aiConfig.provider,
      model: aiConfig.model,
      success: false,
      total_steps: 0,
      total_duration_seconds: 0,
      logs: `Starting Android automation task with ${aiConfig.provider} (${aiConfig.model})...\n`,
    });
    await this.agentTaskRepo.save(agentTask);

    this.activeTasks.set(agentTask.id, { cancelled: false, deviceId: device.device_id });
    this.activeDeviceTasks.set(device.device_id, agentTask.id);
    const startTime = Date.now();

    // Notify web clients that task has begun
    this.gatewayService.broadcastToUser(userId, 'task:started', {
      taskId: agentTask.id,
      deviceId: device.id,
      prompt,
      model: aiConfig.model,
      provider: aiConfig.provider,
    });

    // Run the execution loop in the background
    this.executeLoop(agentTask, device.device_id, userId, prompt, maxSteps, startTime, aiConfig).catch((err) => {
      Logger.error(`[AndroidPlanner] Unhandled error in task ${agentTask.id}:`, err);
    });

    return {
      message: 'Android task initiated successfully',
      data: {
        taskId: agentTask.id,
        status: 'RUNNING',
        provider: aiConfig.provider,
        model: aiConfig.model,
      },
    };
  }


  /**
   * Cancels a running task.
   */
  async cancelTask(taskId: number, userId: number): Promise<ApiResponse> {
    const task = await this.agentTaskRepo.findOne({ where: { id: taskId, user_id: userId } });
    if (!task) throw new AppError('Task not found', 404);

    const active = this.activeTasks.get(taskId);
    if (active) {
      active.cancelled = true;
      this.gatewayService.cancelDeviceActions(active.deviceId);
    }

    task.message = 'Task cancelled by user';
    task.success = false;
    await this.agentTaskRepo.save(task);

    this.gatewayService.broadcastToUser(userId, 'task:cancelled', { taskId });

    return { message: 'Task cancellation requested' };
  }

  private async executeLoop(
    agentTask: AgentTask,
    hardwareDeviceId: string,
    userId: number,
    prompt: string,
    maxSteps: number,
    startTime: number,
    aiConfig: DecryptedAiConfig,
  ) {
    let stepCount = 0;
    let finished = false;
    let wasCancelled = false;
    const history: Array<{ thought: string; action: any; result: string }> = [];
    let previousUiFingerprint: string | null = null;
    let unchangedWaitCount = 0;

    const device = await this.deviceService.getDeviceByHardwareId(hardwareDeviceId);
    const deviceDbId = device?.id;

    // Instantiate model once per task execution loop
    const chatModel = this.aiConfigService.createChatModel({
      provider: aiConfig.provider,
      model: aiConfig.model,
      api_key: aiConfig.api_key,
      base_url: aiConfig.base_url,
      temperature: 0.1,
    });
    const structuredLlm = chatModel.withStructuredOutput(DecisionSchema);

    try {
      while (stepCount < maxSteps) {
        if (this.activeTasks.get(agentTask.id)?.cancelled) {
          Logger.info(`[AndroidPlanner] Task ${agentTask.id} was cancelled.`);
          wasCancelled = true;
          break;
        }

        stepCount++;
        const stepStartTime = Date.now();

        // 1. Capture current UI Tree & Screen in parallel for lower latency
        const [treeResult, screenResult] = await Promise.all([
          this.gatewayService.executeAction(hardwareDeviceId, { type: 'ReadUiTree' }),
          this.gatewayService.executeAction(hardwareDeviceId, { type: 'CaptureScreen' }),
        ]);

        if (treeResult.status !== 'SUCCESS') {
          const detail = treeResult.status === 'FAILURE'
            ? `${treeResult.code}: ${treeResult.message}`
            : 'capture was cancelled';
          throw new Error(`Unable to inspect the Android screen: ${detail}`);
        }
        if (screenResult.status !== 'SUCCESS') {
          const detail = screenResult.status === 'FAILURE'
            ? `${screenResult.code}: ${screenResult.message}`
            : 'capture was cancelled';
          throw new Error(`Unable to capture the Android screen: ${detail}`);
        }

        const uiTree: UiTreeSnapshot | undefined = treeResult.uiTree;
        const screenCapture = screenResult.status === 'SUCCESS' ? screenResult.screenCapture : undefined;
        const screenshotBase64 = screenCapture?.base64Data;

        // 2. Format UI tree for AI context
        const compactTree = this.formatUiTree(uiTree?.root);
        const foregroundApp = uiTree?.packageName || 'unknown';

        // 3. Ask LLM for next decision using user's active AI configuration
        let decision = await this.queryModel(prompt, compactTree, foregroundApp, screenshotBase64, history, aiConfig, structuredLlm);
        decision = { ...decision, safetyLevel: this.enforceSafetyLevel(decision) };

        const uiFingerprint = `${foregroundApp}\n${compactTree}`;
        if (!decision.isFinished && decision.action?.type === 'Wait' && uiFingerprint === previousUiFingerprint) {
          unchangedWaitCount += 1;
        } else {
          unchangedWaitCount = 0;
        }
        previousUiFingerprint = uiFingerprint;

        if (unchangedWaitCount >= 2) {
          decision = {
            thought: `${decision.thought} The screen has not changed after repeated waits, so the task is stopping instead of consuming more AI calls.`,
            isFinished: true,
            finishStatus: 'FAILED',
            finishMessage: 'The device screen did not change after three consecutive wait decisions.',
            safetyLevel: 'LOW',
            action: { type: 'Wait', durationMillis: 1 },
          };
        }

        // 4. Record step log in DB
        const taskLog = this.taskLogRepo.create({
          agent_task_id: agentTask.id,
          device_id: deviceDbId,
          step_index: stepCount,
          action_type: decision.action?.type || (decision.isFinished ? 'FINISH' : 'WAIT'),
          action_payload: decision.action || null,
          thought_reasoning: decision.thought,
          status: AndroidStepStatus.EXECUTING,
          screenshot_base64: screenshotBase64,
          ui_tree_snapshot: compactTree,
        });
        await this.taskLogRepo.save(taskLog);

        // Broadcast step to user Web UI
        this.gatewayService.broadcastToUser(userId, 'task:step', {
          taskId: agentTask.id,
          stepIndex: stepCount,
          thought: decision.thought,
          action: decision.action,
          screenshot: screenshotBase64,
          foregroundApp,
        });

        // 5. Check if goal is achieved
        if (decision.isFinished) {
          taskLog.status = decision.finishStatus === 'FAILED' ? AndroidStepStatus.FAILED : AndroidStepStatus.SUCCESS;
          taskLog.result_message = decision.finishMessage || 'Task completed';
          taskLog.duration_ms = Date.now() - stepStartTime;
          await this.taskLogRepo.save(taskLog);

          agentTask.success = decision.finishStatus !== 'FAILED';
          agentTask.message = decision.finishMessage || 'Goal accomplished successfully';
          finished = true;
          break;
        }

        // 6. Execute action on device
        if (decision.action) {
          const actionResult = await this.gatewayService.executeAction(
            hardwareDeviceId,
            decision.action as AutomationAction,
            decision.safetyLevel === 'USER_CONFIRMATION_REQUIRED' ? 60_000 : 15_000,
            decision.safetyLevel,
          );
          const duration = Date.now() - stepStartTime;

          taskLog.duration_ms = duration;
          if (actionResult.status === 'SUCCESS') {
            taskLog.status = AndroidStepStatus.SUCCESS;
            taskLog.result_message = actionResult.summary;
            history.push({ thought: decision.thought, action: decision.action, result: actionResult.summary });
          } else if (actionResult.status === 'FAILURE') {
            taskLog.status = AndroidStepStatus.FAILED;
            taskLog.error_message = `${actionResult.code}: ${actionResult.message}`;
            history.push({ thought: decision.thought, action: decision.action, result: `Failed: ${actionResult.message}` });
          } else {
            taskLog.status = AndroidStepStatus.CANCELLED;
            taskLog.result_message = 'Action cancelled by user';
          }
          await this.taskLogRepo.save(taskLog);

          this.gatewayService.broadcastToUser(userId, 'task:step_result', {
            taskId: agentTask.id,
            stepIndex: stepCount,
            status: taskLog.status,
            result: taskLog.result_message,
            error: taskLog.error_message,
          });
        } else {
          taskLog.status = AndroidStepStatus.FAILED;
          taskLog.error_message = 'Planner did not return an action';
          taskLog.duration_ms = Date.now() - stepStartTime;
          await this.taskLogRepo.save(taskLog);
        }
      }

      // Finalize task
      if (!finished && !wasCancelled) {
        agentTask.success = false;
        agentTask.message = `Task stopped after reaching the ${maxSteps}-step limit.`;
      }
      agentTask.total_steps = stepCount;
      agentTask.total_duration_seconds = (Date.now() - startTime) / 1000;
      await this.agentTaskRepo.save(agentTask);

      if (!wasCancelled) {
        this.gatewayService.broadcastToUser(userId, 'task:completed', {
          taskId: agentTask.id,
          success: agentTask.success,
          message: agentTask.message,
          totalSteps: stepCount,
        });
      }
    } catch (err: any) {
      Logger.error(`[AndroidPlanner] Error during task loop:`, err);
      agentTask.success = false;
      agentTask.message = err.message || 'Task failed with internal error';
      await this.agentTaskRepo.save(agentTask);
      this.gatewayService.broadcastToUser(userId, 'task:error', { taskId: agentTask.id, error: err.message });
    } finally {
      this.activeTasks.delete(agentTask.id);
      if (this.activeDeviceTasks.get(hardwareDeviceId) === agentTask.id) {
        this.activeDeviceTasks.delete(hardwareDeviceId);
      }
    }
  }

  private async queryModel(
    goalPrompt: string,
    uiTreeText: string,
    foregroundApp: string,
    screenshotBase64: string | undefined,
    history: Array<{ thought: string; action: any; result: string }>,
    aiConfig: DecryptedAiConfig,
    structuredLlm: Runnable,
  ): Promise<AgentDecision> {

    try {
      const systemPrompt = `You are Vector-Brain, an expert autonomous AI agent controlling an Android mobile device.
Your goal is to accomplish the user's task step-by-step.

AVAILABLE ACTIONS:
- OpenApp: { type: "OpenApp", packageName: "package.name" }
- OpenUrl: { type: "OpenUrl", url: "https://example.com" } (prefer this for website/browser goals)
- ClickNode: { type: "ClickNode", nodePath: "0/1/2", text: "exact text", viewId: "com.app:id/btn" }
- SetText: { type: "SetText", nodePath: "0/1/2", text: "content to type" }
- Tap: { type: "Tap", x: 500, y: 800 }
- Swipe: { type: "Swipe", direction: "UP" | "DOWN" | "LEFT" | "RIGHT" }
- Global: { type: "Global", action: "BACK" | "HOME" | "RECENTS" | "NOTIFICATIONS" }
- Wait: { type: "Wait", durationMillis: 1000 }

RULES:
1. Always analyze the current screen UI tree and foreground package first.
2. If the target app is not open, use OpenApp first.
3. Use ClickNode or SetText with the correct nodePath or viewId from the visible UI hierarchy.
4. When the goal is completed, return isFinished = true with finishStatus = "SUCCESS" and a Wait action (finished actions are ignored).
5. If the screen is loading, use Wait.
6. Mark actions that send messages, place orders, make payments, delete data, or commit an external change as USER_CONFIRMATION_REQUIRED.
7. Mark dangerous or clearly unauthorized actions as BLOCKED. Never type into password fields.`;

      const userContent: any[] = [
        {
          type: 'text',
          text: `USER GOAL: "${goalPrompt}"
CURRENT FOREGROUND PACKAGE: ${foregroundApp}

RECENT HISTORY:
${history.map((h, i) => `Step ${i + 1}: ${h.thought} -> Action: ${JSON.stringify(h.action)} -> Result: ${h.result}`).join('\n')}

CURRENT VISIBLE UI NODES:
${uiTreeText}`,
        },
      ];

      // Only attach screenshot image if image is present and model is vision-capable
      const hasImage = Boolean(screenshotBase64 && aiConfig.config_type !== AiConfigType.TEXT);
      if (hasImage && screenshotBase64) {
        userContent.push({
          type: 'image_url',
          image_url: {
            url: `data:image/png;base64,${screenshotBase64}`,
          },
        });
      }

      const messages = [new SystemMessage(systemPrompt), new HumanMessage({ content: userContent })];

      try {
        const response = await structuredLlm.invoke(messages);
        return response as AgentDecision;
      } catch (invokeError: any) {
        // If provider rejects image input (e.g. text-only model or OpenRouter 404 image endpoint), fallback to text-only
        if (hasImage) {
          Logger.warn(
            `[AndroidPlanner] Model (${aiConfig.provider}/${aiConfig.model}) does not accept image input (${invokeError.message}). Falling back to text-only UI tree reasoning.`,
          );
          const textOnlyMessages = [
            new SystemMessage(systemPrompt),
            new HumanMessage({ content: [{ type: 'text', text: userContent[0].text }] }),
          ];
          const fallbackResponse = await structuredLlm.invoke(textOnlyMessages);
          return fallbackResponse as AgentDecision;
        }
        throw invokeError;
      }
    } catch (error) {
      Logger.error(`[AndroidPlanner] LLM invocation error (${aiConfig.provider}/${aiConfig.model}):`, error);
      return {
        thought: 'The planner could not produce a valid next action.',
        isFinished: true,
        finishStatus: 'FAILED',
        finishMessage: error instanceof Error ? error.message : 'The AI planner returned an invalid response.',
        safetyLevel: 'LOW',
        action: { type: 'Wait', durationMillis: 1 },
      };
    }
  }


  private isActionablePrompt(prompt: string): boolean {
    const normalized = prompt.trim().toLowerCase();
    if (normalized.length < 4) return false;

    return !/^(hi|hello|hey|test|help|thanks|thank you)[.!?\s]*$/.test(normalized);
  }

  private async assertDeviceReady(hardwareDeviceId: string): Promise<void> {
    const [treeResult, captureResult] = await Promise.all([
      this.gatewayService.executeAction(hardwareDeviceId, { type: 'ReadUiTree' }),
      this.gatewayService.executeAction(hardwareDeviceId, { type: 'CaptureScreen' }),
    ]);

    if (treeResult.status !== 'SUCCESS') {
      const detail = treeResult.status === 'FAILURE' ? treeResult.message : 'UI inspection was cancelled';
      throw new AppError(
        `Accessibility is not ready on the Android device. Open Android Automation, enable its accessibility service, then try again. ${detail}`,
        400,
      );
    }

    if (captureResult.status !== 'SUCCESS' || !captureResult.screenCapture?.base64Data) {
      const detail = captureResult.status === 'FAILURE' ? captureResult.message : 'No screen frame was returned';
      throw new AppError(
        `Screen capture is not ready on the Android device. Open Android Automation, tap "Enable screen capture", approve Android's prompt, then try again. ${detail}`,
        400,
      );
    }
  }


  private enforceSafetyLevel(decision: AgentDecision): AgentDecision['safetyLevel'] {
    if (decision.safetyLevel === 'BLOCKED' || decision.safetyLevel === 'USER_CONFIRMATION_REQUIRED') {
      return decision.safetyLevel;
    }

    if (decision.action?.type === 'ClickNode') {
      const target = `${decision.action.text || ''} ${decision.action.viewId || ''}`;
      if (/\b(send|submit|confirm|buy|purchase|pay|place.?order|delete|remove|publish|post)\b/i.test(target)) {
        return 'USER_CONFIRMATION_REQUIRED';
      }
    }

    return 'LOW';
  }

  private formatUiTree(node?: UiNodeSnapshot, depth = 0): string {
    if (!node || depth > 8) return '';
    const parts: string[] = [];

    const isInteractive = node.clickable || node.editable;
    const hasText = node.text || node.contentDescription;

    if (isInteractive || hasText) {
      const desc = [
        `path: ${node.path}`,
        node.viewId ? `id: ${node.viewId}` : null,
        node.text ? `text: "${node.text}"` : null,
        node.contentDescription ? `desc: "${node.contentDescription}"` : null,
        node.clickable ? 'clickable' : null,
        node.editable ? 'editable' : null,
        `bounds: [${node.bounds.left},${node.bounds.top},${node.bounds.right},${node.bounds.bottom}]`,
      ]
        .filter(Boolean)
        .join(' | ');

      parts.push(`${'  '.repeat(depth)}- ${desc}`);
    }

    for (const child of node.children || []) {
      const childFormatted = this.formatUiTree(child, depth + 1);
      if (childFormatted) parts.push(childFormatted);
    }

    return parts.join('\n');
  }
}
