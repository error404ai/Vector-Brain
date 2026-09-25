import authManager from '@/_helpers/authManager';
import Global from '@/_helpers/global';
import { baseApi } from '../baseApi';

export type LandingShotKind = 'phone' | 'page';

export interface LandingShot {
  id: number;
  kind: LandingShotKind;
  source: 'capture' | 'mission' | 'page';
  device_id: number | null;
  label: string;
  device_model: string | null;
  mission_id: number | null;
  mime: string;
  width: number;
  height: number;
  size_bytes: number;
  slot: string | null;
  approved: boolean;
  created_at: string;
}

export interface PublicLandingShot {
  id: number;
  kind: LandingShotKind;
  slot: string;
  label: string;
  device_model: string | null;
  width: number;
  height: number;
  path: string;
}

export interface CaptureResult {
  device_id: number;
  label: string;
  shot_id?: number;
  error?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tag types are not declared centrally (same as the other services)
const TAG = 'LANDING_SHOTS' as any;

/** Admin tools for the landing page's screenshots. */
export const landingShotService = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getLandingShots: builder.query<{ message: string; data: { shots: LandingShot[]; slots: string[] } }, void>({
      query: () => ({ url: '/landing-shots', method: 'GET' }),
      providesTags: [TAG],
    }),
    captureLandingPhones: builder.mutation<{ message: string; data: { results: CaptureResult[] } }, number[]>({
      query: (device_ids) => ({ url: '/landing-shots/capture', method: 'POST', body: { device_ids } }),
      invalidatesTags: [TAG],
    }),
    importLandingMission: builder.mutation<{ message: string; data: { mission_id: number; imported: number } }, number | void>({
      query: (mission_id) => ({ url: '/landing-shots/import-mission', method: 'POST', body: mission_id ? { mission_id } : {} }),
      invalidatesTags: [TAG],
    }),
    uploadLandingPage: builder.mutation<{ message: string; data: LandingShot }, { image: string; label: string }>({
      query: (body) => ({ url: '/landing-shots/page', method: 'POST', body }),
      invalidatesTags: [TAG],
    }),
    updateLandingShot: builder.mutation<{ message: string; data: LandingShot }, { id: number; slot?: string | null; approved?: boolean; label?: string }>({
      query: ({ id, ...body }) => ({ url: `/landing-shots/${id}`, method: 'PATCH', body }),
      invalidatesTags: [TAG],
    }),
    deleteLandingShot: builder.mutation<{ message: string }, number>({
      query: (id) => ({ url: `/landing-shots/${id}`, method: 'DELETE' }),
      invalidatesTags: [TAG],
    }),
  }),
});

export const {
  useGetLandingShotsQuery,
  useCaptureLandingPhonesMutation,
  useImportLandingMissionMutation,
  useUploadLandingPageMutation,
  useUpdateLandingShotMutation,
  useDeleteLandingShotMutation,
} = landingShotService;

/** Admin image URL needs the bearer token, so it is fetched as a blob. */
export async function fetchLandingShotBlob(id: number): Promise<Blob> {
  const token = authManager.getAccessToken();
  const res = await fetch(`${Global.BASE_API_PATH}/landing-shots/${id}/image`, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Image ${res.status}`);
  return res.blob();
}

/** Public list for the landing page; plain fetch so it never touches the app cache or auth. */
export async function fetchPublicLandingShots(): Promise<PublicLandingShot[]> {
  const res = await fetch(`${Global.BASE_API_PATH}/public/landing-shots`);
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: PublicLandingShot[] };
  return Array.isArray(json.data) ? json.data : [];
}

export const publicShotUrl = (s: PublicLandingShot) => `${Global.BASE_API_PATH}${s.path}`;
