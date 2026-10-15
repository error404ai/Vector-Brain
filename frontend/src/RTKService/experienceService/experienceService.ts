import { baseApi, TAGS } from '../baseApi';

export type LessonKind = 'path' | 'avoid' | 'widget' | 'behave' | 'limit' | 'field';
export type LessonStatus = 'trusted' | 'candidate' | 'unverified' | 'off';

export interface Lesson {
  id: number;
  scope: string;
  kind: LessonKind;
  text: string;
  status: LessonStatus;
  source: 'auto' | 'user';
  avoid_url: string | null;
  helped: number;
  hurt: number;
  uses: number;
  evidence: number[];
  off_reason: string | null;
  last_used_at: string | null;
  created_at: string;
}

export interface ExperienceOverview {
  settings: { enabled: boolean; learn: boolean };
  stats: { active: number; trusted: number; unverified: number; runs_helped_week: number; runs_with_memory_week: number };
  scopes: { scope: string; lessons: number; trusted: number; helped: number }[];
  lessons: Lesson[];
  runs: { task_id: number; succeeded: boolean; created_at: string; used: { id: number; text: string }[]; learned: { id: number; text: string }[] }[];
}

export const experienceService = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getExperience: builder.query<{ data: ExperienceOverview }, void>({
      query: () => ({ url: '/android/experience', method: 'GET' }),
      providesTags: [TAGS.EXPERIENCE],
    }),
    saveExperienceSettings: builder.mutation<{ data: { enabled: boolean; learn: boolean } }, { enabled?: boolean; learn?: boolean }>({
      query: (body) => ({ url: '/android/experience/settings', method: 'PUT', body }),
      invalidatesTags: [TAGS.EXPERIENCE],
    }),
    teachLesson: builder.mutation<{ data: { id: number } }, { scope: string; kind: LessonKind; text: string }>({
      query: (body) => ({ url: '/android/experience/lessons', method: 'POST', body }),
      invalidatesTags: [TAGS.EXPERIENCE],
    }),
    updateLesson: builder.mutation<{ data: { id: number } }, { id: number; scope?: string; kind?: LessonKind; text?: string; status?: LessonStatus; reset_score?: boolean }>({
      query: ({ id, ...body }) => ({ url: `/android/experience/lessons/${id}`, method: 'PATCH', body }),
      invalidatesTags: [TAGS.EXPERIENCE],
    }),
    deleteLesson: builder.mutation<{ data: { id: number } }, number>({
      query: (id) => ({ url: `/android/experience/lessons/${id}`, method: 'DELETE' }),
      invalidatesTags: [TAGS.EXPERIENCE],
    }),
  }),
});

export const { useGetExperienceQuery, useSaveExperienceSettingsMutation, useTeachLessonMutation, useUpdateLessonMutation, useDeleteLessonMutation } = experienceService;
