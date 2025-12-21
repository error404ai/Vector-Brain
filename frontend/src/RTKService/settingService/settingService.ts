/* eslint-disable @typescript-eslint/no-explicit-any */
import { baseApi, TAGS } from '../baseApi';

export interface Setting {
  title: string;
  key: string;
  value: string | boolean | object;
  group: string;
}

export interface SettingListResponse {
  data: Setting[];
}

export interface SettingGetResponse {
  data: {
    key: string;
    value: string | boolean | object;
    group: string;
    title: string;
  };
}

export interface SettingUpsertRequest {
  key: string;
  value: string | boolean;
}

export interface SettingUpsertResponse {
  status: boolean;
  message: string;
  data: any;
}

export const settingService = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getSettings: builder.query<Setting[], void>({
      query: () => ({
        url: '/setting/list',
        method: 'GET',
      }),
      transformResponse: (response: SettingListResponse) => response.data,
      providesTags: [TAGS.SETTING],
    }),
    getSetting: builder.query<
      {
        key: string;
        value: string | boolean | object;
        group: string;
        title: string;
      },
      string
    >({
      query: (key) => ({
        url: `/setting/get/${key}`,
        method: 'GET',
      }),
      transformResponse: (response: SettingGetResponse) => response.data,
      providesTags: [TAGS.SETTING],
    }),
    updateSetting: builder.mutation<SettingUpsertResponse, SettingUpsertRequest>({
      query: (body) => ({
        url: '/setting/create-or-update',
        method: 'POST',
        body,
      }),
      invalidatesTags: [TAGS.SETTING],
    }),
  }),
});

export const { useGetSettingsQuery, useGetSettingQuery, useUpdateSettingMutation } = settingService;
