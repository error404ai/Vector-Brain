import { AgentTask } from '@/entities/AgentTask';
import { AndroidStepStatus, AndroidTaskLog } from '@/entities/AndroidTaskLog';
import AppError from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import Logger from '@/logger/index';
import { ApiResponse } from '@/types/ApiResponse';
import { Service } from 'typedi';
import { AndroidDeviceService } from './AndroidDeviceService';
import { AndroidGatewayService } from './AndroidGatewayService';
import { AiConfigService, DecryptedAiConfig } from '../controllerService/AiConfigService';
import { AiProvider } from '@/entities/AiConfig';
import { Eko, config, global, GlobalPromptKey, type AgentStreamMessage, type LLMs } from '@eko-ai/eko';
import { AndroidAgent } from './eko/AndroidAgent';

// Configure Eko framework defaults for Android mobile automation
config.platform = 'linux';

const ANDROID_PLANNER_SYSTEM = `You are an expert autonomous AI Planner for Android mobile devices.

## Task Description
Your task is to understand the user's requirements and create an execution workflow plan for the Android device.
- The ONLY agent available in the environment is **AndroidAgent**.
- You MUST ALWAYS assign all subtasks to \`<agent name="AndroidAgent">\`. NEVER fabricate or use other agent names like Browser, Computer, File, etc.
- Break down the user's mobile goal into sequential, high-level milestone nodes (e.g. opening the needed app or website, navigating, typing text or searching, clicking buttons/links, scrolling to locate elements, and verifying results).
- Strictly follow the output XML format.

## Agent list
{{agents}}

## Output Rules and Format
<root>
  <name>Task Name (Short)</name>
  <thought>Your high-level thought process on accomplishing the mobile task</thought>
  <agents>
    <agent name="AndroidAgent" id="0" dependsOn="">
      <task>High-level mobile task description</task>
      <nodes>
        <node>First key step on the device</node>
        <node>Second key step on the device</node>
      </nodes>
    </agent>
  </agents>
</root>

{{examples}}`;

const ANDROID_PLANNER_EXAMPLES = `
## Example 1 (App or Web Navigation)
User: Open target application or website and view specific content
Output result:
<root>
  <name>Open and view content</name>
  <thought>The user wants to access an application or website and view content on the Android mobile device.</thought>
  <agents>
    <agent name="AndroidAgent" id="0" dependsOn="">
      <task>Open the app or website and navigate to the requested content</task>
      <nodes>
        <node>Launch the requested application or open the web URL in browser</node>
        <node>Inspect screen and handle any initial dialogs or prompts</node>
        <node>Navigate to and display the requested view or content</node>
      </nodes>
    </agent>
  </agents>
</root>

## Example 2 (Search and Interaction)
User: Search for a query and select an item from the results
Output result:
<root>
  <name>Search and select item</name>
  <thought>The user wants to search for an item and interact with the results on mobile.</thought>
  <agents>
    <agent name="AndroidAgent" id="0" dependsOn="">
      <task>Perform search and select the item</task>
      <nodes>
        <node>Open the relevant app or web page</node>
        <node>Type the search query into the search input field and submit</node>
        <node>Select the target item from the search results</node>
        <node>Verify that the item details are displayed</node>
      </nodes>
    </agent>
  </agents>
</root>

## Example 3 (Multi-step Mobile Interaction)
User: Fill in information or adjust device/app options
Output result:
<root>
  <name>Configure or interact with mobile options</name>
  <thought>The user wants to adjust settings, fill in form fields, or perform actions across screens on the device.</thought>
  <agents>
    <agent name="AndroidAgent" id="0" dependsOn="">
      <task>Navigate screens and perform the requested actions</task>
      <nodes>
        <node>Open the required screen or application</node>
        <node>Scroll or navigate to locate the relevant options/fields</node>
        <node>Input required values or toggle settings</node>
        <node>Confirm completion</node>
      </nodes>
    </agent>
  </agents>
</root>
`;

global.prompts.set(GlobalPromptKey.planner_system, ANDROID_PLANNER_SYSTEM);
global.prompts.set(GlobalPromptKey.planner_example, ANDROID_PLANNER_EXAMPLES);

@Service()
export class AndroidPlannerService {
  private agentTaskRepo = AppDataSource.getRepository(AgentTask);
  private taskLogRepo = AppDataSource.getRepository(AndroidTaskLog);
  private activeTasks = new Map<
    number,
    { cancelled: boolean; deviceId: string; eko?: Eko; ekoTaskId?: string }
  >();
  private activeDeviceTasks = new Map<string, number>();

  constructor(
    private deviceService: AndroidDeviceService,
    private gatewayService: AndroidGatewayService,
    private aiConfigService: AiConfigService,
  ) {}

  /**
   * Main autonomous reasoning loop for Android task execution powered by @eko-ai/eko.
   * Supports multi-turn conversational follow-ups by passing existingTaskId.
   */
  async runTask(prompt: string, deviceId: number, userId: number, _maxSteps = 15, existingTaskId?: number): Promise<ApiResponse> {
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

    const initialScreenshot = await this.assertDeviceReady(device.device_id, userId);

    let agentTask: AgentTask;
    let executionPrompt = prompt;

    if (existingTaskId) {
      const existing = await this.agentTaskRepo.findOne({ where: { id: existingTaskId, user_id: userId } });
      if (existing) {
        agentTask = existing;
        agentTask.provider = aiConfig.provider;
        agentTask.model = aiConfig.model;
        agentTask.logs = (agentTask.logs || '') + `\n--- Follow-up: "${prompt}" ---\n`;
        await this.agentTaskRepo.save(agentTask);

        const recentLogs = await this.taskLogRepo.find({
          where: { agent_task_id: existingTaskId },
          order: { step_index: 'ASC' },
          take: 20,
        });

        const historySnippet = recentLogs.length
          ? recentLogs
              .map((l) => `- Step ${l.step_index} (${l.action_type}): ${l.thought_reasoning} -> Result: ${l.result_message || l.status}`)
              .join('\n')
          : 'No prior steps recorded.';

        executionPrompt = `Continue the existing mobile automation session.
Original goal: ${existing.prompt}

User follow-up instruction:
${prompt}

Recent steps executed:
${historySnippet}

Use the current visible Android screen and UI state as context. Continue from where the previous actions left off. Accomplish the user follow-up instruction step-by-step.`;
      } else {
        agentTask = this.agentTaskRepo.create({
          user_id: userId,
          prompt,
          provider: aiConfig.provider,
          model: aiConfig.model,
          success: false,
          total_steps: 0,
          total_duration_seconds: 0,
          logs: `Starting Android automation task with ${aiConfig.provider} (${aiConfig.model}) via Eko...\n`,
        });
        await this.agentTaskRepo.save(agentTask);
      }
    } else {
      agentTask = this.agentTaskRepo.create({
        user_id: userId,
        prompt,
        provider: aiConfig.provider,
        model: aiConfig.model,
        success: false,
        total_steps: 0,
        total_duration_seconds: 0,
        logs: `Starting Android automation task with ${aiConfig.provider} (${aiConfig.model}) via Eko...\n`,
      });
      await this.agentTaskRepo.save(agentTask);
    }

    this.activeTasks.set(agentTask.id, { cancelled: false, deviceId: device.device_id });
    this.activeDeviceTasks.set(device.device_id, agentTask.id);
    const startTime = Date.now();

    // Notify web clients that task has begun and send initial screen frame
    this.gatewayService.broadcastToUser(userId, 'task:started', {
      taskId: agentTask.id,
      deviceId: device.id,
      prompt,
      model: aiConfig.model,
      provider: aiConfig.provider,
      screenshot: initialScreenshot,
    });

    // Run the execution loop in the background
    this.executeLoop(agentTask, device.device_id, userId, executionPrompt, startTime, aiConfig, initialScreenshot).catch((err) => {
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
      if (active.eko && active.ekoTaskId) {
        try {
          active.eko.abortTask(active.ekoTaskId, 'Task cancelled by user');
        } catch (err) {
          Logger.warn(`[AndroidPlanner] Failed to abort Eko task ${active.ekoTaskId}:`, err);
        }
      }
      this.gatewayService.cancelDeviceActions(active.deviceId);
    }

    task.message = 'Task cancelled by user';
    task.success = false;
    await this.agentTaskRepo.save(task);

    this.gatewayService.broadcastToUser(userId, 'task:cancelled', { taskId });

    return { message: 'Task cancellation requested' };
  }

  private buildEkoLlms(aiConfig: DecryptedAiConfig): LLMs {
    let provider: any = aiConfig.provider;
    const defaultBaseUrl = this.aiConfigService.getDefaultBaseUrl(aiConfig.provider);
    const baseURL = aiConfig.base_url?.trim() || defaultBaseUrl || undefined;

    switch (aiConfig.provider) {
      case AiProvider.DEEPSEEK:
      case AiProvider.GROQ:
      case AiProvider.CUSTOM:
        provider = 'openai-compatible';
        break;
      case AiProvider.GOOGLE:
        provider = 'google';
        break;
      case AiProvider.ANTHROPIC:
        provider = 'anthropic';
        break;
      case AiProvider.OPENROUTER:
        provider = 'openrouter';
        break;
      case AiProvider.OPENAI:
      default:
        provider = 'openai';
        break;
    }

    return {
      default: {
        provider,
        model: aiConfig.model,
        apiKey: aiConfig.api_key,
        config: {
          baseURL,
          temperature: 0.1,
        },
      },
    };
  }

  private async executeLoop(
    agentTask: AgentTask,
    hardwareDeviceId: string,
    userId: number,
    prompt: string,
    startTime: number,
    aiConfig: DecryptedAiConfig,
    initialScreenshot?: string,
  ) {
    const lastLog = await this.taskLogRepo.findOne({
      where: { agent_task_id: agentTask.id },
      order: { step_index: 'DESC' },
    });
    let stepCount = lastLog ? lastLog.step_index : 0;
    let stepStartTime = Date.now();
    let wasCancelled = false;
    let currentThought = '';
    let currentTaskLog: AndroidTaskLog | null = null;
    let lastScreenshot: string | undefined = initialScreenshot;
    let lastUiTree: string | undefined;
    let lastForegroundApp: string | undefined;
    let finalMessage = '';

    const device = await this.deviceService.getDeviceByHardwareId(hardwareDeviceId);
    const deviceDbId = device?.id;
    const ekoTaskId = `android-task-${agentTask.id}`;

    const androidAgent = new AndroidAgent(this.gatewayService, hardwareDeviceId, {
      onStepExecuted: (info) => {
        if (info.screenshotBase64) {
          lastScreenshot = info.screenshotBase64;
          this.gatewayService.broadcastToUser(userId, 'device:screen_capture', {
            deviceId: hardwareDeviceId,
            result: { screenCapture: { base64Data: info.screenshotBase64 } },
          });
        }
        if (info.uiTree) lastUiTree = info.uiTree;
        if (info.foregroundApp) lastForegroundApp = info.foregroundApp;
      },
    });

    const eko = new Eko({
      llms: this.buildEkoLlms(aiConfig),
      agents: [androidAgent],
      callback: {
        onMessage: async (message: AgentStreamMessage) => {
          if (this.activeTasks.get(agentTask.id)?.cancelled) {
            wasCancelled = true;
            return;
          }

          if (message.type === 'thinking' || message.type === 'text') {
            if (message.text) {
              currentThought = (currentThought ? `${currentThought} ${message.text}` : message.text).trim();
            }
          } else if (message.type === 'tool_use') {
            stepCount++;
            stepStartTime = Date.now();
            const toolName = message.toolName;
            const toolParams = message.params || {};

            currentTaskLog = this.taskLogRepo.create({
              agent_task_id: agentTask.id,
              device_id: deviceDbId,
              step_index: stepCount,
              action_type: toolName,
              action_payload: toolParams,
              thought_reasoning: currentThought || `Executing ${toolName}`,
              status: AndroidStepStatus.EXECUTING,
              screenshot_base64: lastScreenshot,
              ui_tree_snapshot: lastUiTree,
            });
            await this.taskLogRepo.save(currentTaskLog);

            this.gatewayService.broadcastToUser(userId, 'task:step', {
              taskId: agentTask.id,
              stepIndex: stepCount,
              thought: currentThought || `Executing ${toolName}`,
              action: { type: toolName, ...toolParams },
              screenshot: lastScreenshot,
              foregroundApp: lastForegroundApp,
            });

            currentThought = '';
          } else if (message.type === 'tool_result') {
            const toolResult = message.toolResult;
            const isError = toolResult?.isError;
            const textPart = toolResult?.content?.find((c) => c.type === 'text');
            const textContent = (textPart && 'text' in textPart ? textPart.text : '') || '';

            if (currentTaskLog) {
              currentTaskLog.status = isError ? AndroidStepStatus.FAILED : AndroidStepStatus.SUCCESS;
              currentTaskLog.result_message = textContent;
              currentTaskLog.duration_ms = Date.now() - stepStartTime;
              currentTaskLog.screenshot_base64 = lastScreenshot || currentTaskLog.screenshot_base64;
              currentTaskLog.ui_tree_snapshot = lastUiTree || currentTaskLog.ui_tree_snapshot;
              await this.taskLogRepo.save(currentTaskLog);
            }

            this.gatewayService.broadcastToUser(userId, 'task:step_result', {
              taskId: agentTask.id,
              stepIndex: stepCount,
              status: isError ? AndroidStepStatus.FAILED : AndroidStepStatus.SUCCESS,
              result: textContent,
              error: isError ? textContent : undefined,
              screenshot: lastScreenshot,
              foregroundApp: lastForegroundApp,
            });
          } else if (message.type === 'agent_result') {
            finalMessage = message.result || '';
          }
        },
      },
    });

    const activeTaskEntry = this.activeTasks.get(agentTask.id);
    if (activeTaskEntry) {
      activeTaskEntry.eko = eko;
      activeTaskEntry.ekoTaskId = ekoTaskId;
    }

    try {
      const result = await eko.run(prompt, ekoTaskId);
      const isSuccess = !wasCancelled && result?.success !== false;

      // Final live screenshot capture to reflect exact terminal screen state
      try {
        const finalScreen = await this.gatewayService.executeAction(hardwareDeviceId, { type: 'CaptureScreen' });
        if (finalScreen.status === 'SUCCESS' && finalScreen.screenCapture?.base64Data) {
          lastScreenshot = finalScreen.screenCapture.base64Data;
          this.gatewayService.broadcastToUser(userId, 'device:screen_capture', {
            deviceId: hardwareDeviceId,
            result: { screenCapture: { base64Data: lastScreenshot } },
          });
        }
      } catch {
        // Best-effort final frame capture
      }

      agentTask.success = isSuccess;
      agentTask.message = finalMessage || (isSuccess ? 'Goal accomplished successfully' : 'Task completed with errors');
      agentTask.total_steps = stepCount;
      agentTask.total_duration_seconds = (Date.now() - startTime) / 1000;
      await this.agentTaskRepo.save(agentTask);

      if (!wasCancelled) {
        this.gatewayService.broadcastToUser(userId, 'task:completed', {
          taskId: agentTask.id,
          success: agentTask.success,
          message: agentTask.message,
          totalSteps: stepCount,
          screenshot: lastScreenshot,
        });
      }
    } catch (err: any) {
      if (this.activeTasks.get(agentTask.id)?.cancelled) {
        Logger.info(`[AndroidPlanner] Task ${agentTask.id} was cancelled during execution.`);
      } else {
        Logger.error(`[AndroidPlanner] Error during Eko task loop:`, err);
        agentTask.success = false;
        agentTask.message = err.message || 'Task failed with internal error';
        agentTask.total_steps = stepCount;
        agentTask.total_duration_seconds = (Date.now() - startTime) / 1000;
        await this.agentTaskRepo.save(agentTask);
        this.gatewayService.broadcastToUser(userId, 'task:error', { taskId: agentTask.id, error: err.message });
      }
    } finally {
      this.activeTasks.delete(agentTask.id);
      if (this.activeDeviceTasks.get(hardwareDeviceId) === agentTask.id) {
        this.activeDeviceTasks.delete(hardwareDeviceId);
      }
    }
  }

  private isActionablePrompt(prompt: string): boolean {
    const normalized = prompt.trim().toLowerCase();
    if (normalized.length < 4) return false;

    return !/^(hi|hello|hey|test|help|thanks|thank you)[.!?\s]*$/.test(normalized);
  }

  private async assertDeviceReady(hardwareDeviceId: string, userId?: number): Promise<string | undefined> {
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

    const base64 = captureResult.screenCapture.base64Data;
    if (userId && base64) {
      this.gatewayService.broadcastToUser(userId, 'device:screen_capture', {
        deviceId: hardwareDeviceId,
        result: { screenCapture: { base64Data: base64 } },
      });
    }

    return base64;
  }
}

