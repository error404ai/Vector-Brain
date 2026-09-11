import { baseApi } from '../baseApi';

export interface TelegramStatus {
  /** False when the server has no TELEGRAM_BOT_TOKEN. */
  enabled: boolean;
  botUsername: string | null;
  linked: boolean;
  telegramUsername: string | null;
  linkedAt: string | null;
}

export interface TelegramLinkCode {
  code: string;
  expiresAt: string;
  botUsername: string | null;
  /** Opens the bot with the code pre-filled; null if the bot name is unknown. */
  deepLink: string | null;
}

export const telegramService = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getTelegramStatus: builder.query<{ message: string; data: TelegramStatus }, void>({
      query: () => ({
        url: '/telegram/status',
        method: 'GET',
      }),
    }),

    createTelegramLinkCode: builder.mutation<{ message: string; data: TelegramLinkCode }, void>({
      query: () => ({
        url: '/telegram/link-code',
        method: 'POST',
      }),
    }),

    unlinkTelegram: builder.mutation<{ message: string }, void>({
      query: () => ({
        url: '/telegram/link',
        method: 'DELETE',
      }),
    }),
  }),
});

export const { useGetTelegramStatusQuery, useCreateTelegramLinkCodeMutation, useUnlinkTelegramMutation } = telegramService;
