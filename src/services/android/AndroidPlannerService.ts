import { AgentTask } from '@/entities/AgentTask';
import { AndroidDeviceStatus } from '@/entities/AndroidDevice';
import { AndroidStepStatus, AndroidTaskLog } from '@/entities/AndroidTaskLog';
import AppError from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import Logger from '@/logger/index';
import { ApiResponse } from '@/types/ApiResponse';
import { ChatOpenAI } from '@langchain/openai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { Service } from 'typedi';
import * as z from 'zod';
import envConfig from '@/config/envConfig';
import { AndroidDeviceService } from './AndroidDeviceService';
import { AndroidGatewayService } from './AndroidGatewayService';
import { ActionResult, AutomationAction, UiNodeSnapshot, UiTreeSnapshot } from './AndroidProtocol';

const DecisionSchema = z.object({
  thought: z.string().describe('Analysis of current screen and reasoning for the next step'),
  isFinished: z.boolean().describe('True if the user goal has been fully accomplished or cannot proceed'),
  finishStatus: z.enum(['SUCCESS', 'FAILED']).optional(),
  finishMessage: z.string().optional(),
  action: z
    .discriminatedUnion('type', [
      z.object({
        type: z.literal('OpenApp'),
        packageName: z.string().describe('Android application package name e.g. com.google.android.youtube'),
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
    .optional()
    .describe('Atomic Android action to execute next'),
});

type AgentDecision = z.infer<typeof DecisionSchema>;

@Service()
export class AndroidPlannerService {
  private agentTaskRepo = AppDataSource.getRepository(AgentTask);
  private taskLogRepo = AppDataSource.getRepository(AndroidTaskLog);
  private chatModel: ChatOpenAI | null = null;
  private activeTasks = new Map<number, { cancelled: boolean }>();

  constructor(
    private deviceService: AndroidDeviceService,
    private gatewayService: AndroidGatewayService,
  ) {
    if (envConfig.embeddingApiKey) {
      this.chatModel = new ChatOpenAI({
        openAIApiKey: envConfig.embeddingApiKey,
        modelName: 'gpt-4o-mini',
        temperature: 0.1,
      });
    }
  }

  /**
   * Main autonomous reasoning loop for Android task execution.
   */
  async runTask(prompt: string, deviceId: number, userId: number, maxSteps = 15): Promise<ApiResponse> {
    const device = await this.deviceService.getDeviceById(deviceId, userId);

    if (!this.gatewayService.isDeviceConnected(device.device_id)) {
      throw new AppError(`Device "${device.device_name}" is currently offline. Please open the companion app on the device.`, 400);
    }

    // 1. Create AgentTask record
    const agentTask = this.agentTaskRepo.create({
      user_id: userId,
      prompt,
      provider: 'openai',
      model: 'gpt-4o-mini',
      success: false,
      total_steps: 0,
      total_duration_seconds: 0,
      logs: 'Starting Android automation task...\n',
    });
    await this.agentTaskRepo.save(agentTask);

    this.activeTasks.set(agentTask.id, { cancelled: false });
    const startTime = Date.now();

    // Notify web clients that task has begun
    this.gatewayService.broadcastToUser(userId, 'task:started', {
      taskId: agentTask.id,
      deviceId: device.id,
      prompt,
    });

    // Run the execution loop in the background or await
    this.executeLoop(agentTask, device.device_id, userId, prompt, maxSteps, startTime).catch((err) => {
      Logger.error(`[AndroidPlanner] Unhandled error in task ${agentTask.id}:`, err);
    });

    return {
      message: 'Android task initiated successfully',
      data: {
        taskId: agentTask.id,
        status: 'RUNNING',
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
  ) {
    let stepCount = 0;
    const history: Array<{ thought: string; action: any; result: string }> = [];

    const device = await this.deviceService.getDeviceByHardwareId(hardwareDeviceId);
    const deviceDbId = device?.id;

    try {
      while (stepCount < maxSteps) {
        if (this.activeTasks.get(agentTask.id)?.cancelled) {
          Logger.info(`[AndroidPlanner] Task ${agentTask.id} was cancelled.`);
          break;
        }

        stepCount++;
        const stepStartTime = Date.now();

        // 1. Capture current UI Tree & Screen
        const treeResult = await this.gatewayService.executeAction(hardwareDeviceId, { type: 'ReadUiTree' });
        const screenResult = await this.gatewayService.executeAction(hardwareDeviceId, { type: 'CaptureScreen' });

        const uiTree: UiTreeSnapshot | undefined = (treeResult as any).uiTree;
        const screenCapture = (screenResult as any).screenCapture;
        const screenshotBase64 = screenCapture?.base64Data;

        // 2. Format UI tree for AI context
        const compactTree = this.formatUiTree(uiTree?.root);
        const foregroundApp = uiTree?.packageName || 'unknown';

        // 3. Ask Multimodal LLM for next decision
        const decision = await this.queryModel(prompt, compactTree, foregroundApp, screenshotBase64, history);

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
          break;
        }

        // 6. Execute action on device
        if (decision.action) {
          const actionResult = await this.gatewayService.executeAction(hardwareDeviceId, decision.action as AutomationAction);
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
          }
          await this.taskLogRepo.save(taskLog);
        }
      }

      // Finalize task
      agentTask.total_steps = stepCount;
      agentTask.total_duration_seconds = (Date.now() - startTime) / 1000;
      await this.agentTaskRepo.save(agentTask);

      this.gatewayService.broadcastToUser(userId, 'task:completed', {
        taskId: agentTask.id,
        success: agentTask.success,
        message: agentTask.message,
        totalSteps: stepCount,
      });
    } catch (err: any) {
      Logger.error(`[AndroidPlanner] Error during task loop:`, err);
      agentTask.success = false;
      agentTask.message = err.message || 'Task failed with internal error';
      await this.agentTaskRepo.save(agentTask);
      this.gatewayService.broadcastToUser(userId, 'task:error', { taskId: agentTask.id, error: err.message });
    } finally {
      this.activeTasks.delete(agentTask.id);
    }
  }

  private async queryModel(
    goalPrompt: string,
    uiTreeText: string,
    foregroundApp: string,
    screenshotBase64: string | undefined,
    history: Array<{ thought: string; action: any; result: string }>,
  ): Promise<AgentDecision> {
    if (!this.chatModel) {
      return {
        thought: 'No AI model configured. Executing dummy wait.',
        isFinished: true,
        finishStatus: 'FAILED',
        finishMessage: 'OpenAI API key is missing in server configuration.',
      };
    }

    const structuredLlm = this.chatModel.withStructuredOutput(DecisionSchema);

    const systemPrompt = `You are Vector-Brain, an expert autonomous AI agent controlling an Android mobile device.
Your goal is to accomplish the user's task step-by-step.

AVAILABLE ACTIONS:
- OpenApp: { type: "OpenApp", packageName: "package.name" }
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
4. When the goal is completed, return isFinished = true with finishStatus = "SUCCESS".
5. If the screen is loading, use Wait.`;

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

    if (screenshotBase64) {
      userContent.push({
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${screenshotBase64}`,
        },
      });
    }

    const messages = [new SystemMessage(systemPrompt), new HumanMessage({ content: userContent })];

    try {
      const response = await structuredLlm.invoke(messages);
      return response as AgentDecision;
    } catch (error) {
      Logger.error(`[AndroidPlanner] LLM invocation error:`, error);
      return {
        thought: 'Failed to parse model output. Retrying with home action.',
        isFinished: false,
        action: { type: 'Global', action: 'HOME' },
      };
    }
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
