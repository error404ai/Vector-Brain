import Logger from '@/logger/index';
import type { TelegramUpdate } from '@/services/telegram/TelegramService';
import { TelegramService } from '@/services/telegram/TelegramService';
import { Authorized, Body, CurrentUser, Delete, Get, HttpCode, JsonController, Post, Req } from 'routing-controllers';
import { Service } from 'typedi';

@Service()
@JsonController('/telegram')
export class TelegramController {
  constructor(private telegramService: TelegramService) {}

  /**
   * Telegram calls this for every message sent to the bot.
   *
   * Public by design; the secret header Telegram echoes back is what proves
   * the call is genuine. It answers 200 straight away and works in the
   * background, because Telegram retries slow webhooks and /run can take a few
   * seconds to reach the phone.
   */
  @Post('/webhook')
  @HttpCode(200)
  webhook(@Req() req: any, @Body() update: TelegramUpdate) {
    if (!this.telegramService.verifyWebhookSecret(req.headers['x-telegram-bot-api-secret-token'])) {
      Logger.warn('[Telegram] Rejected a webhook call with a missing or wrong secret');
      return { ok: false };
    }

    void this.telegramService.handleUpdate(update).catch((error) => Logger.error('[Telegram] Update failed', error));
    return { ok: true };
  }

  @Authorized()
  @Get('/status')
  status(@CurrentUser({ required: true }) user: { userId: number }) {
    return this.telegramService.getStatus(user.userId);
  }

  @Authorized()
  @Post('/link-code')
  createLinkCode(@CurrentUser({ required: true }) user: { userId: number }) {
    return this.telegramService.createLinkCode(user.userId);
  }

  @Authorized()
  @Delete('/link')
  unlink(@CurrentUser({ required: true }) user: { userId: number }) {
    return this.telegramService.unlink(user.userId);
  }
}
