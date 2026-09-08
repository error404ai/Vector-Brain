import { baseApi } from '../baseApi';

export interface DeviceFile {
  id: number;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  status: 'PENDING' | 'DELIVERED' | 'FAILED';
  failure_message?: string | null;
  delivered_at?: string | null;
  expires_at: string;
  created_at: string;
}

export interface QueueFilePayload {
  device_id: number;
  file_name: string;
  mime_type: string;
  content_base64: string;
}

const deviceFileApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getDeviceFiles: builder.query<{ message: string; data: DeviceFile[] }, number>({
      query: (deviceId) => ({
        url: `/android/files?device_id=${deviceId}`,
        method: 'GET',
      }),
      providesTags: ['DEVICE_FILES' as any],
    }),

    queueDeviceFile: builder.mutation<{ message: string; data: { id: number; file_name: string } }, QueueFilePayload>({
      query: (body) => ({
        url: '/android/files',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['DEVICE_FILES' as any],
    }),

    deleteDeviceFile: builder.mutation<{ message: string }, number>({
      query: (id) => ({
        url: `/android/files/${id}`,
        method: 'DELETE',
      }),
      invalidatesTags: ['DEVICE_FILES' as any],
    }),
  }),
});

export const {
  useGetDeviceFilesQuery,
  useLazyGetDeviceFilesQuery,
  useQueueDeviceFileMutation,
  useDeleteDeviceFileMutation,
} = deviceFileApi;

export default deviceFileApi;
