import { baseApi } from '../baseApi';

export interface ScheduledTask {
  id: number;
  user_id: number;
  device_id: number;
  prompt: string;
  /** "HH:MM" in 24-hour form, in the schedule's own timezone. */
  run_at: string;
  /** Comma-separated JS day numbers; empty string means every day. */
  days_of_week: string;
  timezone: string;
  max_steps: number;
  ai_config_id: number | null;
  enabled: boolean;
  last_run_at?: string | null;
  last_result?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScheduleInput {
  device_id: number;
  prompt: string;
  run_at: string;
  days_of_week?: number[];
  timezone?: string;
  max_steps?: number;
  ai_config_id?: number | null;
  enabled?: boolean;
}

export const scheduleService = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getSchedules: builder.query<{ message: string; data: ScheduledTask[] }, void>({
      query: () => ({
        url: '/android/schedules',
        method: 'GET',
      }),
      providesTags: ['SCHEDULES' as any],
    }),

    createSchedule: builder.mutation<{ message: string; data: ScheduledTask }, ScheduleInput>({
      query: (body) => ({
        url: '/android/schedules',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['SCHEDULES' as any],
    }),

    updateSchedule: builder.mutation<{ message: string; data: ScheduledTask }, { id: number } & Partial<ScheduleInput>>({
      query: ({ id, ...body }) => ({
        url: `/android/schedules/${id}`,
        method: 'PATCH',
        body,
      }),
      invalidatesTags: ['SCHEDULES' as any],
    }),

    deleteSchedule: builder.mutation<{ message: string }, number>({
      query: (id) => ({
        url: `/android/schedules/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['SCHEDULES' as any],
    }),

    runScheduleNow: builder.mutation<{ message: string }, number>({
      query: (id) => ({
        url: `/android/schedules/${id}/run`,
        method: 'POST',
      }),
      invalidatesTags: ['SCHEDULES' as any, 'AGENT_TASKS' as any],
    }),
  }),
});

export const {
  useGetSchedulesQuery,
  useCreateScheduleMutation,
  useUpdateScheduleMutation,
  useDeleteScheduleMutation,
  useRunScheduleNowMutation,
} = scheduleService;
