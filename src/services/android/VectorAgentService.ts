import { AgentTask } from '@/entities/AgentTask';
import { AndroidDevice } from '@/entities/AndroidDevice';
import { DeviceProxy } from '@/entities/DeviceProxy';
import { Mission } from '@/entities/Mission';
import AppError from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import Logger from '@/logger/index';
import { AiConfigService } from '@/services/controllerService/AiConfigService';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { In } from 'typeorm';
import { Service } from 'typedi';
import { AndroidGatewayService } from './AndroidGatewayService';
import { FleetStateService } from './FleetStateService';
import { MissionService, matchNamedDevices } from './MissionService';
import { ProxyRotationService } from './ProxyRotationService';

/**
 * Vector's brain for the Mission Control chat.
 *
 * The model understands the message — in whatever words the user uses — and
 * acts through a small set of tools. What must never depend on the model is
 * enforced here, in code:
 *   - there is no delete tool, so nothing can be deleted from chat;
 *   - settings are only *proposed*; the user's Confirm button applies them;
 *   - a task on many phones or a long one is proposed with an estimate, not run;
 *   - the reply can only say something happened if a tool actually did it.
 */

/** Above this many phones, or this many minutes, a task needs Confirm. */
const CONFIRM_PHONES = 5;
const CONFIRM_MINUTES = 10;
/** Rough cost per agent step with the current token budget (DeepSeek V4 Flash). */
const COST_PER_STEP_USD = 0.0005;
const STEPS_PER_SIMPLE_TASK = 30;
const STEPS_PER_MINUTE = 5;
const MAX_MODEL_TURNS = 6;

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}
export interface BrainTurn {
  text: string;
  calls: ToolCall[];
}
/** One model turn given the conversation so far. Real model or a scripted one. */
export type Brain = (messages: BaseMessage[]) => Promise<BrainTurn>;

/** A change waiting for the user's Confirm. */
export type ProposedAction =
  | { type: 'set_rotation'; proxy_ids: number[]; every: number }
  | { type: 'set_concurrency'; proxy_id: number; concurrency: number }
  | { type: 'run_mission'; instruction: string; device_ids: number[]; duration_seconds?: number };

/** What a proposal will do, laid out for the chat's plan card. */
export interface ProposalPlan {
  kind: 'mission' | 'rotation' | 'concurrency';
  instruction?: string;
  phones?: string[];
  steps?: number;
  cost_usd?: number;
  duration_minutes?: number;
  lanes?: string[];
  setting?: string;
}

/**
 * The narrow policy check (policy v2): judges ONE task instruction against the
 * three blocked categories. The planner never decides acceptability in v2.
 */
export type PolicyJudge = (instruction: string) => Promise<{ block: boolean; line?: string }>;

export interface AgentContext {
  userId: number;
  history: { role: 'user' | 'assistant'; text: string }[];
  lastMissionDevices: number[];
  pending: { summary: string; token?: string }[];
  dryRun?: boolean;
  /** 'v2': model plans, backend (judge) blocks; 'v1': model decides (default). */
  policy?: 'v1' | 'v2';
  judge?: PolicyJudge;
}

/**
 * Policy v2 is on by default: the planner never refuses, and a narrow backend
 * judge removes only the three disallowed kinds of task (fake identities to
 * real third parties, fake reviews/activity, breaking into accounts the user
 * doesn't own). Set VECTOR_POLICY_V2=0 to fall back to the older v1 path.
 */
export const POLICY_V2_DEFAULT = process.env.VECTOR_POLICY_V2 !== '0';

export interface AgentResult {
  text: string;
  mission?: unknown;
  proposal?: { action: ProposedAction; summary: string; plan?: ProposalPlan };
  ask?: { question: string; options: string[] };
  cancelledPending?: boolean;
  /** Set when the user's plain "yes" confirmed a pending proposal. */
  confirmToken?: string;
  /** Policy v2: further missions when one request ran on different phone sets. */
  extraMissions?: unknown[];
  /** Policy v2: steps the policy check removed, each with its one-line reason. */
  skipped?: { instruction: string; line: string }[];
  /** Policy v2: tasks accepted this turn, run together once the model is done. */
  planned?: { instruction: string; deviceIds: number[]; minutes: number }[];
  /** One point-in-time screenshot per phone the user asked to see. */
  screens?: PhoneShot[];
  calls: { name: string; args: Record<string, unknown>; result: string }[];
}

/** A single phone's current screen for the chat: the image, or why there is none. */
export interface PhoneShot {
  device_name: string;
  hw_id: string | null;
  base64?: string;
  error?: string;
}

/** Most phones we screenshot in one "show me the screens" — bounds cost and time. */
const MAX_SCREENS = 12;

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'fleet_status',
      description: 'Read-only. Phones (name, state, lane), lanes (rotation, concurrency), and running missions. Use it before answering questions about the fleet.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_mission',
      description:
        'Run one instruction on phones. Each phone gets the same instruction. phones: "last" (the phones of the last task), "all" (every ready phone), "tag:<Tag>", or a comma-separated list of exact phone names. Large or long tasks are turned into a proposal the user must Confirm.',
      parameters: {
        type: 'object',
        properties: {
          instruction: { type: 'string', description: 'What ONE phone should do, in plain words. Do not mention phone names, proxies or rotation here.' },
          phones: { type: 'string' },
          duration_minutes: { type: 'number', description: 'Only when the user asked to keep doing it for a time ("for 1 hour").' },
        },
        required: ['instruction', 'phones'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'stop_mission',
      description: 'Stop a running mission. Without mission_id, stops every running mission.',
      parameters: { type: 'object', properties: { mission_id: { type: 'number' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rerun_mission',
      description: 'Run a finished mission again: scope "failed" or "all"; continue=true picks runs back up where they stopped.',
      parameters: {
        type: 'object',
        properties: { mission_id: { type: 'number' }, scope: { type: 'string', enum: ['failed', 'all'] }, continue: { type: 'boolean' } },
        required: ['mission_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_rotation',
      description:
        'Propose proxy IP rotation for lanes; the user must press Confirm. rotate_every_tasks: 0 = OFF (never rotate), N = rotate after every N tasks. Only propose ON when the user clearly asked to turn rotation on.',
      parameters: {
        type: 'object',
        properties: { lanes: { type: 'string', description: '"all" or comma-separated lane names' }, rotate_every_tasks: { type: 'integer', minimum: 0 } },
        required: ['lanes', 'rotate_every_tasks'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_concurrency',
      description: 'Propose how many phones a lane runs at once; the user must press Confirm.',
      parameters: { type: 'object', properties: { lane: { type: 'string' }, concurrency: { type: 'integer', minimum: 1 } }, required: ['lane', 'concurrency'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancel_pending_confirmation',
      description: 'Drop any change or task still waiting for Confirm — when the user says no, cancel, stop, leave it.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mission_results',
      description:
        'Read what each phone reported when a mission finished (e.g. which Gmail account is logged in). Without mission_id, the most recent mission. Use this whenever the user asks about results of a task.',
      parameters: { type: 'object', properties: { mission_id: { type: 'number' } } },
    },
  },
  {
    type: 'function',
    function: {
      name: 'phone_history',
      description: 'Recent tasks run on one phone — what was asked and what the phone reported. Use it for "what did we do on X", "which email is on X", settings changed on X.',
      parameters: { type: 'object', properties: { phone: { type: 'string' }, limit: { type: 'number' } }, required: ['phone'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'show_screens',
      description:
        "Show the user a live picture of what is on the phones' screens right now, in the chat. Call this whenever the user wants to SEE or LOOK AT a screen — \"show me the screens\", \"screen dikhao\", \"what's on X right now\", \"let me see phone 2\". phones: \"all\" (every online phone), \"last\" (the last task's phones), \"tag:<Tag>\", or comma-separated exact phone names. The images are rendered for the user; you never need to describe what is on them.",
      parameters: { type: 'object', properties: { phones: { type: 'string' } }, required: ['phones'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'confirm_pending',
      description: 'Apply what is waiting for Confirm — ONLY when the user plainly says yes (yes, haan, confirm, ok, kar do) with nothing else added.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description: 'Ask one short question when you genuinely cannot tell what the user wants. Offer 2-5 short options the user can tap.',
      parameters: {
        type: 'object',
        properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } },
        required: ['question'],
      },
    },
  },
] as const;

const READY_STATES = new Set(['idle', 'completed', 'failed', 'cancelled', 'interrupted']);

/** Phrases a declining reply opens with (English and Hinglish). */
const REFUSAL = /\b(nahi kar sakta|nahin kar sakta|nahi kar sakti|nahi karunga|i can'?t|i cannot|i won'?t|can not help|unable to help|not able to (?:help|do))\b/i;

/** True when nothing was done this turn — a pure text reply. */
function onlyToolless(text: string, result: AgentResult): boolean {
  return !result.calls.length && !result.proposal && !result.mission && REFUSAL.test(text);
}

/**
 * A refusal stays one line, whatever the model wrote: the first sentence
 * that declines, plus a short alternative if it is on the same line.
 */
export function oneLineRefusal(text: string): string {
  const cleaned = text.replace(/[\u274c\u2716\u26d4\ud83d\udeab]/gu, '').replace(/\*\*/g, '').trim();
  const firstLine = cleaned.split(/\n+/).map((l) => l.trim()).find(Boolean) ?? cleaned;
  const line = firstLine.length > 180 ? `${firstLine.slice(0, 177).replace(/\s+\S*$/, '')}…` : firstLine;
  return line;
}
/** A message that is nothing but a yes — the only thing that confirms by typing. */
const PLAIN_YES = /^(yes|yeah|yep|y|ok|okay|confirm|confirmed|go|go ahead|do it|haan|han|ha|haa|hanji|haan ji|ji|kar do|kardo|karo|chalo|chala do|theek hai|thik hai|sure)[\s.!]*$/i;

/** A short, human reason a phone couldn't hand back its screen. */
function screenFailReason(code?: string, message?: string): string {
  if (code === 'CAPTURE_NOT_CONFIGURED') return 'Screen sharing off on the phone';
  if (code === 'ACCESSIBILITY_DISABLED') return 'Offline';
  if (code === 'TIMEOUT') return 'No answer';
  return (message ?? 'No screen').slice(0, 80);
}

@Service()
export class VectorAgentService {
  private proxyRepo = AppDataSource.getRepository(DeviceProxy);
  private missionRepo = AppDataSource.getRepository(Mission);
  private taskRepo = AppDataSource.getRepository(AgentTask);
  private deviceRepo = AppDataSource.getRepository(AndroidDevice);

  constructor(
    private aiConfigService: AiConfigService,
    private fleetStateService: FleetStateService,
    private missionService: MissionService,
    private proxyService: ProxyRotationService,
    private gatewayService: AndroidGatewayService,
  ) {}

  /** The real model with the tools bound, or null when no chat model is configured. */
  async realBrain(userId: number): Promise<Brain | null> {
    const config = await this.aiConfigService.resolveChatConfig(userId);
    if (!config) return null;
    const model = this.aiConfigService
      .createChatModel({ provider: config.provider, model: config.model, api_key: config.api_key, base_url: config.base_url, temperature: 0.2 })
      .bindTools(TOOLS as unknown as Parameters<ReturnType<AiConfigService['createChatModel']>['bindTools']>[0]);
    return async (messages) => {
      const response = await model.invoke(messages);
      const text = typeof response.content === 'string' ? response.content : '';
      const calls = (response.tool_calls ?? []).map((c, i) => ({ id: c.id ?? `call_${i}`, name: c.name, args: (c.args ?? {}) as Record<string, unknown> }));
      return { text: text.trim(), calls };
    };
  }

  /** A scripted brain for the harness: plays back the given turns in order. */
  static scriptedBrain(script: { turns: { text?: string; calls?: { name: string; args?: Record<string, unknown> }[] }[] }): Brain {
    let index = 0;
    return async () => {
      const turn = script.turns[index++] ?? { text: '' };
      return {
        text: turn.text ?? '',
        calls: (turn.calls ?? []).map((c, i) => ({ id: `s${index}_${i}`, name: c.name, args: c.args ?? {} })),
      };
    };
  }

  async run(brain: Brain, message: string, ctx: AgentContext): Promise<AgentResult> {
    const result: AgentResult = { text: '', calls: [] };
    const messages: BaseMessage[] = [new SystemMessage(await this.systemPrompt(ctx))];
    for (const turn of ctx.history.slice(-12)) {
      messages.push(turn.role === 'user' ? new HumanMessage(turn.text) : new AIMessage(turn.text));
    }
    messages.push(new HumanMessage(message));

    let corrected = false;
    for (let i = 0; i < MAX_MODEL_TURNS; i += 1) {
      let turn: BrainTurn;
      try {
        turn = await brain(messages);
      } catch (error) {
        Logger.warn('[VectorAgent] model call failed:', error);
        throw new AppError(`The AI model did not answer (${(error as Error)?.message ?? 'error'}). Try again in a moment.`, 502);
      }
      if (!turn.calls.length) {
        // Guard: the model must not tell the user to press Confirm unless a
        // tool actually created something to confirm. One correction, then
        // take its answer.
        if (!corrected && !result.proposal && /\bconfirm\b/i.test(turn.text)) {
          corrected = true;
          messages.push(new AIMessage(turn.text));
          messages.push(
            new HumanMessage(
              `(system note, not from the user) Your reply mentions Confirm, but no tool created a proposal in this turn${ctx.pending.length ? ` (still waiting from before: ${ctx.pending.map((p) => p.summary).join(' | ')})` : ''}. If the user wants a new task or change, call the tool now; if you mean the earlier item, say which one; otherwise answer without mentioning Confirm.`,
            ),
          );
          continue;
        }
        result.text = onlyToolless(turn.text, result) ? oneLineRefusal(turn.text) : turn.text;
        break;
      }
      messages.push(new AIMessage({ content: turn.text, tool_calls: turn.calls.map((c) => ({ id: c.id, name: c.name, args: c.args, type: 'tool_call' as const })) }));
      for (const call of turn.calls) {
        const output = await this.execute(call, ctx, result, message);
        result.calls.push({ name: call.name, args: call.args, result: output });
        messages.push(new ToolMessage({ content: output, tool_call_id: call.id }));
      }
      // A question to the user ends the turn — wait for their answer.
      if (result.ask) {
        result.text = result.ask.question;
        break;
      }
    }
    if (ctx.policy === 'v2') await this.runPlanned(ctx, result);
    if (result.skipped?.length) {
      // One short line per removed step.
      const lines = result.skipped.map((s) => `Skipped "${s.instruction.slice(0, 60)}${s.instruction.length > 60 ? '…' : ''}" — ${oneLineRefusal(s.line)}`);
      result.text = [result.text && !REFUSAL.test(result.text) ? result.text : '', ...lines].filter(Boolean).join('\n');
    }
    if (!result.text) {
      result.text = result.proposal
        ? 'This needs your confirmation.'
        : result.mission
          ? 'Started — watch it below.'
          : result.cancelledPending
            ? 'Okay, nothing was changed.'
            : 'Done.';
    }
    return result;
  }

  /**
   * Policy v2: start what the policy check accepted. Tasks for the same phones
   * become one mission with numbered steps, so they run in order on each phone.
   */
  private async runPlanned(ctx: AgentContext, result: AgentResult): Promise<void> {
    const groups = new Map<string, { deviceIds: number[]; minutes: number; instructions: string[] }>();
    for (const step of result.planned ?? []) {
      const key = `${[...step.deviceIds].sort((a, b) => a - b).join(',')}|${step.minutes}`;
      const group = groups.get(key) ?? { deviceIds: step.deviceIds, minutes: step.minutes, instructions: [] };
      group.instructions.push(step.instruction);
      groups.set(key, group);
    }
    const missions: unknown[] = [];
    for (const group of groups.values()) {
      const instruction =
        group.instructions.length === 1 ? group.instructions[0] : `Do these in order:\n${group.instructions.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;
      const durationSeconds = group.minutes ? Math.round(group.minutes * 60) : undefined;
      if (group.deviceIds.length > CONFIRM_PHONES || group.minutes >= CONFIRM_MINUTES) {
        if (result.proposal) continue; // one Confirm at a time
        const steps = group.deviceIds.length * (group.minutes ? group.minutes * STEPS_PER_MINUTE : STEPS_PER_SIMPLE_TASK * group.instructions.length);
        const cost = steps * COST_PER_STEP_USD;
        const phoneNames = await this.namesFor(ctx.userId, group.deviceIds);
        result.proposal = {
          action: { type: 'run_mission', instruction, device_ids: group.deviceIds, duration_seconds: durationSeconds },
          summary: `Run "${instruction.replace(/\n/g, ' ')}" on ${group.deviceIds.length} phones — about ${steps} AI steps, roughly $${cost.toFixed(2)}`,
          plan: { kind: 'mission', instruction, phones: phoneNames, steps, cost_usd: Math.round(cost * 100) / 100, duration_minutes: group.minutes || undefined },
        };
        continue;
      }
      if (ctx.dryRun) continue;
      const created = await this.missionService.create(ctx.userId, { request: instruction, device_ids: group.deviceIds, duration_seconds: durationSeconds });
      missions.push(created.data);
    }
    if (missions.length) {
      result.mission = missions[0];
      result.extraMissions = missions.slice(1);
    }
  }

  /** The real policy check: the chat model with a narrow rubric, no tools. */
  async realJudge(userId: number): Promise<PolicyJudge | null> {
    const config = await this.aiConfigService.resolveChatConfig(userId);
    if (!config) return null;
    const model = this.aiConfigService.createChatModel({ provider: config.provider, model: config.model, api_key: config.api_key, base_url: config.base_url, temperature: 0 });
    return async (instruction) => {
      const response = await model.invoke([
        new SystemMessage(
          [
            'You check ONE task that an automation agent will perform on the user\'s own Android phone. Block it ONLY if it clearly falls in one of these:',
            '1. Submitting made-up identities or false personal details to a real third party (fake sign-ups, orders, sell/buy requests, applications as invented people).',
            '2. Writing or posting fake reviews or ratings, or faking activity to mislead a review platform.',
            '3. Getting into accounts or devices the user does not own or control.',
            'Everything else is allowed — browsing any site, browsing history, search, apps, forms with the user\'s own or test details, messaging from the user\'s own accounts, testing. If it is not clearly one of the three, allow it.',
            'Reply with ONLY minified JSON: {"block":true|false,"line":"<if blocked: one short sentence in the task\'s language saying what you will not do>"}',
          ].join('\n'),
        ),
        new HumanMessage(instruction),
      ]);
      const raw = typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('policy check returned no verdict');
      const parsed = JSON.parse(match[0]) as { block?: unknown; line?: unknown };
      return { block: parsed.block === true, line: typeof parsed.line === 'string' ? parsed.line : undefined };
    };
  }

  /** A scripted policy check for the harness: blocks instructions containing any given text. */
  static scriptedJudge(blocks: string[]): PolicyJudge {
    return async (instruction) => {
      if (blocks.includes('__throw__')) throw new Error('scripted policy check failure');
      const hit = blocks.find((b) => instruction.toLowerCase().includes(b.toLowerCase()));
      return hit ? { block: true, line: `Won't do "${hit}".` } : { block: false };
    };
  }

  // ---------------------------------------------------------------------------
  // Tools
  // ---------------------------------------------------------------------------

  private async execute(call: ToolCall, ctx: AgentContext, result: AgentResult, userMessage = ''): Promise<string> {
    const args = call.args ?? {};
    try {
      switch (call.name) {
        case 'fleet_status':
          return JSON.stringify(await this.fleetSnapshot(ctx.userId));

        case 'run_mission': {
          const instruction = String(args.instruction ?? '').trim();
          if (!instruction) return JSON.stringify({ error: 'instruction is empty' });
          const deviceIds = await this.resolvePhones(ctx, String(args.phones ?? ''));
          if (!deviceIds.length) {
            return JSON.stringify({ error: 'No ready phones matched. Ask the user which phones, with ask_user.' });
          }
          const minutes = Number(args.duration_minutes) > 0 ? Number(args.duration_minutes) : 0;
          if (ctx.policy === 'v2') {
            // The backend, not the planner, applies the blocked categories —
            // per task, so a mixed request loses only the blocked part. When a
            // judge exists (a model is configured) its verdict is authoritative
            // and a failed check holds the task back. With no judge at all there
            // is nothing to check against, so the task runs rather than being
            // wrongly refused — the guardrail is off, not inverted into a block.
            if (ctx.judge) {
              const verdict = await ctx.judge(instruction).catch(() => null);
              if (!verdict || verdict.block) {
                const line = verdict?.line?.trim() || "Couldn't run the safety check for this step — try again.";
                (result.skipped ??= []).push({ instruction, line });
                return JSON.stringify({ status: 'skipped_by_policy', note: 'Removed by the policy check; do not repeat or explain it.' });
              }
            }
            (result.planned ??= []).push({ instruction, deviceIds, minutes });
            return JSON.stringify({ status: 'accepted', phones: deviceIds.length, note: 'Runs when you finish replying.' });
          }
          const durationSeconds = minutes ? Math.round(minutes * 60) : undefined;
          if (deviceIds.length > CONFIRM_PHONES || minutes >= CONFIRM_MINUTES) {
            const steps = deviceIds.length * (minutes ? minutes * STEPS_PER_MINUTE : STEPS_PER_SIMPLE_TASK);
            const cost = steps * COST_PER_STEP_USD;
            const summary = `Run "${instruction}" on ${deviceIds.length} phone${deviceIds.length === 1 ? '' : 's'}${minutes ? ` for ${minutes} min` : ''} — about ${steps} AI steps, roughly $${cost.toFixed(cost < 1 ? 2 : 1)}`;
            const phoneNames = await this.namesFor(ctx.userId, deviceIds);
            result.proposal = {
              action: { type: 'run_mission', instruction, device_ids: deviceIds, duration_seconds: durationSeconds },
              summary,
              plan: { kind: 'mission', instruction, phones: phoneNames, steps, cost_usd: Math.round(cost * 100) / 100, duration_minutes: minutes || undefined },
            };
            return JSON.stringify({ status: 'needs_confirmation', summary });
          }
          if (ctx.dryRun) return JSON.stringify({ status: 'started (dry run)', phones: deviceIds.length });
          const created = await this.missionService.create(ctx.userId, { request: instruction, device_ids: deviceIds, duration_seconds: durationSeconds });
          result.mission = created.data;
          const mission = created.data as { id: number; items: { device_name: string }[] };
          return JSON.stringify({ status: 'started', mission_id: mission.id, phones: mission.items.map((i) => i.device_name) });
        }

        case 'stop_mission': {
          const running = await this.missionRepo.find({
            where: args.mission_id ? { id: Number(args.mission_id), user_id: ctx.userId } : { user_id: ctx.userId, status: 'RUNNING' },
          });
          const targets = running.filter((m) => m.status === 'RUNNING');
          if (!targets.length) return JSON.stringify({ status: 'nothing running' });
          if (ctx.dryRun) return JSON.stringify({ status: 'stopped (dry run)', missions: targets.map((m) => m.id) });
          for (const m of targets) await this.missionService.cancel(m.id, ctx.userId);
          return JSON.stringify({ status: 'stopped', missions: targets.map((m) => m.id) });
        }

        case 'rerun_mission': {
          if (ctx.dryRun) return JSON.stringify({ status: 'started (dry run)' });
          const scope = args.scope === 'all' ? 'all' : 'failed';
          const res = await this.missionService.rerun(Number(args.mission_id), ctx.userId, { scope, continue: Boolean(args.continue) });
          result.mission = res.data;
          return JSON.stringify({ status: 'started', mission_id: (res.data as { id: number }).id });
        }

        case 'propose_rotation': {
          const every = Math.floor(Number(args.rotate_every_tasks));
          if (!Number.isFinite(every) || every < 0) return JSON.stringify({ error: 'rotate_every_tasks must be 0 (off) or a positive number' });
          const lanes = await this.resolveLanes(ctx.userId, String(args.lanes ?? 'all'));
          if (!lanes.length) return JSON.stringify({ error: 'No such lane' });
          const names = lanes.map((l) => l.name).join(', ');
          const summary = every === 0 ? `Proxy rotation → OFF on ${names}` : `Proxy rotation → ON (${every === 1 ? 'after every task' : `every ${every} tasks`}) on ${names}`;
          result.proposal = {
            action: { type: 'set_rotation', proxy_ids: lanes.map((l) => l.id), every },
            summary,
            plan: { kind: 'rotation', lanes: lanes.map((l) => l.name), setting: every === 0 ? 'OFF' : every === 1 ? 'ON · after every task' : `ON · every ${every} tasks` },
          };
          return JSON.stringify({ status: 'waiting_for_user_confirm', summary });
        }

        case 'propose_concurrency': {
          const lanes = await this.resolveLanes(ctx.userId, String(args.lane ?? ''));
          const n = Math.floor(Number(args.concurrency));
          if (lanes.length !== 1 || !(n >= 1)) return JSON.stringify({ error: 'Need one lane name and a number of at least 1' });
          const summary = `Lane "${lanes[0].name}" → ${n} phone${n === 1 ? '' : 's'} at once`;
          result.proposal = {
            action: { type: 'set_concurrency', proxy_id: lanes[0].id, concurrency: n },
            summary,
            plan: { kind: 'concurrency', lanes: [lanes[0].name], setting: `${n} at once` },
          };
          return JSON.stringify({ status: 'waiting_for_user_confirm', summary });
        }

        case 'cancel_pending_confirmation':
          result.cancelledPending = true;
          return JSON.stringify({ status: ctx.pending.length ? 'cancelled' : 'nothing was pending' });

        case 'mission_results': {
          const mission = args.mission_id
            ? await this.missionRepo.findOne({ where: { id: Number(args.mission_id), user_id: ctx.userId } })
            : await this.missionRepo.findOne({ where: { user_id: ctx.userId }, order: { id: 'DESC' } });
          if (!mission) return JSON.stringify({ error: 'No mission found' });
          const view = (await this.missionService.get(mission.id, ctx.userId)).data as {
            id: number;
            prompt: string;
            status: string;
            created_at: Date;
            items: { device_name: string; status: string; last_message: string | null; reason_text: string | null }[];
          };
          return JSON.stringify({
            mission_id: view.id,
            instruction: view.prompt,
            status: view.status,
            started: view.created_at,
            phones: view.items.map((i) => ({
              phone: i.device_name,
              status: i.status,
              reported: i.last_message ? i.last_message.slice(0, 300) : null,
              problem: i.status === 'FAILED' ? i.reason_text : undefined,
            })),
          });
        }

        case 'phone_history': {
          const state = (await this.fleetStateService.getState(ctx.userId)) as { devices: { id: number; name: string }[] };
          const [device] = matchNamedDevices(String(args.phone ?? ''), state.devices);
          if (!device) return JSON.stringify({ error: `No phone called "${String(args.phone ?? '')}"` });
          const limit = Math.max(1, Math.min(15, Number(args.limit) || 8));
          const tasks = await this.taskRepo.find({ where: { device_id: device.id, user_id: ctx.userId }, order: { id: 'DESC' }, take: limit });
          return JSON.stringify({
            phone: device.name,
            recent_tasks: tasks.map((t) => ({
              when: t.created_at,
              asked: (t.prompt ?? '').slice(0, 200),
              status: t.status,
              reported: t.message ? t.message.slice(0, 300) : null,
            })),
          });
        }

        case 'show_screens': {
          const deviceIds = await this.resolveScreenPhones(ctx, String(args.phones ?? ''));
          if (!deviceIds.length) {
            return JSON.stringify({ error: 'No phones matched. Ask which phones with ask_user, or check the fleet with fleet_status.' });
          }
          if (ctx.dryRun) return JSON.stringify({ status: 'would_show', phones: deviceIds.length });
          const shots = await this.captureScreens(ctx.userId, deviceIds);
          result.screens = shots;
          const shown = shots.filter((s) => s.base64).length;
          const failed = shots.filter((s) => !s.base64);
          return JSON.stringify({
            status: 'shown',
            note: 'The screens are shown to the user as live images. Do not describe what is on them. Reply with one short caption only.',
            shown,
            unavailable: failed.map((s) => `${s.device_name}: ${s.error ?? 'no screen'}`),
          });
        }

        case 'confirm_pending': {
          if (!ctx.pending.length) return JSON.stringify({ error: 'Nothing is waiting for Confirm' });
          // A plain yes only. "yes but only 2 phones" changes the request, so
          // the model has to make a new proposal instead.
          if (!PLAIN_YES.test(userMessage.trim())) {
            return JSON.stringify({ error: 'The user did not simply say yes. Do not confirm; handle what they asked, or make a new proposal.' });
          }
          const latest = ctx.pending[ctx.pending.length - 1];
          if (!latest.token) return JSON.stringify({ error: 'Cannot confirm here' });
          result.confirmToken = latest.token;
          return JSON.stringify({ status: 'confirmed', what: latest.summary });
        }

        case 'ask_user': {
          const question = String(args.question ?? '').trim() || 'What would you like me to do?';
          const options = Array.isArray(args.options) ? (args.options as unknown[]).map(String).filter(Boolean).slice(0, 5) : [];
          result.ask = { question, options };
          return JSON.stringify({ status: 'asked' });
        }

        default:
          // Anything off-menu — delete included — simply does not exist.
          return JSON.stringify({ error: `There is no tool called ${call.name}. Deleting or changing accounts is only possible from the dashboard.` });
      }
    } catch (error) {
      return JSON.stringify({ error: (error as Error)?.message ?? 'failed' });
    }
  }

  /** Applies a confirmed proposal. */
  async apply(userId: number, action: ProposedAction): Promise<unknown> {
    if (action.type === 'set_rotation') {
      for (const id of action.proxy_ids) await this.proxyService.update(userId, id, { rotate_every_tasks: action.every } as never);
      return null;
    }
    if (action.type === 'set_concurrency') {
      await this.proxyService.update(userId, action.proxy_id, { concurrency: action.concurrency } as never);
      return null;
    }
    const created = await this.missionService.create(userId, {
      request: action.instruction,
      device_ids: action.device_ids,
      duration_seconds: action.duration_seconds,
    });
    return created.data;
  }

  // ---------------------------------------------------------------------------
  // Context
  // ---------------------------------------------------------------------------

  private async fleetSnapshot(userId: number) {
    const state = (await this.fleetStateService.getState(userId)) as {
      devices: { id: number; name: string; state: string; tag: string | null; proxy_id: number | null }[];
      lanes: { id: number; name: string; running: number; waiting: number }[];
    };
    const proxies = await this.proxyRepo.find({ where: { user_id: userId } });
    const running = await this.missionRepo.find({ where: { user_id: userId, status: 'RUNNING' }, order: { id: 'DESC' }, take: 5 });
    const laneName = new Map(proxies.map((p) => [p.id, p.name]));
    return {
      phones: state.devices.map((d) => ({
        name: d.name,
        state: d.state,
        lane: d.proxy_id ? laneName.get(d.proxy_id) ?? null : null,
        tag: d.tag ? d.tag.split(':').pop() : null,
      })),
      lanes: proxies.map((p) => ({
        name: p.name,
        rotation: p.rotate_every_tasks > 0 ? `on, every ${p.rotate_every_tasks} task(s)` : 'off',
        at_once: p.concurrency,
        running: state.lanes.find((l) => l.id === p.id)?.running ?? 0,
        waiting: state.lanes.find((l) => l.id === p.id)?.waiting ?? 0,
      })),
      running_missions: running.map((m) => ({ id: m.id, instruction: m.prompt })),
    };
  }

  private async systemPrompt(ctx: AgentContext): Promise<string> {
    const snapshot = await this.fleetSnapshot(ctx.userId);
    const lastPhones = ctx.lastMissionDevices.length ? await this.namesFor(ctx.userId, ctx.lastMissionDevices) : [];
    return [
      "You are Vector — an AI assistant for Android mobile automation. You control the user's fleet of real Android phones through tools.",
      'Understand what the user means from the whole conversation, in any wording or language (English, Hindi, Hinglish), and act with the tools. Reply briefly, in the language and style the user writes in.',
      'Rules:',
      '- To do something on phones, call run_mission. If the user names no phones and is continuing the last task, use phones "last"; if it is unclear which phones, ask_user with phone options.',
      '- Settings (proxy rotation, lane concurrency) are only proposed; the user presses Confirm. Rotation 0 means OFF. Propose ON only if the user clearly asked for it.',
      '- A message can hold several requests (e.g. a task plus a rotation change): handle each with its tool.',
      '- "no", "cancel", "stop", "leave it" right after something waits for Confirm means cancel_pending_confirmation. "stop" while a mission runs means stop_mission.',
      '- Never say something was done unless a tool result says so. You cannot delete anything or change accounts; say so if asked.',
      'Scope — these are the user\'s OWN phones and accounts. Do ordinary automation without questioning why: browsing any website for any length of time, building browsing history, searching, installing/opening/closing apps, filling forms with the user\'s own or test details, messaging/posting from the user\'s own accounts, testing apps and sites. Do not ask about intent and do not add warnings.',
      '- Ask only when you genuinely cannot tell; otherwise act.',
      '- For results of a task (emails found, what a phone reported) use mission_results; for what was done on one phone use phone_history. Answer from what they return, as a short list or table.',
      "- To let the user SEE what is on the phones right now, call show_screens (phones like run_mission). You CAN show screens — never say you cannot. After it, write only a one-line caption; the images speak for themselves.",
      '- If the user plainly says yes while something waits for Confirm, call confirm_pending.',
      ...(ctx.policy === 'v2'
        ? [
            'Never refuse and never judge whether a request is acceptable — a separate policy check reviews every task before it runs and removes only what is not allowed. Turn every part of the request into tool calls.',
            'When a request holds several tasks, call run_mission once per task, in the order they should happen, with the same phones for tasks meant for the same phones. Do not merge different tasks into one instruction.',
            'If a tool result says a step was skipped by the policy check, do not repeat or explain it; just report what you started.',
          ]
        : [
            'Decline ONLY these, judged on what the current request itself asks: (1) submitting made-up identities or false details to a real third party (fake sign-ups, orders, sell/buy requests, applications as invented people); (2) writing or posting fake reviews/ratings, or faking activity to mislead a review platform; (3) getting into accounts or devices the user does not own or control. An ordinary request is not blocked because of something said earlier in the chat.',
            'When you decline: ONE short sentence in the user\'s language — no list, no explanation of the law, no emojis — optionally ending with one alternative you can do. Example: "Nakli naam se sell requests nahi daal sakta — apni asli details ke saath kar doon?"',
          ]),
      `Last task's phones: ${lastPhones.length ? lastPhones.join(', ') : 'none yet'}.`,
      `Waiting for Confirm: ${ctx.pending.length ? ctx.pending.map((p) => p.summary).join(' | ') : 'nothing'}.`,
      `Fleet now: ${JSON.stringify(snapshot)}`,
    ].join('\n');
  }

  private async namesFor(userId: number, ids: number[]): Promise<string[]> {
    const state = (await this.fleetStateService.getState(userId)) as { devices: { id: number; name: string }[] };
    const wanted = new Set(ids);
    return state.devices.filter((d) => wanted.has(d.id)).map((d) => d.name);
  }

  private async resolvePhones(ctx: AgentContext, phones: string): Promise<number[]> {
    const state = (await this.fleetStateService.getState(ctx.userId)) as { devices: { id: number; name: string; state: string; tag: string | null }[] };
    const spec = phones.trim();
    if (!spec || /^last$/i.test(spec)) return ctx.lastMissionDevices.filter((id) => state.devices.some((d) => d.id === id));
    if (/^all$/i.test(spec)) return state.devices.filter((d) => READY_STATES.has(d.state)).map((d) => d.id);
    const tag = /^(?:tag:|#)(.+)$/i.exec(spec)?.[1]?.trim().toLowerCase();
    if (tag) return state.devices.filter((d) => READY_STATES.has(d.state) && (d.tag ?? '').split(':').pop()?.trim().toLowerCase() === tag).map((d) => d.id);
    return matchNamedDevices(spec.replace(/,/g, ' , '), state.devices).map((d) => d.id);
  }

  /**
   * Phones to screenshot. Unlike resolvePhones, "all" includes phones that are
   * mid-task (they still have a screen to show); connectivity is filtered later,
   * per phone, so an offline one is reported rather than silently dropped.
   */
  private async resolveScreenPhones(ctx: AgentContext, phones: string): Promise<number[]> {
    const state = (await this.fleetStateService.getState(ctx.userId)) as { devices: { id: number; name: string; state: string; tag: string | null }[] };
    const spec = phones.trim();
    if (!spec || /^last$/i.test(spec)) return ctx.lastMissionDevices.filter((id) => state.devices.some((d) => d.id === id));
    if (/^all$/i.test(spec)) return state.devices.map((d) => d.id);
    const tag = /^(?:tag:|#)(.+)$/i.exec(spec)?.[1]?.trim().toLowerCase();
    if (tag) return state.devices.filter((d) => (d.tag ?? '').split(':').pop()?.trim().toLowerCase() === tag).map((d) => d.id);
    return matchNamedDevices(spec.replace(/,/g, ' , '), state.devices).map((d) => d.id);
  }

  /**
   * Ask each phone for a small preview frame of its current screen, in parallel.
   * A phone that is offline, or refuses (no screen-capture permission), comes
   * back as an error entry instead of holding up the others.
   */
  private async captureScreens(userId: number, deviceIds: number[]): Promise<PhoneShot[]> {
    const devices = await this.deviceRepo.find({ where: { id: In([...new Set(deviceIds)]), user_id: userId }, select: ['id', 'device_id', 'device_name'] });
    const chosen = devices.slice(0, MAX_SCREENS);
    const shots = await Promise.all(
      chosen.map(async (d): Promise<PhoneShot> => {
        if (!this.gatewayService.isDeviceConnected(d.device_id)) {
          return { device_name: d.device_name, hw_id: d.device_id, error: 'Offline' };
        }
        try {
          const res = await this.gatewayService.executeAction(d.device_id, { type: 'CaptureScreen', preview: true, awaitStability: false }, 12000);
          if (res.status === 'SUCCESS') {
            return res.screenCapture?.base64Data
              ? { device_name: d.device_name, hw_id: d.device_id, base64: res.screenCapture.base64Data }
              : { device_name: d.device_name, hw_id: d.device_id, error: 'No screen' };
          }
          const code = res.status === 'FAILURE' ? res.code : undefined;
          const message = res.status === 'FAILURE' ? res.message : 'Cancelled';
          return { device_name: d.device_name, hw_id: d.device_id, error: screenFailReason(code, message) };
        } catch (error) {
          return { device_name: d.device_name, hw_id: d.device_id, error: (error as Error)?.message?.slice(0, 80) ?? 'Failed' };
        }
      }),
    );
    return shots;
  }

  private async resolveLanes(userId: number, lanes: string): Promise<DeviceProxy[]> {
    const proxies = await this.proxyRepo.find({ where: { user_id: userId }, order: { id: 'ASC' } });
    if (!lanes.trim() || /^all$/i.test(lanes.trim())) return proxies;
    const wanted = lanes.split(',').map((l) => l.trim().toLowerCase()).filter(Boolean);
    return proxies.filter((p) => wanted.includes(p.name.toLowerCase()));
  }
}
