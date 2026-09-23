import { baseApi, TAGS } from '../baseApi';

export type MissionStatus = 'RUNNING' | 'DONE' | 'CANCELLED';
export type MissionItemStatus = 'PENDING' | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';

export interface MissionItem {
  id: number;
  device_id: number;
  device_name: string;
  device_hw_id: string | null;
  status: MissionItemStatus;
  attempts: number;
  agent_task_id: number | null;
  replaces_item_id: number | null;
  last_reason: string | null;
  reason_text: string | null;
  last_message: string | null;
  next_attempt_at: string | null;
}

export interface Mission {
  id: number;
  request: string;
  prompt: string | null;
  target_mode: 'ids' | 'count' | 'all' | 'tag';
  requested_count: number | null;
  no_internet: boolean;
  status: MissionStatus;
  note: string | null;
  summary: string | null;
  created_at: string;
  finished_at: string | null;
  progress: {
    total: number;
    succeeded: number;
    failed: number;
    running: number;
    queued: number;
    pending: number;
    retries: number;
  };
  items: MissionItem[];
}

export interface MissionInput {
  request: string;
  device_ids?: number[];
  max_steps?: number;
  ai_config_id?: number;
  no_internet?: boolean;
}

export const missionService = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getMissions: builder.query<{ message: string; data: Mission[] }, number | void>({
      query: (limit) => ({ url: `/android/missions?limit=${limit ?? 20}`, method: 'GET' }),
      providesTags: [TAGS.MISSIONS],
    }),
    createMission: builder.mutation<{ message: string; data: Mission }, MissionInput>({
      query: (body) => ({ url: '/android/missions', method: 'POST', body }),
      invalidatesTags: [TAGS.MISSIONS],
    }),
    cancelMission: builder.mutation<{ message: string; data: Mission }, number>({
      query: (id) => ({ url: `/android/missions/${id}/cancel`, method: 'POST' }),
      invalidatesTags: [TAGS.MISSIONS],
    }),
  }),
});

export const { useGetMissionsQuery, useCreateMissionMutation, useCancelMissionMutation } = missionService;
