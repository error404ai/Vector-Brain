import { ChatMessage } from '@/entities/ChatMessage';
import { ChatScreenShot } from '@/entities/ChatScreenShot';
import { Conversation } from '@/entities/Conversation';
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
import { POLICY_V2_DEFAULT, VectorAgentService, type Brain, type PolicyJudge, type ProposedAction } from './VectorAgentService';

const SIMULATION = process.env.AGENT_SIMULATION === '1' && process.env.NODE_ENV !== 'production';
/** A pending confirmation lives this long before the token is refused. */
const CONFIRM_TTL_MS = 10 * 60_000;
/** Screens shown in the chat are kept this long, then swept. */
const SCREEN_SHOT_TTL_MS = 7 * 24 * 60 * 60_000;

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
  /** The thread this confirmation belongs to, so a "yes" in another chat can't apply it. */
  conversationId?: number;
  /** Old classifier path action, or a proposal from Vector's agent. */
  action: PendingAction | { type: 'agent'; proposal: ProposedAction };
  summary: string;
  at: number;
  /** A task asked for in the same message, started once the setting is applied. */
  thenMission?: string;
}

export interface ChatReply {
  /** answer: plain text · mission: a mission started · confirm: awaiting yes · clarify: a question back · screens: live phone screens · error */
  kind: 'answer' | 'mission' | 'confirm' | 'clarify' | 'screens' | 'error';
  text: string;
  mission?: unknown;
  /** kind 'screens': one live screenshot per phone (base64 stripped before storage). */
  screens?: import('./VectorAgentService').PhoneShot[];
  confirm_token?: string;
  /** Echoes the action a confirm will apply, for the UI to describe. */
  action?: PendingAction;
  /** Tap-to-send answers shown under a question. */
  quick_replies?: string[];
  /** Further missions started by the same message (different phone sets). */
  extra_missions?: unknown[];
  /** What a Confirm will do, for the plan card. */
  plan?: import('./VectorAgentService').ProposalPlan;
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
  private conversationRepo = AppDataSource.getRepository(Conversation);
  private shotRepo = AppDataSource.getRepository(ChatScreenShot);
  private pending = new Map<string, Pending>();
  private lastShotSweep = 0;

  constructor(
    private aiService: AiService,
    private aiConfigService: AiConfigService,
    private fleetStateService: FleetStateService,
    private missionService: MissionService,
    private proxyService: ProxyRotationService,
    private agent: VectorAgentService,
  ) {}

  async handle(userId: number, message: string, conversationId?: number): Promise<ApiResponse> {
    let text = String(message ?? '').trim();
    if (!text) throw new AppError('Type something for the chat to do', 400);
    const conversation = await this.resolveConversation(userId, conversationId, text);

    // Harness only: "[agent:{turns:[...]}]" scripts Vector's agent model.
    let scripted: Brain | null = null;
    let policy: { v2: boolean; judge?: PolicyJudge } = { v2: POLICY_V2_DEFAULT };
    if (SIMULATION) {
      const marker = /\s*\[agent:(\{.*\})\]\s*$/.exec(text);
      if (marker) {
        try {
          const script = JSON.parse(marker[1]);
          scripted = VectorAgentService.scriptedBrain(script);
          // A scripted run opts into v2 explicitly and brings its own judge;
          // otherwise it stays on v1, since the harness has no real model to
          // build a judge from. The production default (POLICY_V2_DEFAULT) is
          // for real traffic, not these deterministic scripts.
          policy = script.policy_v2 ? { v2: true, judge: VectorAgentService.scriptedJudge(script.policy_blocks ?? []) } : { v2: false };
        } catch {
          scripted = null;
        }
        text = text.slice(0, marker.index).trim();
      }
    }
    const brain = scripted ?? (SIMULATION ? null : await this.agent.realBrain(userId));
    if (brain) {
      await this.record(userId, 'user', text, undefined, conversation.id);
      try {
        const reply = await this.runAgent(userId, brain, text, conversation.id, policy);
        await this.record(userId, 'assistant', reply.text, reply, conversation.id);
        return { message: 'Chat reply', data: { ...reply, conversation_id: conversation.id } };
      } catch (error) {
        // The model could not be reached (credits, outage): fall back to the
        // simple built-in understanding rather than leaving the chat dead.
        Logger.warn('[CommandChat] agent failed, using the built-in fallback:', error);
        const context = await this.recentContext(userId, conversation.id);
        const intent = classifyLocally(await this.joinWithPending(userId, text, context.pending));
        const reply = await this.act(userId, text, intent, context.lastMissionDevices, conversation.id);
        reply.text = `(AI model unavailable — ${(error as Error)?.message ?? 'error'}. Used the basic mode.) ${reply.text}`;
        await this.record(userId, 'assistant', reply.text, reply, conversation.id);
        return { message: 'Chat reply', data: { ...reply, conversation_id: conversation.id } };
      }
    }

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
    await this.record(userId, 'user', text, undefined, conversation.id);
    const context = await this.recentContext(userId, conversation.id);
    // Finish a question the chat just asked: "stop youtube" -> "which phone?" ->
    // "Nokia" is one request, not two unrelated messages.
    const effective = await this.joinWithPending(userId, text, context.pending);
    const intent = await this.classify(userId, effective, context.lines, stub);
    const reply = await this.act(userId, effective, intent, context.lastMissionDevices, conversation.id);
    await this.record(userId, 'assistant', reply.text, reply, conversation.id);
    return { message: 'Chat reply', data: { ...reply, conversation_id: conversation.id } };
  }

  private pendingFor(userId: number, conversationId?: number): { token: string; summary: string }[] {
    const now = Date.now();
    return [...this.pending.entries()]
      .filter(([, p]) => p.userId === userId && now - p.at <= CONFIRM_TTL_MS && (conversationId === undefined || p.conversationId === undefined || p.conversationId === conversationId))
      .map(([token, p]) => ({ token, summary: p.summary }));
  }

  private async agentContext(userId: number, conversationId?: number) {
    const convoId = conversationId ?? (await this.latestConversationId(userId));
    const rows = convoId
      ? await this.messageRepo.find({ where: { user_id: userId, conversation_id: convoId }, order: { id: 'DESC' }, take: 24 })
      : [];
    const context = await this.recentContext(userId, convoId ?? 0);
    const history = rows
      .slice(1)
      .reverse()
      .map((r) => ({ role: r.role as 'user' | 'assistant', text: r.text.slice(0, 600) }));
    return { history, lastMissionDevices: context.lastMissionDevices };
  }

  /** The policy check for v2: the scripted one if given, else the real model. */
  private async policyFor(userId: number, policy: { v2: boolean; judge?: PolicyJudge }) {
    if (!policy.v2) return { policy: 'v1' as const };
    return { policy: 'v2' as const, judge: policy.judge ?? (await this.agent.realJudge(userId)) ?? undefined };
  }

  private async runAgent(
    userId: number,
    brain: Brain,
    text: string,
    conversationId?: number,
    policy: { v2: boolean; judge?: PolicyJudge } = { v2: POLICY_V2_DEFAULT },
  ): Promise<ChatReply> {
    const base = await this.agentContext(userId, conversationId);
    const pending = this.pendingFor(userId, conversationId);
    const result = await this.agent.run(brain, text, { userId, ...base, pending, ...(await this.policyFor(userId, policy)) });

    if (result.confirmToken) return this.applyToken(userId, result.confirmToken);
    if (result.cancelledPending) for (const p of pending) this.pending.delete(p.token);
    if (result.ask) {
      return { kind: 'clarify', text: result.ask.question, quick_replies: result.ask.options.length ? result.ask.options : undefined };
    }
    if (result.proposal) {
      const token = crypto.randomBytes(12).toString('hex');
      this.pending.set(token, { userId, conversationId, action: { type: 'agent', proposal: result.proposal.action }, summary: result.proposal.summary, at: Date.now() });
      const text = result.text.includes(result.proposal.summary) ? result.text : `${result.text}\n\n${result.proposal.summary}.`;
      return { kind: 'confirm', text, confirm_token: token, plan: result.proposal.plan };
    }
    if (result.mission) return { kind: 'mission', text: result.text, mission: result.mission, extra_missions: result.extraMissions?.length ? result.extraMissions : undefined };
    if (result.screens?.length) return { kind: 'screens', text: result.text, screens: result.screens };
    return { kind: 'answer', text: result.text };
  }

  /** What Vector would do with a message, without doing it — for the eval script. */
  async dryRun(
    userId: number,
    message: string,
    history?: { role: 'user' | 'assistant'; text: string }[],
    pendingOverride?: string[],
    policyChoice?: 'v1' | 'v2',
  ): Promise<ApiResponse> {
    let policy: { v2: boolean; judge?: PolicyJudge } = { v2: policyChoice ? policyChoice === 'v2' : POLICY_V2_DEFAULT };
    let text = String(message ?? '').trim();
    let brain: Brain | null = null;
    if (SIMULATION) {
      const marker = /\s*\[agent:(\{.*\})\]\s*$/.exec(text);
      if (marker) {
        const script = JSON.parse(marker[1]);
        brain = VectorAgentService.scriptedBrain(script);
        if (script.policy_v2) policy = { v2: true, judge: VectorAgentService.scriptedJudge(script.policy_blocks ?? []) };
        text = text.slice(0, marker.index).trim();
      }
    } else {
      brain = await this.agent.realBrain(userId);
    }
    if (!brain) throw new AppError('No AI model is configured for the chat', 400);
    const base = await this.agentContext(userId);
    const result = await this.agent.run(brain, text, {
      userId,
      history: history ?? base.history,
      lastMissionDevices: base.lastMissionDevices,
      pending: pendingOverride ? pendingOverride.map((summary) => ({ summary })) : this.pendingFor(userId),
      dryRun: true,
      ...(await this.policyFor(userId, policy)),
    });
    return {
      message: 'Dry run',
      data: {
        policy: policy.v2 ? 'v2' : 'v1',
        text: result.text,
        calls: result.calls,
        proposal: result.proposal?.summary ?? null,
        ask: result.ask ?? null,
        skipped: result.skipped ?? [],
        planned: result.planned?.map((p) => p.instruction) ?? [],
      },
    };
  }

  /**
   * Retry / Continue / Run again from a mission card. Goes through the chat so
   * the new mission lands in the transcript like any other reply.
   */
  async rerun(userId: number, missionId: number, options: { scope?: 'failed' | 'all'; continue?: boolean }): Promise<ApiResponse> {
    const label = options.continue ? 'Continue' : options.scope === 'all' ? 'Run again' : 'Retry failed phones';
    const conversationId = await this.latestConversationId(userId);
    await this.record(userId, 'user', label, undefined, conversationId);
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
    await this.record(userId, 'assistant', reply.text, reply, conversationId);
    return { message: 'Chat reply', data: { ...reply, conversation_id: conversationId } };
  }

  /** The conversation so far, oldest first, so a reload picks up where it left off. */
  async history(userId: number, conversationId?: number, limit = 100): Promise<ApiResponse> {
    // Default to the most recent conversation, so opening the page shows it.
    const conversation = conversationId
      ? await this.conversationRepo.findOne({ where: { id: conversationId, user_id: userId } })
      : await this.conversationRepo.findOne({ where: { user_id: userId }, order: { last_message_at: 'DESC' } });
    if (!conversation) return { message: 'Chat history', data: { conversation_id: null, turns: [] } };
    const rows = await this.messageRepo.find({
      where: { user_id: userId, conversation_id: conversation.id },
      order: { id: 'DESC' },
      take: Math.max(1, Math.min(300, limit)),
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
      // Screens from before they were stored have nothing to show — keep the caption.
      if (reply.kind === 'screens' && !reply.screens?.some((s) => s.shot_id)) reply = { kind: 'answer', text: reply.text };
      return { id: row.id, role: 'assistant' as const, reply };
    });
    return { message: 'Chat history', data: { conversation_id: conversation.id, turns } };
  }

  /** The sidebar list: threads newest first. */
  async listConversations(userId: number): Promise<ApiResponse> {
    const rows = await this.conversationRepo.find({ where: { user_id: userId }, order: { last_message_at: 'DESC' }, take: 100 });
    return { message: 'Conversations', data: rows.map((c) => ({ id: c.id, title: c.title, last_message_at: c.last_message_at, created_at: c.created_at })) };
  }

  /** Start an empty thread; the first message names it. */
  async newConversation(userId: number): Promise<ApiResponse> {
    const created = await this.conversationRepo.save(this.conversationRepo.create({ user_id: userId, title: 'New chat' }));
    return { message: 'Conversation created', data: { id: created.id, title: created.title } };
  }

  async renameConversation(userId: number, id: number, title: string): Promise<ApiResponse> {
    const clean = title.trim().slice(0, 120) || 'New chat';
    const res = await this.conversationRepo.update({ id, user_id: userId }, { title: clean });
    if (!res.affected) throw new AppError('Chat not found', 404);
    return { message: 'Renamed', data: { id, title: clean } };
  }

  async deleteConversation(userId: number, id: number): Promise<ApiResponse> {
    const conversation = await this.conversationRepo.findOne({ where: { id, user_id: userId } });
    if (!conversation) throw new AppError('Chat not found', 404);
    await this.messageRepo.delete({ user_id: userId, conversation_id: id });
    await this.shotRepo.delete({ user_id: userId, conversation_id: id });
    await this.conversationRepo.delete({ id, user_id: userId });
    return { message: 'Deleted', data: { id } };
  }

  /**
   * Finds the thread to write to, making one when needed, and titles a fresh
   * thread from its first user message.
   */
  private async resolveConversation(userId: number, conversationId: number | undefined, firstText: string): Promise<Conversation> {
    if (conversationId) {
      const existing = await this.conversationRepo.findOne({ where: { id: conversationId, user_id: userId } });
      if (existing) {
        if (existing.title === 'New chat') await this.conversationRepo.update({ id: existing.id }, { title: titleFrom(firstText) });
        return existing;
      }
    }
    // No id given (an API caller that doesn't track threads, or a very first
    // message): continue the user's most recent thread if it was active in the
    // last 30 min, else start a fresh one. The web app always sends an id, so
    // this only affects direct API use.
    if (conversationId === undefined) {
      const recent = await this.conversationRepo.findOne({ where: { user_id: userId }, order: { last_message_at: 'DESC' } });
      if (recent && Date.now() - new Date(recent.last_message_at).getTime() < 30 * 60_000) {
        if (recent.title === 'New chat') await this.conversationRepo.update({ id: recent.id }, { title: titleFrom(firstText) });
        return recent;
      }
    }
    return this.conversationRepo.save(this.conversationRepo.create({ user_id: userId, title: titleFrom(firstText) }));
  }

  /** What the chat needs from the conversation so far. */
  private async recentContext(userId: number, conversationId: number): Promise<{
    lines: string[];
    pending: ChatReply['pending'] | null;
    lastMissionDevices: number[];
  }> {
    const rows = await this.messageRepo.find({ where: { user_id: userId, conversation_id: conversationId }, order: { id: 'DESC' }, take: 20 });
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

  private async record(userId: number, role: 'user' | 'assistant', text: string, reply?: ChatReply, conversationId?: number): Promise<void> {
    try {
      const missionId = (reply?.mission as { id?: number } | undefined)?.id ?? null;
      // The (large) images never go into the transcript row: each is saved on
      // its own and the reply keeps only its id, so a reload shows the same
      // screens while the history itself stays small.
      const toStore = reply?.kind === 'screens' ? { ...reply, screens: await this.storeShots(userId, conversationId, reply.screens ?? []) } : reply;
      await this.messageRepo.save(
        this.messageRepo.create({ user_id: userId, conversation_id: conversationId ?? null, role, text: text.slice(0, 8000), reply: toStore ? JSON.stringify(toStore) : null, mission_id: missionId }),
      );
      if (conversationId) await this.conversationRepo.update({ id: conversationId, user_id: userId }, { last_message_at: new Date() });
    } catch (error) {
      // Losing a transcript line must never break the chat itself.
      Logger.warn('[CommandChat] Could not save chat message:', error);
    }
  }

  /** Saves each captured screen and returns the reply's screens with ids in place of images. */
  private async storeShots(userId: number, conversationId: number | undefined, shots: import('./VectorAgentService').PhoneShot[]) {
    const out: import('./VectorAgentService').PhoneShot[] = [];
    for (const shot of shots) {
      if (!shot.base64) {
        out.push({ device_name: shot.device_name, hw_id: shot.hw_id, error: shot.error });
        continue;
      }
      try {
        const saved = await this.shotRepo.save(
          this.shotRepo.create({ user_id: userId, conversation_id: conversationId ?? null, device_name: shot.device_name.slice(0, 150), image: shot.base64 }),
        );
        out.push({ device_name: shot.device_name, hw_id: shot.hw_id, shot_id: saved.id });
      } catch (error) {
        Logger.warn('[CommandChat] Could not store a chat screen:', error);
        out.push({ device_name: shot.device_name, hw_id: shot.hw_id, error: 'Not saved' });
      }
    }
    void this.sweepOldShots();
    return out;
  }

  /** Drops screens older than the retention window, at most once an hour. */
  private async sweepOldShots(): Promise<void> {
    if (Date.now() - this.lastShotSweep < 60 * 60_000) return;
    this.lastShotSweep = Date.now();
    try {
      await this.shotRepo
        .createQueryBuilder()
        .delete()
        .where('created_at < :cutoff', { cutoff: new Date(Date.now() - SCREEN_SHOT_TTL_MS) })
        .execute();
    } catch (error) {
      Logger.warn('[CommandChat] Could not sweep old chat screens:', error);
    }
  }

  /** One stored chat screen, only for its owner. */
  async screenShot(userId: number, shotId: number): Promise<ApiResponse> {
    const shot = await this.shotRepo.findOne({ where: { id: shotId, user_id: userId }, select: ['id', 'device_name', 'image', 'created_at'] });
    if (!shot) throw new AppError('This screen is no longer available', 404);
    return { message: 'Chat screen', data: { id: shot.id, device_name: shot.device_name, base64: shot.image, captured_at: shot.created_at } };
  }

  async confirm(userId: number, token: string): Promise<ApiResponse> {
    const reply = await this.applyToken(userId, token);
    const conversationId = await this.latestConversationId(userId);
    await this.record(userId, 'assistant', reply.text, reply, conversationId);
    return { message: 'Applied', data: { ...reply, conversation_id: conversationId } };
  }

  private async latestConversationId(userId: number): Promise<number | undefined> {
    const c = await this.conversationRepo.findOne({ where: { user_id: userId }, order: { last_message_at: 'DESC' } });
    return c?.id;
  }

  /** Applies a pending proposal; the caller records the reply. */
  private async applyToken(userId: number, token: string): Promise<ChatReply> {
    const pending = this.pending.get(token);
    if (!pending || pending.userId !== userId) throw new AppError('Nothing to confirm (it may have expired)', 404);
    this.pending.delete(token);
    if (Date.now() - pending.at > CONFIRM_TTL_MS) throw new AppError('That confirmation expired — ask again', 410);

    let reply: ChatReply = { kind: 'answer', text: `Done — ${pending.summary}.` };
    if (pending.action.type === 'agent') {
      try {
        const mission = await this.agent.apply(userId, pending.action.proposal);
        if (mission) reply = { kind: 'mission', text: 'Confirmed — running it now.', mission };
      } catch (error) {
        reply = { kind: 'error', text: (error as AppError)?.message ?? 'Could not apply it' };
      }
      return reply;
    }
    await this.apply(userId, pending.action);
    if (pending.thenMission) {
      try {
        const result = await this.missionService.create(userId, { request: pending.thenMission });
        reply = { kind: 'mission', text: `Done — ${pending.summary}. Now running the task — watch it below.`, mission: result.data };
      } catch (error) {
        reply = { kind: 'error', text: `${pending.summary} is done, but the task could not start: ${(error as AppError)?.message ?? 'unknown error'}` };
      }
    }
    return reply;
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

  private async act(userId: number, text: string, intent: ChatIntent, lastMissionDevices: number[] = [], conversationId?: number): Promise<ChatReply> {
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
        this.pending.set(token, { userId, conversationId, action: built.action, summary: built.summary, at: Date.now(), thenMission });
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

  private async apply(userId: number, action: PendingAction | { type: 'agent'; proposal: ProposedAction }): Promise<void> {
    if (action.type === 'agent') return;
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

/** A short thread title from the first message. */
function titleFrom(text: string): string {
  const clean = text.replace(/\[(agent|ai):.*$/i, '').replace(/\s+/g, ' ').trim();
  const words = clean.split(' ').slice(0, 7).join(' ');
  return (words || 'New chat').slice(0, 60);
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
