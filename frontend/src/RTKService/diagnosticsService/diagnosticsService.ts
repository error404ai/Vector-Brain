import authManager from '@/_helpers/authManager';
import Global from '@/_helpers/global';
import { baseApi } from '../baseApi';

export interface RunDiagnostics {
  version: number;
  steps: number;
  sources: Record<string, number>;
  llm_calls: number;
  tokens_reported: boolean;
  prompt_tokens: number;
  completion_tokens: number;
  think_ms: number;
  phone_ms: number;
  wait_ms: number;
  failed: number;
  wasted: number;
  waste: Record<string, number>;
  actions: Record<string, number>;
  vision: number;
  packages: string[];
}

export interface DiagnosticsSummary {
  days: number;
  runs: number;
  measured_runs: number;
  succeeded: number;
  failed: number;
  replay_runs: number;
  engines: {
    engine: string;
    runs: number;
    measured_runs: number;
    success_rate: number | null;
    avg_steps: number | null;
    avg_wasted: number | null;
    avg_llm_calls: number | null;
    avg_tokens: number | null;
    avg_think_s: number | null;
    verified: number;
    unverified: number;
    failed_verification: number;
  }[];
  avg_steps_succeeded: number;
  steps: number;
  wasted: number;
  waste: { tag: string; label: string; count: number }[];
  actions: { action: string; count: number }[];
  llm_calls: number;
  token_runs: number;
  prompt_tokens: number;
  completion_tokens: number;
  think_ms: number;
  phone_ms: number;
  wait_ms: number;
  vision: number;
  top_packages: { package: string; runs: number; steps: number; wasted: number }[];
  repeated_tasks: { prompt: string; runs: number; success_rate: number; avg_steps: number; avg_wasted: number | null }[];
}

export interface DiagnosticsRun {
  id: number;
  prompt: string;
  device: string | null;
  status: string;
  reason: string | null;
  provider: string | null;
  model: string | null;
  total_steps: number;
  duration_s: number;
  created_at: string;
  engine: string;
  verification: Verification | null;
  diagnostics: RunDiagnostics | null;
}

export interface Verification {
  status: 'verified' | 'unverified' | 'failed';
  method: 'rule' | 'judge' | 'none';
  reason: string;
  retries: number;
}

export interface DiagnosticsStep {
  id: number;
  step_index: number;
  action_type: string;
  action_payload: Record<string, unknown> | null;
  status: string;
  duration_ms: number;
  think_ms: number | null;
  source: string;
  package_before: string | null;
  package_after: string | null;
  llm_call: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  waste: string | null;
  thought_reasoning: string;
  result_message: string;
  error_message: string | null;
}

export interface DiagnosticsRunDetail extends Omit<DiagnosticsRun, 'reason' | 'duration_s' | 'engine'> {
  engine: string | null;
  reason_code: string | null;
  total_duration_seconds: number;
  message: string | null;
  waste_labels: Record<string, string>;
  steps: DiagnosticsStep[];
}

export interface SyncState {
  configured: boolean;
  repo: string | null;
  branch: string;
  last_push_at: string | null;
  last_file: string | null;
  last_error: string | null;
}

export interface ClientReport {
  id: number;
  user_id: number | null;
  kind: string;
  page: string | null;
  tab_id: string | null;
  user_agent: string | null;
  app_version: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tag types are not declared centrally (same as the other services)
const TAG = 'DIAGNOSTICS' as any;

/** Run diagnostics (owner only): where the agent's steps, time and tokens go. */
export const diagnosticsService = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    getDiagnosticsSummary: builder.query<{ data: DiagnosticsSummary }, number>({
      query: (days) => ({ url: `/diagnostics/summary?days=${days}`, method: 'GET' }),
      providesTags: [TAG],
    }),
    getDiagnosticsRuns: builder.query<{ data: DiagnosticsRun[] }, { days: number; limit?: number }>({
      query: ({ days, limit = 50 }) => ({ url: `/diagnostics/runs?days=${days}&limit=${limit}`, method: 'GET' }),
      providesTags: [TAG],
    }),
    getDiagnosticsRun: builder.query<{ data: DiagnosticsRunDetail }, number>({
      query: (id) => ({ url: `/diagnostics/runs/${id}`, method: 'GET' }),
    }),
    getDiagnosticsSync: builder.query<{ data: SyncState }, void>({
      query: () => ({ url: '/diagnostics/sync', method: 'GET' }),
      providesTags: [TAG],
    }),
    getClientReports: builder.query<{ data: ClientReport[] }, number>({
      query: (days) => ({ url: `/diagnostics/client-reports?days=${days}`, method: 'GET' }),
      providesTags: [TAG],
    }),
    syncDiagnosticsNow: builder.mutation<{ data: SyncState }, void>({
      query: () => ({ url: '/diagnostics/sync', method: 'POST' }),
      invalidatesTags: [TAG],
    }),
  }),
});

export const {
  useGetDiagnosticsSummaryQuery,
  useGetDiagnosticsRunsQuery,
  useGetDiagnosticsRunQuery,
  useGetDiagnosticsSyncQuery,
  useSyncDiagnosticsNowMutation,
  useGetClientReportsQuery,
} = diagnosticsService;

/** The export needs the bearer token, so it is fetched as a blob and saved. */
export async function downloadDiagnosticsExport(days: number): Promise<void> {
  const token = authManager.getAccessToken();
  const res = await fetch(`${Global.BASE_API_PATH}/diagnostics/export?days=${days}`, {
    credentials: 'include',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new Error(`Export failed (${res.status})`);
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? `vector-runs-${days}d.jsonl.gz`;
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
