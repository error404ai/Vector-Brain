import { baseApi, TAGS } from '../baseApi';

export type AiProvider = 'openai' | 'google' | 'anthropic' | 'deepseek' | 'groq' | 'openrouter' | 'custom';
export type AiConfigType = 'text' | 'vision';

export interface AiConfig {
  id: number;
  user_id: number;
  provider: AiProvider;
  model: string;
  base_url: string | null;
  is_active: boolean;
  label: string | null;
  config_type: AiConfigType;
  has_api_key: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateAiConfigPayload {
  provider: AiProvider;
  model: string;
  api_key: string;
  base_url?: string | null;
  is_active?: boolean;
  label?: string | null;
  config_type?: AiConfigType;
}

export interface UpdateAiConfigPayload {
  id: number;
  provider?: AiProvider;
  model?: string;
  api_key?: string;
  base_url?: string | null;
  is_active?: boolean;
  label?: string | null;
  config_type?: AiConfigType;
}

export interface TestAiConfigPayload {
  provider: AiProvider;
  model: string;
  api_key: string;
  base_url?: string | null;
}

export interface TestResultResponse {
  message: string;
  data: {
    latencyMs: number;
    reply: string;
  };
}

const aiConfigApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getAiConfigs: builder.query<{ message: string; data: AiConfig[] }, void>({
      query: () => ({
        url: '/ai-configs/list',
        method: 'GET',
      }),
      providesTags: (result) =>
        result?.data
          ? [
              ...result.data.map(({ id }) => ({ type: TAGS.AI_CONFIG, id })),
              { type: TAGS.AI_CONFIGS, id: 'LIST' },
            ]
          : [{ type: TAGS.AI_CONFIGS, id: 'LIST' }],
    }),


    getAiConfig: builder.query<{ message: string; data: AiConfig }, number>({
      query: (id) => ({
        url: `/ai-configs/details/${id}`,
        method: 'GET',
      }),
      providesTags: (_result, _error, id) => [{ type: TAGS.AI_CONFIG, id }],
    }),

    createAiConfig: builder.mutation<{ message: string; data: AiConfig }, CreateAiConfigPayload>({
      query: (body) => ({
        url: '/ai-configs/create',
        method: 'POST',
        body,
      }),
      invalidatesTags: [{ type: TAGS.AI_CONFIGS, id: 'LIST' }],
    }),

    updateAiConfig: builder.mutation<{ message: string; data: AiConfig }, UpdateAiConfigPayload>({
      query: ({ id, ...body }) => ({
        url: `/ai-configs/update/${id}`,
        method: 'PUT',
        body,
      }),
      invalidatesTags: (_result, _error, { id }) => [
        { type: TAGS.AI_CONFIG, id },
        { type: TAGS.AI_CONFIGS, id: 'LIST' },
      ],
    }),

    deleteAiConfig: builder.mutation<{ message: string }, number>({
      query: (id) => ({
        url: `/ai-configs/delete/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: [{ type: TAGS.AI_CONFIGS, id: 'LIST' }],
    }),

    setActiveAiConfig: builder.mutation<{ message: string; data: AiConfig }, number>({
      query: (id) => ({
        url: `/ai-configs/set-active/${id}`,
        method: 'PATCH',
      }),
      invalidatesTags: [{ type: TAGS.AI_CONFIGS, id: 'LIST' }],
    }),

    testAiConfig: builder.mutation<TestResultResponse, TestAiConfigPayload>({
      query: (body) => ({
        url: '/ai-configs/test',
        method: 'POST',
        body,
      }),
    }),

    testSavedAiConfig: builder.mutation<TestResultResponse, number>({
      query: (id) => ({
        url: `/ai-configs/test/${id}`,
        method: 'POST',
      }),
    }),
  }),
});

export const {
  useGetAiConfigsQuery,
  useGetAiConfigQuery,
  useCreateAiConfigMutation,
  useUpdateAiConfigMutation,
  useDeleteAiConfigMutation,
  useSetActiveAiConfigMutation,
  useTestAiConfigMutation,
  useTestSavedAiConfigMutation,
} = aiConfigApi;
