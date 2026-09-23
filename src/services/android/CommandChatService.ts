import { DeviceProxy } from '@/entities/DeviceProxy';
import AppError from '@/helpers/AppError';
import { AppDataSource } from '@/loaders/database';
import Logger from '@/logger/index';
import { AiService, type ChatIntent } from '@/services/AiService';
import { AiConfigService } from '@/services/controllerService/AiConfigService';
import { ApiResponse } from '@/types/ApiResponse';
import crypto from 'node:crypto';
import { Service } from 'typedi';
import { FleetStateService } from './FleetStateService';
import { MissionService } from './MissionService';
import { ProxyRotationService } from './ProxyRotationService';

const SIMULATION = process.env.AGENT_SIMULATION === '1' && process.env.NODE_ENV !== 'production';
/** A pending confirmation lives this long before the token is refused. */
const CONFIRM_TTL_MS = 10 * 60_000;

/**
 * What the chat can do to change something. Deliberately tiny: every entry is a
 * specific, reversible fleet setting. There is no delete of any kind here — the
 * model cannot ask for one because the shape has nowhere to put it.
 */
type PendingAction =
  | { type: 'set_rotation'; proxy_id: number | 'all'; every: number }
  | { type: 'set_concurrency'; proxy_id: number; concurrency: number };

interface Pending {
  userId: number;
  action: PendingAction;
  summary: string;
  at: number;
}

export interface ChatReply {
  /** answer: plain text · mission: a mission started · confirm: awaiting yes · clarify: a question back · error */
  kind: 'answer' | 'mission' | 'confirm' | 'clarify' | 'error';
  text: string;
  mission?: unknown;
  confirm_token?: string;
  /** Echoes the action a confirm will apply, for the UI to describe. */
  action?: PendingAction;
}

/**
 * The Command chat: plain language in, one bounded step out.
 *
 * The model's only job is to classify the message — a read-only question, a
 * mission to run, a setting to change, or something too vague to act on — and
 * hand back structured fields. This service does the actual work with ordinary
 * code, so a weak or misbehaving model can only ever trigger one of a few known
 * actions. It can never delete, and a setting change waits for the user's yes.
 */
@Service()
export class CommandChatService {
  private proxyRepo = AppDataSource.getRepository(DeviceProxy);
  private pending = new Map<string, Pending>();

  constructor(
    private aiService: AiService,
    private aiConfigService: AiConfigService,
    private fleetStateService: FleetStateService,
    private missionService: MissionService,
    private proxyService: ProxyRotationService,
  ) {}

  async handle(userId: number, message: string): Promise<ApiResponse> {
    const text = String(message ?? '').trim();
    if (!text) throw new AppError('Type something for the chat to do', 400);

    const intent = await this.classify(userId, text);
    const reply = await this.act(userId, text, intent);
    return { message: 'Chat reply', data: reply };
  }

  async confirm(userId: number, token: string): Promise<ApiResponse> {
    const pending = this.pending.get(token);
    if (!pending || pending.userId !== userId) throw new AppError('Nothing to confirm (it may have expired)', 404);
    this.pending.delete(token);
    if (Date.now() - pending.at > CONFIRM_TTL_MS) throw new AppError('That confirmation expired — ask again', 410);

    await this.apply(userId, pending.action);
    return { message: 'Applied', data: { kind: 'answer', text: `Done — ${pending.summary}.` } as ChatReply };
  }

  // ---------------------------------------------------------------------------
  // Classify
  // ---------------------------------------------------------------------------

  private async classify(userId: number, text: string): Promise<ChatIntent> {
    if (!SIMULATION) {
      const config = await this.aiConfigService.resolveChatConfig(userId);
      if (config) {
        const intent = await this.aiService.classifyChatCommand(text, config);
        if (intent) return intent;
      }
    }
    return classifyLocally(text);
  }

  // ---------------------------------------------------------------------------
  // Act
  // ---------------------------------------------------------------------------

  private async act(userId: number, text: string, intent: ChatIntent): Promise<ChatReply> {
    switch (intent.kind) {
      case 'status':
        return { kind: 'answer', text: await this.describeFleet(userId) };

      case 'mission': {
        try {
          const result = await this.missionService.create(userId, { request: intent.prompt || text });
          const mission = result.data as { note?: string | null };
          return {
            kind: 'mission',
            text: mission?.note ? `Started. ${mission.note}` : 'Started — watch it below.',
            mission: result.data,
          };
        } catch (error) {
          return { kind: 'error', text: (error as AppError)?.message ?? 'Could not start that mission' };
        }
      }

      case 'setting': {
        const built = await this.buildSettingAction(userId, intent);
        if ('error' in built) return { kind: 'clarify', text: built.error };
        const token = crypto.randomBytes(12).toString('hex');
        this.pending.set(token, { userId, action: built.action, summary: built.summary, at: Date.now() });
        return { kind: 'confirm', text: `${built.summary}. Confirm?`, confirm_token: token, action: built.action };
      }

      case 'refuse':
        // Delete and anything else off-menu is declined, never offered.
        return {
          kind: 'answer',
          text:
            "I can't delete devices, proxies or tasks, or change accounts from chat — do that from the dashboard. I can run tasks across phones, report fleet status, and change proxy rotation or lane concurrency.",
        };

      case 'clarify':
      default:
        return {
          kind: 'clarify',
          text: intent.question || 'What would you like to do — run a task on some phones, check status, or change proxy rotation?',
        };
    }
  }

  private async buildSettingAction(
    userId: number,
    intent: Extract<ChatIntent, { kind: 'setting' }>,
  ): Promise<{ action: PendingAction; summary: string } | { error: string }> {
    const proxies = await this.proxyRepo.find({ where: { user_id: userId }, order: { id: 'ASC' } });
    if (proxies.length === 0) return { error: 'There are no proxy lanes to change yet.' };

    const resolveLane = (name?: string): DeviceProxy | 'all' | null => {
      if (!name || /\ball\b|every|har/i.test(name)) return 'all';
      const match = proxies.find((p) => p.name.toLowerCase() === name.trim().toLowerCase());
      return match ?? null;
    };

    if (intent.setting === 'rotation') {
      const lane = resolveLane(intent.proxy);
      if (lane === null) return { error: `I couldn't find a lane called "${intent.proxy}". Which lane — ${proxies.map((p) => p.name).join(', ')}?` };
      const every = intent.every && intent.every > 0 ? Math.floor(intent.every) : 1;
      const where = lane === 'all' ? 'every lane' : `lane "${lane.name}"`;
      const phrase = every === 1 ? 'after every task' : `after every ${every} tasks`;
      return { action: { type: 'set_rotation', proxy_id: lane === 'all' ? 'all' : lane.id, every }, summary: `Rotate ${where} ${phrase}` };
    }

    if (intent.setting === 'concurrency') {
      const lane = resolveLane(intent.proxy);
      if (lane === null || lane === 'all') return { error: `Which lane's concurrency — ${proxies.map((p) => p.name).join(', ')}?` };
      const n = intent.concurrency && intent.concurrency > 0 ? Math.floor(intent.concurrency) : null;
      if (!n) return { error: 'How many phones should run at once on that lane?' };
      return { action: { type: 'set_concurrency', proxy_id: lane.id, concurrency: n }, summary: `Run ${n} at once on lane "${lane.name}"` };
    }

    return { error: 'I can change proxy rotation or lane concurrency. Which did you mean?' };
  }

  private async apply(userId: number, action: PendingAction): Promise<void> {
    if (action.type === 'set_rotation') {
      const proxies =
        action.proxy_id === 'all'
          ? await this.proxyRepo.find({ where: { user_id: userId } })
          : await this.proxyRepo.find({ where: { id: action.proxy_id, user_id: userId } });
      for (const proxy of proxies) {
        await this.proxyService.update(userId, proxy.id, { rotate_every_tasks: action.every } as never);
      }
      return;
    }
    if (action.type === 'set_concurrency') {
      await this.proxyService.update(userId, action.proxy_id, { concurrency: action.concurrency } as never);
    }
  }

  // ---------------------------------------------------------------------------
  // Read-only view
  // ---------------------------------------------------------------------------

  private async describeFleet(userId: number): Promise<string> {
    const state = (await this.fleetStateService.getState(userId)) as {
      counts: Record<string, number>;
      lanes: { name: string; running: number; waiting: number }[];
    };
    const c = state.counts;
    const online = (c.total ?? 0) - (c.offline ?? 0);
    const parts = [`${online} of ${c.total ?? 0} phones online`];
    if (c.running) parts.push(`${c.running} running`);
    if (c.waiting) parts.push(`${c.waiting} waiting in a proxy queue`);
    if (c.needs_setup) parts.push(`${c.needs_setup} need accessibility turned on`);
    if (c.offline) parts.push(`${c.offline} offline`);
    const lanes = state.lanes.map((l) => `${l.name}: ${l.running} running, ${l.waiting} waiting`).join(' · ');
    return `${parts.join(', ')}.${lanes ? `\nLanes — ${lanes}.` : ''}`;
  }
}

// -----------------------------------------------------------------------------
// Local classifier — used in the harness (no model) and when the model's reply
// is unusable. Conservative: anything it cannot place becomes a clarify.
// -----------------------------------------------------------------------------

const DELETE_WORDS = /\b(delete|remove|unpair|wipe|erase|drop|hata\s*do|delete\s*all)\b/i;
const STATUS_WORDS = /\b(status|online|offline|how many|kitne|kaun|which phones|running|idle|fleet)\b/i;
const ROTATE_WORDS = /\brotat/i;
const CONCURRENCY_WORDS = /\bconcurren|at once|parallel|ek saath\b/i;
const MISSION_WORDS = /\b(open|play|send|search|scroll|close|tap|type|go to|khol|chalao|bhejo)\b/i;

export function classifyLocally(text: string): ChatIntent {
  const t = text.toLowerCase();

  if (DELETE_WORDS.test(t)) return { kind: 'refuse' };

  if (ROTATE_WORDS.test(t)) {
    const every = /every task|har task|each task/.test(t) ? 1 : Number(/every (\d+)/.exec(t)?.[1]) || 0;
    const proxy = /\ball\b|every lane|har lane/.test(t) ? 'all' : /\blane ([\w-]+)/.exec(t)?.[1];
    return { kind: 'setting', setting: 'rotation', every, proxy };
  }
  if (CONCURRENCY_WORDS.test(t)) {
    const concurrency = Number(/(\d+)/.exec(t)?.[1]) || 0;
    const proxy = /\blane ([\w-]+)/.exec(t)?.[1] ?? /(\w+) lane/.exec(t)?.[1];
    return { kind: 'setting', setting: 'concurrency', concurrency, proxy };
  }
  if (STATUS_WORDS.test(t)) return { kind: 'status' };
  if (MISSION_WORDS.test(t)) return { kind: 'mission', prompt: text };

  return { kind: 'clarify', question: 'What would you like to do — run a task on some phones, check status, or change proxy rotation?' };
}
