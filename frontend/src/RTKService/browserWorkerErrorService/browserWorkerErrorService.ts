import { baseApi, TAGS } from '../baseApi';

export interface BrowserWorkerError {
  id: number;
  fingerprint: string;
  error_code: string;
  phase: string;
  message: string;
  stack: string | null;
  extension_version: string;
  browser: 'chrome' | 'firefox' | 'edge' | 'other';
  browser_version: string | null;
  provider: string | null;
  model: string | null;
  tool: string | null;
  step: number | null;
  task_duration_ms: number | null;
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export interface BrowserWorkerErrorListResponse {
  message: string;
  data: BrowserWorkerError[];
  pagination: {
    currentPage: number;
    totalPages: number;
    totalCount: number;
    pageSize: number;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
  };
}

export interface BrowserWorkerErrorListParams {
  page?: number;
  limit?: number;
  search?: string;
  sortField?: 'last_seen_at' | 'first_seen_at' | 'occurrence_count' | 'error_code' | 'extension_version';
  sortDirection?: 'asc' | 'desc';
}

export interface BrowserWorkerErrorSummary {
  total_groups: number;
  total_occurrences: number;
  active_groups_24h: number;
}

const browserWorkerErrorApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getBrowserWorkerErrors: builder.query<BrowserWorkerErrorListResponse, BrowserWorkerErrorListParams>({
      query: (params) => ({ url: '/browserworker-error/list', params }),
      providesTags: [TAGS.BROWSERWORKER_ERRORS],
    }),
    getBrowserWorkerErrorSummary: builder.query<{ message: string; data: BrowserWorkerErrorSummary }, void>({
      query: () => '/browserworker-error/summary',
      providesTags: [TAGS.BROWSERWORKER_ERRORS],
    }),
    deleteBrowserWorkerError: builder.mutation<{ message: string }, number>({
      query: (id) => ({ url: `/browserworker-error/delete/${id}`, method: 'DELETE' }),
      invalidatesTags: [TAGS.BROWSERWORKER_ERRORS],
    }),
  }),
});

export const { useGetBrowserWorkerErrorsQuery, useGetBrowserWorkerErrorSummaryQuery, useDeleteBrowserWorkerErrorMutation } = browserWorkerErrorApi;
