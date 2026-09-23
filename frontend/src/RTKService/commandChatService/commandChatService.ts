import { baseApi } from '../baseApi';
import type { Mission } from '../missionService/missionService';

export type ChatReplyKind = 'answer' | 'mission' | 'confirm' | 'clarify' | 'error';

export interface ChatReply {
  kind: ChatReplyKind;
  text: string;
  mission?: Mission;
  confirm_token?: string;
  action?: unknown;
}

export const commandChatService = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    sendCommand: builder.mutation<{ message: string; data: ChatReply }, string>({
      query: (message) => ({ url: '/android/chat', method: 'POST', body: { message } }),
    }),
    confirmCommand: builder.mutation<{ message: string; data: ChatReply }, string>({
      query: (confirm_token) => ({ url: '/android/chat/confirm', method: 'POST', body: { confirm_token } }),
    }),
  }),
});

export const { useSendCommandMutation, useConfirmCommandMutation } = commandChatService;
