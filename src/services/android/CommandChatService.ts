import { ChatMessage } from '@/entities/ChatMessage';
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
import { MissionService, MissionTargetMissing, matchNamedDevices } from './MissionService';
import { ProxyRotationService } from './ProxyRotationService';

const SIMULATION = process.env.AGENT_SIMULATION === '1' && process.env.NODE_ENV !== 'production';
/** A pending confirmation lives this long before the token is refused. */
const CONFIRM_TTL_MS = 10 * 60_000;

/** Who the chat says it is. Fixed text, so the answer never drifts with the model. */
export const VECTOR_IDENTITY =
  "I'm Vector — an AI assistant for Android mobile automation. I run tasks across your phone fleet in plain language, report which phones are online and what they're doing, and manage proxy rotation for you. Setting changes always wait for your confirmation, and I never delete anything.";

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
  /** A task asked for in the same message, started once the setting is applied. */
  thenMission?: string;
}

export interface ChatReply {
  /** answer: plain text · mission: a mission started · confirm: awaiting yes · clarify: a question back · error */
  kind: 'answer' | 'mission' | 'confirm' | 'clarify' | 'error';
  text: string;
  mission?: unknown;
  confirm_token?: string;
  /** Echoes the action a confirm will apply, for the UI to describe. */
  action?: PendingAction;
  /** Tap-to-send answers shown under a question. */
  quick_replies?: string[];
  /**
   * What a question is waiting for, so the next message can finish the job:
   * the phones for a request already given, or the action for phones already
   * named. Stored with the reply, which is how the chat "remembers" it.
   */
  pending?: { awaiting: 'phones'; request: string } | { awaiting: 'action'; target: string };
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
  private messageRepo = AppDataSource.getRepository(ChatMessage);
  private pending = new Map<string, Pending>();

  constructor(
    private aiService: AiService,
    private aiConfigService: AiConfigService,
    private fleetStateService: FleetStateService,
    private missionService: MissionService,
    private proxyService: ProxyRotationService,
  ) {}

  async handle(userId: number, message: string): Promise<ApiResponse> {
    let text = String(message ?? '').trim();
    if (!text) throw new AppError('Type something for the chat to do', 400);

    // Harness only: "[ai:{...}]" stands in for the real model's classification,
    // so the model-driven paths can be tested without a model.
    let stub: ChatIntent | null = null;
    if (SIMULATION) {
      const marker = /\s*\[ai:(\{.*\})\]\s*$/.exec(text);
      if (marker) {
        try {
          stub = JSON.parse(marker[1]) as ChatIntent;
        } catch {
          stub = null;
        }
        text = text.slice(0, marker.index).trim();
      }
    }
    await this.record(userId, 'user', text);
    const context = await this.recentContext(userId);
    // Finish a question the chat just asked: "stop youtube" -> "which phone?" ->
    // "Nokia" is one request, not two unrelated messages.
    const effective = await this.joinWithPending(userId, text, context.pending);
    const intent = await this.classify(userId, effective, context.lines, stub);
    const reply = await this.act(userId, effective, intent, context.lastMissionDevices);
    await this.record(userId, 'assistant', reply.text, reply);
    return { message: 'Chat reply', data: reply };
  }

  /**
   * Retry / Continue / Run again from a mission card. Goes through the chat so
   * the new mission lands in the transcript like any other reply.
   */
  async rerun(userId: number, missionId: number, options: { scope?: 'failed' | 'all'; continue?: boolean }): Promise<ApiResponse> {
    const label = options.continue ? 'Continue' : options.scope === 'all' ? 'Run again' : 'Retry failed phones';
    await this.record(userId, 'user', label);
    let reply: ChatReply;
    try {
      const result = await this.missionService.rerun(missionId, userId, options);
      reply = {
        kind: 'mission',
        text: options.continue ? 'Picking each phone back up where it stopped.' : 'Started again — watch it below.',
        mission: result.data,
      };
    } catch (error) {
      reply = { kind: 'error', text: (error as AppError)?.message ?? 'Could not run it again' };
    }
    await this.record(userId, 'assistant', reply.text, reply);
    return { message: 'Chat reply', data: reply };
  }

  /** The conversation so far, oldest first, so a reload picks up where it left off. */
  async history(userId: number, limit = 60): Promise<ApiResponse> {
    const rows = await this.messageRepo.find({
      where: { user_id: userId },
      order: { id: 'DESC' },
      take: Math.max(1, Math.min(200, limit)),
    });
    const turns = rows.reverse().map((row) => {
      if (row.role === 'user') return { id: row.id, role: 'user' as const, text: row.text };
      let reply: ChatReply = { kind: 'answer', text: row.text };
      try {
        if (row.reply) reply = JSON.parse(row.reply) as ChatReply;
      } catch {
        /* keep the plain text */
      }
      // A confirm from an earlier visit can't be applied any more; show it as text.
      if (reply.kind === 'confirm') reply = { kind: 'answer', text: `${reply.text.replace(/ Confirm\?$/, '')} (not confirmed)` };
      return { id: row.id, role: 'assistant' as const, reply };
    });
    return { message: 'Chat history', data: turns };
  }

  /** What the chat needs from the conversation so far. */
  private async recentContext(userId: number): Promise<{
    lines: string[];
    pending: ChatReply['pending'] | null;
    lastMissionDevices: number[];
  }> {
    const rows = await this.messageRepo.find({ where: { user_id: userId }, order: { id: 'DESC' }, take: 20 });
    // rows[0] is the message just recorded; the reply before it is the last assistant turn.
    const lastAssistant = rows.find((r, i) => i > 0 && r.role === 'assistant');
    let pending: ChatReply['pending'] | null = null;
    if (lastAssistant?.reply) {
      try {
        pending = (JSON.parse(lastAssistant.reply) as ChatReply).pending ?? null;
      } catch {
        pending = null;
      }
    }
    // Only a question asked moments ago is still "open".
    if (lastAssistant && Date.now() - new Date(lastAssistant.created_at).getTime() > 30 * 60_000) pending = null;

    let lastMissionDevices: number[] = [];
    const lastMission = rows.find((r) => r.mission_id);
    if (lastMission?.reply) {
      try {
        const mission = (JSON.parse(lastMission.reply) as ChatReply).mission as { items?: { device_id: number }[] } | undefined;
        lastMissionDevices = (mission?.items ?? []).map((i) => i.device_id);
      } catch {
        lastMissionDevices = [];
      }
    }
    const lines = rows
      .slice(1, 9)
      .reverse()
      .map((r) => `${r.role === 'user' ? 'User' : 'Vector'}: ${r.text.slice(0, 300)}`);
    return { lines, pending, lastMissionDevices };
  }

  private async joinWithPending(userId: number, text: string, pending: ChatReply['pending'] | null): Promise<string> {
    if (!pending) return text;
    // A complete new instruction wins over an old question.
    const own = classifyLocally(text);
    if (pending.awaiting === 'phones') {
      if ((own.kind === 'mission' || own.kind === 'status' || own.kind === 'setting' || own.kind === 'refuse') && !(await this.isTargetOnly(userId, text))) {
        return text;
      }
      return `${pending.request} on ${text.replace(/^(on|in|par|pe)\s+/i, '')}`;
    }
    if (pending.awaiting === 'action') {
      if (await this.isTargetOnly(userId, text)) return text;
      return `${text} on ${pending.target}`;
    }
    return text;
  }

  private async record(userId: number, role: 'user' | 'assistant', text: string, reply?: ChatReply): Promise<void> {
    try {
      const missionId = (reply?.mission as { id?: number } | undefined)?.id ?? null;
      await this.messageRepo.save(
        this.messageRepo.create({ user_id: userId, role, text: text.slice(0, 8000), reply: reply ? JSON.stringify(reply) : null, mission_id: missionId }),
      );
    } catch (error) {
      // Losing a transcript line must never break the chat itself.
      Logger.warn('[CommandChat] Could not save chat message:', error);
    }
  }

  async confirm(userId: number, token: string): Promise<ApiResponse> {
    const pending = this.pending.get(token);
    if (!pending || pending.userId !== userId) throw new AppError('Nothing to confirm (it may have expired)', 404);
    this.pending.delete(token);
    if (Date.now() - pending.at > CONFIRM_TTL_MS) throw new AppError('That confirmation expired — ask again', 410);

    await this.apply(userId, pending.action);
    let reply: ChatReply = { kind: 'answer', text: `Done — ${pending.summary}.` };
    if (pending.thenMission) {
      try {
        const result = await this.missionService.create(userId, { request: pending.thenMission });
        reply = { kind: 'mission', text: `Done — ${pending.summary}. Now running the task — watch it below.`, mission: result.data };
      } catch (error) {
        reply = { kind: 'error', text: `${pending.summary} is done, but the task could not start: ${(error as AppError)?.message ?? 'unknown error'}` };
      }
    }
    await this.record(userId, 'assistant', reply.text, reply);
    return { message: 'Applied', data: reply };
  }

  // ---------------------------------------------------------------------------
  // Classify
  // ---------------------------------------------------------------------------

  private async classify(userId: number, text: string, history: string[] = [], stub: ChatIntent | null = null): Promise<ChatIntent> {
    // A message that only names phones is half an instruction: ask for the rest.
    if (await this.isTargetOnly(userId, text)) return { kind: 'target', target: text } as ChatIntent;
    let modelIntent: ChatIntent | null = stub;
    if (!modelIntent && !SIMULATION) {
      const config = await this.aiConfigService.resolveChatConfig(userId);
      if (config) modelIntent = await this.aiService.classifyChatCommand(text, config, history);
    }
    if (!modelIntent) return classifyLocally(text);
    return reconcileModelIntent(text, modelIntent);
  }

  // ---------------------------------------------------------------------------
  // Act
  // ---------------------------------------------------------------------------

  private async act(userId: number, text: string, intent: ChatIntent, lastMissionDevices: number[] = []): Promise<ChatReply> {
    switch (intent.kind) {
      case 'target': {
        const target = (intent as { target: string }).target;
        return {
          kind: 'clarify',
          text: `What should ${target.replace(/^@/, '')} do?`,
          quick_replies: ['Open YouTube', 'Open Chrome', 'Open Settings', 'Close all apps'],
          pending: { awaiting: 'action', target },
        };
      }

      case 'status':
        return { kind: 'answer', text: await this.describeFleet(userId) };

      case 'mission': {
        try {
          const minutes = intent.duration_minutes ?? parseDurationMinutes(text);
          const result = await this.missionService.create(userId, {
            request: intent.prompt || text,
            duration_seconds: minutes && minutes > 0 ? Math.round(minutes * 60) : undefined,
            fallback_device_ids: lastMissionDevices,
          });
          const mission = result.data as { note?: string | null };
          const timed = minutes && minutes > 0 ? ` Each phone keeps going for ${formatMinutes(minutes)}.` : '';
          return {
            kind: 'mission',
            text: `${mission?.note ? `Started. ${mission.note}` : 'Started — watch it below.'}${timed}`,
            mission: result.data,
          };
        } catch (error) {
          if (error instanceof MissionTargetMissing) {
            // Ask once, remember the request, and offer the likely answers.
            return {
              kind: 'clarify',
              text: 'Which phones should do this?',
              quick_replies: await this.phoneQuickReplies(userId),
              pending: { awaiting: 'phones', request: intent.prompt || text },
            };
          }
          return { kind: 'error', text: (error as AppError)?.message ?? 'Could not start that mission' };
        }
      }

      case 'setting': {
        const built = await this.buildSettingAction(userId, intent, text);
        if ('error' in built) return { kind: 'clarify', text: built.error, quick_replies: built.quick_replies };
        // "open youtube on all phones without proxy rotation" is two jobs: the
        // setting, then the task. One confirm covers both.
        const rest = stripRotationPhrase(text);
        const thenMission = rest && classifyLocally(rest).kind === 'mission' ? rest : undefined;
        const summary = thenMission ? `${built.summary}, then run: "${rest}"` : built.summary;
        const token = crypto.randomBytes(12).toString('hex');
        this.pending.set(token, { userId, action: built.action, summary: built.summary, at: Date.now(), thenMission });
        return { kind: 'confirm', text: `${summary}. Confirm?`, confirm_token: token, action: built.action };
      }

      case 'identity':
        return { kind: 'answer', text: VECTOR_IDENTITY };

      case 'refuse':
        // Delete and anything else off-menu is declined, never offered.
        return {
          kind: 'answer',
          text:
            "I can't delete devices, proxies or tasks, or change accounts from chat — do that from the dashboard. I can run tasks across phones, report fleet status, and change proxy rotation or lane concurrency.",
        };

      case 'clarify':
      default: {
        const question = (intent as { question?: string }).question || 'What would you like to do — run a task on some phones, check status, or change proxy rotation?';
        // A question about phones gets phone buttons and remembers the request;
        // any other question gets no buttons rather than ones that don't answer it.
        if ((intent as { about?: string }).about === 'phones') {
          return {
            kind: 'clarify',
            text: question,
            quick_replies: await this.phoneQuickReplies(userId),
            pending: { awaiting: 'phones', request: text },
          };
        }
        return { kind: 'clarify', text: question };
      }
    }
  }

  /** True when the message names phones (or all / a tag) and nothing else. */
  private async isTargetOnly(userId: number, text: string): Promise<boolean> {
    const t = text.trim();
    if (!t || t.length > 160) return false;
    if (isGenericTarget(t)) return true;
    const state = (await this.fleetStateService.getState(userId)) as { devices: { id: number; name: string }[] };
    const named = matchNamedDevices(t, state.devices);
    if (!named.length) return false;
    let rest = ` ${t.toLowerCase()} `;
    for (const device of named) rest = rest.split(device.name.toLowerCase()).join(' ');
    return rest.replace(/[@,&]|\b(and|or|on|in|par|pe|phones?|devices?)\b/g, ' ').trim() === '';
  }

  /** Likely answers to "which phones?": a few ready phones, all, and tags. */
  private async phoneQuickReplies(userId: number): Promise<string[]> {
    const state = (await this.fleetStateService.getState(userId)) as { devices: { name: string; tag: string | null; state: string }[] };
    const ready = state.devices.filter((d) => ['idle', 'completed', 'failed', 'cancelled', 'interrupted'].includes(d.state));
    const tags = [...new Set(state.devices.map((d) => (d.tag ?? '').split(':').pop()?.trim()).filter(Boolean))] as string[];
    return [...ready.slice(0, 4).map((d) => d.name), 'All phones', ...tags.slice(0, 2).map((t) => `#${t}`)];
  }

  private async buildSettingAction(
    userId: number,
    intent: Extract<ChatIntent, { kind: 'setting' }>,
    text = '',
  ): Promise<{ action: PendingAction; summary: string } | { error: string; quick_replies?: string[] }> {
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
      // Never turn rotation on by assumption. The words decide: "without",
      // "off", "band"... mean off, whatever number the model sent; turning it
      // on needs an explicit on/every-N; anything else is asked, not guessed.
      let every: number | null;
      if (ROTATION_OFF.test(text)) every = 0;
      else if (intent.every === 0) every = 0;
      else if (intent.every && intent.every > 0 && ROTATION_ON.test(text)) every = Math.floor(intent.every);
      else if (ROTATION_ON.test(text)) every = Number(/every\s+(\d+)/i.exec(text)?.[1]) || 1;
      else every = null;
      if (every === null) {
        return {
          error: 'Turn proxy rotation on or off?',
          quick_replies: ['Turn proxy rotation off on all lanes', 'Turn proxy rotation on after every task'],
        };
      }
      const lanes = lane === 'all' ? proxies : [lane];
      const names = lanes.map((p) => p.name).join(', ');
      const action: PendingAction = { type: 'set_rotation', proxy_id: lane === 'all' ? 'all' : lane.id, every };
      if (every === 0) return { action, summary: `Proxy rotation → OFF on ${names}` };
      const phrase = every === 1 ? 'after every task' : `every ${every} tasks`;
      return { action, summary: `Proxy rotation → ON (${phrase}) on ${names}` };
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
      lanes: { id: number; name: string; running: number; waiting: number }[];
    };
    const proxies = await this.proxyRepo.find({ where: { user_id: userId } });
    const rotation = new Map(proxies.map((p) => [p.id, p.rotate_every_tasks]));
    const rotationText = (id: number) => {
      const every = rotation.get(id) ?? 0;
      return every <= 0 ? 'no rotation' : every === 1 ? 'rotates after every task' : `rotates every ${every} tasks`;
    };
    const c = state.counts;
    const online = (c.total ?? 0) - (c.offline ?? 0);
    const parts = [`${online} of ${c.total ?? 0} phones online`];
    if (c.running) parts.push(`${c.running} running`);
    if (c.waiting) parts.push(`${c.waiting} waiting in a proxy queue`);
    if (c.needs_setup) parts.push(`${c.needs_setup} need accessibility turned on`);
    if (c.offline) parts.push(`${c.offline} offline`);
    const lanes = state.lanes.map((l) => `${l.name}: ${l.running} running, ${l.waiting} waiting, ${rotationText(l.id)}`).join(' · ');
    return `${parts.join(', ')}.${lanes ? `\nLanes — ${lanes}.` : ''}`;
  }
}

// -----------------------------------------------------------------------------
// Local classifier — used in the harness (no model) and when the model's reply
// is unusable. Conservative: anything it cannot place becomes a clarify.
// -----------------------------------------------------------------------------

const IDENTITY_WORDS = /\b(who are you|who r u|who ru|your name|what are you|what can you do|kaun ho|kaun hai|tum kaun|tu kaun|introduce|help)\b|^\s*(hi|hello|hey|namaste|hii+)\b/i;
const DELETE_WORDS = /\b(delete|remove|unpair|wipe|erase|drop|hata\s*do|delete\s*all)\b/i;
const STATUS_WORDS = /\b(status|online|offline|how many|kitne|kaun|which phones|running|idle|fleet)\b/i;
const ROTATE_WORDS = /\brotat/i;
const CONCURRENCY_WORDS = /\bconcurren|at once|parallel|ek saath\b/i;
const MISSION_WORDS = /\b(open|play|send|search|scroll|close|stop|pause|kill|exit|quit|tap|type|go to|browse|visit|watch|khol|kholo|chalao|bhejo|dekho|band|bnd)\b/i;

/**
 * The parts of a "phones only" message that need no fleet lookup: "all phones",
 * "#PhoneBox", "@free1". Named phones are checked against the fleet separately.
 */
function isGenericTarget(text: string): boolean {
  const t = text.trim();
  if (/^(all|every|saare|sabhi|sab)\s*(the\s+)?(phones?|devices?|mobiles?)$/i.test(t)) return true;
  return /^[#@][\w.-]+(\s*(,|and|&)\s*[#@][\w.-]+)*$/i.test(t);
}

/**
 * Guard rails on the model's label. Models ask "which phone?" for clear
 * actions that simply name no phone — that is the server's call (last phones,
 * or a proper question with phone buttons), so a clear action stays a mission.
 * A genuine question about phones is marked so it gets phone buttons.
 */
export function reconcileModelIntent(text: string, intent: ChatIntent): ChatIntent {
  if (intent.kind !== 'clarify') return intent;
  const question = (intent as { question?: string }).question ?? '';
  if (classifyLocally(text).kind === 'mission') return { kind: 'mission', prompt: text };
  if (/\b(phone|phones|device|devices|mobile)\b/i.test(question)) {
    return { kind: 'clarify', question, about: 'phones' } as ChatIntent;
  }
  return intent;
}

/** A negation around "rotation": without / no / off / stop / band / mat / bina. */
const ROTATION_OFF =
  /\b(without|no|stop|disable|off|band|bnd|mat|bina|don.?t|never|nahi)\b[^.]{0,25}\brotat|\brotat\w*\b[^.]{0,25}\b(off|band|bnd|stop|disable|mat|nahi|bina|no)\b/i;
/** An explicit "turn it on": on / enable / start / chalu / every task / every N. */
const ROTATION_ON = /\b(on|enable|start|chalu|chalao|resume)\b|\bevery\s+(task|\d+)|\bhar\s+task\b|\bafter each\b/i;

/** The message without its proxy-rotation clause, for the task part of it. */
export function stripRotationPhrase(text: string): string {
  return text
    .replace(/\s*(,|and|aur)?\s*\b(without|with|no|stop|disable|turn\s+(on|off))?\s*(the\s+)?(proxy\s+|ip\s+)*rotat\w*(\s+(on|off|band|mat|stop|after every task|on all lanes))*\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** "for 1 hour", "30 min", "2 ghante", "1.5 hrs" -> minutes. */
export function parseDurationMinutes(text: string): number | undefined {
  const m = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|h\b|ghante|ghanta|minutes?|mins?|m\b|minat)/i.exec(text);
  if (!m) return undefined;
  const n = Number(m[1]);
  return /^(h|hour|hours|hr|hrs|ghante|ghanta)$/i.test(m[2]) ? n * 60 : n;
}

function formatMinutes(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} hour${minutes === 60 ? '' : 's'}`;
  return `${Math.round(minutes)} min`;
}

export function classifyLocally(text: string): ChatIntent {
  const t = text.toLowerCase();

  if (DELETE_WORDS.test(t)) return { kind: 'refuse' };
  if (IDENTITY_WORDS.test(t)) return { kind: 'identity' };

  if (ROTATE_WORDS.test(t)) {
    const stop = /\b(stop|off|disable|band|no rotation|don.?t rotate|never)\b/.test(t);
    const every = stop ? 0 : /every task|har task|each task/.test(t) ? 1 : Number(/every (\d+)/.exec(t)?.[1]) || undefined;
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
