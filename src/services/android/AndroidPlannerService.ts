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
import crypto from 'node:crypto';

// Configure Eko framework defaults for Android mobile automation
config.platform = 'linux';
// Eko defaults to 500 ReAct iterations. Mobile automation must always have a
// small outer safety ceiling; each task also enforces its requested maxSteps.
config.maxReactNum = 50;
config.compressThreshold = 20;
config.compressTokensThreshold = 60000;

const MAX_CONSECUTIVE_FAILURES = 6;
const MAX_IDENTICAL_TOOL_STATES = 3;
const MAX_UNCHANGED_OBSERVATIONS = 3;
const MAX_THOUGHT_CHARS = 1200; // hard cap — prevents any runaway thought-text growth
const MAX_HISTORY_THOUGHT_CHARS = 200; // cap per-step thought when building follow-up context

const ANDROID_PLANNER_SYSTEM = `You are an expert autonomous AI Planner for Android mobile devices.

## Your Role
Create a precise, step-by-step execution plan for AndroidAgent to complete the user's task on an Android device.
- The ONLY agent available is **AndroidAgent**.
- You MUST ALWAYS assign all subtasks to \`<agent name="AndroidAgent">\`.
- Break down the goal into SPECIFIC, GRANULAR nodes — not vague high-level steps.
- Each node must describe ONE concrete action the agent should take.

## CRITICAL PLANNING RULES:

### For ALL tasks:
- Always start with launching the correct app or URL
- Always include wait steps after page loads (e.g. "Wait 2-3 seconds for page to load")
- Always include handling popups, cookie banners, or permission dialogs
- Always end with a verification or summary step

### For RESEARCH tasks (research, find info, look up, check reviews):
- NEVER plan just 1-2 nodes — research needs 10-15 nodes minimum
- Must include: open multiple sources, read each source, go back between sources
- Must end with: "Prepare complete summary of all collected information"
- "Deep research" = minimum 5 different sources

### For SEARCH tasks:
- ALWAYS prefer open_url over manually tapping the address bar. Chrome may
  resume on a previously opened page, and its address bar is not always a
  reliable, easy-to-find tap target in the UI tree in that state.
- For Google searches specifically, plan a node like: "Use open_url to
  navigate directly to https://www.google.com/search?q=<url-encoded-query>"
  — this skips the address bar entirely and lands straight on results.
- Include: wait for results → identify correct result → tap it
- Never combine "search and open result" into one node — split them

### For multi-item lists (search results, article listings):
- When identifying "top N" items from a scrollable list, note down each
  item's title and source THE FIRST TIME it's seen — do not rely on
  re-finding the same item after scrolling, since list positions shift.
- If an item can't be relocated after scrolling, treat it as already
  identified from the earlier observation rather than re-scrolling
  repeatedly to visually re-confirm it.

### For NAVIGATION tasks:
- Include explicit wait times after each navigation
- Include handling of any popups or overlays
- Include scroll steps if content is below the fold

### STOPPING EARLY (important):
- The nodes are a guide, NOT a checklist that must be exhausted. The moment
  enough information exists to fully answer the user's question, STOP and
  present the answer — skip all remaining nodes.
- Do not open a "second source to cross-check" unless the first source was
  ambiguous or contradictory. One good source is usually enough.
- If a summary or TL;DR section already answers the question, that IS the
  answer — do not scroll further looking for a longer version of it.
  
## Agent list
{{agents}}

## Output Rules and Format
<root>
  <n>Task Name (Short)</n>
  <thought>Your detailed reasoning about how to accomplish this task step by step</thought>
  <agents>
    <agent name="AndroidAgent" id="0" dependsOn="">
      <task>Specific task description with clear success criteria</task>
      <nodes>
        <node>First specific action</node>
        <node>Second specific action</node>
      </nodes>
    </agent>
  </agents>
</root>

{{examples}}`;

const ANDROID_PLANNER_EXAMPLES = `
## Example 1 (Simple Web Navigation)
User: Open Chrome and go to google.com
Output result:
<root>
  <n>Open Google</n>
  <thought>Simple navigation task. Open Chrome browser and navigate to google.com. Handle any popups.</thought>
  <agents>
    <agent name="AndroidAgent" id="0" dependsOn="">
      <task>Launch Chrome and navigate to google.com</task>
      <nodes>
        <node>Open Chrome browser using open_app</node>
        <node>Wait 2 seconds for Chrome to load</node>
        <node>Tap the address bar at the top of Chrome</node>
        <node>Type "google.com" in the address bar</node>
        <node>Tap Go or press Enter to navigate</node>
        <node>Wait 3 seconds for Google homepage to load</node>
        <node>Handle any cookie popups or permission dialogs if they appear</node>
        <node>Verify Google homepage is displayed and search box is visible</node>
      </nodes>
    </agent>
  </agents>
</root>

## Example 2 (Search and Open Result)
User: Search for Phonebox.co.uk on Google and open their website
Output result:
<root>
  <n>Search and Open Phonebox</n>
  <thought>Need to open Chrome, go to Google, search for Phonebox, then open the correct result. Each step is separate.</thought>
  <agents>
    <agent name="AndroidAgent" id="0" dependsOn="">
      <task>Search Google for Phonebox.co.uk and open official website</task>
      <nodes>
        <node>Open Chrome browser</node>
        <node>Wait 2 seconds for Chrome to load</node>
        <node>Tap the address bar and type "google.com", press Enter</node>
        <node>Wait 3 seconds for Google to load</node>
        <node>Tap the Google search box</node>
        <node>Type "Phonebox.co.uk" in the search box</node>
        <node>Tap the Search button or press Enter</node>
        <node>Wait 3 seconds for search results to load</node>
        <node>Read the search results and identify the official Phonebox website link</node>
        <node>Tap on the official Phonebox website result</node>
        <node>Wait 4 seconds for the website to load</node>
        <node>Handle any cookie consent or popup dialogs</node>
        <node>Verify the Phonebox website is loaded correctly</node>
      </nodes>
    </agent>
  </agents>
</root>

## Example 3 (Company Research)
User: Research about Phonebox.co.uk company - find their services, reviews, and latest news
Output result:
<root>
  <n>Phonebox Company Research</n>
  <thought>This is a research task requiring multiple sources. I must NOT complete after just one search. I need to: visit official website, read content, find reviews on Trustpilot, search for news, then summarize everything. Minimum 15 nodes needed.</thought>
  <agents>
    <agent name="AndroidAgent" id="0" dependsOn="">
      <task>Research Phonebox.co.uk thoroughly from multiple sources and provide complete summary</task>
      <nodes>
        <node>Open Chrome browser and navigate to google.com</node>
        <node>Wait 3 seconds for Google to load</node>
        <node>Search for "Phonebox.co.uk" in Google</node>
        <node>Wait 3 seconds for search results to load</node>
        <node>Identify and tap the official Phonebox website from results</node>
        <node>Wait 4 seconds for website to load and handle any popups</node>
        <node>Read the homepage - note company description, main services, and key offerings</node>
        <node>Scroll down slowly to read more content about their services</node>
        <node>Press back button to return to Google search results</node>
        <node>Search for "Phonebox.co.uk reviews Trustpilot" on Google</node>
        <node>Wait 3 seconds for results and tap the Trustpilot result</node>
        <node>Wait 4 seconds for Trustpilot page to load</node>
        <node>Read the overall rating and top customer reviews</node>
        <node>Press back and search for "Phonebox.co.uk news 2025"</node>
        <node>Wait 3 seconds and open the most recent news article</node>
        <node>Read the news article content</node>
        <node>Prepare and present complete summary: company overview, services, Trustpilot rating, customer feedback, recent news</node>
      </nodes>
    </agent>
  </agents>
</root>

## Example 4 (Multi-step Form or Settings)
User: Fill in information or adjust device/app options
Output result:
<root>
  <n>Configure Mobile Options</n>
  <thought>Need to navigate to correct settings, find the specific option, and make the change carefully.</thought>
  <agents>
    <agent name="AndroidAgent" id="0" dependsOn="">
      <task>Navigate to settings and make the requested configuration change</task>
      <nodes>
        <node>Open the required app or settings screen</node>
        <node>Wait 2 seconds for app to load</node>
        <node>Handle any permission requests or popups</node>
        <node>Scroll to locate the relevant option or input field</node>
        <node>Tap on the target field or option</node>
        <node>Enter the required value or toggle the setting</node>
        <node>Tap Save or Confirm button</node>
        <node>Verify the change was applied successfully</node>
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
    { cancelled: boolean; deviceId: string; deviceDbId?: number; eko?: Eko; ekoTaskId?: string }
  >();
  private activeDeviceTasks = new Map<string, number>();
  private startingDevices = new Set<string>();

  constructor(
    private deviceService: AndroidDeviceService,
    private gatewayService: AndroidGatewayService,
    private aiConfigService: AiConfigService,
  ) {}

  /**
   * Main autonomous reasoning loop for Android task execution powered by @eko-ai/eko.
   * Supports multi-turn conversational follow-ups by passing existingTaskId.
   */
  async runTask(prompt: string, deviceId: number, userId: number, maxSteps = 40, existingTaskId?: number): Promise<ApiResponse> {
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
    if (this.activeDeviceTasks.has(device.device_id) || this.startingDevices.has(device.device_id)) {
      throw new AppError(`Device "${device.device_name}" is already running another automation task.`, 409);
    }
    this.startingDevices.add(device.device_id);

    const boundedMaxSteps = Math.max(1, Math.min(maxSteps, 50));

    // Wake the display before the first observation in case the device was idle.
    this.gatewayService.setAutomationSession(device.device_id, true);
    let initialScreenshot: string | undefined;
    try {
      initialScreenshot = await this.assertDeviceReady(device.device_id, userId);
    } catch (error) {
      this.startingDevices.delete(device.device_id);
      throw error;
    } finally {
      // The bounded task session is acquired again below after its DB record exists.
      this.gatewayService.setAutomationSession(device.device_id, false);
    }

    let agentTask: AgentTask;
    let executionPrompt = prompt;

    try {
      if (existingTaskId) {
        const existing = await this.agentTaskRepo.findOne({ where: { id: existingTaskId, user_id: userId } });
        if (existing) {
          agentTask = existing;
          agentTask.device_id = device.id;
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
                .map((l) => {
                  const thought = (l.thought_reasoning || '').slice(0, MAX_HISTORY_THOUGHT_CHARS);
                  return `- Step ${l.step_index} (${l.action_type}): ${thought} -> Result: ${l.result_message || l.status}`;
                })
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
            device_id: device.id,
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
          device_id: device.id,
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
    } catch (error) {
      this.startingDevices.delete(device.device_id);
      throw error;
    }

    // Keep the device CPU/display active for the complete automation session,
    // including the time spent waiting for the model between device actions.
    this.gatewayService.setAutomationSession(device.device_id, true);
    this.activeTasks.set(agentTask.id, { cancelled: false, deviceId: device.device_id, deviceDbId: device.id });
    this.activeDeviceTasks.set(device.device_id, agentTask.id);
    this.startingDevices.delete(device.device_id);
    const startTime = Date.now();

    // Notify web clients that task has begun. The readiness observation already
    // published the initial frame through device:screen_capture.
    this.gatewayService.broadcastToUser(userId, 'task:started', {
      taskId: agentTask.id,
      deviceId: device.id,
      prompt,
      model: aiConfig.model,
      provider: aiConfig.provider,
    });

    // Run the execution loop in the background
    this.executeLoop(
      agentTask,
      device.device_id,
      userId,
      executionPrompt,
      boundedMaxSteps,
      startTime,
      aiConfig,
      initialScreenshot,
    ).catch((err) => {
      Logger.error(`[AndroidPlanner] Unhandled error in task ${agentTask.id}:`, err);
      this.gatewayService.setAutomationSession(device.device_id, false);
      this.activeTasks.delete(agentTask.id);
      if (this.activeDeviceTasks.get(device.device_id) === agentTask.id) {
        this.activeDeviceTasks.delete(device.device_id);
      }
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

    this.gatewayService.broadcastToUser(userId, 'task:cancelled', {
      taskId,
      deviceId: active?.deviceDbId ?? task.device_id,
    });

    return { message: 'Task cancellation requested' };
  }

  /**
   * Task ids that are currently executing (used by the API to mark live sessions).
   */
  getActiveTaskIds(): number[] {
    return Array.from(this.activeTasks.entries())
      .filter(([, entry]) => !entry.cancelled)
      .map(([taskId]) => taskId);
  }

  /**
   * The task currently running on a specific device, or any running task when no
   * device is given. Lets the UI re-attach to a live session after a reload.
   */
  getActiveTaskIdForDevice(deviceDbId?: number): number | undefined {
    for (const [taskId, entry] of this.activeTasks.entries()) {
      if (entry.cancelled) continue;
      if (deviceDbId === undefined || entry.deviceDbId === deviceDbId) return taskId;
    }
    return undefined;
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
    maxSteps: number,
    startTime: number,
    aiConfig: DecryptedAiConfig,
    initialScreenshot?: string,
  ) {
    const lastLog = await this.taskLogRepo.findOne({
      where: { agent_task_id: agentTask.id },
      order: { step_index: 'DESC' },
    });
    let stepCount = lastLog ? lastLog.step_index : 0;
    let runStepCount = 0;
    let stepStartTime = Date.now();
    let wasCancelled = false;
    let currentThought = '';
    let thinkingBuffer = '';
    let textBuffer = '';
    let currentTaskLog: AndroidTaskLog | null = null;
    let lastScreenshot: string | undefined = initialScreenshot;
    let lastUiTree: string | undefined;
    let lastForegroundApp: string | undefined;
    let finalMessage = '';
    let guardStopReason: string | undefined;
    let consecutiveFailures = 0;
    let lastToolStateSignature: string | undefined;
    let identicalToolStateCount = 0;
    let lastObservationFingerprint: string | undefined;
    let unchangedObservationCount = 0;

    const device = await this.deviceService.getDeviceByHardwareId(hardwareDeviceId);
    const deviceDbId = device?.id;
    const ekoTaskId = `android-task-${agentTask.id}`;

    let eko: Eko | undefined;
    const stopForSafety = (reason: string) => {
      if (guardStopReason) return;
      guardStopReason = reason;
      if (eko) {
        try {
          eko.abortTask(ekoTaskId, reason);
        } catch (error) {
          Logger.warn(`[AndroidPlanner] Failed to stop guarded task ${ekoTaskId}:`, error);
        }
      }
      this.gatewayService.cancelDeviceActions(hardwareDeviceId);
    };

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

        if (info.uiTree || info.screenshotBase64) {
          const observationFingerprint = this.fingerprintObservation(
            info.foregroundApp,
            info.uiTree,
            info.screenshotBase64,
          );
          if (observationFingerprint === lastObservationFingerprint) {
            unchangedObservationCount += 1;
          } else {
            unchangedObservationCount = 0;
          }
          lastObservationFingerprint = observationFingerprint;
          if (unchangedObservationCount >= MAX_UNCHANGED_OBSERVATIONS) {
            stopForSafety('The visible device state did not change after repeated agent actions.');
          }
        }
      },
    });

    const ekoInstance = new Eko({
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
              const incoming = message.text.trim();
              if (incoming) {
                // Track "thinking" and "text" as independent cumulative streams —
                // some providers stream each separately, and merging them into one
                // buffer causes cross-stream interleaving/duplication.
                const isThinking = message.type === 'thinking';
                const bufferValue = isThinking ? thinkingBuffer : textBuffer;
                let updated: string;
                if (bufferValue && incoming.startsWith(bufferValue)) {
                  updated = incoming;
                } else if (bufferValue && bufferValue.includes(incoming)) {
                  updated = bufferValue;
                } else {
                  updated = bufferValue ? `${bufferValue} ${incoming}`.trim() : incoming;
                }
                updated = this.collapseGrowingResends(updated);
                updated = this.collapseRepeatingLoop(updated);
                if (updated.length > MAX_THOUGHT_CHARS) {
                  updated = updated.slice(-MAX_THOUGHT_CHARS);
                }
                if (isThinking) {
                  thinkingBuffer = updated;
                } else {
                  textBuffer = updated;
                }
                currentThought = [thinkingBuffer, textBuffer].filter(Boolean).join(' ').trim();
              }
            }
          } else if (message.type === 'tool_use') {
            if (runStepCount >= maxSteps) {
              const reason = `Task stopped after reaching the ${maxSteps}-step limit.`;
              stopForSafety(reason);
              throw new Error(reason);
            }

            stepCount++;
            runStepCount++;
            stepStartTime = Date.now();
            const toolName = message.toolName;
            const toolParams = message.params || {};
            const persistedToolParams =
              toolName === 'type_text' && 'text' in toolParams
                ? { ...toolParams, text: '[REDACTED]' }
                : toolParams;
            const stateFingerprint = this.fingerprintObservation(lastForegroundApp, lastUiTree, lastScreenshot);
            const toolStateSignature = this.hashText(
              `${toolName}\n${JSON.stringify(toolParams)}\n${stateFingerprint}`,
            );
            if (toolStateSignature === lastToolStateSignature) {
              identicalToolStateCount += 1;
            } else {
              identicalToolStateCount = 0;
            }
            lastToolStateSignature = toolStateSignature;
            if (identicalToolStateCount >= MAX_IDENTICAL_TOOL_STATES) {
              const reason = `Task stopped because ${toolName} was repeated on the same unchanged screen.`;
              stopForSafety(reason);
              throw new Error(reason);
            }

            currentTaskLog = this.taskLogRepo.create({
              agent_task_id: agentTask.id,
              device_id: deviceDbId,
              step_index: stepCount,
              action_type: toolName,
              action_payload: persistedToolParams,
              thought_reasoning: currentThought || `Executing ${toolName}`,
              status: AndroidStepStatus.EXECUTING,
              ui_tree_snapshot: lastUiTree,
            });
            await this.taskLogRepo.save(currentTaskLog);

            this.gatewayService.broadcastToUser(userId, 'task:step', {
              taskId: agentTask.id,
              deviceId: deviceDbId,
              stepIndex: stepCount,
              thought: currentThought || `Executing ${toolName}`,
              action: { type: toolName, ...toolParams },
              foregroundApp: lastForegroundApp,
            });

            currentThought = '';
            thinkingBuffer = '';
            textBuffer = '';
          } else if (message.type === 'tool_result') {
            const toolResult = message.toolResult;
            const isError = toolResult?.isError;
            const textPart = toolResult?.content?.find((c) => c.type === 'text');
            const textContent = (textPart && 'text' in textPart ? textPart.text : '') || '';

            consecutiveFailures = isError ? consecutiveFailures + 1 : 0;
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
              stopForSafety(`Task stopped after ${MAX_CONSECUTIVE_FAILURES} consecutive device action failures.`);
            }

            if (currentTaskLog) {
              currentTaskLog.status = isError ? AndroidStepStatus.FAILED : AndroidStepStatus.SUCCESS;
              currentTaskLog.result_message = textContent;
              currentTaskLog.duration_ms = Date.now() - stepStartTime;
              currentTaskLog.ui_tree_snapshot = lastUiTree || currentTaskLog.ui_tree_snapshot;
              await this.taskLogRepo.save(currentTaskLog);
            }

            this.gatewayService.broadcastToUser(userId, 'task:step_result', {
              taskId: agentTask.id,
              deviceId: deviceDbId,
              stepIndex: stepCount,
              status: isError ? AndroidStepStatus.FAILED : AndroidStepStatus.SUCCESS,
              result: textContent,
              error: isError ? textContent : undefined,
              foregroundApp: lastForegroundApp,
            });
          } else if (message.type === 'agent_result') {
            finalMessage = message.result || '';
          }
        },
      },
    });
    eko = ekoInstance;

    const activeTaskEntry = this.activeTasks.get(agentTask.id);
    if (activeTaskEntry) {
      activeTaskEntry.eko = ekoInstance;
      activeTaskEntry.ekoTaskId = ekoTaskId;
    }

    const maxTaskDurationMillis = Math.min(
      10 * 60_000,
      Math.max(2 * 60_000, maxSteps * 30_000),
    );
    let rejectTaskTimeout: ((error: Error) => void) | undefined;
    const taskTimeout = setTimeout(() => {
      const reason = `Task stopped after exceeding ${Math.round(maxTaskDurationMillis / 1000)} seconds.`;
      stopForSafety(reason);
      rejectTaskTimeout?.(new Error(reason));
    }, maxTaskDurationMillis);

    try {
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        rejectTaskTimeout = reject;
      });
      const result = await Promise.race([ekoInstance.run(prompt, ekoTaskId), timeoutPromise]);
      const terminalAgentResult = (finalMessage || result.result || '').trim();
      const agentFinished = terminalAgentResult.toLowerCase() !== 'unfinished';
      const isSuccess =
        !wasCancelled &&
        !guardStopReason &&
        agentFinished &&
        result.success &&
        result.stopReason === 'done';

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
      agentTask.message =
        guardStopReason ||
        (!agentFinished ? 'Task stopped before the agent confirmed completion.' : undefined) ||
        terminalAgentResult ||
        (isSuccess ? 'Goal accomplished successfully' : 'Task completed with errors');
      agentTask.total_steps = stepCount;
      agentTask.total_duration_seconds = (Date.now() - startTime) / 1000;
      await this.agentTaskRepo.save(agentTask);

      if (!wasCancelled) {
        this.gatewayService.broadcastToUser(userId, 'task:completed', {
          taskId: agentTask.id,
          deviceId: deviceDbId,
          success: agentTask.success,
          message: agentTask.message,
          totalSteps: stepCount,
        });
      }
    } catch (err: any) {
      if (this.activeTasks.get(agentTask.id)?.cancelled) {
        Logger.info(`[AndroidPlanner] Task ${agentTask.id} was cancelled during execution.`);
      } else {
        Logger.error(`[AndroidPlanner] Error during Eko task loop:`, err);
        agentTask.success = false;
        agentTask.message = guardStopReason || err.message || 'Task failed with internal error';
        agentTask.total_steps = stepCount;
        agentTask.total_duration_seconds = (Date.now() - startTime) / 1000;
        await this.agentTaskRepo.save(agentTask);
        this.gatewayService.broadcastToUser(userId, 'task:error', {
          taskId: agentTask.id,
          deviceId: deviceDbId,
          error: err.message,
        });
      }
    } finally {
      clearTimeout(taskTimeout);
      try {
        ekoInstance.deleteTask(ekoTaskId);
      } catch (error) {
        Logger.warn(`[AndroidPlanner] Failed to release Eko task ${ekoTaskId}:`, error);
      }
      this.gatewayService.setAutomationSession(hardwareDeviceId, false);
      this.activeTasks.delete(agentTask.id);
      if (this.activeDeviceTasks.get(hardwareDeviceId) === agentTask.id) {
        this.activeDeviceTasks.delete(hardwareDeviceId);
      }
    }
  }
  private collapseRepeatingLoop(text: string, maxRepeats = 2): string {
    const words = text.split(/\s+/);
    if (words.length < 20) return text;

    for (let winSize = 25; winSize >= 4; winSize--) {
      for (let start = 0; start + winSize * (maxRepeats + 1) <= words.length; start++) {
        const window = words.slice(start, start + winSize).join(' ');
        let repeats = 1;
        let pos = start + winSize;
        while (
          pos + winSize <= words.length &&
          words.slice(pos, pos + winSize).join(' ') === window
        ) {
          repeats++;
          pos += winSize;
        }
        if (repeats > maxRepeats) {
          return words.slice(0, start + winSize).join(' ');
        }
      }
    }
    return text;
  }

  private collapseGrowingResends(text: string, anchorLen = 6, maxGapWords = 400): string {
    const words = text.split(/\s+/);
    if (words.length < anchorLen * 2) return text;

    const lastSeen = new Map<string, number>();
    let dropStart = -1;
    let dropEnd = -1;

    for (let i = 0; i + anchorLen <= words.length; i++) {
      const key = words.slice(i, i + anchorLen).join(' ').toLowerCase();
      const prev = lastSeen.get(key);
      if (prev !== undefined && i - prev <= maxGapWords) {
        if (dropStart === -1 || prev < dropStart) dropStart = prev;
        dropEnd = Math.max(dropEnd, i);
      }
      lastSeen.set(key, i);
    }

    if (dropStart === -1) return text;
    const kept = [...words.slice(0, dropStart), ...words.slice(dropEnd)];
    return kept.join(' ');
  }

  private hashText(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex');
  }

  private fingerprintObservation(foregroundApp?: string, uiTree?: string, screenshotBase64?: string): string {
    // Hash only a small prefix/suffix of the image. This detects repeated frames
    // without retaining or repeatedly hashing a multi-megabyte base64 payload.
    const imageSample = screenshotBase64
      ? `${screenshotBase64.slice(0, 2048)}:${screenshotBase64.slice(-2048)}`
      : '';
    return this.hashText(`${foregroundApp || ''}\n${uiTree || ''}\n${imageSample}`);
  }

  private isActionablePrompt(prompt: string): boolean {
    const normalized = prompt.trim().toLowerCase();
    if (normalized.length < 4) return false;

    return !/^(hi|hello|hey|test|help|thanks|thank you)[.!?\s]*$/.test(normalized);
  }

  private async assertDeviceReady(hardwareDeviceId: string, userId?: number): Promise<string | undefined> {
    const observation = await this.gatewayService.executeAction(hardwareDeviceId, { type: 'ObserveScreen' });
    const treeResult = observation;
    const captureResult = observation;

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
        `Screen capture is not ready on the Android device. Open Android Automation and verify Accessibility is enabled. On Android 10 or older, also enable screen capture. ${detail}`,
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
