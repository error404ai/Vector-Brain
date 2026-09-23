import { AgentTask, type AgentTaskStatus } from '@/entities/AgentTask';
import { AndroidDeviceStatus } from '@/entities/AndroidDevice';
import { AndroidStepStatus, AndroidTaskLog } from '@/entities/AndroidTaskLog';
import AppError from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import Logger from '@/logger/index';
import { ApiResponse } from '@/types/ApiResponse';
import { Service } from 'typedi';
import { AndroidDeviceService } from './AndroidDeviceService';
import { AndroidGatewayService } from './AndroidGatewayService';
import { AiConfigService, DecryptedAiConfig } from '../controllerService/AiConfigService';
import { ProxyRotationService } from './ProxyRotationService';
import { TaskQueueService } from './TaskQueueService';
import { AiProvider } from '@/entities/AiConfig';
import { Eko, config, global, GlobalPromptKey, type AgentStreamMessage, type LLMs } from '@eko-ai/eko';
import { AndroidAgent } from './eko/AndroidAgent';
import crypto from 'node:crypto';

// Configure Eko framework defaults for Android mobile automation
config.platform = 'linux';
// Eko's own ReAct ceiling. This is a module-level global, so it cannot vary per
// task and must sit above any step budget a user might pick — otherwise it
// silently truncates long runs the way the old 200-step clamp did. The real
// limiter is the per-task check against maxSteps inside executeLoop, which stops
// with a message the user can act on.
config.maxReactNum = 20000;
config.compressThreshold = 30;
config.compressTokensThreshold = 60000;

const MAX_CONSECUTIVE_FAILURES = 6;
const MAX_IDENTICAL_TOOL_STATES = 3;
const MAX_UNCHANGED_OBSERVATIONS = 3;

/** Step budget used when a caller does not supply one. */
/** Time a sleeping phone gets to come up before its first action. */
const WAKE_SETTLE_MS = 1_500;

/** A longer pause for the retry, for the slowest handsets in a fleet. */
const WAKE_RETRY_MS = 4_000;

const DEFAULT_MAX_STEPS = 500;

/**
 * The screen dump inside a tool result, up to an optional trailing NOTE.
 *
 * Matches both shapes AndroidAgent produces: "UPDATED SCREEN ELEMENTS:" on
 * action results and "VISIBLE UI ELEMENTS (...):" on read_ui_tree.
 */
const SCREEN_DUMP_PATTERN = /\n\n(?:UPDATED SCREEN ELEMENTS:|VISIBLE UI ELEMENTS \([^\n]*\):)\n[\s\S]*?(?=\n\nNOTE:|$)/;

/**
 * Drop the screen dump from a tool result before it is persisted.
 *
 * The model needs the dump in its context, but the same tree is already saved
 * in ui_tree_snapshot, so storing it in result_message as well kept every step's
 * screen twice — the main reason android_task_logs grew to hundreds of MB. The
 * live broadcast still carries the full text; only the stored copy is trimmed.
 */
function stripScreenDump(text: string): string {
  if (!text) return text;
  return text.replace(SCREEN_DUMP_PATTERN, '\n\n(screen elements stored separately)');
}

/**
 * How long a run may produce no activity at all before it is considered dead.
 *
 * This deliberately replaced a wall-clock limit. The old code stopped every run
 * after ten minutes regardless of whether it was making progress, which killed
 * long but perfectly healthy tasks. What matters is not how long a run has been
 * going, but whether anything is still happening — so this timer resets on every
 * agent message and every executed device step, and only fires when the loop has
 * genuinely gone silent (device disconnected, model request hung).
 *
 * The existing unchanged-observation, identical-tool-state and consecutive-failure
 * guards cover the opposite case, where the loop is busy but going nowhere.
 */
const STALL_TIMEOUT_MS = 3 * 60_000;
/**
 * How long a run may go without a single action reaching the phone. The stall
 * watchdog above counts any model message as life, so a model that keeps
 * thinking, streaming or retrying without ever choosing a step reset it forever
 * and a task could sit on "Step 1" for many minutes. This one only counts real
 * device actions, so such a run is stopped with a reason instead of hanging.
 */
const NO_ACTION_TIMEOUT_MS = 4 * 60_000;

/**
 * Task leases. A running task renews its lease every LEASE_RENEW_MS; if the
 * process running it dies, renewals stop and after LEASE_MS the sweeper closes
 * the task as INTERRUPTED. The lease is several renew periods long so a slow
 * database write or a busy event loop never kills a healthy run.
 */
const LEASE_MS = 45_000;
const LEASE_RENEW_MS = 10_000;
const LEASE_SWEEP_MS = 15_000;

const leaseFromNow = () => new Date(Date.now() + LEASE_MS);

/**
 * Test-harness only. With AGENT_SIMULATION=1 (and never in production) a run
 * skips the AI model and instead performs a few real device actions over the
 * socket, so queues, leases, cancel and shutdown can be exercised against fake
 * phones without spending tokens. Tune per task with "[sim steps=6 delay=400 fail]"
 * anywhere in the prompt.
 */
const AGENT_SIMULATION = process.env.AGENT_SIMULATION === '1' && process.env.NODE_ENV !== 'production';

function simulationOptions(prompt: string): { steps: number; delay: number; fail: boolean; planFail: boolean } {
  const match = /\[sim([^\]]*)\]/i.exec(prompt);
  const text = match?.[1] ?? '';
  const number = (key: string, fallback: number) => {
    const found = new RegExp(`${key}=(\\d+)`).exec(text);
    return found ? Number(found[1]) : fallback;
  };
  return { steps: number('steps', 5), delay: number('delay', 400), fail: /\bfail\b/.test(text), planFail: /\bplanfail\b/.test(text) };
}

/** Best-effort mapping of a thrown error to a stable reason code. */
function classifyFailure(message: string | undefined): string {
  const text = (message || '').toLowerCase();
  if (/\b429\b|rate limit|too many requests/.test(text)) return 'LLM_RATE_LIMIT';
  if (/\b401\b|\b402\b|api key|unauthori[sz]ed|insufficient|credit/.test(text)) return 'LLM_AUTH_OR_CREDIT';
  if (/offline|not connected|disconnected/.test(text)) return 'DEVICE_OFFLINE';
  if (/timed out|timeout/.test(text)) return 'TIMEOUT';
  return 'ERROR';
}
const MAX_THOUGHT_CHARS = 1200; // hard cap — prevents any runaway thought-text growth
const MAX_HISTORY_THOUGHT_CHARS = 200; // cap per-step thought when building follow-up context

/** Longest plan we will show; anything past this is noise for the user. */
const MAX_PLAN_NODES = 40;
/** Plan rows are one-liners in the UI, so keep them short. */
const MAX_PLAN_NODE_CHARS = 120;

/**
 * Pulls human-readable step descriptions out of an Eko workflow stream message.
 *
 * The shape of that message is not part of Eko's public typings, and it has
 * changed between versions, so this reads defensively: every access is guarded
 * and any unrecognised shape simply yields an empty list. A missing plan
 * degrades the UI to what it showed before — it never breaks the run.
 */
function extractPlanNodes(payload: unknown): string[] {
  const nodes: string[] = [];

  const pushText = (value: unknown): void => {
    if (nodes.length >= MAX_PLAN_NODES) return;
    let text: string | null = null;
    if (typeof value === 'string') {
      text = value;
    } else if (value && typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      for (const key of ['text', 'name', 'description', 'title', 'content']) {
        if (typeof obj[key] === 'string' && (obj[key] as string).trim()) {
          text = obj[key] as string;
          break;
        }
      }
    }
    if (!text) return;
    const cleaned = text.replace(/\s+/g, ' ').trim();
    if (!cleaned) return;
    nodes.push(cleaned.length > MAX_PLAN_NODE_CHARS ? `${cleaned.slice(0, MAX_PLAN_NODE_CHARS - 1)}…` : cleaned);
  };

  const walk = (value: unknown, depth: number): void => {
    if (!value || depth > 6 || nodes.length >= MAX_PLAN_NODES) return;
    if (Array.isArray(value)) {
      for (const entry of value) walk(entry, depth + 1);
      return;
    }
    if (typeof value !== 'object') return;
    const obj = value as Record<string, unknown>;
    if (Array.isArray(obj.nodes)) {
      for (const node of obj.nodes) pushText(node);
      return;
    }
    for (const key of ['workflow', 'agents', 'steps', 'plan']) {
      if (obj[key]) walk(obj[key], depth + 1);
    }
  };

  walk(payload, 0);

  // Older Eko builds stream the plan as XML text rather than a node array.
  if (nodes.length === 0 && payload && typeof payload === 'object') {
    const obj = payload as Record<string, unknown>;
    const xml = [obj.xml, obj.text, (obj.workflow as Record<string, unknown> | undefined)?.xml].find(
      (candidate) => typeof candidate === 'string' && candidate.includes('<node'),
    );
    if (typeof xml === 'string') {
      const pattern = /<node[^>]*>([\s\S]*?)<\/node>/g;
      let match = pattern.exec(xml);
      while (match !== null && nodes.length < MAX_PLAN_NODES) {
        pushText(match[1].replace(/<[^>]*>/g, ' '));
        match = pattern.exec(xml);
      }
    }
  }

  return nodes;
}

const ANDROID_PLANNER_SYSTEM = `You are an expert autonomous AI Planner for Android mobile devices.

## Your Role
Create a precise, step-by-step execution plan for AndroidAgent to complete the user's task on an Android device.
- The ONLY agent available is **AndroidAgent**.
- You MUST ALWAYS assign all subtasks to \`<agent name="AndroidAgent">\`.
- Break down the goal into SPECIFIC, GRANULAR nodes — not vague high-level steps.
- Each node must describe ONE concrete action the agent should take.

## CRITICAL PLANNING RULES:

### Plan size must match the request
- Count the concrete actions the user actually asked for. A request like
  "open X and do Y" is TWO actions and deserves a two or three node plan.
- Do NOT add nodes the user never asked for: sign-in handling, cookie banners,
  permission dialogs, or extra verification passes. Handle those only if they
  actually appear on screen.
- Long plans are for genuinely long tasks (research, many sites, many items).

### Search by URL, never by typing into a search box
The device has NO way to press Enter or the keyboard's search key. Typing a
query into a search box therefore leaves it unsubmitted, and the agent wastes
many steps hunting for a submit button. ALWAYS navigate straight to the site's
search results URL with open_url instead:
- YouTube: \`https://www.youtube.com/results?search_query=<url-encoded-query>\`
  (this opens the YouTube app itself, already on the results screen)
- Google: \`https://www.google.com/search?q=<url-encoded-query>\`
- Google Maps: \`https://www.google.com/maps/search/<url-encoded-query>\`
- Amazon: \`https://www.amazon.in/s?k=<url-encoded-query>\`
Only fall back to tapping a search box when the app has no URL entry point at
all. Never plan a node that says "press Enter" or "tap the search button".

### "Open <app> and find/play/search <X>" is ONE node, not two
The search results URL launches the app already on the results screen, so a
node that opens the app first is pure waste. Make the FIRST node the open_url
call itself — do not plan open_app, do not plan tapping a search icon, and do
not plan tapping search suggestions. For example, "Open YouTube and play
Lo-Fi Beats" plans as:
  1. open_url https://www.youtube.com/results?search_query=Lo-Fi+Beats
  2. Tap the first video in the results
That is the whole plan.

### Ads and interstitials
- If a "Skip ad", "Skip", "Close" or "X" control is on screen, tap it
  immediately. Do not wait repeatedly for an ad to finish on its own.
- An ad playing over the target content still means the content opened
  correctly — do not restart the task because of one.

### When a page looks empty
Web pages often expose almost nothing to the accessibility tree, so a loaded
page can look blank in the element list. Waiting again will not change that.
After one wait, take a screenshot and read the screen from the image instead
of waiting a third time or scrolling at random.

### Picking from a list of results
- Tap the FIRST plausible match. Do not scroll looking for a better one, and do
  not judge results by length, view count or format unless the user asked.
- At most two scrolls if nothing usable is visible.

### For ALL tasks:
- Always start with launching the correct app or URL
- Include a wait node only where something genuinely loads
- Do not pre-plan popup, cookie or permission handling — the agent deals with
  those if and when they actually show up
- End with a verification step only for tasks where the result is not obvious

### For RESEARCH tasks (research, find info, look up, check reviews):
- NEVER plan just 1-2 nodes — research needs 10-15 nodes minimum
- Must include: open multiple sources, read each source, go back between sources
- Must end with: "Prepare complete summary of all collected information"
- "Deep research" = minimum 5 different sources

### For SEARCH tasks:
- ALWAYS prefer open_url over manually tapping the address bar. Chrome may
  resume on a previously opened page, and its address bar is not always a
  reliable, easy-to-find tap target in the UI tree in that state.
- open_url cannot control tabs — the companion app does not support tab reuse
  yet, so each call may open a new one. Plan plain open_url nodes and never
  promise the user that pages stayed in a single tab.
- Plan: open the search results URL → wait for results → tap the first
  plausible result
- Always append &udm=14 to a Google search URL. It drops the AI overview, the
  shopping row and the image block, so the organic results sit at the top and
  no scrolling is needed to reach them. Without it a search often returns
  stock-photo and image pages instead of the sites asked for.

### For multi-item lists (search results, article listings):
- When identifying "top N" items from a scrollable list, note down each
  item's title and source THE FIRST TIME it's seen — do not rely on
  re-finding the same item after scrolling, since list positions shift.
- If an item can't be relocated after scrolling, treat it as already
  identified from the earlier observation rather than re-scrolling
  repeatedly to visually re-confirm it.

### For NAVIGATION tasks:
- Add a wait node only where something genuinely loads, and never plan popup or
  overlay handling in advance — the agent deals with those if they appear. (An
  earlier version of this section asked for both, contradicting the rule above.)
- Include a scroll node only when the content is known to sit below the fold

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
## Example 1 (Open a website)
User: Open Chrome and go to google.com
Output result:
<root>
  <n>Open Google</n>
  <thought>A URL is known, so this is a single open_url. No app launch, no address bar, no Enter.</thought>
  <agents>
    <agent name="AndroidAgent" id="0" dependsOn="">
      <task>Open google.com</task>
      <nodes>
        <node>open_url https://www.google.com</node>
      </nodes>
    </agent>
  </agents>
</root>

## Example 2 (Search the web and open a result)
User: Search for Phonebox.co.uk on Google and open their website
Output result:
<root>
  <n>Open Phonebox site</n>
  <thought>The search results URL loads Google already on the results page, so the search itself is one node. &udm=14 strips the AI overview and ad blocks so the organic results sit at the top with no scrolling.</thought>
  <agents>
    <agent name="AndroidAgent" id="0" dependsOn="">
      <task>Search Google for Phonebox.co.uk and open the official site</task>
      <nodes>
        <node>open_url https://www.google.com/search?q=Phonebox.co.uk&udm=14</node>
        <node>Tap the first result that points at phonebox.co.uk</node>
      </nodes>
    </agent>
  </agents>
</root>

## Example 3 (Search inside an app that has no URL)
User: Open the Play Store and search for Duolingo
Output result:
<root>
  <n>Find Duolingo</n>
  <thought>The Play Store has no usable search URL, so this is the fallback path: focus the search field, set the text, then press_key ENTER to submit. Only use this shape when no URL entry point exists.</thought>
  <agents>
    <agent name="AndroidAgent" id="0" dependsOn="">
      <task>Search the Play Store for Duolingo</task>
      <nodes>
        <node>Open the Play Store with open_app</node>
        <node>Tap the search field and set_text "Duolingo"</node>
        <node>press_key ENTER to run the search</node>
        <node>Tap the Duolingo result</node>
      </nodes>
    </agent>
  </agents>
</root>

## Example 4 (Open an app already on its results screen)
User: Open YouTube and play Lo-Fi Beats
Output result:
<root>
  <n>Play Lo-Fi Beats</n>
  <thought>YouTube's results URL opens the app itself on the results screen, so opening the app first would be wasted. Two nodes total.</thought>
  <agents>
    <agent name="AndroidAgent" id="0" dependsOn="">
      <task>Play a Lo-Fi Beats video on YouTube</task>
      <nodes>
        <node>open_url https://www.youtube.com/results?search_query=Lo-Fi+Beats</node>
        <node>Tap the first video in the results</node>
      </nodes>
    </agent>
  </agents>
</root>

## Example 5 (Research across several sources)
User: Research Phonebox.co.uk - services, reviews, and latest news
Output result:
<root>
  <n>Phonebox research</n>
  <thought>Research genuinely needs several sources, so the node count is high here for a real reason, not out of habit. Each source is still reached by URL rather than by typing into a search box.</thought>
  <agents>
    <agent name="AndroidAgent" id="0" dependsOn="">
      <task>Research Phonebox.co.uk from several sources and summarise</task>
      <nodes>
        <node>open_url https://www.phonebox.co.uk</node>
        <node>Read the homepage - company description, main services, key offerings</node>
        <node>Scroll down and read the rest of the services content</node>
        <node>open_url https://uk.trustpilot.com/review/phonebox.co.uk</node>
        <node>Read the overall rating and the top customer reviews</node>
        <node>open_url https://www.google.com/search?q=Phonebox.co.uk+news&udm=14</node>
        <node>Open the most recent news article and read it</node>
        <node>Prepare the summary: overview, services, Trustpilot rating, customer feedback, recent news</node>
      </nodes>
    </agent>
  </agents>
</root>

## Example 6 (Change a device setting)
User: Open Settings and check the battery level
Output result:
<root>
  <n>Check battery</n>
  <thought>No URL exists for Settings, so open the app and navigate. No pre-planned popup handling and no fixed waits — the agent deals with whatever actually appears.</thought>
  <agents>
    <agent name="AndroidAgent" id="0" dependsOn="">
      <task>Read the battery level from Settings</task>
      <nodes>
        <node>Open Settings with open_app</node>
        <node>Find and tap Battery</node>
        <node>Read the battery percentage from the screen</node>
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
  /** Set once the process has been told to stop; finished runs then leave the DB alone. */
  private shuttingDown = false;
  private taskLogRepo = AppDataSource.getRepository(AndroidTaskLog);
  private activeTasks = new Map<
    number,
    { cancelled: boolean; deviceId: string; deviceDbId?: number; laneExempt?: boolean; eko?: Eko; ekoTaskId?: string }
  >();
  private activeDeviceTasks = new Map<string, number>();
  private startingDevices = new Set<string>();

  constructor(
    private deviceService: AndroidDeviceService,
    private gatewayService: AndroidGatewayService,
    private aiConfigService: AiConfigService,
    private proxyRotationService: ProxyRotationService,
    private taskQueueService: TaskQueueService,
  ) {
    // The queue launches tasks through the planner, so it is handed the entry
    // point rather than injecting the planner back — that would be a cycle.
    this.taskQueueService.register(
      (prompt, deviceId, userId, maxSteps, existingTaskId, aiConfigId) =>
        this.runTask(prompt, deviceId, userId, maxSteps, existingTaskId, aiConfigId),
      (deviceDbId) => this.isDeviceBusy(deviceDbId),
    );

    // Close out runs whose lease expired — typically because a deploy or crash
    // killed the process running them. Runs once shortly after boot, then on a
    // timer. unref() so the timer never keeps a shutting-down process alive.
    setTimeout(() => void this.sweepExpiredLeases(), 5_000).unref();
    setInterval(() => void this.sweepExpiredLeases(), LEASE_SWEEP_MS).unref();

    // A deploy stops the old container with SIGTERM. Close out our own runs
    // right away (instead of waiting for their leases to expire) and stop the
    // phones, so a device is never left acting for a process that is gone.
    if (AGENT_SIMULATION) Logger.warn('[AndroidPlanner] AGENT_SIMULATION is ON — runs use fake steps, not the AI model.');
    process.once('SIGTERM', () => void this.shutdown('SIGTERM'));
    process.once('SIGINT', () => void this.shutdown('SIGINT'));
  }

  private async shutdown(signal: string): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    const running = Array.from(this.activeTasks.entries()).filter(([, entry]) => !entry.cancelled);
    Logger.warn(`[AndroidPlanner] ${signal} received — interrupting ${running.length} running task(s).`);

    const message = 'Task stopped: the server was restarting (a deploy or restart). Run it again to continue.';
    await Promise.allSettled(
      running.map(async ([taskId, entry]) => {
        entry.cancelled = true;
        try {
          if (entry.eko && entry.ekoTaskId) entry.eko.abortTask(entry.ekoTaskId, 'Server shutting down');
        } catch {
          // best effort
        }
        this.gatewayService.cancelDeviceActions(entry.deviceId);
        this.gatewayService.setAutomationSession(entry.deviceId, false);
        const task = await this.agentTaskRepo.findOne({ where: { id: taskId }, select: ['id', 'user_id', 'device_id'] });
        await this.agentTaskRepo.update(
          { id: taskId, status: 'RUNNING' },
          {
            status: 'INTERRUPTED',
            reason_code: 'SERVER_RESTART',
            success: false,
            message,
            finished_at: new Date(),
            lease_until: null,
          },
        );
        if (task) {
          this.gatewayService.broadcastToUser(task.user_id, 'task:error', {
            taskId,
            deviceId: task.device_id,
            error: message,
            reasonCode: 'SERVER_RESTART',
          });
        }
      }),
    );
    // Give the socket messages a moment to flush, then exit — without a handler
    // Node would have died instantly; with one it must leave on its own.
    setTimeout(() => process.exit(0), 1_500).unref();
  }

  /**
   * Marks RUNNING tasks with an expired lease as INTERRUPTED and tells the
   * owner's open dashboards, so a run killed by a restart shows up as stopped
   * with a reason instead of vanishing or staying "running" forever.
   *
   * Decided on the lease alone, never on "not in this process's memory": during
   * a deploy the old and new containers overlap, and the old one may still be
   * running — and renewing — tasks the new one has never heard of.
   */
  private async sweepExpiredLeases(): Promise<void> {
    if (!AppDataSource.isInitialized) return;
    try {
      const expired = await this.agentTaskRepo
        .createQueryBuilder('task')
        .select(['task.id', 'task.user_id', 'task.device_id'])
        .where('task.status = :status', { status: 'RUNNING' })
        .andWhere('task.lease_until < :now', { now: new Date() })
        .getMany();

      for (const task of expired) {
        // Our own live run with a missed renewal is not dead — just renew it.
        if (this.activeTasks.has(task.id)) {
          await this.agentTaskRepo.update({ id: task.id, status: 'RUNNING' }, { lease_until: leaseFromNow() });
          continue;
        }
        const message = 'Task stopped: the server restarted or lost track of this run. Run it again to continue.';
        const result = await this.agentTaskRepo.update(
          { id: task.id, status: 'RUNNING' },
          {
            status: 'INTERRUPTED',
            reason_code: 'SERVER_RESTART',
            success: false,
            message,
            finished_at: new Date(),
            lease_until: null,
          },
        );
        if (result.affected) {
          Logger.warn(`[AndroidPlanner] Task ${task.id} lease expired — marked INTERRUPTED.`);
          this.gatewayService.broadcastToUser(task.user_id, 'task:error', {
            taskId: task.id,
            deviceId: task.device_id,
            error: message,
            reasonCode: 'SERVER_RESTART',
          });
        }
      }
    } catch (error) {
      Logger.warn('[AndroidPlanner] Lease sweep failed:', error);
    }
  }

  /** True while a run is in progress on this device, or about to be. */
  /**
   * True while a run is in progress on this device, or about to be.
   *
   * The queue asks this to decide whether a lane is occupied, so runs that need
   * no exit IP are not counted: they share the phone, not the address.
   */
  private isDeviceBusy(deviceDbId: number): boolean {
    for (const active of this.activeTasks.values()) {
      if (active.deviceDbId === deviceDbId && !active.laneExempt) return true;
    }
    return false;
  }

  /**
   * Main autonomous reasoning loop for Android task execution powered by @eko-ai/eko.
   * Supports multi-turn conversational follow-ups by passing existingTaskId.
   */
  async runTask(
    prompt: string,
    deviceId: number,
    userId: number,
    maxSteps = DEFAULT_MAX_STEPS,
    existingTaskId?: number,
    aiConfigId?: number,
    /** Keep every screen frame so the run can be shared or replayed later. */
    record = false,
    /**
     * The run uses no exit IP — a settings change, something inside an app — so
     * it neither waits for the phone's proxy lane nor occupies it.
     */
    skipProxyLane = false,
  ): Promise<ApiResponse> {
    // A task can pin a specific provider so different devices can run different
    // models simultaneously; otherwise fall back to the user's active config.
    const aiConfig = aiConfigId
      ? (await this.aiConfigService.resolveConfigById(userId, aiConfigId)) ??
        (await this.aiConfigService.resolveActiveConfig(userId))
      : await this.aiConfigService.resolveActiveConfig(userId);

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
      // Phones that were alive moments ago are usually mid-reconnect (a deploy,
      // a brief network drop), so give them a few seconds before refusing.
      const seenRecently =
        device.status === AndroidDeviceStatus.ONLINE &&
        !!device.last_seen_at &&
        Date.now() - new Date(device.last_seen_at).getTime() < 2 * 60_000;
      const connected = seenRecently ? await this.gatewayService.waitForDevice(device.device_id) : false;
      if (!connected) {
        throw new AppError(
          seenRecently
            ? `Device "${device.device_name}" is reconnecting (the server may have just restarted). Try again in a few seconds.`
            : `Device "${device.device_name}" is currently offline. Please open the companion app on the device.`,
          400,
        );
      }
    }
    if (this.activeDeviceTasks.has(device.device_id) || this.startingDevices.has(device.device_id)) {
      throw new AppError(`Device "${device.device_name}" is already running another automation task.`, 409);
    }

    // A phone behind a proxy shares one exit IP with the rest of its lane, so it
    // waits its turn instead of starting alongside them. Devices with no proxy
    // skip this entirely and behave exactly as they always have.
    if (device.proxy_id && !existingTaskId && !skipProxyLane) {
      // Admission reserves the lane slot as it grants it, so devices dispatched
      // together cannot all be told the lane is free.
      const admitted = await this.taskQueueService.tryAdmit(device.id);
      if (!admitted) {
        return this.taskQueueService.enqueue({
          userId,
          deviceId: device.id,
          proxyId: device.proxy_id,
          prompt,
          aiConfigId,
          maxSteps,
        });
      }
    }
    this.startingDevices.add(device.device_id);

    // Steps are the only ceiling now that the wall-clock timeout is gone, so the
    // number the user typed is the number that actually runs. Previously this
    // silently clamped to 200 while the UI and validation both advertised 500,
    // which made long runs stop for no visible reason. Genuinely stuck runs are
    // caught by the stall watchdog in executeLoop instead.
    const boundedMaxSteps = Math.max(1, Math.floor(Number(maxSteps) || DEFAULT_MAX_STEPS));

    // Wake the display before the first observation in case the device was idle.
    this.gatewayService.setAutomationSession(device.device_id, true);

    // A phone that has been sitting idle needs a moment after the wake lock
    // before its accessibility service answers. Without this pause the first
    // action lands while the device is still coming up and times out — which
    // is what made queued devices look broken while the same handset worked
    // fine from the agent page, where the live view had already woken it.
    await new Promise((resolve) => setTimeout(resolve, WAKE_SETTLE_MS));

    let initialScreenshot: string | undefined;
    try {
      initialScreenshot = await this.assertDeviceReady(device.device_id, userId);
    } catch (error) {
      // One retry, because the usual cause is a device that simply had not
      // finished waking. A second failure is a real problem and is reported.
      Logger.warn(`[AndroidPlanner] ${device.device_name} was not ready; waking it and retrying once`);
      try {
        this.gatewayService.setAutomationSession(device.device_id, true);
        await new Promise((resolve) => setTimeout(resolve, WAKE_RETRY_MS));
        initialScreenshot = await this.assertDeviceReady(device.device_id, userId);
      } catch (retryError) {
        this.startingDevices.delete(device.device_id);
        this.gatewayService.setAutomationSession(device.device_id, false);
        throw retryError;
      }
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
          agentTask.status = 'RUNNING';
          agentTask.reason_code = null;
          agentTask.started_at = new Date();
          agentTask.finished_at = null;
          agentTask.lease_until = leaseFromNow();
          await this.agentTaskRepo.save(agentTask);

          // DESC then reversed: take() applies after the sort, so ASC handed back
          // the FIRST twenty steps of the run. On any task longer than twenty
          // steps a follow-up therefore showed the agent only the beginning and
          // none of the work it had just done.
          const recentLogs = (
            await this.taskLogRepo.find({
              where: { agent_task_id: existingTaskId },
              order: { step_index: 'DESC' },
              take: 20,
            })
          ).reverse();

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
            status: 'RUNNING',
            reason_code: null,
            started_at: new Date(),
            finished_at: null,
            lease_until: leaseFromNow(),
            lane_exempt: skipProxyLane,
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
          status: 'RUNNING',
          reason_code: null,
          started_at: new Date(),
          finished_at: null,
          lease_until: leaseFromNow(),
          total_steps: 0,
          total_duration_seconds: 0,
          logs: `Starting Android automation task with ${aiConfig.provider} (${aiConfig.model}) via Eko...\n`,
          lane_exempt: skipProxyLane,
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
    this.activeTasks.set(agentTask.id, {
      cancelled: false,
      deviceId: device.device_id,
      deviceDbId: device.id,
      laneExempt: skipProxyLane,
    });
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
      record,
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
    task.status = 'CANCELLED';
    task.reason_code = 'USER_CANCELLED';
    task.finished_at = new Date();
    task.lease_until = null;
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
    record = false,
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
    // Eko re-streams the workflow as it grows, so only broadcast real changes.
    let lastPlanSignature = '';
    let loggedUnparsedPlan = false;
    let currentTaskLog: AndroidTaskLog | null = null;
    let lastScreenshot: string | undefined = initialScreenshot;
    let lastUiTree: string | undefined;
    let lastForegroundApp: string | undefined;
    let finalMessage = '';
    let guardStopReason: string | undefined;
    let guardStopCode: string | undefined;
    let consecutiveFailures = 0;
    let lastToolStateSignature: string | undefined;
    let identicalToolStateCount = 0;
    let lastObservationFingerprint: string | undefined;
    let unchangedObservationCount = 0;

    const device = await this.deviceService.getDeviceByHardwareId(hardwareDeviceId);
    const deviceDbId = device?.id;
    const ekoTaskId = `android-task-${agentTask.id}`;

    let eko: Eko | undefined;
    const stopForSafety = (reason: string, code = 'GUARD_STOP') => {
      if (guardStopReason) return;
      guardStopReason = reason;
      guardStopCode = code;
      if (eko) {
        try {
          eko.abortTask(ekoTaskId, reason);
        } catch (error) {
          Logger.warn(`[AndroidPlanner] Failed to stop guarded task ${ekoTaskId}:`, error);
        }
      }
      this.gatewayService.cancelDeviceActions(hardwareDeviceId);
    };

    // Stall watchdog. Declared here (rather than beside the Eko run below) so the
    // agent and message callbacks can reach it; it is only armed once the loop
    // actually starts. Every sign of life resets it, so a task that keeps moving
    // can run for hours.
    let rejectTaskTimeout: ((error: Error) => void) | undefined;
    let stallTimer: ReturnType<typeof setTimeout> | undefined;
    let watchdogArmed = false;
    let noActionTimer: ReturnType<typeof setTimeout> | undefined;
    const noteDeviceAction = () => {
      if (!watchdogArmed) return;
      if (noActionTimer) clearTimeout(noActionTimer);
      noActionTimer = setTimeout(() => {
        const minutes = Math.round(NO_ACTION_TIMEOUT_MS / 60_000);
        const reason =
          `Task stopped: the AI model did not take any action on the phone for ${minutes} minutes. ` +
          `It kept thinking without choosing a step — try again or switch to a different model.`;
        stopForSafety(reason, 'NO_ACTION');
        rejectTaskTimeout?.(new Error(reason));
      }, NO_ACTION_TIMEOUT_MS);
    };
    const noteActivity = () => {
      if (!watchdogArmed) return;
      if (stallTimer) clearTimeout(stallTimer);
      stallTimer = setTimeout(() => {
        const minutes = Math.round(STALL_TIMEOUT_MS / 60_000);
        const reason =
          `Task stopped because nothing happened for ${minutes} minutes. ` +
          `The phone or the AI provider stopped responding — this is not a step-limit or time-limit problem.`;
        stopForSafety(reason, 'STALLED');
        rejectTaskTimeout?.(new Error(reason));
      }, STALL_TIMEOUT_MS);
    };

    const androidAgent = new AndroidAgent(this.gatewayService, hardwareDeviceId, {
      onStepExecuted: (info) => {
        // A device action came back, including waits. Proof the phone is alive.
        noteActivity();
        noteDeviceAction();
        if (info.screenshotBase64) {
          lastScreenshot = info.screenshotBase64;
          this.gatewayService.broadcastToUser(userId, 'device:screen_capture', {
            deviceId: hardwareDeviceId,
            result: { screenCapture: { base64Data: info.screenshotBase64 } },
          });
        }
        if (info.uiTree) lastUiTree = info.uiTree;
        if (info.foregroundApp) lastForegroundApp = info.foregroundApp;

        // Waits deliberately skip re-observation, so they always report the
        // previous screen. Counting them here killed legitimate runs that were
        // simply waiting for a page to finish loading.
        const isWaitStep = info.toolName === 'wait';

        if (!isWaitStep && (info.uiTree || info.screenshotBase64)) {
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
            stopForSafety('The visible device state did not change after repeated agent actions.', 'SCREEN_UNCHANGED');
          }
        }
      },
    });

    const ekoInstance = new Eko({
      llms: this.buildEkoLlms(aiConfig),
      agents: [androidAgent],
      callback: {
        onMessage: async (message: AgentStreamMessage) => {
          // Any message means the model is still talking to us. Reset before the
          // cancellation check so a cancelling run is not also reported as stalled.
          noteActivity();

          if (this.activeTasks.get(agentTask.id)?.cancelled) {
            wasCancelled = true;
            return;
          }

          // The plan Eko builds before it touches the device is the most useful
          // thing we can show during the otherwise blank planning wait. Read it
          // through an untyped view: 'workflow' is not in Eko's exported union,
          // so comparing the typed discriminant would not compile.
          const rawMessage = message as unknown as { type?: string };
          if (rawMessage.type === 'workflow') {
            const planNodes = extractPlanNodes(message);
            if (planNodes.length > 0) {
              const signature = planNodes.join('\u0000');
              if (signature !== lastPlanSignature) {
                lastPlanSignature = signature;
                this.gatewayService.broadcastToUser(userId, 'task:plan', {
                  taskId: agentTask.id,
                  nodes: planNodes,
                });
              }
            } else if (!loggedUnparsedPlan) {
              // One line per task, truncated — enough to fix the parser if a
              // future Eko version changes the shape again.
              loggedUnparsedPlan = true;
              Logger.info(
                `[AndroidPlanner] Task ${agentTask.id}: could not read plan from workflow message: ` +
                  `${JSON.stringify(message).slice(0, 600)}`,
              );
            }
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
              const reason =
                `Task stopped after reaching the ${maxSteps}-step limit. ` +
                `The task was still in progress — raise the Steps value in the header (up to 500) and run it again, ` +
                `or use Continue task below to carry on from the current screen.`;
              stopForSafety(reason, 'STEP_LIMIT');
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
              stopForSafety(reason, 'LOOP_DETECTED');
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
              stopForSafety(`Task stopped after ${MAX_CONSECUTIVE_FAILURES} consecutive device action failures.`, 'DEVICE_ACTION_FAILURES');
            }

            if (currentTaskLog) {
              currentTaskLog.status = isError ? AndroidStepStatus.FAILED : AndroidStepStatus.SUCCESS;
              currentTaskLog.result_message = stripScreenDump(textContent);
              currentTaskLog.duration_ms = Date.now() - stepStartTime;
              currentTaskLog.ui_tree_snapshot = lastUiTree || currentTaskLog.ui_tree_snapshot;
              // Frames already arrive with every observation for the live view;
              // recording simply keeps them so the run can be replayed or
              // shared. Off by default because they are large.
              if (record && lastScreenshot) {
                currentTaskLog.screenshot_base64 = lastScreenshot;
              }
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

    // The companion app holds a screen wake-lock with a safety timeout. Re-send the
    // session signal periodically so the device never locks mid-task while the
    // agent is waiting on the model.
    const keepAwakeTimer = setInterval(() => {
      this.gatewayService.setAutomationSession(hardwareDeviceId, true);
    }, 45_000);

    // Arm the stall watchdog. There is no longer any limit on how long a run may
    // take — only on how long it may be completely silent.
    watchdogArmed = true;
    noteActivity();
    noteDeviceAction();

    const leaseTimer = setInterval(() => {
      this.agentTaskRepo
        .update({ id: agentTask.id, status: 'RUNNING' }, { lease_until: leaseFromNow() })
        .catch((error) => Logger.warn(`[AndroidPlanner] Lease renewal failed for task ${agentTask.id}:`, error));
    }, LEASE_RENEW_MS);

    try {
      const timeoutPromise = new Promise<never>((_resolve, reject) => {
        rejectTaskTimeout = reject;
      });
      const simulate = async () => {
        const options = simulationOptions(prompt);
        // What Eko returns when the model's plan comes back with no agent in it.
        if (options.planFail) return { success: false, stopReason: 'error', result: 'Error: Workflow error' };
        for (let index = 0; index < options.steps; index += 1) {
          if (this.activeTasks.get(agentTask.id)?.cancelled) {
            wasCancelled = true;
            return { success: false, stopReason: 'abort', result: 'Cancelled' };
          }
          if (guardStopReason) throw new Error(guardStopReason);
          const outcome = await this.gatewayService.executeAction(hardwareDeviceId, { type: 'CaptureScreen' });
          stepCount += 1;
          noteActivity();
          noteDeviceAction();
          if (outcome.status !== 'SUCCESS') {
            throw new Error('message' in outcome ? outcome.message : 'Simulated device action failed');
          }
          await new Promise((resolve) => setTimeout(resolve, options.delay));
        }
        if (options.fail) throw new Error('Simulated failure');
        return { success: true, stopReason: 'done', result: `Simulated run finished after ${options.steps} steps.` };
      };
      const result = (await Promise.race([
        AGENT_SIMULATION ? simulate() : ekoInstance.run(prompt, ekoTaskId),
        timeoutPromise,
      ])) as Awaited<ReturnType<typeof ekoInstance.run>>;
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
      const terminal: { status: AgentTaskStatus; reason: string | null } = isSuccess
        ? { status: 'SUCCEEDED', reason: null }
        : wasCancelled
          ? { status: 'CANCELLED', reason: 'USER_CANCELLED' }
          : guardStopReason
            ? { status: 'FAILED', reason: guardStopCode ?? 'GUARD_STOP' }
            : /workflow error/i.test(String(terminalAgentResult ?? ''))
              ? // Eko's planning call returned a plan with no agent in it — a
                // model hiccup before any step ran, not the task being impossible.
                { status: 'FAILED', reason: 'PLAN_FAILED' }
              : !agentFinished
                ? { status: 'FAILED', reason: 'UNFINISHED' }
                : { status: 'FAILED', reason: 'AGENT_REPORTED_FAILURE' };
      agentTask.status = terminal.status;
      agentTask.reason_code = terminal.reason;
      agentTask.finished_at = new Date();
      agentTask.lease_until = null;
      if (!this.shuttingDown) await this.agentTaskRepo.save(agentTask);

      if (!wasCancelled) {
        this.gatewayService.broadcastToUser(userId, 'task:completed', {
          taskId: agentTask.id,
          deviceId: deviceDbId,
          success: agentTask.success,
          message: agentTask.message,
          totalSteps: stepCount,
          reasonCode: agentTask.reason_code,
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
        agentTask.status = 'FAILED';
        agentTask.reason_code = guardStopReason ? (guardStopCode ?? 'GUARD_STOP') : classifyFailure(err?.message);
        agentTask.finished_at = new Date();
        agentTask.lease_until = null;
        await this.agentTaskRepo.save(agentTask);
        this.gatewayService.broadcastToUser(userId, 'task:error', {
          taskId: agentTask.id,
          deviceId: deviceDbId,
          error: err.message,
          reasonCode: agentTask.reason_code,
        });
      }
    } finally {
      clearInterval(keepAwakeTimer);
      clearInterval(leaseTimer);
      watchdogArmed = false;
      if (stallTimer) clearTimeout(stallTimer);
      if (noActionTimer) clearTimeout(noActionTimer);
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

      // Give this phone's proxy a fresh IP for whatever runs next. Deliberately
      // not awaited: the run is over, and a slow provider must not hold the
      // device marked busy or delay the result the user is waiting on.
      // The slot goes back before rotation, so the lane is free the moment the
      // new IP has settled.
      this.taskQueueService.release(agentTask.device_id);

      // A run that used no exit IP has nothing to rotate away from, and it was
      // never holding the lane, so neither the provider nor the queue is touched.
      if (agentTask.lane_exempt) return;

      // Rotate first, then let the lane's next phone in — the wait for the new
      // IP to settle happens inside onLaneFreed.
      void this.proxyRotationService
        .onTaskFinished(agentTask.device_id)
        .then(() => this.taskQueueService.onDeviceFinished(agentTask.device_id))
        .catch((error) => Logger.warn('[AndroidPlanner] Proxy rotation or queue drain failed:', error));
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
    let observation = await this.gatewayService.executeAction(hardwareDeviceId, { type: 'ObserveScreen' });
    // Android allows roughly one accessibility screenshot per second; a live
    // preview taken a moment earlier makes the phone refuse this one. That is
    // a wait, not a setup problem.
    for (let tries = 0; tries < 2 && observation.status === 'FAILURE' && /too quickly|interval/i.test(observation.message ?? ''); tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      observation = await this.gatewayService.executeAction(hardwareDeviceId, { type: 'ObserveScreen' });
    }
    const treeResult = observation;
    const captureResult = observation;

    if (treeResult.status !== 'SUCCESS') {
      const detail = treeResult.status === 'FAILURE' ? treeResult.message : 'UI inspection was cancelled';
      // Only blame accessibility when the phone said so. A socket that is
      // gone or a phone that never answered used to land here too, and the
      // message sent people to re-enable a service that was already on.
      const failure = treeResult.status === 'FAILURE' ? treeResult : null;
      if (failure && /not currently connected/i.test(failure.message ?? '')) {
        throw new AppError('The phone is offline right now (it may be reconnecting). Try again in a moment.', 409);
      }
      if (failure && /too quickly|interval/i.test(failure.message ?? '')) {
        throw new AppError(`The phone is busy taking another screenshot — try again in a moment. ${detail}`, 429);
      }
      if (treeResult.status === 'CANCELLED') {
        throw new AppError('The screen check was cancelled before the phone answered — try again.', 409);
      }
      if (failure?.code === 'TIMEOUT') {
        throw new AppError(
          `The phone did not answer the first screen check in time — it may be asleep, busy or on a slow connection. ${detail}`,
          504,
        );
      }
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
