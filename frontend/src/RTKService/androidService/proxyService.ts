import { baseApi } from '../baseApi';

export interface DeviceProxy {
  id: number;
  name: string;
  concurrency: number;
  settle_seconds: number;
  rotate_every_tasks: number;
  tasks_since_rotation: number;
  last_rotation_status: string | null;
  last_ip: string | null;
  last_rotated_at: string | null;
  /** Phones currently pointed at this proxy. */
  device_count: number;
}

export interface QueuedTask {
  id: number;
  device_id: number;
  proxy_id: number;
  prompt: string;
  status: string;
  last_error: string | null;
  created_at: string;
}

export interface CreateProxyPayload {
  name: string;
  rotation_url: string;
  concurrency?: number;
  settle_seconds?: number;
  rotate_every_tasks?: number;
}

/** An empty rotation_url leaves the saved one untouched. */
export type UpdateProxyPayload = Partial<CreateProxyPayload>;

export const proxyService = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getDeviceProxies: builder.query<{ message: string; data: DeviceProxy[] }, void>({
      query: () => ({ url: '/device-proxy', method: 'GET' }),
    }),

    createDeviceProxy: builder.mutation<{ message: string }, CreateProxyPayload>({
      query: (body) => ({ url: '/device-proxy', method: 'POST', body }),
    }),

    updateDeviceProxy: builder.mutation<{ message: string }, { id: number } & UpdateProxyPayload>({
      query: ({ id, ...body }) => ({ url: `/device-proxy/${id}`, method: 'PATCH', body }),
    }),

    deleteDeviceProxy: builder.mutation<{ message: string }, number>({
      query: (id) => ({ url: `/device-proxy/${id}`, method: 'DELETE' }),
    }),

    rotateDeviceProxy: builder.mutation<{ message: string; data: { ok: boolean; ip: string | null } }, number>({
      query: (id) => ({ url: `/device-proxy/${id}/rotate`, method: 'POST' }),
    }),

    getTaskQueue: builder.query<{ message: string; data: QueuedTask[] }, void>({
      query: () => ({ url: '/device-proxy/queue', method: 'GET' }),
    }),

    cancelQueuedTask: builder.mutation<{ message: string }, number>({
      query: (id) => ({ url: `/device-proxy/queue/${id}`, method: 'DELETE' }),
      invalidatesTags: ['TASK_QUEUE' as any],
    }),
    clearAllQueued: builder.mutation<{ message: string; data: { cleared: number } }, void>({
      query: () => ({ url: '/device-proxy/queue/all', method: 'DELETE' }),
    }),

    assignDeviceProxy: builder.mutation<{ message: string }, { device_id: number; proxy_id: number | null }>({
      query: (body) => ({ url: '/device-proxy/assign', method: 'POST', body }),
    }),
  }),
});

export const {
  useGetDeviceProxiesQuery,
  useCreateDeviceProxyMutation,
  useUpdateDeviceProxyMutation,
  useDeleteDeviceProxyMutation,
  useRotateDeviceProxyMutation,
  useAssignDeviceProxyMutation,
  useGetTaskQueueQuery,
  useClearAllQueuedMutation,
  useCancelQueuedTaskMutation,
} = proxyService;
