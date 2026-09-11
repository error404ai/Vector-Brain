import envConfig from '@/config/envConfig';
import { AgentTask } from '@/entities/AgentTask';
import { AndroidDevice } from '@/entities/AndroidDevice';
import { AndroidTaskLog } from '@/entities/AndroidTaskLog';
import { TelegramLink } from '@/entities/TelegramLink';
import AppError from '@/helpers/AppError';
import Logger from '@/logger/index';
import { AppDataSource } from '@/loaders/database';
import { AndroidDeviceService } from '@/services/android/AndroidDeviceService';
import { AndroidGatewayService } from '@/services/android/AndroidGatewayService';
import { AndroidPlannerService } from '@/services/android/AndroidPlannerService';
import crypto from 'crypto';
import { Service } from 'typedi';

/** The slice of Telegram's Update object this bot reads. */
interface TelegramUser {
  id: number;
  username?: string;
}

interface TelegramMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: TelegramUser;
  text?: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface WatchedRun {
  chatId: string;
  hardwareId: string;
  deviceName: string;
  prompt: string;
  startedAt: number;
}

const API_BASE = 'https://api.telegram.org';
const LINK_CODE_TTL_MS = 10 * 60 * 1000;
const LINK_CODE_LENGTH = 8;
/** No 0/O or 1/I, so a code read off a screen cannot be mistyped. */
const LINK_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
/** Wrong link codes allowed per chat per window, against guessing. */
const MAX_LINK_FAILURES = 5;
const LINK_FAILURE_WINDOW_MS = 10 * 60 * 1000;
const TEXT_LIMIT = 4000;
const CAPTION_LIMIT = 1000;
/** Watched runs older than this are dropped even if no end event arrived. */
const WATCH_TTL_MS = 12 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;

const COMMANDS: { command: string; description: string }[] = [
  { command: 'run', description: 'Run a task: /run open YouTube and play lofi' },
  { command: 'status', description: 'What the phone is doing right now' },
  { command: 'stop', description: 'Stop the running task' },
  { command: 'devices', description: 'List your phones' },
  { command: 'use', description: 'Pick the default phone: /use 2' },
  { command: 'pair', description: 'Get a code to pair a new phone' },
  { command: 'rename', description: 'Rename a phone: /rename 2 Office phone' },
  { command: 'unpair', description: 'Remove a phone' },
  { command: 'unlink', description: 'Disconnect this chat from your account' },
  { command: 'help', description: 'All commands' },
];

const HELP_TEXT = [
  'Vector Brain — control your phones from here.',
  '',
  '/run <task> — run on your default phone',
  '/run #2 <task> — run on phone 2',
  '/status [n] — what the phone is doing',
  '/stop [n] — stop the running task',
  '/devices — list your phones',
  '/use <n> — set the default phone',
  '/pair [name] — pairing code for a new phone',
  '/rename <n> <name> — rename a phone',
  '/unpair <n> — remove a phone',
  '/unlink — disconnect this chat',
].join('\n');

/**
 * Telegram bot for Vector Brain.
 *
 * Webhook only (no polling), and no SDK: the Bot API is plain HTTPS + JSON, and
 * the Docker build cannot take new npm packages. One bot serves every user; a
 * chat is tied to an account through a one-time code from the dashboard.
 */
@Service()
export class TelegramService {
  private linkRepo = AppDataSource.getRepository(TelegramLink);
  private deviceRepo = AppDataSource.getRepository(AndroidDevice);
  private taskRepo = AppDataSource.getRepository(AgentTask);
  private logRepo = AppDataSource.getRepository(AndroidTaskLog);

  private botUsername: string | null = null;
  private recentUpdateIds: number[] = [];
  private linkFailures = new Map<string, { count: number; firstAt: number }>();
  /** Runs started from Telegram, reported back to their chat when they end. */
  private watchedRuns = new Map<number, WatchedRun>();
  /** Latest frame per device, kept only while a watched run is going. */
  private lastFrames = new Map<string, string>();

  constructor(
    private plannerService: AndroidPlannerService,
    private deviceService: AndroidDeviceService,
    private gatewayService: AndroidGatewayService,
  ) {
    this.gatewayService.onBroadcast((_userId, event, payload) => this.onUserEvent(event, payload));
  }

  isEnabled(): boolean {
    return Boolean(envConfig.telegramBotToken);
  }

  /** Called once at boot: learn the bot's name, point Telegram at our webhook. */
  async start(): Promise<void> {
    if (!this.isEnabled()) {
      Logger.info('[Telegram] TELEGRAM_BOT_TOKEN not set, bot disabled');
      return;
    }

    const me = await this.api<{ username?: string }>('getMe', {});
    this.botUsername = me?.username ?? null;

    const base = (envConfig.telegramWebhookBaseUrl || '').replace(/\/+$/, '');
    if (!base.startsWith('https://')) {
      Logger.warn('[Telegram] Webhook not registered: set APP_URL (or TELEGRAM_WEBHOOK_BASE_URL) to your public https URL');
      return;
    }

    const registered = await this.api('setWebhook', {
      url: `${base}/api/telegram/webhook`,
      secret_token: this.webhookSecret(),
      allowed_updates: ['message'],
    });
    await this.api('setMyCommands', { commands: COMMANDS });
    Logger.info(
      `[Telegram] Bot ${this.botUsername ? `@${this.botUsername}` : '(unknown name)'} ${
        registered ? 'webhook registered' : 'webhook registration FAILED'
      }`,
    );
  }

  /** Telegram echoes this back in a header on every webhook call. */
  verifyWebhookSecret(received: unknown): boolean {
    if (!this.isEnabled() || typeof received !== 'string') return false;
    const expected = Buffer.from(this.webhookSecret());
    const actual = Buffer.from(received);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }

  // ---------------------------------------------------------------------------
  // Dashboard side
  // ---------------------------------------------------------------------------

  async getStatus(userId: number) {
    const link = await this.linkRepo.findOne({ where: { user_id: userId } });
    return {
      message: 'Telegram status',
      data: {
        enabled: this.isEnabled(),
        botUsername: this.botUsername,
        linked: Boolean(link?.chat_id),
        telegramUsername: link?.chat_id ? link.telegram_username : null,
        linkedAt: link?.chat_id ? link.linked_at : null,
      },
    };
  }

  async createLinkCode(userId: number) {
    if (!this.isEnabled()) throw new AppError('The Telegram bot is not configured on this server.', 400);

    let link = await this.linkRepo.findOne({ where: { user_id: userId } });
    if (!link) link = this.linkRepo.create({ user_id: userId });

    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
    // The column is unique; a collision is astronomically unlikely, but retry
    // rather than surface a database error if it ever happens.
    for (let attempt = 0; attempt < 3; attempt++) {
      link.link_code = this.randomCode();
      link.link_code_expires_at = expiresAt;
      try {
        await this.linkRepo.save(link);
        break;
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }

    return {
      message: 'Link code created',
      data: {
        code: link.link_code,
        expiresAt: expiresAt.toISOString(),
        botUsername: this.botUsername,
        deepLink: this.botUsername ? `https://t.me/${this.botUsername}?start=${link.link_code}` : null,
      },
    };
  }

  async unlink(userId: number) {
    const link = await this.linkRepo.findOne({ where: { user_id: userId } });
    if (!link) return { message: 'Telegram was not linked' };

    if (link.chat_id) {
      await this.send(link.chat_id, 'This chat was disconnected from Vector Brain from the dashboard.');
    }
    await this.linkRepo.delete(link.id);
    return { message: 'Telegram unlinked' };
  }

  // ---------------------------------------------------------------------------
  // Bot side
  // ---------------------------------------------------------------------------

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (!update || typeof update.update_id !== 'number') return;

    // Telegram re-delivers when it thinks a call failed. Handle each id once.
    if (this.recentUpdateIds.includes(update.update_id)) return;
    this.recentUpdateIds.push(update.update_id);
    if (this.recentUpdateIds.length > 500) this.recentUpdateIds.shift();

    const message = update.message;
    if (!message?.text || !message.chat) return;
    const chatId = String(message.chat.id);

    // Groups would let anyone in them drive your phone.
    if (message.chat.type !== 'private') {
      await this.send(chatId, 'For your safety this bot only works in a private chat.');
      return;
    }

    try {
      await this.handleText(chatId, message.from, message.text);
    } catch (error: any) {
      // AppError messages are written for users (offline device, busy, ...).
      const text = error instanceof AppError ? error.message : 'Something went wrong. Please try again.';
      if (!(error instanceof AppError)) Logger.error('[Telegram] Command failed', error);
      await this.send(chatId, text);
    }
  }

  private async handleText(chatId: string, from: TelegramUser | undefined, rawText: string): Promise<void> {
    const text = rawText.trim();
    const match = text.match(/^\/([a-zA-Z_]+)(?:@\S+)?(?:\s+([\s\S]*))?$/);
    const command = match ? match[1].toLowerCase() : '';
    const args = match ? (match[2] || '').trim() : '';

    if (command === 'start' && args) return this.linkChat(chatId, from, args);
    if (command === 'link') {
      if (!args) return this.send(chatId, 'Send the code from the dashboard like this: /link ABCD2345');
      return this.linkChat(chatId, from, args);
    }

    const link = await this.linkRepo.findOne({ where: { chat_id: chatId } });
    if (!link) {
      return this.send(
        chatId,
        'This chat is not linked to a Vector Brain account yet.\n\nIn the dashboard open Settings → Telegram → Connect, then send the code here with /link CODE.',
      );
    }

    switch (command) {
      case 'start':
      case 'help':
        return this.send(chatId, HELP_TEXT);
      case 'devices':
        return this.cmdDevices(chatId, link);
      case 'use':
        return this.cmdUse(chatId, link, args);
      case 'run':
        return this.cmdRun(chatId, link, args);
      case 'status':
        return this.cmdStatus(chatId, link, args);
      case 'stop':
        return this.cmdStop(chatId, link, args);
      case 'pair':
        return this.cmdPair(chatId, link, args);
      case 'rename':
        return this.cmdRename(chatId, link, args);
      case 'unpair':
        return this.cmdUnpair(chatId, link, args);
      case 'unlink':
        await this.linkRepo.delete(link.id);
        return this.send(chatId, 'Unlinked. This chat can no longer control your phones.');
      default:
        return this.send(
          chatId,
          command ? `Unknown command /${command}. Send /help.` : 'To start a task send /run followed by what to do. /help lists everything.',
        );
    }
  }

  private async linkChat(chatId: string, from: TelegramUser | undefined, rawCode: string): Promise<void> {
    const failures = this.linkFailures.get(chatId);
    if (failures && Date.now() - failures.firstAt < LINK_FAILURE_WINDOW_MS && failures.count >= MAX_LINK_FAILURES) {
      return this.send(chatId, 'Too many wrong codes. Wait 10 minutes and try again.');
    }

    const code = rawCode.trim().toUpperCase();
    const link = /^[A-Z0-9]{4,16}$/.test(code) ? await this.linkRepo.findOne({ where: { link_code: code } }) : null;
    const expired = !link?.link_code_expires_at || new Date(link.link_code_expires_at).getTime() < Date.now();

    if (!link || expired) {
      this.noteLinkFailure(chatId);
      return this.send(chatId, 'That code is wrong or has expired. Create a new one in the dashboard (Settings → Telegram).');
    }

    // A chat belongs to one account. Linking it here detaches it elsewhere.
    const previous = await this.linkRepo.findOne({ where: { chat_id: chatId } });
    if (previous && previous.id !== link.id) await this.linkRepo.delete(previous.id);

    link.chat_id = chatId;
    link.telegram_username = from?.username ? from.username.slice(0, 64) : null;
    link.link_code = null;
    link.link_code_expires_at = null;
    link.linked_at = new Date();
    await this.linkRepo.save(link);
    this.linkFailures.delete(chatId);

    const devices = await this.userDevices(link.user_id);
    const next =
      devices.length === 0
        ? 'You have no phones paired yet. Send /pair to get a pairing code.'
        : `You have ${devices.length} phone${devices.length === 1 ? '' : 's'}. Send /devices to see them, or /run <task> to start.`;
    return this.send(chatId, `Linked to your Vector Brain account. ${next}`);
  }

  private async cmdDevices(chatId: string, link: TelegramLink): Promise<void> {
    const devices = await this.userDevices(link.user_id);
    if (devices.length === 0) return this.send(chatId, 'No phones paired yet. Send /pair to get a pairing code.');

    const lines = devices.map((device, index) => {
      const online = this.gatewayService.isDeviceConnected(device.device_id) ? 'online' : 'offline';
      const running = this.plannerService.getActiveTaskIdForDevice(device.id) ? ' · running a task' : '';
      const isDefault = this.defaultDevice(link, devices)?.id === device.id ? ' · default' : '';
      return `${index + 1}. ${device.device_name} — ${online}${running}${isDefault}`;
    });
    const hint = devices.length > 1 ? '\n\nPick the default for /run with /use <number>.' : '';
    return this.send(chatId, `Your phones:\n${lines.join('\n')}${hint}`);
  }

  private async cmdUse(chatId: string, link: TelegramLink, args: string): Promise<void> {
    const devices = await this.userDevices(link.user_id);
    const device = this.deviceByNumber(devices, args);
    link.default_device_id = device.id;
    await this.linkRepo.save(link);
    return this.send(chatId, `/run will now use ${device.device_name}.`);
  }

  private async cmdRun(chatId: string, link: TelegramLink, args: string): Promise<void> {
    // "/run #2 open youtube" targets phone 2. A bare number is not taken as a
    // device because prompts often start with one ("5 minute timer").
    const targeted = args.match(/^#(\d+)\s+([\s\S]+)$/);
    const prompt = (targeted ? targeted[2] : args).trim();
    if (!prompt) return this.send(chatId, 'Tell me what to do, e.g.\n/run open YouTube and play lofi music');

    const devices = await this.userDevices(link.user_id);
    const device = targeted ? this.deviceByNumber(devices, targeted[1]) : this.requireDefaultDevice(link, devices);

    await this.api('sendChatAction', { chat_id: chatId, action: 'typing' });
    const result = await this.plannerService.runTask(prompt, device.id, link.user_id);
    const taskId = Number(result?.data?.taskId);

    if (Number.isFinite(taskId)) {
      this.pruneWatchedRuns();
      this.watchedRuns.set(taskId, {
        chatId,
        hardwareId: device.device_id,
        deviceName: device.device_name,
        prompt,
        startedAt: Date.now(),
      });
    }
    return this.send(chatId, `Started on ${device.device_name}. I'll send the result here when it finishes. /stop cancels it.`);
  }

  private async cmdStatus(chatId: string, link: TelegramLink, args: string): Promise<void> {
    const devices = await this.userDevices(link.user_id);
    const device = args ? this.deviceByNumber(devices, args) : this.requireDefaultDevice(link, devices);
    const online = this.gatewayService.isDeviceConnected(device.device_id);
    const taskId = this.plannerService.getActiveTaskIdForDevice(device.id);

    if (!taskId) return this.send(chatId, `${device.device_name} is ${online ? 'online and idle' : 'offline'}.`);

    const task = await this.taskRepo.findOne({ where: { id: taskId } });
    const steps = await this.logRepo.count({ where: { agent_task_id: taskId } });
    const watched = this.watchedRuns.get(taskId);
    const since = watched?.startedAt ?? (task?.created_at ? new Date(task.created_at).getTime() : Date.now());
    const prompt = watched?.prompt ?? task?.prompt ?? '';
    return this.send(
      chatId,
      `${device.device_name} is running a task for ${this.formatDuration(Date.now() - since)}, ${steps} step${
        steps === 1 ? '' : 's'
      } so far:\n“${this.clip(prompt, 300)}”`,
    );
  }

  private async cmdStop(chatId: string, link: TelegramLink, args: string): Promise<void> {
    const devices = await this.userDevices(link.user_id);
    const device = args ? this.deviceByNumber(devices, args) : this.requireDefaultDevice(link, devices);
    const taskId = this.plannerService.getActiveTaskIdForDevice(device.id);
    if (!taskId) return this.send(chatId, `Nothing is running on ${device.device_name}.`);

    const watchedHere = this.watchedRuns.get(taskId)?.chatId === chatId;
    await this.plannerService.cancelTask(taskId, link.user_id);
    // A run started from this chat gets its own "Stopped" report from the
    // cancel event; only confirm here for runs started elsewhere.
    if (!watchedHere) return this.send(chatId, `Stopped the task on ${device.device_name}.`);
  }

  private async cmdPair(chatId: string, link: TelegramLink, args: string): Promise<void> {
    const name = (args || 'Android phone').slice(0, 150);
    const result = await this.deviceService.requestPairingCode({ device_name: name }, link.user_id);
    const code = result?.data?.pairingCode;
    if (!code) throw new AppError('Could not create a pairing code. Please try again.', 500);
    return this.send(
      chatId,
      `Pairing code for “${name}”: ${code}\n\nOpen the Vector companion app on the phone and enter this code. It is valid for 10 minutes.`,
    );
  }

  private async cmdRename(chatId: string, link: TelegramLink, args: string): Promise<void> {
    const match = args.match(/^(\d+)\s+([\s\S]+)$/);
    if (!match) return this.send(chatId, 'Usage: /rename <number> <new name>, e.g. /rename 2 Office phone');
    const name = match[2].trim();
    if (!name || name.length > 150) return this.send(chatId, 'The name must be 1 to 150 characters.');

    const devices = await this.userDevices(link.user_id);
    const device = this.deviceByNumber(devices, match[1]);
    await this.deviceService.renameDevice(device.id, link.user_id, name);
    return this.send(chatId, `Renamed “${device.device_name}” to “${name}”.`);
  }

  private async cmdUnpair(chatId: string, link: TelegramLink, args: string): Promise<void> {
    const [numberArg, confirmArg] = args.split(/\s+/);
    if (!numberArg) return this.send(chatId, 'Usage: /unpair <number>. See /devices for the numbers.');

    const devices = await this.userDevices(link.user_id);
    const device = this.deviceByNumber(devices, numberArg);

    if (this.plannerService.getActiveTaskIdForDevice(device.id)) {
      return this.send(chatId, `${device.device_name} is running a task. Stop it first with /stop ${numberArg}.`);
    }
    if ((confirmArg || '').toLowerCase() !== 'confirm') {
      return this.send(
        chatId,
        `This removes “${device.device_name}”. To use it again you will have to pair it again.\n\nTo confirm send: /unpair ${numberArg} confirm`,
      );
    }

    this.gatewayService.disconnectDevice(device.device_id);
    await this.deviceService.unpairDevice(device.id, link.user_id);
    return this.send(chatId, `Removed “${device.device_name}”.`);
  }

  // ---------------------------------------------------------------------------
  // Run reporting
  // ---------------------------------------------------------------------------

  private onUserEvent(event: string, payload: any): void {
    if (this.watchedRuns.size === 0) return;

    if (event === 'device:screen_capture') {
      const hardwareId = payload?.deviceId;
      const frame = payload?.result?.screenCapture?.base64Data;
      if (typeof hardwareId !== 'string' || typeof frame !== 'string') return;
      for (const run of this.watchedRuns.values()) {
        if (run.hardwareId === hardwareId) {
          this.lastFrames.set(hardwareId, frame);
          break;
        }
      }
      return;
    }

    if (event !== 'task:completed' && event !== 'task:error' && event !== 'task:cancelled') return;
    const taskId = Number(payload?.taskId);
    const run = this.watchedRuns.get(taskId);
    if (!run) return;

    this.watchedRuns.delete(taskId);
    const frame = this.lastFrames.get(run.hardwareId);
    const deviceStillWatched = Array.from(this.watchedRuns.values()).some((other) => other.hardwareId === run.hardwareId);
    if (!deviceStillWatched) this.lastFrames.delete(run.hardwareId);

    void this.reportFinished(run, event, payload, frame).catch((error) =>
      Logger.warn('[Telegram] Could not report a finished run', error),
    );
  }

  private async reportFinished(run: WatchedRun, event: string, payload: any, frame?: string): Promise<void> {
    if (event === 'task:cancelled') {
      return this.send(run.chatId, `Stopped on ${run.deviceName}: “${this.clip(run.prompt, 200)}”`);
    }
    if (event === 'task:error') {
      return this.send(run.chatId, `Failed on ${run.deviceName}: ${this.clip(String(payload?.error || 'unknown error'), 1500)}`);
    }

    const steps = Number(payload?.totalSteps) || 0;
    const header = `${payload?.success ? 'Done' : 'Finished with problems'} on ${run.deviceName} · ${steps} step${
      steps === 1 ? '' : 's'
    } · ${this.formatDuration(Date.now() - run.startedAt)}`;
    const body = String(payload?.message || '').trim();
    const text = body ? `${header}\n\n${body}` : header;

    if (frame && text.length <= CAPTION_LIMIT) {
      const sent = await this.sendPhoto(run.chatId, frame, text);
      if (sent) return;
    }
    await this.send(run.chatId, text);
    if (frame) await this.sendPhoto(run.chatId, frame);
  }

  private pruneWatchedRuns(): void {
    const now = Date.now();
    for (const [taskId, run] of this.watchedRuns) {
      if (now - run.startedAt > WATCH_TTL_MS) this.watchedRuns.delete(taskId);
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Paired phones in a stable order, so "phone 2" means the same phone every time. */
  private async userDevices(userId: number): Promise<AndroidDevice[]> {
    const devices = await this.deviceRepo.find({ where: { user_id: userId }, order: { id: 'ASC' } });
    return devices.filter((device) => !device.device_id.startsWith('pending_'));
  }

  private defaultDevice(link: TelegramLink, devices: AndroidDevice[]): AndroidDevice | undefined {
    if (link.default_device_id) {
      const chosen = devices.find((device) => device.id === link.default_device_id);
      if (chosen) return chosen;
    }
    return devices.length === 1 ? devices[0] : undefined;
  }

  private requireDefaultDevice(link: TelegramLink, devices: AndroidDevice[]): AndroidDevice {
    if (devices.length === 0) throw new AppError('No phones paired yet. Send /pair to get a pairing code.', 400);
    const device = this.defaultDevice(link, devices);
    if (!device) {
      throw new AppError(`You have ${devices.length} phones. Pick one with /use <number> (see /devices), or add #number to the command.`, 400);
    }
    return device;
  }

  private deviceByNumber(devices: AndroidDevice[], raw: string): AndroidDevice {
    const index = Number.parseInt(String(raw).replace(/^#/, ''), 10);
    const device = Number.isInteger(index) ? devices[index - 1] : undefined;
    if (!device) throw new AppError(`There is no phone number ${raw || '?'}. Send /devices to see the list.`, 400);
    return device;
  }

  private noteLinkFailure(chatId: string): void {
    const now = Date.now();
    const current = this.linkFailures.get(chatId);
    if (!current || now - current.firstAt > LINK_FAILURE_WINDOW_MS) {
      this.linkFailures.set(chatId, { count: 1, firstAt: now });
    } else {
      current.count += 1;
    }
  }

  private randomCode(): string {
    let code = '';
    for (let i = 0; i < LINK_CODE_LENGTH; i++) code += LINK_CODE_ALPHABET[crypto.randomInt(LINK_CODE_ALPHABET.length)];
    return code;
  }

  /** Derived from the token, so only one secret has to be configured. */
  private webhookSecret(): string {
    return crypto
      .createHash('sha256')
      .update(`vector-brain-telegram:${envConfig.telegramBotToken || ''}`)
      .digest('hex')
      .slice(0, 48);
  }

  private clip(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  }

  private formatDuration(ms: number): string {
    const seconds = Math.max(0, Math.round(ms / 1000));
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }

  private async send(chatId: string, text: string): Promise<void> {
    await this.api('sendMessage', {
      chat_id: chatId,
      text: this.clip(text, TEXT_LIMIT),
      disable_web_page_preview: true,
    });
  }

  private async sendPhoto(chatId: string, base64: string, caption?: string): Promise<boolean> {
    const form = new FormData();
    form.append('chat_id', chatId);
    // Copied into a plain Uint8Array: since TS 5.7 a Node Buffer is not a valid
    // BlobPart under the DOM typings, and a type error here fails the build.
    const bytes = new Uint8Array(Buffer.from(base64, 'base64'));
    form.append('photo', new Blob([bytes], { type: 'image/jpeg' }), 'screen.jpg');
    if (caption) form.append('caption', this.clip(caption, CAPTION_LIMIT));
    return (await this.api('sendPhoto', form)) !== null;
  }

  /**
   * One Bot API call. Never throws: a Telegram hiccup must not break a run or
   * the webhook. The URL carries the token, so it is never logged.
   */
  private async api<T = unknown>(method: string, body: Record<string, unknown> | FormData): Promise<T | null> {
    const token = envConfig.telegramBotToken;
    if (!token) return null;

    try {
      const isForm = body instanceof FormData;
      const response = await fetch(`${API_BASE}/bot${token}/${method}`, {
        method: 'POST',
        headers: isForm ? undefined : { 'Content-Type': 'application/json' },
        body: isForm ? body : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const json: any = await response.json().catch(() => null);
      if (!response.ok || !json?.ok) {
        Logger.warn(`[Telegram] ${method} failed (${response.status}): ${json?.description ?? 'no description'}`);
        return null;
      }
      return (json.result ?? true) as T;
    } catch (error: any) {
      Logger.warn(`[Telegram] ${method} request error: ${error?.message ?? error}`);
      return null;
    }
  }
}
