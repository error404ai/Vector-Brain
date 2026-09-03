import { baseApi } from '../baseApi';

export interface SharedRunFrame {
  step_index: number;
  caption: string | null;
  image_base64: string;
}

export interface PublicRun {
  prompt: string;
  success: boolean;
  summary: string | null;
  total_steps: number;
  total_duration_seconds: number;
  model: string | null;
  created_at: string;
  frames: SharedRunFrame[];
}

export const runShareService = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getShareStatus: builder.query<{ message: string; data: { token: string | null; shared_at: string | null } }, number>({
      query: (id) => ({
        url: `/android/runs/${id}/share`,
        method: 'GET',
      }),
      providesTags: ['RUN_SHARE' as any],
    }),

    shareRun: builder.mutation<
      { message: string; data: { token: string; frames: number } },
      { id: number; exclude_steps?: number[] }
    >({
      query: ({ id, exclude_steps }) => ({
        url: `/android/runs/${id}/share`,
        method: 'POST',
        body: { exclude_steps: exclude_steps ?? [] },
      }),
      invalidatesTags: ['RUN_SHARE' as any],
    }),

    unshareRun: builder.mutation<{ message: string }, number>({
      query: (id) => ({
        url: `/android/runs/${id}/share`,
        method: 'DELETE',
      }),
      invalidatesTags: ['RUN_SHARE' as any],
    }),

    /** Public read — works without a session. */
    getPublicRun: builder.query<{ message: string; data: PublicRun }, string>({
      query: (token) => ({
        url: `/public/runs/${token}`,
        method: 'GET',
      }),
    }),
  }),
});

export const {
  useGetShareStatusQuery,
  useShareRunMutation,
  useUnshareRunMutation,
  useGetPublicRunQuery,
} = runShareService;
