import { modelErrorText } from '@/services/ai/modelErrors';
import { addSight, emptyRunSight, runSightLine, sightCapability, type SightWhy } from './screenSight';
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
import { config, global, GlobalPromptKey, type AgentStreamMessage, type LLMs } from '@eko-ai/eko';
import { AndroidAgent } from './eko/AndroidAgent';
import { classifyFailure } from './failureReason';
import { RunDiagnosticsService } from './RunDiagnosticsService';
import { screenFingerprint, type RecoveryKind } from './runDiagnostics';
import { modelSeesImages } from './eko/modelVision';
import { isEngineKind, type AgentEngine, type EngineKind, type EngineRunResult } from './agent/AgentEngine';
import { EkoEngine } from './agent/EkoEngine';
import { VectorEngine } from './agent/VectorEngine';
import { withRateLimitRetry } from '@/services/ai/rateLimitFetch';
import { createScreenGrounder } from './agent/screenGrounder';
import { isOscillating } from './agent/oscillation';
import { isScreenshotMode, type ScreenshotMode } from './eko/screenshotMode';
import { deviceFactsText } from './deviceNetwork';
import { createLanguageModel } from './agent/aiSdkModel';
import { User } from '@/entities/User';
import { FlowLibraryService, type FlowMode, type FlowPlan } from './FlowLibraryService';
import { FlowRunner } from './flowRunner';
import { aiDidStep, LOOK_ONLY_TOOLS, parseTable, recordFlow, resyncIndex, type FlowStepV2 } from './flowSteps';
import { parseAppList, verifyCompletion } from './agent/successVerifier';
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
// Images go to the model as a user message with a real image part, never inside
// a tool result: OpenRouter and OpenAI-compatible APIs turn tool-result images
// into base64 text (~80k tokens per screenshot, re-sent on every later call).
config.toolResultMultimodal = false;

const MAX_CONSECUTIVE_FAILURES = 6;
const MAX_IDENTICAL_TOOL_STATES = 3;
const MAX_UNCHANGED_OBSERVATIONS = 3;
/**
 * A run bouncing between the same two steps on the same two screens
 * (tap → menu → BACK → tap …) never repeats one step twice in a row, so the
 * identical-step guard missed it; one run went round 28 times in 12 minutes.
 * The agent is shown the screen after two rounds; six rounds stops the run.
 */
const OSCILLATION_WINDOW = 12;
/** Actions the AI may take to fix one broken flow step before the rest of the task goes to it. */
const FLOW_REPAIR_STEPS = 10;

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

function simulationOptions(prompt: string): {
  steps: number;
  delay: number;
  fail: boolean;
  planFail: boolean;
  report: string | null;
  actions: string[] | null;
} {
  const match = /\[sim([^\]]*)\]/i.exec(prompt);
  const text = match?.[1] ?? '';
  const number = (key: string, fallback: number) => {
    const found = new RegExp(`${key}=(\\d+)`).exec(text);
    return found ? Number(found[1]) : fallback;
  };
  const report = /report="([^"]*)"/.exec(text)?.[1] ?? null;
  // actions=open:com.app,read,tap,tap0,back,fail,wait,click:Text — a scripted run that goes
  // through the real step recording (tool_use / tool_result / finish).
  const actions = /actions=([\w.:,]+)/.exec(text)?.[1]?.split(',').filter(Boolean) ?? null;
  return {
    steps: number('steps', 5),
    delay: number('delay', 400),
    fail: /\bfail\b/.test(text.replace(/actions=[\w.:,]+/, '')),
    planFail: /\bplanfail\b/.test(text),
    report,
    actions,
  };
}

/** The formatted tree a simulated screen shows; the clock row changes without changing the screen. */
function simulatedTree(screen: number, tick: number): string {
  return ['idx|type|label|flags|tap_at', `0|text|12:${String(tick % 60).padStart(2, '0')}||40,20`, `1|btn|Screen ${screen}|t|100,200`].join('\n');
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

### Searching and submitting
The quickest way to search is the site's search results URL with open_url —
one step, no typing:
- YouTube: \`https://www.youtube.com/results?search_query=<url-encoded-query>\`
  (this opens the YouTube app itself, already on the results screen)
- Google: \`https://www.google.com/search?q=<url-encoded-query>\`
- Google Maps: \`https://www.google.com/maps/search/<url-encoded-query>\`
- Amazon UK: \`https://www.amazon.co.uk/s?k=<url-encoded-query>\`
When text has to go into an app's own field (a search box with no URL, a
form, a chat message), type it and then submit with press_key ENTER — on
Android 11+ that triggers the keyboard's Search/Go/Send action. If ENTER is
refused (older Android), tap the on-screen Search, Go, Send or Done button.

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

### If the phone is on the lock screen
Signs: "Swipe up to unlock", a big clock with the date, "Emergency call", or a
wallpaper with almost nothing tappable. This is NOT the app you were asked to
open — the screen is just locked.
- Swipe UP once to unlock. If that one swipe does not unlock it, do NOT keep
  swiping — press the HOME global action once, then take a screenshot.
- Spend at most 2-3 steps trying to get past the lock. If it is still locked
  after that, stop and report that the phone is locked (it may need a PIN or a
  manual unlock) instead of swiping again and again.
- Never treat a locked screen as a failure of the task itself and never restart
  the task because of it.

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
    { cancelled: boolean; deviceId: string; deviceDbId?: number; laneExempt?: boolean; engine?: AgentEngine }
  >();
  private activeDeviceTasks = new Map<string, number>();
  private startingDevices = new Set<string>();

  constructor(
    private deviceService: AndroidDeviceService,
    private gatewayService: AndroidGatewayService,
    private aiConfigService: AiConfigService,
    private proxyRotationService: ProxyRotationService,
    private taskQueueService: TaskQueueService,
    private runDiagnosticsService: RunDiagnosticsService,
    private flowLibrary: FlowLibraryService,
  ) {
    // The queue launches tasks through the planner, so it is handed the entry
    // point rather than injecting the planner back — that would be a cycle.
    this.taskQueueService.register(
      (prompt, deviceId, userId, maxSteps, existingTaskId, aiConfigId, runSeconds) =>
        this.runTask(prompt, deviceId, userId, maxSteps, existingTaskId, aiConfigId, false, false, runSeconds),
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
          entry.engine?.abort('Server shutting down');
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
    /**
     * Keep working this long ("browse for 1 hour"). The agent has no clock and
     * stops when it thinks it is done, so the run starts fresh rounds on the
     * same task until the time is up; the phone keeps its lane slot throughout.
     */
    runForSeconds?: number,
    /** Replay this saved flow first (the Flows page's "Replay"), whatever the account switch says. */
    opts: { flowId?: number } = {},
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
          runSeconds: runForSeconds,
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
      runForSeconds && runForSeconds > 0 ? Date.now() + runForSeconds * 1000 : undefined,
      { flowId: opts.flowId, followUp: Boolean(existingTaskId) },
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
      active.engine?.abort('Task cancelled by user');
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

  /**
   * The engine for this account's runs: the account's own choice, else the
   * server default (AGENT_ENGINE, 'eko' when unset or invalid).
   */
  async engineSettings(userId: number): Promise<{
    kind: EngineKind;
    planner: boolean;
    source: 'account' | 'server';
    vision_config_id: number | null;
    fallback_config_id: number | null;
    screenshots: ScreenshotMode;
  }> {
    const fallback: EngineKind = isEngineKind(process.env.AGENT_ENGINE) ? process.env.AGENT_ENGINE : 'eko';
    const user = await AppDataSource.getRepository(User)
      .findOne({ where: { id: userId }, select: ['id', 'agent_engine', 'agent_planner', 'agent_vision_config_id', 'agent_fallback_config_id', 'agent_screenshots'] })
      .catch(() => null);
    const own = user?.agent_engine;
    const shots = user?.agent_screenshots;
    return {
      kind: isEngineKind(own) ? own : fallback,
      planner: Boolean(user?.agent_planner),
      source: isEngineKind(own) ? 'account' : 'server',
      vision_config_id: user?.agent_vision_config_id ?? null,
      fallback_config_id: user?.agent_fallback_config_id ?? null,
      screenshots: isScreenshotMode(shots) ? shots : 'stuck',
    };
  }

  /** The fleet default model, its vision helper and the screenshot setting, as the next run would use them. */
  async sightStatus(userId: number) {
    const settings = await this.engineSettings(userId);
    const config = await this.aiConfigService.resolveActiveConfig(userId);
    const modelSees = config ? await modelSeesImages(config.provider, config.model).catch(() => false) : false;
    const helper = !modelSees && settings.vision_config_id ? await this.aiConfigService.resolveConfigById(userId, settings.vision_config_id).catch(() => null) : null;
    const helperSees = helper ? await modelSeesImages(helper.provider, helper.model).catch(() => false) : false;
    return {
      model: config?.model ?? null,
      model_sees: modelSees,
      helper_model: helper?.model ?? null,
      helper_sees: helperSees,
      screenshots: settings.screenshots ?? 'stuck',
      capability: sightCapability(modelSees, helperSees),
    };
  }

  async setEngineSettings(
    userId: number,
    input: { engine?: string | null; planner?: boolean; vision_config_id?: number | null; fallback_config_id?: number | null; screenshots?: string | null },
  ): Promise<ApiResponse> {
    const patch: Partial<User> = {};
    if (input.engine !== undefined) {
      if (input.engine !== null && !isEngineKind(input.engine)) throw new AppError('engine must be "eko", "vector" or null', 400);
      patch.agent_engine = input.engine;
    }
    if (input.planner !== undefined) patch.agent_planner = Boolean(input.planner);
    if (input.screenshots !== undefined) {
      if (input.screenshots !== null && !isScreenshotMode(input.screenshots)) throw new AppError('screenshots must be "off", "stuck" or "every_step"', 400);
      patch.agent_screenshots = input.screenshots;
    }
    // A helper model must be one of this account's own AI configs.
    for (const [key, column] of [
      ['vision_config_id', 'agent_vision_config_id'],
      ['fallback_config_id', 'agent_fallback_config_id'],
    ] as const) {
      const value = input[key];
      if (value === undefined) continue;
      if (value !== null && !(await this.aiConfigService.resolveConfigById(userId, Number(value)))) throw new AppError('That AI model is not one of yours', 400);
      patch[column] = value === null ? null : Number(value);
    }
    if (Object.keys(patch).length) await AppDataSource.getRepository(User).update({ id: userId }, patch);
    return { message: 'Engine settings saved', data: await this.engineSettings(userId) };
  }

  /** One model in Eko's shape. Short rate limits are waited out at the HTTP level. */
  private ekoLlm(aiConfig: DecryptedAiConfig): LLMs[string] {
    const defaultBaseUrl = this.aiConfigService.getDefaultBaseUrl(aiConfig.provider);
    const baseURL = aiConfig.base_url?.trim() || defaultBaseUrl || undefined;
    let provider: any;
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
      provider,
      model: aiConfig.model,
      apiKey: aiConfig.api_key,
      // Stays under Eko's 45 s wait for the first streamed token.
      fetch: withRateLimitRetry(fetch, { maxTotalMs: 30_000 }),
      config: {
        baseURL,
        temperature: 0.1,
      },
    } as LLMs[string];
  }

  /** "default" is the account's model; "fallback", when set, is tried when it fails (Eko walks the names in order). */
  private buildEkoLlms(aiConfig: DecryptedAiConfig, fallback?: DecryptedAiConfig | null): LLMs {
    const llms: LLMs = { default: this.ekoLlm(aiConfig) };
    if (fallback) llms.fallback = this.ekoLlm(fallback);
    return llms;
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
    /** Epoch ms. When set, the run keeps going in rounds until this moment. */
    runUntil?: number,
    flowOptions: { flowId?: number; followUp?: boolean } = {},
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
    const recentStepSignatures: string[] = [];
    let lastObservationFingerprint: string | undefined;
    let pendingTapPx: { x: number; y: number } | null = null;
    let unchangedObservationCount = 0;

    // Saved flows (docs/REPLAY_ENGINE.md). Who chose the step being logged.
    let stepSource: 'ai' | 'replay' = 'ai';
    /** What type_text really typed, by step (the log keeps "[REDACTED]"); memory only. */
    const typedTexts = new Map<number, string>();
    /** While the AI fixes one broken flow step: the step, its budget and where the flow resumes. */
    let repair: {
      plan: FlowPlan;
      index: number;
      /** Last step number before the AI started; its own steps follow. */
      fromStep: number;
      startKey: string;
      used: number;
      resumeAt: number;
    } | null = null;
    let flowSettings = { record: false, replay_first: false, ai_repair: false, share_fixes: false };
    let flowPlan: FlowPlan | null = null;
    let flowMode: FlowMode = 'replay';
    /** An AI fix of a flow step, saved as a candidate if the run succeeds. */
    let pendingFix: { index: number; resume: number; fromStep: number; toStep: number } | null = null;
    /** Saved fixes this run used (their outcome is booked when it ends). */
    const usedPatches: number[] = [];
    let runSucceeded = false;

    // Run diagnostics: where this run's time and model usage go (RunDiagnosticsService).
    let lastResultAt = Date.now();
    let llmCalls = 0;
    let promptTokens = 0;
    let completionTokens = 0;
    let tokensReported = false;
    /** Steps the current model call has produced so far (its usage is booked on the first). */
    let callSteps: AndroidTaskLog[] = [];

    const device = await this.deviceService.getDeviceByHardwareId(hardwareDeviceId);
    const deviceDbId = device?.id;
    const baseEkoTaskId = `android-task-${agentTask.id}`;
    // Each round of a timed run is its own Eko task; aborts target the live one.
    let ekoTaskId = baseEkoTaskId;
    const ekoTaskIds: string[] = [baseEkoTaskId];
    let round = 1;
    let reachedDeadline = false;

    let engine: AgentEngine | undefined;
    const stopForSafety = (reason: string, code = 'GUARD_STOP') => {
      if (guardStopReason) return;
      guardStopReason = reason;
      guardStopCode = code;
      engine?.abort(reason);
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

    // Screenshots only for models that can read them (see modelVision).
    const vision = await modelSeesImages(aiConfig.provider, aiConfig.model);
    Logger.info(`[AndroidPlanner] Task ${agentTask.id}: ${aiConfig.provider}/${aiConfig.model} ${vision ? 'can' : 'cannot'} read screenshots`);
    const engineSettings = await this.engineSettings(userId);
    const modelFor = (config: DecryptedAiConfig) =>
      createLanguageModel({
        provider: config.provider,
        model: config.model,
        apiKey: config.api_key,
        baseURL: config.base_url?.trim() || this.aiConfigService.getDefaultBaseUrl(config.provider) || undefined,
      });
    // A text-only model gets a small vision model to read the screens its
    // element list cannot describe, instead of tapping blind.
    const helperConfig =
      !vision && engineSettings.vision_config_id ? await this.aiConfigService.resolveConfigById(userId, engineSettings.vision_config_id).catch(() => null) : null;
    const grounder =
      helperConfig && (await modelSeesImages(helperConfig.provider, helperConfig.model))
        ? createScreenGrounder(modelFor(helperConfig), (usage) => {
            // Its calls cost tokens like any other; they count in the run's totals.
            llmCalls += 1;
            promptTokens += usage.inputTokens;
            completionTokens += usage.outputTokens;
            if (usage.inputTokens || usage.outputTokens) tokensReported = true;
          })
        : undefined;
    if (grounder) Logger.info(`[AndroidPlanner] Task ${agentTask.id}: screens the element list cannot describe are read by ${helperConfig?.model}`);
    // Per step and for the run: did the AI see the screen as an image (screenSight.ts).
    const runSight = emptyRunSight(aiConfig.model, vision, grounder ? helperConfig?.model ?? null : null);
    const sightWhys = new Map<SightWhy, number>();
    // The backup model, for when the main one is rate-limited or out of quota.
    const fallbackConfig =
      engineSettings.fallback_config_id && engineSettings.fallback_config_id !== aiConfig.id
        ? await this.aiConfigService.resolveConfigById(userId, engineSettings.fallback_config_id).catch(() => null)
        : null;
    const ruleRecoveries: RecoveryKind[] = [];
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
        // Where a tap landed in pixels, stored on the step so a saved flow can replay it.
        if (info.tapPx) pendingTapPx = info.tapPx;

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
      onRecovery: (id) => {
        ruleRecoveries.push('obstacle');
        Logger.info(`[AndroidPlanner] Task ${agentTask.id}: cleared ${id} by rule`);
      },
      onHeartbeat: () => {
        noteActivity();
        noteDeviceAction();
      },
    }, { vision, grounder, task: prompt, screenshots: engineSettings.screenshots, deviceFacts: deviceFactsText(device?.network_info) });

    // Kept in a variable so the harness simulation can drive the very same
    // step recording a real model run goes through.
    const handleMessage = async (message: AgentStreamMessage): Promise<void> => {
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
            // Without the screenshot: a clock or an animation must not hide a loop.
            recentStepSignatures.push(
              this.hashText(`${toolName}\n${JSON.stringify(toolParams)}\n${lastForegroundApp || ''}\n${lastUiTree || ''}`),
            );
            if (recentStepSignatures.length > OSCILLATION_WINDOW) recentStepSignatures.shift();
            if (isOscillating(recentStepSignatures, OSCILLATION_WINDOW)) {
              const reason = 'Task stopped because it kept going back and forth between the same two screens without getting anywhere.';
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
              // What the model was looking at when it chose this step. The
              // snapshot above is replaced by the screen after the step.
              ui_tree_before: lastUiTree ?? null,
              package_before: lastForegroundApp ?? null,
              screen_before: screenFingerprint(lastUiTree, lastForegroundApp),
              think_ms: stepSource === 'ai' ? Math.max(0, stepStartTime - lastResultAt) : 0,
              llm_call: stepSource === 'ai' ? llmCalls + 1 : null,
              source: stepSource,
            });
            await this.taskLogRepo.save(currentTaskLog);
            if (stepSource === 'ai') callSteps.push(currentTaskLog);
            if (toolName === 'type_text' && typeof toolParams.text === 'string') typedTexts.set(stepCount, toolParams.text);
            if (repair && stepSource === 'ai') repair.used += 1;

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
            // Read once per result; replayed steps (no model) carry none.
            const stepSight = androidAgent.sight;
            androidAgent.sight = null;
            if (stepSight) addSight(runSight, stepSight, sightWhys);

            consecutiveFailures = isError ? consecutiveFailures + 1 : 0;
            if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
              stopForSafety(`Task stopped after ${MAX_CONSECUTIVE_FAILURES} consecutive device action failures.`, 'DEVICE_ACTION_FAILURES');
            }

            if (currentTaskLog) {
              currentTaskLog.status = isError ? AndroidStepStatus.FAILED : AndroidStepStatus.SUCCESS;
              if (pendingTapPx && !isError) {
                currentTaskLog.action_payload = { ...(currentTaskLog.action_payload ?? {}), px_x: pendingTapPx.x, px_y: pendingTapPx.y };
              }
              pendingTapPx = null;
              currentTaskLog.result_message = stripScreenDump(textContent);
              if (stepSight) {
                currentTaskLog.sight = stepSight.seen;
                currentTaskLog.sight_why = stepSight.why ?? null;
              }
              currentTaskLog.duration_ms = Date.now() - stepStartTime;
              currentTaskLog.ui_tree_snapshot = lastUiTree || currentTaskLog.ui_tree_snapshot;
              currentTaskLog.package_after = lastForegroundApp ?? null;
              currentTaskLog.screen_after = screenFingerprint(lastUiTree, lastForegroundApp);
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
              sight: stepSight,
              runSight,
            });
            lastResultAt = Date.now();

            // The AI is fixing one flow step: hand back to the flow as soon as the
            // step's result is on screen, or the phone is on a later step's screen.
            if (repair && stepSource === 'ai') {
              const rows = parseTable(lastUiTree);
              const pkg = lastForegroundApp && lastForegroundApp !== 'unknown' ? lastForegroundApp : null;
              const broken = repair.plan.steps[repair.index];
              const moved = this.hashText(`${pkg}\n${lastUiTree ?? ''}`) !== repair.startKey;
              const tool = String(message.toolName ?? '');
              // Looking (read_ui_tree, list_apps…) never counts: in the Oct 7 export a
              // screen read after a failed install was taken as the install done.
              const didStep = aiDidStep(broken, tool, Boolean(isError), pkg, rows, moved);
              const acted = !isError && !LOOK_ONLY_TOOLS.has(tool) && moved;
              // A later step's screen only counts after a real action, and never past
              // a broken step whose work cannot be seen (typing, an install).
              const later = acted && !['type', 'install_app'].includes(broken.action) ? resyncIndex(repair.plan.steps, repair.index + 1, pkg, rows) : -1;
              if (didStep) repair.resumeAt = repair.index + 1;
              else if (later > repair.index) repair.resumeAt = later;
              if (repair.resumeAt >= 0) engine?.abort('The saved flow is back on track');
              else if (repair.used >= FLOW_REPAIR_STEPS) engine?.abort('The step fix used up its budget');
            }
          } else if (message.type === 'agent_result') {
            finalMessage = message.result || '';
          } else if (message.type === 'finish') {
            // One model call ended. Its usage belongs to the first step it chose;
            // a call that chose no step (planning, final answer) only counts in the totals.
            llmCalls += 1;
            const usage = (message as { usage?: { promptTokens?: number; completionTokens?: number } }).usage;
            const inTokens = Math.max(0, Number(usage?.promptTokens) || 0);
            const outTokens = Math.max(0, Number(usage?.completionTokens) || 0);
            if (inTokens || outTokens) tokensReported = true;
            promptTokens += inTokens;
            completionTokens += outTokens;
            const first = callSteps[0];
            if (first?.id && (inTokens || outTokens)) {
              first.prompt_tokens = inTokens;
              first.completion_tokens = outTokens;
              await this.taskLogRepo
                .update({ id: first.id }, { prompt_tokens: inTokens, completion_tokens: outTokens })
                .catch((error) => Logger.warn(`[AndroidPlanner] Could not store token usage for step ${first.id}:`, error));
            }
            callSteps = [];
          }
        };

    // Which engine drives the model (see agent/AgentEngine). Both feed the
    // same handler above, so recording, guards and diagnostics are shared.
    engine =
      engineSettings.kind === 'vector'
        ? new VectorEngine({
            model: modelFor(aiConfig),
            fallback: fallbackConfig ? { model: modelFor(fallbackConfig), label: fallbackConfig.model } : undefined,
            agent: androidAgent,
            onMessage: handleMessage,
            vision,
            planner: engineSettings.planner,
            // Unset in production (engine defaults apply); the harness shortens them.
            callIdleMs: Number(process.env.VECTOR_CALL_IDLE_MS) || undefined,
            callMaxMs: Number(process.env.VECTOR_CALL_MAX_MS) || undefined,
          })
        : new EkoEngine(this.buildEkoLlms(aiConfig, fallbackConfig), androidAgent, handleMessage);
    const activeEngine = engine;
    agentTask.engine = engineSettings.kind;
    void this.agentTaskRepo.update({ id: agentTask.id }, { engine: engineSettings.kind }).catch(() => undefined);
    Logger.info(`[AndroidPlanner] Task ${agentTask.id}: engine ${engineSettings.kind}${engineSettings.kind === 'vector' ? ` (planner ${engineSettings.planner ? 'on' : 'off'})` : ''}`);

    const activeTaskEntry = this.activeTasks.get(agentTask.id);
    if (activeTaskEntry) activeTaskEntry.engine = activeEngine;

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
      const simulate = async (roundPrompt: string) => {
        const options = simulationOptions(roundPrompt);
        // What Eko returns when the model's plan comes back with no agent in it.
        if (options.planFail) return { success: false, stopReason: 'error', result: 'Error: Workflow error' };
        if (options.actions) {
          // Scripted run: feed Eko-shaped messages to the real handler so step
          // recording and diagnostics are exercised exactly as in a model run.
          let screen = 0;
          let tick = 0;
          let pkg = 'com.android.launcher3';
          // A round after a saved flow starts where the flow left the phone.
          if (!lastUiTree) {
            lastUiTree = simulatedTree(screen, tick);
            lastForegroundApp = pkg;
          }
          const envelope = { streamType: 'agent', chatId: 'sim', taskId: ekoTaskId, agentName: 'Android' };
          for (const [index, step] of options.actions.entries()) {
            if (this.activeTasks.get(agentTask.id)?.cancelled) {
              wasCancelled = true;
              return { success: false, stopReason: 'abort', result: 'Cancelled' };
            }
            if (guardStopReason) throw new Error(guardStopReason);
            const [kind, arg] = step.split(':');
            const tool =
              kind === 'open'
                ? { toolName: 'open_app', params: { packageName: arg || 'com.example.app' } }
                : kind === 'read'
                  ? { toolName: 'read_ui_tree', params: {} }
                  : kind === 'back'
                    ? { toolName: 'global_action', params: { action: 'BACK' } }
                    : kind === 'wait'
                      ? { toolName: 'wait', params: { durationMillis: 10 } }
                      : kind === 'tap0'
                        ? { toolName: 'tap_coordinate', params: { x: 5, y: 5 } }
                        : kind === 'fail'
                          ? { toolName: 'tap_coordinate', params: { x: 9, y: 9 } }
                          : kind === 'click'
                            ? { toolName: 'click_node', params: { text: arg } }
                            : { toolName: 'tap_coordinate', params: { x: 100, y: 200 + index } };
            await handleMessage({ ...envelope, type: 'tool_use', toolCallId: `sim-${index}`, ...tool } as unknown as AgentStreamMessage);
            // click:<text> really clicks on the phone (a scripted fake app), and the
            // agent reports the screen it lands on, as in a model run.
            if (kind === 'click') {
              const res = await androidAgent.runTool('click_node', { text: arg });
              noteDeviceAction();
              await handleMessage({ ...envelope, type: 'tool_result', toolCallId: `sim-${index}`, ...tool, toolResult: res } as unknown as AgentStreamMessage);
              await handleMessage({ ...envelope, type: 'finish', finishReason: 'tool-calls', usage: { promptTokens: 1000 + index, completionTokens: 40, totalTokens: 1040 + index } } as unknown as AgentStreamMessage);
              continue;
            }
            const outcome = await this.gatewayService.executeAction(hardwareDeviceId, { type: 'CaptureScreen' });
            noteDeviceAction();
            const failed = kind === 'fail' || outcome.status !== 'SUCCESS';
            tick += 1;
            if (!failed && (kind === 'open' || kind === 'tap' || kind === 'back')) screen += 1;
            if (kind === 'open') pkg = arg || 'com.example.app';
            lastUiTree = simulatedTree(screen, tick);
            lastForegroundApp = pkg;
            await handleMessage({
              ...envelope,
              type: 'tool_result',
              toolCallId: `sim-${index}`,
              ...tool,
              toolResult: { content: [{ type: 'text', text: failed ? 'Action failed: simulated' : 'Action succeeded' }], isError: failed },
            } as unknown as AgentStreamMessage);
            await handleMessage({
              ...envelope,
              type: 'finish',
              finishReason: 'tool-calls',
              usage: { promptTokens: 1000 + index, completionTokens: 40, totalTokens: 1040 + index },
            } as unknown as AgentStreamMessage);
            await new Promise((resolve) => setTimeout(resolve, Math.min(options.delay, 50)));
          }
          return { success: true, stopReason: 'done', result: options.report ?? `Simulated run finished after ${options.actions.length} steps.` };
        }
        for (let index = 0; index < options.steps; index += 1) {
          if (this.activeTasks.get(agentTask.id)?.cancelled) {
            wasCancelled = true;
            return { success: false, stopReason: 'abort', result: 'Cancelled' };
          }
          if (guardStopReason) throw new Error(guardStopReason);
          if (reachedDeadline) return { success: true, stopReason: 'done', result: 'Time is up.' };
          const outcome = await this.gatewayService.executeAction(hardwareDeviceId, { type: 'CaptureScreen' });
          stepCount += 1;
          // Same live events a real run sends, so the UI can be exercised.
          this.gatewayService.broadcastToUser(userId, 'task:step', {
            taskId: agentTask.id,
            deviceId: deviceDbId,
            stepIndex: stepCount,
            thought: `Simulated step ${stepCount} of round ${round}`,
            action: { type: 'capture_screen' },
          });
          noteActivity();
          noteDeviceAction();
          if (outcome.status !== 'SUCCESS') {
            throw new Error('message' in outcome ? outcome.message : 'Simulated device action failed');
          }
          await new Promise((resolve) => setTimeout(resolve, options.delay));
        }
        if (options.fail) throw new Error('Simulated failure');
        return { success: true, stopReason: 'done', result: options.report ?? `Simulated run finished after ${options.steps} steps.` };
      };
      const runRound = (roundPrompt: string) =>
        Promise.race([
          AGENT_SIMULATION && !/\[llm\]/i.test(roundPrompt) ? simulate(roundPrompt) : activeEngine.run(roundPrompt, ekoTaskId),
          timeoutPromise,
        ]) as Promise<EngineRunResult>;

      // A timed run is cut off at its deadline even mid-round; reaching the
      // deadline is the goal, so it counts as success rather than an abort.
      const deadlineTimer = runUntil
        ? setTimeout(() => {
            reachedDeadline = true;
            try {
              engine?.abort('Time is up');
            } catch {
              /* already finished */
            }
          }, Math.max(0, runUntil - Date.now()))
        : undefined;

      // A saved flow first, when one fits (docs/REPLAY_ENGINE.md). Never for a
      // timed run or a follow-up: neither has a recorded path to follow.
      flowSettings = await this.flowLibrary.settings(userId);
      flowPlan =
        runUntil || flowOptions.followUp
          ? null
          : flowOptions.flowId
            ? await this.flowLibrary.byId(userId, flowOptions.flowId)
            : flowSettings.replay_first
              ? await this.flowLibrary.match(userId, prompt)
              : null;
      if (flowPlan) {
        agentTask.flow_id = flowPlan.flow.id;
        void this.agentTaskRepo.update({ id: agentTask.id }, { flow_id: flowPlan.flow.id }).catch(() => undefined);
        Logger.info(`[AndroidPlanner] Task ${agentTask.id}: replaying saved flow ${flowPlan.flow.id} (${flowPlan.steps.length} steps)`);
      }

      /** Log one flow step through the same handler as a model's step. */
      let replayCall = 0;
      const replayStep = async (toolName: string, args: Record<string, unknown>, label: string) => {
        stepSource = 'replay';
        currentThought = `Saved flow: ${label}`;
        const envelope = { streamType: 'agent', chatId: 'flow', taskId: ekoTaskId, agentName: 'Android' };
        const toolCallId = `flow-${(replayCall += 1)}`;
        try {
          await handleMessage({ ...envelope, type: 'tool_use', toolCallId, toolName, params: args } as unknown as AgentStreamMessage);
          const toolResult = await androidAgent.runTool(toolName, args);
          await handleMessage({ ...envelope, type: 'tool_result', toolCallId, toolName, params: args, toolResult } as unknown as AgentStreamMessage);
          noteDeviceAction();
          return toolResult;
        } finally {
          stepSource = 'ai';
        }
      };
      const runner = new FlowRunner({
        observe: async () => {
          const seen = await androidAgent.observeForReplay();
          if (!seen) return null;
          noteActivity();
          lastUiTree = seen.tree ?? undefined;
          lastForegroundApp = seen.packageName ?? undefined;
          return seen;
        },
        step: replayStep,
        stopped: () => Boolean(guardStopReason) || wasCancelled || Boolean(this.activeTasks.get(agentTask.id)?.cancelled),
      });

      /** The flow ran to the end: the same rule checks as any run, else the steps' own checks. */
      /**
       * The flow got to the end. Every app it installs must be on the phone's
       * app list; then the usual rule check. "Checked by replay" only when the
       * flow itself did the last step and saw its result.
       */
      const finishFlow = async (plan: FlowPlan, lastByFlow: boolean): Promise<EngineRunResult> => {
        const installs = plan.steps.filter((s) => s.action === 'install_app').map((s) => String(s.args.packageName ?? '')).filter(Boolean);
        if (installs.length) {
          const apps = parseAppList(await androidAgent.launcherAppsText());
          const listed = new Set(apps.map((a) => a.packageName));
          const missing = installs.filter((p) => !listed.has(p));
          if (!apps.length || missing.length) {
            const reason = !apps.length ? 'the phone did not list its apps, so the install could not be checked' : `${missing.join(', ')} is not installed on the phone`;
            return { success: false, stopReason: 'done', result: `The saved flow ran, but ${reason}.`, reasonCode: 'VERIFICATION_FAILED', verification: { status: 'failed', method: 'rule', reason, retries: 0 } };
          }
        }
        const check = await verifyCompletion({
          goal: prompt,
          summary: `Saved flow "${plan.flow.name}" finished`,
          observe: () => androidAgent.observeForCheck(),
          listApps: async () => parseAppList(await androidAgent.launcherAppsText()),
        });
        if (check.status === 'failed') return { success: false, stopReason: 'done', result: `The saved flow ran, but ${check.reason}.`, reasonCode: 'VERIFICATION_FAILED', verification: check };
        const fixed = flowMode === 'repaired' ? ' (one step was fixed on the way)' : '';
        const verification =
          check.status === 'verified'
            ? check
            : installs.length
              ? { status: 'verified' as const, method: 'rule' as const, reason: `${installs.join(', ')} is installed (the phone lists it)`, retries: 0 }
              : lastByFlow
                ? { status: 'verified' as const, method: 'replay' as const, reason: 'Every step reached the screen it was recorded on', retries: 0 }
                : { status: 'unverified' as const, method: 'none' as const, reason: 'The AI did the last step; no check applies to this task', retries: 0 };
        return { success: true, stopReason: 'done', result: `Done with the saved flow "${plan.flow.name}"${fixed}.`, verification };
      };

      /** The AI does only the broken step; returns where the flow continues, or -1. */
      let repairSaidDone = false;
      const repairStep = async (plan: FlowPlan, index: number, reason: string): Promise<number> => {
        repairSaidDone = false;
        const step = plan.steps[index];
        repair = {
          plan,
          index,
          fromStep: stepCount,
          startKey: this.hashText(`${lastForegroundApp && lastForegroundApp !== 'unknown' ? lastForegroundApp : null}\n${lastUiTree ?? ''}`),
          used: 0,
          resumeAt: -1,
        };
        const typing = step.action === 'type' ? ' Type the text this task needs into the field.' : '';
        round += 1;
        ekoTaskId = `${baseEkoTaskId}-fix${index + 1}`;
        ekoTaskIds.push(ekoTaskId);
        finalMessage = '';
        try {
          const fixRound = await runRound(
            `You are partway through this task: "${prompt}".\n` +
              `A saved flow is doing it step by step, and this step did not work: "${step.label}" (${reason}).${typing}\n` +
              'Do only what this step needs (deal with anything in the way first), then stop. The saved flow carries on by itself as soon as the phone is back on track — do not do the rest of the task.',
          );
          repairSaidDone = fixRound.success && fixRound.stopReason === 'done';
        } catch (error) {
          if (guardStopReason || this.activeTasks.get(agentTask.id)?.cancelled) throw error;
          Logger.warn(`[AndroidPlanner] Task ${agentTask.id}: the step fix ended with an error: ${String((error as Error)?.message ?? error).slice(0, 200)}`);
        }
        const out = repair as { resumeAt: number; fromStep: number } | null;
        repair = null;
        finalMessage = '';
        if (!out) return -1;
        // The broken step was the last one and the AI says it is done: the end check decides.
        if (out.resumeAt < 0 && repairSaidDone && index === plan.steps.length - 1) out.resumeAt = plan.steps.length;
        if (out.resumeAt < 0) return -1;
        pendingFix = { index, resume: out.resumeAt, fromStep: out.fromStep, toStep: stepCount };
        return out.resumeAt;
      };

      const runWithFlow = async (plan: FlowPlan): Promise<EngineRunResult> => {
        let from = 0;
        let lastBreak = '';
        const tried = new Set<number>();
        for (;;) {
          const out = await runner.run(plan.steps, plan.params, plan.values, from);
          if (out.status === 'stopped') return { success: false, stopReason: 'abort', result: guardStopReason ?? 'Cancelled' };
          if (out.status === 'done') return finishFlow(plan, true);
          const step = plan.steps[out.index];
          lastBreak = `"${step.label}" (${out.reason})`;
          Logger.info(`[AndroidPlanner] Task ${agentTask.id}: flow step ${out.index + 1} broke: ${out.reason}`);
          // One fix per step: the same step breaking again goes to the AI for the rest.
          if (tried.has(out.index)) break;
          tried.add(out.index);

          // 1. A fix that worked before on this phone (or, shared, on this model).
          let resumed = -1;
          const patches = await this.flowLibrary.patchesFor(plan.flow, out.index, deviceDbId ?? null, device?.device_model ?? null, flowSettings.share_fixes);
          for (const patch of patches) {
            const fixSteps = JSON.parse(patch.steps_json) as FlowStepV2[];
            const fixed = await runner.run(fixSteps, plan.params, plan.values, 0);
            if (fixed.status === 'stopped') return { success: false, stopReason: 'abort', result: guardStopReason ?? 'Cancelled' };
            const seen = await androidAgent.observeForReplay();
            const at = seen ? resyncIndex(plan.steps, out.index + 1, seen.packageName, parseTable(seen.tree)) : -1;
            const next = fixed.status === 'done' ? (at > out.index ? at : patch.resume_index) : -1;
            if (next >= 0) {
              usedPatches.push(patch.id);
              resumed = next;
              break;
            }
            void this.flowLibrary.patchOutcome(patch.id, false, device?.device_model ?? null, flowSettings.share_fixes);
          }

          // 2. The AI, for this step only.
          if (resumed < 0 && flowSettings.ai_repair) resumed = await repairStep(plan, out.index, out.reason);
          if (guardStopReason || this.activeTasks.get(agentTask.id)?.cancelled) return { success: false, stopReason: 'abort', result: guardStopReason ?? 'Cancelled' };
          if (resumed < 0) break;
          flowMode = 'repaired';
          // The AI (or a saved fix) did the last step: never "checked by replay".
          if (resumed >= plan.steps.length) return finishFlow(plan, false);
          from = resumed;
        }

        // 3. The AI finishes the task from where the phone is.
        flowMode = 'fallback';
        pendingFix = null;
        round += 1;
        ekoTaskId = `${baseEkoTaskId}-ai`;
        ekoTaskIds.push(ekoTaskId);
        finalMessage = '';
        return runRound(
          `${prompt}\n\nA saved flow did the first part of this task and stopped at ${lastBreak}. Look at the current screen and finish the task from here; start over only if the screen requires it.`,
        );
      };

      // Raced with the watchdog like a model round, so a stalled phone still ends the run.
      let result = flowPlan ? ((await Promise.race([runWithFlow(flowPlan), timeoutPromise])) as EngineRunResult) : await runRound(prompt);
      // Timed runs: the agent said it was done before the time was up — start
      // another round on the same task (same lane slot, same step budget).
      while (
        runUntil &&
        !reachedDeadline &&
        Date.now() < runUntil &&
        !wasCancelled &&
        !guardStopReason &&
        !this.activeTasks.get(agentTask.id)?.cancelled &&
        stepCount < maxSteps
      ) {
        round += 1;
        ekoTaskId = `${baseEkoTaskId}-r${round}`;
        ekoTaskIds.push(ekoTaskId);
        const entry = this.activeTasks.get(agentTask.id);
        finalMessage = '';
        const minutesLeft = Math.max(1, Math.round((runUntil - Date.now()) / 60_000));
        this.gatewayService.broadcastToUser(userId, 'task:round', {
          taskId: agentTask.id,
          deviceId: deviceDbId,
          round,
          endsAt: runUntil,
        });
        result = await runRound(
          `${prompt}\n\nKeep going — this is round ${round}, about ${minutesLeft} min left. Carry on with the same task and do something new rather than repeating what you already did. Do not stop early; the time limit ends the task.`,
        );
      }
      if (deadlineTimer) clearTimeout(deadlineTimer);

      // A cancel can land while the engine is waiting on the model, so no
      // message ever flagged it; the registry is the source of truth.
      if (this.activeTasks.get(agentTask.id)?.cancelled) wasCancelled = true;
      const timedOk = Boolean(runUntil) && reachedDeadline && !wasCancelled && !guardStopReason;
      const terminalAgentResult = timedOk
        ? `Worked for ${Math.round(((runUntil as number) - startTime) / 60_000) || '<1'} min over ${round} round${round === 1 ? '' : 's'}.`
        : (finalMessage || result.result || '').trim();
      const agentFinished = timedOk || terminalAgentResult.toLowerCase() !== 'unfinished';
      const isSuccess =
        timedOk ||
        (!wasCancelled && !guardStopReason && agentFinished && result.success && result.stopReason === 'done');

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
            : result.reasonCode
              ? // The engine knows exactly why (e.g. VERIFICATION_FAILED).
                { status: 'FAILED', reason: result.reasonCode }
            : /workflow error/i.test(String(terminalAgentResult ?? ''))
              ? // Eko's planning call returned a plan with no agent in it — a
                // model hiccup before any step ran, not the task being impossible.
                { status: 'FAILED', reason: 'PLAN_FAILED' }
              : !agentFinished
                ? { status: 'FAILED', reason: 'UNFINISHED' }
                : { status: 'FAILED', reason: 'AGENT_REPORTED_FAILURE' };
      agentTask.status = terminal.status;
      agentTask.reason_code = terminal.reason;
      if (flowPlan) agentTask.flow_mode = flowMode;
      runSucceeded = isSuccess;
      agentTask.verification = result.verification ?? null;
      agentTask.finished_at = new Date();
      agentTask.lease_until = null;
      // Keep just the final frame (one per task) so the card can show each
      // phone's last screen after the task ends, even after a reload.
      if (lastScreenshot) agentTask.final_screenshot = lastScreenshot;
      agentTask.sight = runSight;
      if (!this.shuttingDown) await this.agentTaskRepo.save(agentTask);

      if (!wasCancelled) {
        this.gatewayService.broadcastToUser(userId, 'task:completed', {
          taskId: agentTask.id,
          deviceId: deviceDbId,
          success: agentTask.success,
          message: agentTask.message,
          totalSteps: stepCount,
          reasonCode: agentTask.reason_code,
          sight: runSight,
          sightLine: runSightLine(runSight),
        });
      }
    } catch (err: any) {
      if (this.activeTasks.get(agentTask.id)?.cancelled) {
        Logger.info(`[AndroidPlanner] Task ${agentTask.id} was cancelled during execution.`);
      } else {
        Logger.error(`[AndroidPlanner] Error during Eko task loop:`, err);
        agentTask.success = false;
        agentTask.reason_code = guardStopReason ? (guardStopCode ?? 'GUARD_STOP') : classifyFailure(err?.message);
        // An AI provider failure reads as what to do, not as the provider's raw
        // text (status codes, troubleshooting URLs); the raw text is logged above.
        const aiFailure = !guardStopReason && (agentTask.reason_code.startsWith('LLM_') || /troubleshooting url|openrouter|langchain/i.test(String(err?.message ?? '')));
        agentTask.message = guardStopReason || (aiFailure ? modelErrorText(err) : err.message) || 'Task failed with internal error';
        agentTask.total_steps = stepCount;
        agentTask.total_duration_seconds = (Date.now() - startTime) / 1000;
        agentTask.status = 'FAILED';
        agentTask.finished_at = new Date();
        agentTask.lease_until = null;
        agentTask.sight = runSight;
        await this.agentTaskRepo.save(agentTask);
        this.gatewayService.broadcastToUser(userId, 'task:error', {
          taskId: agentTask.id,
          deviceId: deviceDbId,
          error: agentTask.message,
          reasonCode: agentTask.reason_code,
          sight: runSight,
          sightLine: runSightLine(runSight),
        });
      }
    } finally {
      clearInterval(keepAwakeTimer);
      clearInterval(leaseTimer);
      watchdogArmed = false;
      if (stallTimer) clearTimeout(stallTimer);
      if (noActionTimer) clearTimeout(noActionTimer);
      try {
        activeEngine.dispose();
      } catch (error) {
        Logger.warn(`[AndroidPlanner] Failed to release the engine for task ${agentTask.id}:`, error);
      }
      this.gatewayService.setAutomationSession(hardwareDeviceId, false);
      // Explain where the run's steps went. Not awaited and never throws: the
      // result the user is waiting for must not wait on bookkeeping.
      void this.runDiagnosticsService.finalize(agentTask.id, {
        llmCalls,
        promptTokens,
        completionTokens,
        tokensReported,
        recoveries: [...ruleRecoveries, ...(activeEngine.usedBackupModel ? (['backup_model'] as const) : [])],
      });
      // Saved flows: book how the flow did, keep a step fix, or save this run as a
      // flow — before the phone is free, so its next run sees the result. Never throws.
      if (!this.shuttingDown) {
        await this.afterFlowRun({
          task: agentTask,
          settings: flowSettings,
          plan: flowPlan,
          mode: flowMode,
          ok: runSucceeded,
          deviceDbId: deviceDbId ?? null,
          deviceModel: device?.device_model ?? null,
          usedPatches,
          pendingFix,
          typed: typedTexts,
          timed: Boolean(runUntil),
          followUp: Boolean(flowOptions.followUp),
        });
      }

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
  /**
   * After a run (never throws): with a flow, its stats, the fixes it used and
   * a new fix the AI made; without one, the run saved as a flow when the
   * account records runs (docs/REPLAY_ENGINE.md).
   */
  private async afterFlowRun(input: {
    task: AgentTask;
    settings: { record: boolean; share_fixes: boolean };
    plan: FlowPlan | null;
    mode: FlowMode;
    ok: boolean;
    deviceDbId: number | null;
    deviceModel: string | null;
    usedPatches: number[];
    pendingFix: { index: number; resume: number; fromStep: number; toStep: number } | null;
    typed: Map<number, string>;
    timed: boolean;
    followUp: boolean;
  }): Promise<void> {
    const { task, plan, settings } = input;
    try {
      // Only text that is part of the task's wording can become a flow parameter;
      // nothing else typed (a password, a code) is kept, not even in memory.
      const wording = (task.prompt ?? '').toLowerCase();
      this.flowLibrary.rememberTyped(task.id, new Map([...input.typed].filter(([, text]) => text.trim().length >= 2 && wording.includes(text.trim().toLowerCase()))));
      if (plan) {
        await this.flowLibrary.recordOutcome(plan.flow.id, input.mode, input.ok, input.deviceModel);
        for (const id of input.usedPatches) await this.flowLibrary.patchOutcome(id, input.ok, input.deviceModel, settings.share_fixes);
        const fix = input.pendingFix;
        if (fix && input.ok && input.mode === 'repaired' && task.prompt) {
          const steps = recordFlow(task.prompt, await this.flowLibrary.recordedSteps(task.id, fix.fromStep, fix.toStep)).steps;
          const patch = await this.flowLibrary.savePatch(plan.flow, fix.index, fix.resume, steps, input.deviceDbId, input.deviceModel);
          if (patch) await this.flowLibrary.patchOutcome(patch.id, true, input.deviceModel, settings.share_fixes);
        }
        return;
      }
      if (input.ok && settings.record && !input.timed && !input.followUp && task.verification?.status !== 'failed') {
        await this.flowLibrary.recordFromTask(task, { auto: true, deviceModel: input.deviceModel });
      }
    } catch (error) {
      Logger.warn(`[AndroidPlanner] Saved-flow bookkeeping failed for task ${task.id}:`, error);
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
      if (failure && /screen capture|permission prompt/i.test(failure.message ?? '')) {
        throw new AppError(
          "Screen capture permission is not approved on the phone. Open the Vector app on the phone and approve Android's screen-capture prompt, then try again.",
          400,
        );
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
