import type { FailureKind } from '@/utils/failureKind';
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
  /** Of prompt_tokens: read from the prompt cache. Absent on older runs. */
  cache_read_tokens?: number;
  /** Written to the prompt cache; null when the provider does not report it. */
  cache_write_tokens?: number | null;
  /** Of completion_tokens: hidden reasoning. */
  reasoning_tokens?: number;
  /** Billed cost of the run's model calls in USD; null when not reported. */
  cost_usd?: number | null;
  /** 'price_list': worked out from tokens × the model's list price (the provider sends no cost). */
  cost_basis?: 'billed' | 'price_list';
  think_ms: number;
  phone_ms: number;
  wait_ms: number;
  failed: number;
  wasted: number;
  waste: Record<string, number>;
  actions: Record<string, number>;
  vision: number;
  packages: string[];
  recoveries?: Record<string, number>;
  /** Model requests recorded with a provider generation id (Vector/Lite runs). */
  generation_count?: number;
  /** What OpenRouter itself billed for those requests, once checked. */
  billed?: BilledCost;
}

export interface BilledCost {
  usd: number;
  found: number;
  requested: number;
  not_checkable: number;
  checked_at: string;
}

export type RunOutcome = 'first_try' | 'recovered' | 'human_assisted' | 'failed' | 'cancelled';

export interface OutcomeBreakdown {
  first_try: number;
  recovered: number;
  human_assisted: number;
  failed: number;
  cancelled: number;
  /** Runs that ended (cancelled excluded). */
  ended: number;
  completion_pct: number | null;
  /** Completion counting only the agent's own failures (shown next to completion_pct). */
  agent_completion_pct?: number | null;
  /** Failed runs by whose problem they were. */
  failure_kinds?: Record<FailureKind, number>;
  /** Successes the system checked on the phone. */
  verified: number;
  failure_reasons: { reason: string; count: number }[];
}

export interface DiagnosticsSummary {
  days: number;
  runs: number;
  measured_runs: number;
  succeeded: number;
  failed: number;
  replay_runs: number;
  outcomes: OutcomeBreakdown;
  recoveries: { kind: string; label: string; count: number }[];
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
    avg_cached_tokens?: number | null;
    avg_cost_usd?: number | null;
    verified: number;
    unverified: number;
    failed_verification: number;
    outcomes: OutcomeBreakdown;
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
  cache_read_tokens?: number;
  cost_usd?: number;
  cost_runs?: number;
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
  outcome: RunOutcome | null;
  failure_kind?: FailureKind | null;
  diagnostics: RunDiagnostics | null;
}

export interface Verification {
  status: 'verified' | 'unverified' | 'failed';
  method: 'rule' | 'judge' | 'replay' | 'none';
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
  cache_read_tokens?: number | null;
  cache_write_tokens?: number | null;
  reasoning_tokens?: number | null;
  cost_usd?: number | null;
  /** Estimated tokens of the screen list this step returned (the next call reads it). */
  screen_tokens?: number | null;
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
    checkBilledCost: builder.mutation<{ data: BilledCost }, number>({
      query: (id) => ({ url: `/diagnostics/runs/${id}/billed`, method: 'POST' }),
    }),
    getTestSet: builder.query<{ data: { tasks: TestSetTask[]; runs: TestSetRun[] } }, void>({
      query: () => ({ url: '/diagnostics/testset', method: 'GET' }),
      providesTags: ['MISSIONS' as never],
    }),
    startTestSet: builder.mutation<{ data: { run: string; missions: number } }, { device_ids: number[]; keys?: string[] }>({
      query: (body) => ({ url: '/diagnostics/testset/run', method: 'POST', body }),
      invalidatesTags: ['MISSIONS' as never],
    }),
    getTestLab: builder.query<{ data: TestLabOverview }, void>({
      query: () => ({ url: '/diagnostics/testlab', method: 'GET' }),
      providesTags: ['TESTLAB' as never],
    }),
    getTestLabNight: builder.query<{ data: TestLabNight }, number>({
      query: (id) => ({ url: `/diagnostics/testlab/nights/${id}`, method: 'GET' }),
      providesTags: ['TESTLAB' as never],
    }),
    getTestLabFreeModels: builder.query<{ data: { id: string; name: string; context: number | null }[] }, void>({
      query: () => ({ url: '/diagnostics/testlab/free-models', method: 'GET' }),
    }),
    saveTestLabSettings: builder.mutation<{ data: TestLabSettings }, TestLabSettings>({
      query: (body) => ({ url: '/diagnostics/testlab/settings', method: 'PUT', body }),
      invalidatesTags: ['TESTLAB' as never],
    }),
    runTestLab: builder.mutation<{ data: { id: number; jobs: number } }, void>({
      query: () => ({ url: '/diagnostics/testlab/run', method: 'POST' }),
      invalidatesTags: ['TESTLAB' as never],
    }),
    stopTestLab: builder.mutation<{ data: { id: number } | null }, void>({
      query: () => ({ url: '/diagnostics/testlab/stop', method: 'POST' }),
      invalidatesTags: ['TESTLAB' as never],
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
  useCheckBilledCostMutation,
  useGetTestSetQuery,
  useStartTestSetMutation,
  useGetTestLabQuery,
  useGetTestLabNightQuery,
  useGetTestLabFreeModelsQuery,
  useSaveTestLabSettingsMutation,
  useRunTestLabMutation,
  useStopTestLabMutation,
} = diagnosticsService;

/** Test Lab (backend testlab/testLab.ts). */
export interface TestLabSettings {
  enabled: boolean;
  hour: number;
  models: string[];
  device_ids: number[];
  runs_per_night: number;
  variant_share: number;
  max_steps: number;
  core: { key: string; prompt: string }[];
  skip_kinds: string[];
}

export type TestLabBucket = 'pass' | 'unsure' | 'engine' | 'model' | 'setup' | 'quota' | 'platform' | 'skipped';
export type TestLabTotals = Record<TestLabBucket, number> & { runs: number; counted: number; pass_rate: number | null; cost_usd: number };

export interface TestLabNightRow {
  id: number;
  day: string;
  status: 'RUNNING' | 'DONE' | 'STOPPED';
  manual: boolean;
  started_at: string;
  finished_at: string | null;
  jobs: number;
  done: number;
  running: number;
  totals: TestLabTotals | null;
}

export interface TestLabOverview {
  settings: TestLabSettings;
  openrouter_ready: boolean;
  github: boolean;
  bank: { key: string; kind: string; prompt: string; needs: string[] }[];
  nights: TestLabNightRow[];
}

export interface TestLabJob {
  id: number;
  key: string;
  kind: string;
  prompt: string;
  original?: string;
  model: string;
  pair?: number;
  status: 'queued' | 'running' | 'done' | 'skipped';
  device_id?: number | null;
  task_id?: number | null;
  note?: string;
  bucket?: TestLabBucket;
  result?: { status: string; reason_code: string | null; message: string; verification: { status: string; method: string; reason: string } | null; parts: string[]; cost_usd: number; steps: number };
}

export interface TestLabReport {
  night_id: number;
  day: string;
  totals: TestLabTotals;
  per_model: { model: string; runs: number; pass: number; unsure: number; engine: number; model_fault: number; quota: number; cost_usd: number; avg_steps: number }[];
  per_kind: { kind: string; runs: number; pass: number; engine: number }[];
  engine: { signature: string; count: number; runs: { key: string; task_id: number | null; model: string; device_id: number | null; why: string }[] }[];
  model_quirks: { model: string; key: string; task_id: number | null; why: string }[];
  setup: { device_id: number | null; key: string; task_id: number | null; why: string }[];
  failed_everywhere: string[];
}

export interface TestLabNight {
  id: number;
  day: string;
  status: 'RUNNING' | 'DONE' | 'STOPPED';
  manual: boolean;
  started_at: string;
  finished_at: string | null;
  jobs: TestLabJob[];
  report: TestLabReport | null;
}

/** One task of the fixed test set (backend testset/testSet.ts). */
export interface TestSetTask {
  key: string;
  kind: string;
  prompt: string;
}

export interface TestSetTaskResult {
  key: string;
  kind: string;
  prompt: string;
  phones: number;
  pending: number;
  passed: number;
  verified: number;
  failed: number;
  costUsd: number;
  steps: number;
  reasons: { reason: string; count: number }[];
}

/** One run of the test set: every task on the same phones, started together. */
export interface TestSetRun {
  run: string;
  startedAt: string;
  phones: number;
  model: string | null;
  engine: string | null;
  finished: number;
  total: number;
  passed: number;
  verified: number;
  costUsd: number;
  tasks: TestSetTaskResult[];
}

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
