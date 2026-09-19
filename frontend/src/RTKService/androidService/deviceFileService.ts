import authManager from '@/_helpers/authManager';
import Global from '@/_helpers/global';
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
  /** One device. Omit when sending device_ids. */
  device_id?: number;
  /** Several devices in a single upload — the bytes travel once. */
  device_ids?: number[];
  file_name: string;
  mime_type: string;
  content_base64: string;
}

export interface InitUploadPayload {
  device_id?: number;
  device_ids?: number[];
  file_name: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  total_chunks: number;
}

/** Files at or below this go through the simple base64 path; above it, chunked. */
export const INLINE_UPLOAD_LIMIT = 12 * 1024 * 1024;

/** Chunk size for the chunked path. Must stay at or below the server's cap. */
export const UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;

const deviceFileApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getDeviceFiles: builder.query<{ message: string; data: DeviceFile[] }, number>({
      query: (deviceId) => ({
        url: `/android/files?device_id=${deviceId}`,
        method: 'GET',
      }),
      providesTags: ['DEVICE_FILES' as any],
    }),

    queueDeviceFile: builder.mutation<
      { message: string; data: { id: number; file_name: string; device_count?: number } },
      QueueFilePayload
    >({
      query: (body) => ({
        url: '/android/files',
        method: 'POST',
        body,
      }),
      invalidatesTags: ['DEVICE_FILES' as any],
    }),

    initDeviceUpload: builder.mutation<{ message: string; data: { upload_id: string; chunk_size: number } }, InitUploadPayload>({
      query: (body) => ({ url: '/android/files/init', method: 'POST', body }),
    }),

    finishDeviceUpload: builder.mutation<
      { message: string; data: { id: number; device_count?: number } },
      { upload_id: string }
    >({
      query: (body) => ({ url: '/android/files/finish', method: 'POST', body }),
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
  useInitDeviceUploadMutation,
  useFinishDeviceUploadMutation,
  useDeleteDeviceFileMutation,
} = deviceFileApi;

/** Lowercase-hex SHA-256 of a file, computed in the browser via WebCrypto. */
export async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Streams one chunk of a chunked upload as raw binary.
 *
 * Sent with a direct fetch rather than through RTK Query, because the body is an
 * ArrayBuffer of octet-stream, not JSON — RTK's base query is wired for JSON.
 * Auth and credentials mirror the base query so it authorises the same way.
 */
export async function uploadChunk(
  uploadId: string,
  index: number,
  chunk: Blob,
): Promise<void> {
  const token = authManager.getAccessToken();
  const response = await fetch(
    `${Global.BASE_API_PATH}/android/files/chunk?upload_id=${encodeURIComponent(uploadId)}&index=${index}`,
    {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/octet-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: chunk,
    },
  );
  if (!response.ok) {
    const detail = await response.json().catch(() => null);
    throw new Error(detail?.message || `Chunk ${index} upload failed (${response.status})`);
  }
}

export default deviceFileApi;
