import { baseApi, TAGS } from '../baseApi';

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
  /** 2 = checkable steps (acts on elements, checks each step); 1 = an old pixel recording. */
  format?: number;
  /** Off: never used automatically (it can still be replayed by hand). */
  enabled?: boolean;
  version?: number;
  /** Saved automatically after a successful run. */
  auto?: boolean;
  /** Recorded from a run the system checked on the phone. */
  checked?: boolean;
  /** Steps the AI still does each time (typed text that is not in the task's wording). */
  ai_steps?: number;
  /** Fits the same task with other values ("Search YouTube for …"). */
  has_params?: boolean;
  template?: string | null;
  stats?: FlowStats | null;
  last_verified_at?: string | null;
}

export interface FlowStats {
  runs: number;
  replay_only: number;
  repaired: number;
  fell_back: number;
  failed: number;
  models: Record<string, { runs: number; ok: number }>;
}

/** The account's saved-flow switches (Settings → Saved flows). */
export interface FlowSettings {
  record: boolean;
  replay_first: boolean;
  ai_repair: boolean;
  share_fixes: boolean;
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

    setFlowEnabled: builder.mutation<{ message: string }, { id: number; enabled: boolean }>({
      query: ({ id, enabled }) => ({ url: `/android/flows/${id}`, method: 'PATCH', body: { enabled } }),
      invalidatesTags: [TAGS.FLOWS],
    }),

    getFlowSettings: builder.query<{ message: string; data: FlowSettings }, void>({
      query: () => ({ url: '/android/flows/settings', method: 'GET' }),
      providesTags: [TAGS.FLOW_SETTINGS],
    }),

    setFlowSettings: builder.mutation<{ message: string; data: FlowSettings }, Partial<FlowSettings>>({
      query: (body) => ({ url: '/android/flows/settings', method: 'PUT', body }),
      invalidatesTags: [TAGS.FLOW_SETTINGS],
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
  useSetFlowEnabledMutation,
  useGetFlowSettingsQuery,
  useSetFlowSettingsMutation,
} = flowService;
