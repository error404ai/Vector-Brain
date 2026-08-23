import { baseApi } from '../baseApi';

export interface AndroidDevice {
  id: number;
  user_id: number;
  device_id: string;
  device_name: string;
  device_model?: string;
  android_version?: string;
  status: 'ONLINE' | 'OFFLINE' | 'BUSY';
  last_seen_at?: string;
  capabilities?: {
    accessibility: boolean;
    screenCapture: boolean;
    screenWidth?: number;
    screenHeight?: number;
  };
  created_at: string;
  updated_at: string;
}

export interface AndroidTaskLog {
  id: number;
  agent_task_id: number;
  device_id: number;
  step_index: number;
  action_type: string;
  action_payload: any;
  thought_reasoning: string;
  status: 'PENDING' | 'EXECUTING' | 'SUCCESS' | 'FAILED' | 'CANCELLED';
  screenshot_base64?: string;
  ui_tree_snapshot?: any;
  duration_ms: number;
  result_message?: string;
  error_message?: string;
  created_at: string;
}

export interface RequestPairingPayload {
  device_name: string;
  device_model?: string;
}

export interface DispatchAndroidPromptPayload {
  device_id: number;
  prompt: string;
  max_steps?: number;
}

export interface DirectActionPayload {
  device_id: number;
  action: any;
}

const androidApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getAndroidDevices: builder.query<{ message: string; data: AndroidDevice[] }, void>({
      query: () => ({
        url: '/android/devices',
        method: 'GET',
      }),
      providesTags: ['ANDROID_DEVICES' as any],
    }),

    requestPairingCode: builder.mutation<{ message: string; data: { pairingCode: string; expiresAt: string } }, RequestPairingPayload>({
      query: (body) => ({
        url: '/android/devices/pair/request',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['ANDROID_DEVICES' as any],
    }),

    unpairDevice: builder.mutation<{ message: string }, number>({
      query: (id) => ({
        url: `/android/devices/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['ANDROID_DEVICES' as any],
    }),

    sendDirectAction: builder.mutation<{ message: string; data: any }, DirectActionPayload>({
      query: (body) => ({
        url: '/android/devices/action/direct',
        method: 'POST',
        body,
      }),
    }),

    runAndroidTask: builder.mutation<{ message: string; data: { taskId: number; status: string } }, DispatchAndroidPromptPayload>({
      query: (body) => ({
        url: '/android/agent/run',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['AGENT_TASKS' as any],
    }),

    cancelAndroidTask: builder.mutation<{ message: string }, number>({
      query: (taskId) => ({
        url: `/android/agent/cancel/${taskId}`,
        method: 'POST',
      }),
    }),

    getAndroidTaskLogs: builder.query<{ message: string; data: AndroidTaskLog[] }, number>({
      query: (taskId) => ({
        url: `/android/agent/logs/${taskId}`,
        method: 'GET',
      }),
    }),
  }),
});

export const {
  useGetAndroidDevicesQuery,
  useRequestPairingCodeMutation,
  useUnpairDeviceMutation,
  useSendDirectActionMutation,
  useRunAndroidTaskMutation,
  useCancelAndroidTaskMutation,
  useGetAndroidTaskLogsQuery,
  useLazyGetAndroidTaskLogsQuery,
} = androidApi;

export default androidApi;
