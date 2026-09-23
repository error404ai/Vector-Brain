import { DeviceProxy } from '@/entities/DeviceProxy';
import { Mission } from '@/entities/Mission';
import AppError from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import Logger from '@/logger/index';
import { AiConfigService } from '@/services/controllerService/AiConfigService';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage } from '@langchain/core/messages';
import { Service } from 'typedi';
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

export interface AgentContext {
  userId: number;
  history: { role: 'user' | 'assistant'; text: string }[];
  lastMissionDevices: number[];
  pending: { summary: string }[];
  dryRun?: boolean;
}

export interface AgentResult {
  text: string;
  mission?: unknown;
  proposal?: { action: ProposedAction; summary: string };
  ask?: { question: string; options: string[] };
  cancelledPending?: boolean;
  calls: { name: string; args: Record<string, unknown>; result: string }[];
}

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

@Service()
export class VectorAgentService {
  private proxyRepo = AppDataSource.getRepository(DeviceProxy);
  private missionRepo = AppDataSource.getRepository(Mission);

  constructor(
    private aiConfigService: AiConfigService,
    private fleetStateService: FleetStateService,
    private missionService: MissionService,
    private proxyService: ProxyRotationService,
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

    for (let i = 0; i < MAX_MODEL_TURNS; i += 1) {
      let turn: BrainTurn;
      try {
        turn = await brain(messages);
      } catch (error) {
        Logger.warn('[VectorAgent] model call failed:', error);
        throw new AppError(`The AI model did not answer (${(error as Error)?.message ?? 'error'}). Try again in a moment.`, 502);
      }
      if (!turn.calls.length) {
        result.text = turn.text;
        break;
      }
      messages.push(new AIMessage({ content: turn.text, tool_calls: turn.calls.map((c) => ({ id: c.id, name: c.name, args: c.args, type: 'tool_call' as const })) }));
      for (const call of turn.calls) {
        const output = await this.execute(call, ctx, result);
        result.calls.push({ name: call.name, args: call.args, result: output });
        messages.push(new ToolMessage({ content: output, tool_call_id: call.id }));
      }
      // A question to the user ends the turn — wait for their answer.
      if (result.ask) {
        result.text = result.ask.question;
        break;
      }
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

  // ---------------------------------------------------------------------------
  // Tools
  // ---------------------------------------------------------------------------

  private async execute(call: ToolCall, ctx: AgentContext, result: AgentResult): Promise<string> {
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
          const durationSeconds = minutes ? Math.round(minutes * 60) : undefined;
          if (deviceIds.length > CONFIRM_PHONES || minutes >= CONFIRM_MINUTES) {
            const steps = deviceIds.length * (minutes ? minutes * STEPS_PER_MINUTE : STEPS_PER_SIMPLE_TASK);
            const cost = steps * COST_PER_STEP_USD;
            const summary = `Run "${instruction}" on ${deviceIds.length} phone${deviceIds.length === 1 ? '' : 's'}${minutes ? ` for ${minutes} min` : ''} — about ${steps} AI steps, roughly $${cost.toFixed(cost < 1 ? 2 : 1)}`;
            result.proposal = { action: { type: 'run_mission', instruction, device_ids: deviceIds, duration_seconds: durationSeconds }, summary };
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
          result.proposal = { action: { type: 'set_rotation', proxy_ids: lanes.map((l) => l.id), every }, summary };
          return JSON.stringify({ status: 'waiting_for_user_confirm', summary });
        }

        case 'propose_concurrency': {
          const lanes = await this.resolveLanes(ctx.userId, String(args.lane ?? ''));
          const n = Math.floor(Number(args.concurrency));
          if (lanes.length !== 1 || !(n >= 1)) return JSON.stringify({ error: 'Need one lane name and a number of at least 1' });
          const summary = `Lane "${lanes[0].name}" → ${n} phone${n === 1 ? '' : 's'} at once`;
          result.proposal = { action: { type: 'set_concurrency', proxy_id: lanes[0].id, concurrency: n }, summary };
          return JSON.stringify({ status: 'waiting_for_user_confirm', summary });
        }

        case 'cancel_pending_confirmation':
          result.cancelledPending = true;
          return JSON.stringify({ status: ctx.pending.length ? 'cancelled' : 'nothing was pending' });

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
      '- Ask only when you genuinely cannot tell; otherwise act.',
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

  private async resolveLanes(userId: number, lanes: string): Promise<DeviceProxy[]> {
    const proxies = await this.proxyRepo.find({ where: { user_id: userId }, order: { id: 'ASC' } });
    if (!lanes.trim() || /^all$/i.test(lanes.trim())) return proxies;
    const wanted = lanes.split(',').map((l) => l.trim().toLowerCase()).filter(Boolean);
    return proxies.filter((p) => wanted.includes(p.name.toLowerCase()));
  }
}
