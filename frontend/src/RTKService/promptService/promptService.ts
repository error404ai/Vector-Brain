import { baseApi } from '../baseApi';

export const promptService = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    /** Rewrites a rough instruction into one the Android agent follows well. */
    enhancePrompt: builder.mutation<{ enhancedPrompt: string; originalPrompt: string }, { prompt: string }>({
      query: (body) => ({
        url: '/prompts/enhance',
        method: 'POST',
        body,
      }),
    }),
  }),
});

export const { useEnhancePromptMutation } = promptService;
