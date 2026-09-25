import { baseApi } from '../baseApi';
import type { Mission } from '../missionService/missionService';

export type ChatReplyKind = 'answer' | 'mission' | 'confirm' | 'clarify' | 'screens' | 'error';

/** One phone's current screen for the chat: the image, or why there isn't one. */
export interface PhoneShot {
  device_name: string;
  hw_id: string | null;
  base64?: string;
  error?: string;
  /** Saved copy (after a reload the image is fetched by this id). */
  shot_id?: number;
}

export interface ChatReply {
  kind: ChatReplyKind;
  text: string;
  mission?: Mission;
  /** kind 'screens': one live screenshot per phone the user asked to see. */
  screens?: PhoneShot[];
  confirm_token?: string;
  action?: unknown;
  /** Tap-to-send answers under a question. */
  quick_replies?: string[];
  /** The thread this reply belongs to. */
  conversation_id?: number;
  /** What a Confirm will do, for the plan card. */
  plan?: {
    kind: 'mission' | 'rotation' | 'concurrency';
    instruction?: string;
    phones?: string[];
    steps?: number;
    cost_usd?: number;
    duration_minutes?: number;
    lanes?: string[];
    setting?: string;
  };
}

export interface Conversation {
  id: number;
  title: string;
  last_message_at: string;
  created_at: string;
}

export type ChatHistoryTurn =
  | { id: number; role: 'user'; text: string }
  | { id: number; role: 'assistant'; reply: ChatReply };

export const commandChatService = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    sendCommand: builder.mutation<{ message: string; data: ChatReply }, { message: string; conversation_id?: number }>({
      query: (body) => ({ url: '/android/chat', method: 'POST', body }),
    }),
    getChatHistory: builder.query<{ message: string; data: { conversation_id: number | null; turns: ChatHistoryTurn[] } }, number | undefined>({
      query: (conversationId) => ({ url: `/android/chat/history?limit=120${conversationId ? `&conversation_id=${conversationId}` : ''}`, method: 'GET' }),
      keepUnusedDataFor: 0,
    }),
    getConversations: builder.query<{ message: string; data: Conversation[] }, void>({
      query: () => ({ url: '/android/chat/conversations', method: 'GET' }),
      keepUnusedDataFor: 0,
    }),
    newConversation: builder.mutation<{ message: string; data: { id: number; title: string } }, void>({
      query: () => ({ url: '/android/chat/conversations', method: 'POST' }),
    }),
    renameConversation: builder.mutation<{ message: string }, { id: number; title: string }>({
      query: ({ id, title }) => ({ url: `/android/chat/conversations/${id}/rename`, method: 'POST', body: { title } }),
    }),
    deleteConversation: builder.mutation<{ message: string }, number>({
      query: (id) => ({ url: `/android/chat/conversations/${id}`, method: 'DELETE' }),
    }),
    rerunFromChat: builder.mutation<{ message: string; data: ChatReply }, { mission_id: number; scope?: 'failed' | 'all'; continue?: boolean }>({
      query: (body) => ({ url: '/android/chat/rerun', method: 'POST', body }),
    }),
    getChatScreen: builder.query<{ message: string; data: { id: number; device_name: string; base64: string; captured_at: string } }, number>({
      query: (id) => ({ url: `/android/chat/screens/${id}`, method: 'GET' }),
      keepUnusedDataFor: 300,
    }),
    confirmCommand: builder.mutation<{ message: string; data: ChatReply }, string>({
      query: (confirm_token) => ({ url: '/android/chat/confirm', method: 'POST', body: { confirm_token } }),
    }),
  }),
});

export const {
  useSendCommandMutation,
  useConfirmCommandMutation,
  useGetChatHistoryQuery,
  useGetChatScreenQuery,
  useRerunFromChatMutation,
  useGetConversationsQuery,
  useNewConversationMutation,
  useRenameConversationMutation,
  useDeleteConversationMutation,
} = commandChatService;
