import { baseApi } from '../baseApi';

export interface SavedFlow {
  id: number;
  name: string;
  source_prompt: string | null;
  step_count: number;
  /** Taps recorded as screen positions — these are the fragile ones. */
  coordinate_step_count: number;
  run_count: number;
  last_run_at: string | null;
  created_at: string;
}

export const flowService = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getFlows: builder.query<{ message: string; data: SavedFlow[] }, void>({
      query: () => ({ url: '/android/flows', method: 'GET' }),
      providesTags: ['FLOWS' as any],
    }),

    saveFlow: builder.mutation<
      { message: string; data: { id: number; step_count: number; coordinate_step_count: number; needs_text: boolean } },
      { task_id: number; name?: string }
    >({
      query: (body) => ({ url: '/android/flows', method: 'POST', body }),
      invalidatesTags: ['FLOWS' as any],
    }),

    runFlow: builder.mutation<{ message: string; data: { taskId: number; steps: number } }, { id: number; device_id: number }>({
      query: ({ id, device_id }) => ({ url: `/android/flows/${id}/run`, method: 'POST', body: { device_id } }),
      invalidatesTags: ['FLOWS' as any, 'AGENT_TASKS' as any],
    }),

    renameFlow: builder.mutation<{ message: string }, { id: number; name: string }>({
      query: ({ id, name }) => ({ url: `/android/flows/${id}`, method: 'PATCH', body: { name } }),
      invalidatesTags: ['FLOWS' as any],
    }),

    deleteFlow: builder.mutation<{ message: string }, number>({
      query: (id) => ({ url: `/android/flows/${id}`, method: 'DELETE' }),
      invalidatesTags: ['FLOWS' as any],
    }),
  }),
});

export const {
  useGetFlowsQuery,
  useSaveFlowMutation,
  useRunFlowMutation,
  useRenameFlowMutation,
  useDeleteFlowMutation,
} = flowService;
