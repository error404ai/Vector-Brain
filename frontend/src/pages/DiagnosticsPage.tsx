import PageHeader, { HeaderActions } from '@/components/ui/PageHeader';
import {
  downloadDiagnosticsExport,
  useGetClientReportsQuery,
  useGetDiagnosticsRunQuery,
  useGetDiagnosticsRunsQuery,
  useGetDiagnosticsSummaryQuery,
  useGetDiagnosticsSyncQuery,
  useSyncDiagnosticsNowMutation,
  useCheckBilledCostMutation,
  type ClientReport,
  type DiagnosticsRun,
  type DiagnosticsStep,
  type DiagnosticsSummary,
  type OutcomeBreakdown,
  type RunDiagnostics,
  type RunOutcome,
} from '@/RTKService/diagnosticsService/diagnosticsService';
import CloudSyncIcon from '@mui/icons-material/CloudSync';
import DownloadIcon from '@mui/icons-material/Download';
import {
  Alert,
  Box,
  Button,
  Card,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Skeleton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { FAILURE_KIND, FAILURE_KIND_ORDER } from '@/utils/failureKind';
import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import toast from 'react-hot-toast';

const WASTE_SHORT: Record<string, string> = {
  failed: 'Failed',
  repeat: 'Repeated',
  reopen: 'Re-opened app',
  reread: 'Re-read screen',
  no_effect: 'No effect',
  backtrack: 'Went back',
};

const SOURCE_LABEL: Record<string, string> = { ai: 'AI', replay: 'Replay', direct: 'Direct' };
const ENGINE_LABEL: Record<string, string> = { eko: 'Eko', vector: 'Vector', lite: 'Lite', replay: 'Replay' };
const OUTCOME: Record<RunOutcome, { label: string; short: string; color: string; chip: 'success' | 'info' | 'warning' | 'error' | 'default' }> = {
  first_try: { label: 'Done first try', short: 'First try', color: 'success.main', chip: 'success' },
  recovered: { label: 'Done after recovery', short: 'Recovered', color: 'info.main', chip: 'info' },
  human_assisted: { label: 'Done with your help', short: 'Human-assisted', color: 'warning.main', chip: 'warning' },
  failed: { label: 'Failed', short: 'Failed', color: 'error.main', chip: 'error' },
  cancelled: { label: 'Cancelled', short: 'Cancelled', color: 'text.disabled', chip: 'default' },
};
const ENDED_OUTCOMES: RunOutcome[] = ['first_try', 'recovered', 'human_assisted', 'failed'];
const VERIFICATION_LABEL: Record<string, string> = { verified: 'Verified', unverified: 'Not verified', failed: 'Verification failed' };

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-IN');
/** USD with enough decimals to tell fractions of a cent apart. */
const fmtUsd = (n: number) => (n === 0 ? '$0' : n < 0.01 ? `$${n.toFixed(4)}` : n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`);
const fmtSeconds = (ms: number) => {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  const m = s / 60;
  return m < 60 ? `${m.toFixed(1)} min` : `${(m / 60).toFixed(1)} h`;
};
const pct = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–');

/**
 * Where the agent's steps, time and tokens go: every run records the screen
 * before and after each step, who chose it, how long the model thought, what it
 * cost, and whether the step was wasted.
 */
export default function DiagnosticsPage() {
  const [days, setDays] = useState(7);
  const [openRun, setOpenRun] = useState<number | null>(null);
  const [downloading, setDownloading] = useState(false);
  const summaryQuery = useGetDiagnosticsSummaryQuery(days);
  const runsQuery = useGetDiagnosticsRunsQuery({ days, limit: 50 });
  const syncQuery = useGetDiagnosticsSyncQuery();
  const [syncNow, { isLoading: syncing }] = useSyncDiagnosticsNowMutation();
  const summary = summaryQuery.data?.data;
  const sync = syncQuery.data?.data;

  const handleDownload = async () => {
    setDownloading(true);
    try {
      await downloadDiagnosticsExport(days);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Download failed');
    } finally {
      setDownloading(false);
    }
  };

  const handleSync = async () => {
    try {
      const res = await syncNow().unwrap();
      if (res.data.last_error) toast.error(res.data.last_error);
      else toast.success(`Pushed ${res.data.last_file ?? 'summary'} to ${res.data.repo}`);
    } catch {
      toast.error('Sync failed');
    }
  };

  const timeTotal = summary ? summary.think_ms + summary.phone_ms + summary.wait_ms : 0;

  return (
    <>
      <Helmet>
        <title>Run diagnostics - Vector Brain</title>
      </Helmet>
      <PageHeader
        title="Run diagnostics"
        subtitle="Where the agent's steps, time and tokens go, across every run. Runs recorded before this page existed show totals only."
        action={
          <HeaderActions>
            <ToggleButtonGroup size="small" exclusive value={days} onChange={(_, v) => v && setDays(v)} aria-label="Time range">
              <ToggleButton value={1}>24 h</ToggleButton>
              <ToggleButton value={7}>7 days</ToggleButton>
              <ToggleButton value={30}>30 days</ToggleButton>
            </ToggleButtonGroup>
            <Button variant="outlined" startIcon={<DownloadIcon />} onClick={() => void handleDownload()} disabled={downloading}>
              {downloading ? 'Preparing…' : 'Download data'}
            </Button>
          </HeaderActions>
        }
      />

      {summaryQuery.isLoading || !summary ? (
        <Stack spacing={2}>
          <Skeleton variant="rounded" height={96} />
          <Skeleton variant="rounded" height={240} />
        </Stack>
      ) : (
        <Stack spacing={2.5}>
          {summary.measured_runs === 0 ? (
            <Alert severity="info">
              Recording is on. No run in this period has step-level data yet; new runs appear here as soon as they finish.
            </Alert>
          ) : null}

          {summary.outcomes ? <OutcomeCard outcomes={summary.outcomes} recoveries={summary.recoveries ?? []} /> : null}

          <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(5, minmax(0, 1fr))' } }}>
            <Stat label="Runs" value={fmtInt(summary.runs)} note={`${pct(summary.succeeded, summary.runs)} succeeded · ${fmtInt(summary.replay_runs)} replays`} />
            <Stat label="Avg steps (successful)" value={String(summary.avg_steps_succeeded)} note={`${fmtInt(summary.measured_runs)} runs recorded in detail`} />
            <Stat label="Wasted steps" value={pct(summary.wasted, summary.steps)} note={`${fmtInt(summary.wasted)} of ${fmtInt(summary.steps)} recorded steps`} />
            <Stat
              label="AI calls"
              value={fmtInt(summary.llm_calls)}
              note={summary.token_runs ? `${fmtInt(summary.prompt_tokens + summary.completion_tokens)} tokens (${fmtInt(summary.token_runs)} runs reported)` : 'Provider did not report tokens'}
            />
            <Stat
              label="Time split"
              value={pct(summary.think_ms, timeTotal) === '–' ? '–' : `${pct(summary.think_ms, timeTotal)} AI`}
              note={`AI thinking ${fmtSeconds(summary.think_ms)} · phone ${fmtSeconds(summary.phone_ms)} · waits ${fmtSeconds(summary.wait_ms)}`}
            />
          </Box>

          <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) minmax(0, 1fr)' } }}>
            <Card variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                Where steps are wasted
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Share of all recorded steps, by reason.
              </Typography>
              {summary.waste.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No wasted steps recorded in this period.
                </Typography>
              ) : (
                <Stack spacing={1.25}>
                  {summary.waste.map((w) => (
                    <WasteBar key={w.tag} label={w.label} count={w.count} total={summary.steps} max={summary.waste[0].count} />
                  ))}
                </Stack>
              )}
            </Card>

            <Card variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                Most used actions
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                Every step of recorded runs, by action.
              </Typography>
              {summary.actions.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  Nothing recorded yet.
                </Typography>
              ) : (
                <Stack spacing={1.25}>
                  {summary.actions.slice(0, 8).map((a) => (
                    <WasteBar key={a.action} label={a.action} count={a.count} total={summary.steps} max={summary.actions[0].count} />
                  ))}
                </Stack>
              )}
            </Card>
          </Box>

          {summary.engines.length ? <EngineComparison engines={summary.engines} /> : null}

          <Card variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
              Tasks run more than once
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              The same instruction (numbers ignored). These are the first candidates for replay without AI.
            </Typography>
            {summary.repeated_tasks.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No instruction was run more than once in this period.
              </Typography>
            ) : (
              <ScrollTable>
                <TableHead>
                  <TableRow>
                    <TableCell>Instruction</TableCell>
                    <TableCell align="right">Runs</TableCell>
                    <TableCell align="right">Success</TableCell>
                    <TableCell align="right">Avg steps</TableCell>
                    <TableCell align="right">Avg wasted</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {summary.repeated_tasks.map((t) => (
                    <TableRow key={t.prompt}>
                      <TableCell sx={{ maxWidth: 420 }}>
                        <Typography variant="body2" noWrap title={t.prompt}>
                          {t.prompt}
                        </Typography>
                      </TableCell>
                      <TableCell align="right">{t.runs}</TableCell>
                      <TableCell align="right">{Math.round(t.success_rate * 100)}%</TableCell>
                      <TableCell align="right">{t.avg_steps}</TableCell>
                      <TableCell align="right">{t.avg_wasted ?? '–'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </ScrollTable>
            )}
          </Card>

          {summary.top_packages.length ? (
            <Card variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>
                Apps
              </Typography>
              <ScrollTable>
                <TableHead>
                  <TableRow>
                    <TableCell>App</TableCell>
                    <TableCell align="right">Runs</TableCell>
                    <TableCell align="right">Steps</TableCell>
                    <TableCell align="right">Wasted</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {summary.top_packages.map((p) => (
                    <TableRow key={p.package}>
                      <TableCell>{p.package}</TableCell>
                      <TableCell align="right">{p.runs}</TableCell>
                      <TableCell align="right">{p.steps}</TableCell>
                      <TableCell align="right">
                        {p.wasted} ({pct(p.wasted, p.steps)})
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </ScrollTable>
            </Card>
          ) : null}

          <BrowserReports days={days} />

          <Card variant="outlined" sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
              Recent runs
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Open a run to see every step: who chose it, how long the AI thought, what it cost, and why it was wasted.
            </Typography>
            <RunsTable runs={runsQuery.data?.data ?? []} loading={runsQuery.isLoading} onOpen={setOpenRun} />
          </Card>

          <Card variant="outlined" sx={{ p: 2 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ sm: 'center' }} justifyContent="space-between">
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                  GitHub sync
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {sync?.configured
                    ? `Every 2 hours, sanitized runs go to the private repo ${sync.repo}${sync.last_push_at ? ` · last push ${new Date(sync.last_push_at).toLocaleString()}` : ''}.`
                    : 'Off. Set DIAG_GITHUB_REPO and DIAG_GITHUB_TOKEN on the server to push sanitized runs to a private repository automatically.'}
                </Typography>
                {sync?.last_error ? (
                  <Typography variant="body2" color="error" sx={{ mt: 0.5 }}>
                    {sync.last_error}
                  </Typography>
                ) : null}
              </Box>
              <Button variant="outlined" startIcon={<CloudSyncIcon />} disabled={!sync?.configured || syncing} onClick={() => void handleSync()} sx={{ flexShrink: 0 }}>
                {syncing ? 'Syncing…' : 'Sync now'}
              </Button>
            </Stack>
          </Card>
        </Stack>
      )}

      <RunDialog id={openRun} onClose={() => setOpenRun(null)} />
    </>
  );
}

/**
 * The reliability numbers (docs/RELIABILITY.md): how every run that ended
 * ended. Human-assisted runs sit apart and never inflate "first try".
 */
function OutcomeCard({ outcomes, recoveries }: { outcomes: OutcomeBreakdown; recoveries: { kind: string; label: string; count: number }[] }) {
  const ended = outcomes.ended;
  return (
    <Card variant="outlined" sx={{ p: 2 }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={{ xs: 1.5, md: 3 }} alignItems={{ md: 'center' }}>
        <Box sx={{ minWidth: 170 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
            Task completion
          </Typography>
          <Typography variant="h3" sx={{ fontWeight: 900, fontVariantNumeric: 'tabular-nums', lineHeight: 1.1 }}>
            {outcomes.completion_pct === null ? '–' : `${Math.round(outcomes.completion_pct)}%`}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            of {fmtInt(ended)} finished runs · {fmtInt(outcomes.verified)} checked on the phone
            {outcomes.cancelled ? ` · ${fmtInt(outcomes.cancelled)} cancelled not counted` : ''}
          </Typography>
          {outcomes.agent_completion_pct != null ? (
            <Tooltip title="Completion counting only the agent's own failures: runs lost to the phone, the AI provider, our server or a step only you can do are left out.">
              <Typography variant="body2" sx={{ mt: 0.75, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                {`${Math.round(outcomes.agent_completion_pct)}%`}{' '}
                <Typography component="span" variant="caption" color="text.secondary">
                  agent success (own mistakes only)
                </Typography>
              </Typography>
            </Tooltip>
          ) : null}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box
            role="img"
            aria-label={ENDED_OUTCOMES.map((o) => `${OUTCOME[o].label} ${outcomes[o]}`).join(', ')}
            sx={{ display: 'flex', height: 12, borderRadius: 1, overflow: 'hidden', bgcolor: 'action.hover', gap: '2px' }}
          >
            {ended > 0
              ? ENDED_OUTCOMES.filter((o) => outcomes[o] > 0).map((o) => (
                  <Tooltip key={o} title={`${OUTCOME[o].label}: ${outcomes[o]} (${pct(outcomes[o], ended)})`}>
                    <Box sx={{ width: `${(outcomes[o] / ended) * 100}%`, bgcolor: OUTCOME[o].color, minWidth: 4 }} />
                  </Tooltip>
                ))
              : null}
          </Box>
          <Box sx={{ mt: 1.25, display: 'grid', gap: 1, gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', sm: 'repeat(4, minmax(0, 1fr))' } }}>
            {ENDED_OUTCOMES.map((o) => (
              <Stack key={o} direction="row" spacing={1} alignItems="flex-start" sx={{ minWidth: 0 }}>
                <Box sx={{ mt: 0.6, width: 10, height: 10, borderRadius: '3px', bgcolor: OUTCOME[o].color, flexShrink: 0 }} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtInt(outcomes[o])} <Typography component="span" variant="caption" color="text.secondary">{pct(outcomes[o], ended)}</Typography>
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                    {OUTCOME[o].label}
                  </Typography>
                </Box>
              </Stack>
            ))}
          </Box>
        </Box>
      </Stack>
      {outcomes.failure_kinds && outcomes.failed > 0 ? <FailureKinds kinds={outcomes.failure_kinds} failed={outcomes.failed} /> : null}
      {outcomes.failure_reasons.length || recoveries.length ? (
        <Box sx={{ mt: 2, display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' } }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 800, mb: 0.75 }}>
              Why runs failed
            </Typography>
            {outcomes.failure_reasons.length ? (
              <Stack direction="row" useFlexGap flexWrap="wrap" spacing={0.75}>
                {outcomes.failure_reasons.map((r) => (
                  <Chip key={r.reason} size="small" variant="outlined" color="error" label={`${r.reason} · ${r.count}`} />
                ))}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No failures in this period.
              </Typography>
            )}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 800, mb: 0.75 }}>
              What the engine recovered from
            </Typography>
            {recoveries.length ? (
              <Stack direction="row" useFlexGap flexWrap="wrap" spacing={0.75}>
                {recoveries.map((r) => (
                  <Tooltip key={r.kind} title={r.label}>
                    <Chip size="small" variant="outlined" color="info" label={`${r.label} · ${r.count}`} />
                  </Tooltip>
                ))}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                Nothing recorded yet (counted for runs from this release on).
              </Typography>
            )}
          </Box>
        </Box>
      ) : null}
    </Card>
  );
}

/** Failed runs split by whose problem they were (agent, user, phone, AI service, server). */
function FailureKinds({ kinds, failed }: { kinds: NonNullable<OutcomeBreakdown['failure_kinds']>; failed: number }) {
  const present = FAILURE_KIND_ORDER.filter((k) => kinds[k] > 0);
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="body2" sx={{ fontWeight: 800, mb: 0.75 }}>
        Whose problem the {fmtInt(failed)} failures were
      </Typography>
      <Box
        role="img"
        aria-label={present.map((k) => `${FAILURE_KIND[k].label} ${kinds[k]}`).join(', ')}
        sx={{ display: 'flex', height: 8, borderRadius: 1, overflow: 'hidden', bgcolor: 'action.hover', gap: '2px' }}
      >
        {present.map((k) => (
          <Tooltip key={k} title={`${FAILURE_KIND[k].label}: ${kinds[k]} (${pct(kinds[k], failed)})`}>
            <Box sx={{ width: `${(kinds[k] / failed) * 100}%`, bgcolor: FAILURE_KIND[k].color, minWidth: 4 }} />
          </Tooltip>
        ))}
      </Box>
      <Stack direction="row" useFlexGap flexWrap="wrap" spacing={0.75} sx={{ mt: 1 }}>
        {present.map((k) => (
          <Tooltip key={k} title={FAILURE_KIND[k].hint}>
            <Chip
              size="small"
              variant="outlined"
              icon={<Box component="span" sx={{ width: 8, height: 8, borderRadius: '2px', bgcolor: FAILURE_KIND[k].color, ml: '8px !important' }} />}
              label={`${FAILURE_KIND[k].label} · ${kinds[k]}`}
            />
          </Tooltip>
        ))}
      </Stack>
    </Box>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <Card variant="outlined" sx={{ p: 1.75, minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>
        {label}
      </Typography>
      <Typography variant="h5" sx={{ fontWeight: 900, fontVariantNumeric: 'tabular-nums', lineHeight: 1.3 }}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
        {note}
      </Typography>
    </Card>
  );
}

/** One row of a single-series horizontal bar list: label, bar, and the value written out. */
function WasteBar({ label, count, total, max }: { label: string; count: number; total: number; max: number }) {
  const width = max > 0 ? Math.max(2, (count / max) * 100) : 0;
  return (
    <Tooltip title={`${count} steps · ${pct(count, total)} of recorded steps`} placement="top-start">
      <Box sx={{ cursor: 'default' }}>
        <Stack direction="row" justifyContent="space-between" spacing={1}>
          <Typography variant="body2" noWrap>
            {label}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
            {fmtInt(count)} · {pct(count, total)}
          </Typography>
        </Stack>
        <Box sx={{ mt: 0.5, height: 8, borderRadius: 1, bgcolor: 'action.hover' }}>
          <Box sx={{ width: `${width}%`, height: '100%', borderRadius: 1, bgcolor: 'primary.main' }} />
        </Box>
      </Box>
    </Tooltip>
  );
}

function ScrollTable({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ overflowX: 'auto', mx: -1 }}>
      <Table size="small" sx={{ minWidth: 560 }}>
        {children}
      </Table>
    </Box>
  );
}

function RunsTable({ runs, loading, onOpen }: { runs: DiagnosticsRun[]; loading: boolean; onOpen: (id: number) => void }) {
  if (loading) return <Skeleton variant="rounded" height={160} />;
  if (!runs.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        No runs in this period.
      </Typography>
    );
  }
  return (
    <ScrollTable>
      <TableHead>
        <TableRow>
          <TableCell>When</TableCell>
          <TableCell>Instruction</TableCell>
          <TableCell>Phone</TableCell>
          <TableCell>Engine</TableCell>
          <TableCell>Result</TableCell>
          <TableCell align="right">Steps</TableCell>
          <TableCell align="right">Wasted</TableCell>
          <TableCell align="right">AI calls</TableCell>
          <TableCell align="right">Tokens</TableCell>
          <TableCell align="right">Cost</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {runs.map((r) => {
          const d = r.diagnostics && r.diagnostics.steps > 0 ? r.diagnostics : null;
          return (
            <TableRow key={r.id} hover onClick={() => onOpen(r.id)} sx={{ cursor: 'pointer' }}>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{new Date(r.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</TableCell>
              <TableCell sx={{ maxWidth: 320 }}>
                <Typography variant="body2" noWrap title={r.prompt}>
                  {r.prompt}
                </Typography>
              </TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.device ?? '–'}</TableCell>
              <TableCell sx={{ whiteSpace: 'nowrap' }}>{ENGINE_LABEL[r.engine] ?? r.engine}</TableCell>
              <TableCell>
                {r.outcome ? (
                  <Tooltip title={r.failure_kind ? `${FAILURE_KIND[r.failure_kind].label}: ${FAILURE_KIND[r.failure_kind].hint}` : ''}>
                    <Chip
                      size="small"
                      variant="outlined"
                      color={OUTCOME[r.outcome].chip}
                      label={r.outcome === 'failed' ? `${r.failure_kind ? `${FAILURE_KIND[r.failure_kind].short} · ` : ''}${r.reason ?? 'Failed'}` : OUTCOME[r.outcome].short}
                    />
                  </Tooltip>
                ) : (
                  <Chip size="small" variant="outlined" label={r.status} />
                )}
              </TableCell>
              <TableCell align="right">{r.total_steps}</TableCell>
              <TableCell align="right">{d ? `${d.wasted} (${pct(d.wasted, d.steps)})` : '–'}</TableCell>
              <TableCell align="right">{d ? d.llm_calls : '–'}</TableCell>
              <TableCell align="right">{d?.tokens_reported ? fmtInt(d.prompt_tokens + d.completion_tokens) : '–'}</TableCell>
              <TableCell align="right" title={d?.cost_basis === 'price_list' ? 'Estimated from tokens × the model list price; this provider sends no cost' : undefined}>
                {d?.cost_usd != null ? `${d.cost_basis === 'price_list' ? '≈' : ''}${fmtUsd(d.cost_usd)}` : '–'}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </ScrollTable>
  );
}

function RunDialog({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data, isFetching } = useGetDiagnosticsRunQuery(id ?? 0, { skip: id === null });
  const run = data?.data;
  const d = run?.diagnostics;
  return (
    <Dialog open={id !== null} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle sx={{ pr: 6 }}>
        Run #{id}
        <IconButton onClick={onClose} sx={{ position: 'absolute', right: 12, top: 12 }} aria-label="Close">
          <CloseIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        {isFetching || !run ? (
          <Skeleton variant="rounded" height={240} />
        ) : (
          <Stack spacing={2}>
            <Box>
              <Typography variant="body1" sx={{ fontWeight: 700, wordBreak: 'break-word' }}>
                {run.prompt}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {run.device ?? 'Unknown phone'} · {run.status}
                {run.reason_code ? ` (${run.reason_code})` : ''} · {run.total_steps} steps in {Math.round(run.total_duration_seconds)}s · {run.model ?? ''} ·{' '}
                {ENGINE_LABEL[run.engine ?? 'eko'] ?? run.engine} engine
              </Typography>
              {run.verification ? (
                <Alert severity={run.verification.status === 'verified' ? 'success' : run.verification.status === 'failed' ? 'error' : 'warning'} sx={{ mt: 1 }}>
                  <strong>{VERIFICATION_LABEL[run.verification.status]}</strong>
                  {` (${run.verification.method === 'rule' ? 'checked on the phone' : run.verification.method === 'judge' ? 'checked by a separate AI call' : run.verification.method === 'replay' ? 'every saved-flow step reached its recorded screen' : 'no check applied'}${run.verification.retries ? `, agent sent back ${run.verification.retries}×` : ''}): `}
                  {run.verification.reason}
                </Alert>
              ) : null}
            </Box>
            {d && d.steps > 0 ? (
              <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                <Chip size="small" label={`Wasted ${d.wasted} of ${d.steps}`} />
                <Chip size="small" label={`AI calls ${d.llm_calls}`} />
                <Chip size="small" label={d.tokens_reported ? `Tokens ${fmtInt(d.prompt_tokens + d.completion_tokens)}` : 'Tokens not reported'} />
                <Chip size="small" label={`AI thinking ${fmtSeconds(d.think_ms)}`} />
                <Chip size="small" label={`Phone ${fmtSeconds(d.phone_ms)}`} />
                {d.wait_ms ? <Chip size="small" label={`Waiting ${fmtSeconds(d.wait_ms)}`} /> : null}
                {Object.entries(d.sources).map(([s, n]) => (
                  <Chip key={s} size="small" variant="outlined" label={`Chosen by ${SOURCE_LABEL[s] ?? s}: ${n}`} />
                ))}
              </Stack>
            ) : (
              <Alert severity="info">This run was recorded before step diagnostics existed.</Alert>
            )}
            {d && d.tokens_reported ? <TokenBreakdown d={d} screenTokens={avgScreenTokens(run.steps)} /> : null}
            {d && d.generation_count ? <BilledCheck runId={run.id} d={d} /> : null}
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 980 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    <TableCell>By</TableCell>
                    <TableCell>Action</TableCell>
                    <TableCell>App</TableCell>
                    <TableCell align="right">AI think</TableCell>
                    <TableCell align="right">Phone</TableCell>
                    <TableCell align="right">Input</TableCell>
                    <TableCell align="right">Cached</TableCell>
                    <TableCell align="right">
                      <Tooltip title="Estimated tokens of the screen list this step returned. The next AI call reads it in full, uncached.">
                        <span>Screen</span>
                      </Tooltip>
                    </TableCell>
                    <TableCell align="right">Output</TableCell>
                    <TableCell align="right">Cost</TableCell>
                    <TableCell>Wasted</TableCell>
                    <TableCell>Why (AI)</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {run.steps.map((s) => (
                    <StepRow key={s.id} step={s} labels={run.waste_labels} />
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Where one run's tokens went: input read fresh vs from the prompt cache,
 * cache writes, output (with hidden reasoning) and what the provider billed.
 */
/** Average estimated size of the screen lists the run's steps returned, or null when none were stored. */
function avgScreenTokens(steps: DiagnosticsStep[]): number | null {
  const sizes = steps.map((s) => s.screen_tokens ?? 0).filter((n) => n > 0);
  return sizes.length ? Math.round(sizes.reduce((a, b) => a + b, 0) / sizes.length) : null;
}

function TokenBreakdown({ d, screenTokens }: { d: RunDiagnostics; screenTokens: number | null }) {
  const cached = Math.min(d.cache_read_tokens ?? 0, d.prompt_tokens);
  const fresh = Math.max(0, d.prompt_tokens - cached);
  const output = d.completion_tokens;
  const total = Math.max(1, fresh + cached + output);
  const parts = [
    { key: 'fresh', label: 'Input, sent fresh', value: fresh, color: '#5b6cff', note: 'Billed at the full input price' },
    { key: 'cached', label: 'Input, from cache', value: cached, color: '#18a874', note: cached ? `${pct(cached, d.prompt_tokens)} of input · billed at ~10% on Claude` : 'Nothing was read from the cache' },
    {
      key: 'output',
      label: 'Output',
      value: output,
      color: '#f08a24',
      note: d.reasoning_tokens ? `${fmtInt(d.reasoning_tokens)} of it hidden reasoning` : 'Usually the priciest tokens per unit',
    },
  ];
  return (
    <Card variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
      <Stack direction="row" alignItems="baseline" justifyContent="space-between" flexWrap="wrap" useFlexGap spacing={1} sx={{ mb: 1.25 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
          Where the tokens went
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {fmtInt(d.prompt_tokens + output)} tokens over {d.llm_calls} AI calls
          {d.cost_usd != null ? (
            <>
              {d.cost_basis === 'price_list' ? ' · about ' : ' · billed '}
              <Box component="strong" sx={{ color: 'text.primary' }}>
                {fmtUsd(d.cost_usd)}
              </Box>
              {d.cost_basis === 'price_list' && ' (tokens × list price; this provider sends no cost)'}
            </>
          ) : (
            ' · cost not reported by this provider'
          )}
        </Typography>
      </Stack>
      <Box role="img" aria-label="Share of fresh input, cached input and output tokens" sx={{ display: 'flex', height: 10, borderRadius: 5, overflow: 'hidden', bgcolor: 'action.hover', mb: 1.5 }}>
        {parts.map((p) => (p.value ? <Box key={p.key} sx={{ width: `${(p.value / total) * 100}%`, bgcolor: p.color, transition: 'width 400ms ease' }} /> : null))}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' }, gap: 1.5 }}>
        {parts.map((p) => (
          <Box key={p.key}>
            <Stack direction="row" alignItems="center" spacing={0.75}>
              <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: p.color, flexShrink: 0 }} />
              <Typography variant="caption" color="text.secondary">
                {p.label}
              </Typography>
            </Stack>
            <Typography sx={{ fontWeight: 800, fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>{fmtInt(p.value)}</Typography>
            <Typography variant="caption" color="text.secondary">
              {p.note}
            </Typography>
          </Box>
        ))}
        <Box>
          <Typography variant="caption" color="text.secondary">
            Written to cache
          </Typography>
          <Typography sx={{ fontWeight: 800, fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>{d.cache_write_tokens != null ? fmtInt(d.cache_write_tokens) : '–'}</Typography>
          <Typography variant="caption" color="text.secondary">
            {d.cache_write_tokens != null ? 'Billed at 1.25× once, then read cheaply' : 'Not reported by OpenRouter; included in the billed cost'}
          </Typography>
        </Box>
        {screenTokens ? (
          <Box>
            <Typography variant="caption" color="text.secondary">
              Screen list, per call
            </Typography>
            <Typography sx={{ fontWeight: 800, fontSize: 18, fontVariantNumeric: 'tabular-nums' }}>~{fmtInt(screenTokens)}</Typography>
            <Typography variant="caption" color="text.secondary">
              {d.llm_calls && d.prompt_tokens ? `≈${pct(screenTokens, Math.max(1, d.prompt_tokens - Math.min(d.cache_read_tokens ?? 0, d.prompt_tokens)) / d.llm_calls)} of the fresh input; estimated` : 'Estimated from the stored screens'}
            </Typography>
          </Box>
        ) : null}
      </Box>
    </Card>
  );
}

/**
 * The provider's own bill for the run, next to what the run recorded. OpenRouter
 * is asked for every request the engine made, including retried or cut-off
 * attempts and the plan and completion-check calls, which the recorded cost misses.
 */
function BilledCheck({ runId, d }: { runId: number; d: RunDiagnostics }) {
  const [check, { data, isLoading }] = useCheckBilledCostMutation();
  const billed = data?.data ?? d.billed ?? null;
  const recorded = d.cost_usd ?? null;
  const gap = billed && recorded != null ? billed.usd - recorded : null;
  const run = async () => {
    try {
      await check(runId).unwrap();
    } catch (error) {
      toast.error((error as { data?: { message?: string } })?.data?.message ?? 'Could not reach OpenRouter');
    }
  };
  return (
    <Card variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between">
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
            Billed by OpenRouter
          </Typography>
          {billed ? (
            <>
              <Typography sx={{ fontWeight: 800, fontSize: 22, fontVariantNumeric: 'tabular-nums' }}>{fmtUsd(billed.usd)}</Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {billed.found} of {billed.requested} requests found
                {billed.not_checkable ? ` · ${billed.not_checkable} made through a provider that cannot be asked` : ''} · checked{' '}
                {new Date(billed.checked_at).toLocaleTimeString()}
              </Typography>
              {gap != null ? (
                <Typography variant="caption" sx={{ display: 'block', color: Math.abs(gap) < 0.000005 ? 'success.main' : 'warning.main' }}>
                  {Math.abs(gap) < 0.000005
                    ? `Matches the recorded ${fmtUsd(recorded ?? 0)}`
                    : `Recorded ${fmtUsd(recorded ?? 0)} · ${gap > 0 ? `${fmtUsd(gap)} more was billed (retries, cut-off calls)` : `${fmtUsd(-gap)} less was billed`}`}
                </Typography>
              ) : null}
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {d.generation_count} model requests recorded. Ask OpenRouter what each one was actually billed.
            </Typography>
          )}
        </Box>
        <Button variant={billed ? 'outlined' : 'contained'} size="small" onClick={run} disabled={isLoading} sx={{ flexShrink: 0 }}>
          {isLoading ? 'Asking OpenRouter…' : billed ? 'Check again' : 'Check with OpenRouter'}
        </Button>
      </Stack>
    </Card>
  );
}

function StepRow({ step, labels }: { step: DiagnosticsStep; labels: Record<string, string> }) {
  const payload = step.action_payload ? JSON.stringify(step.action_payload) : '';
  const app = step.package_after && step.package_after !== step.package_before ? `${step.package_before ?? '?'} → ${step.package_after}` : step.package_before ?? '–';
  return (
    <TableRow sx={step.waste ? { bgcolor: 'action.hover' } : undefined}>
      <TableCell>{step.step_index}</TableCell>
      <TableCell>
        <Chip size="small" variant="outlined" label={SOURCE_LABEL[step.source] ?? step.source} />
      </TableCell>
      <TableCell sx={{ maxWidth: 220 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {step.action_type}
        </Typography>
        {payload && payload !== '{}' ? (
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }} title={payload}>
            {payload}
          </Typography>
        ) : null}
      </TableCell>
      <TableCell sx={{ maxWidth: 200 }}>
        <Typography variant="caption" noWrap sx={{ display: 'block' }} title={app}>
          {app}
        </Typography>
      </TableCell>
      <TableCell align="right">{step.think_ms !== null ? fmtSeconds(step.think_ms) : '–'}</TableCell>
      <TableCell align="right">{fmtSeconds(step.duration_ms ?? 0)}</TableCell>
      <TableCell align="right">{step.prompt_tokens ? fmtInt(step.prompt_tokens) : ''}</TableCell>
      <TableCell align="right" sx={{ color: 'success.main' }}>
        {step.prompt_tokens && step.cache_read_tokens ? fmtInt(step.cache_read_tokens) : step.prompt_tokens ? '0' : ''}
      </TableCell>
      <TableCell align="right" sx={{ color: 'text.secondary' }}>
        {step.screen_tokens ? `~${fmtInt(step.screen_tokens)}` : ''}
      </TableCell>
      <TableCell align="right">
        {step.prompt_tokens ? (
          <Tooltip title={step.reasoning_tokens ? `${fmtInt(step.reasoning_tokens)} of them hidden reasoning` : ''}>
            <span>{fmtInt(step.completion_tokens ?? 0)}</span>
          </Tooltip>
        ) : (
          ''
        )}
      </TableCell>
      <TableCell align="right">{step.cost_usd != null ? fmtUsd(step.cost_usd) : ''}</TableCell>
      <TableCell>
        {step.waste ? (
          <Tooltip title={labels[step.waste] ?? step.waste}>
            <Chip size="small" color="warning" variant="outlined" label={WASTE_SHORT[step.waste] ?? step.waste} />
          </Tooltip>
        ) : null}
      </TableCell>
      <TableCell sx={{ maxWidth: 320 }}>
        <Typography variant="caption" color="text.secondary" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }} title={step.thought_reasoning}>
          {step.thought_reasoning}
        </Typography>
      </TableCell>
    </TableRow>
  );
}

function EngineComparison({ engines }: { engines: DiagnosticsSummary['engines'] }) {
  const show = (value: number | null, suffix = '') => (value === null ? '–' : `${value}${suffix}`);
  return (
    <Card variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
        Engines compared
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Averages per run with step data. Switch engines in Settings → Agent engine.
      </Typography>
      <ScrollTable>
        <TableHead>
          <TableRow>
            <TableCell>Engine</TableCell>
            <TableCell align="right">Runs</TableCell>
            <TableCell align="right">Completion</TableCell>
            <TableCell align="right">First try / recovered / failed</TableCell>
            <TableCell align="right">Avg steps</TableCell>
            <TableCell align="right">Avg wasted</TableCell>
            <TableCell align="right">Avg AI calls</TableCell>
            <TableCell align="right">Avg tokens</TableCell>
            <TableCell align="right">Avg cached</TableCell>
            <TableCell align="right">Avg cost</TableCell>
            <TableCell align="right">Avg AI thinking</TableCell>
            <TableCell align="right">Verified / not / failed</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {engines.map((e) => (
            <TableRow key={e.engine}>
              <TableCell>{ENGINE_LABEL[e.engine] ?? e.engine}</TableCell>
              <TableCell align="right">
                {e.runs}
                {e.measured_runs !== e.runs ? ` (${e.measured_runs} measured)` : ''}
              </TableCell>
              <TableCell align="right">{e.outcomes?.completion_pct == null ? '–' : `${Math.round(e.outcomes.completion_pct)}%`}</TableCell>
              <TableCell align="right">{e.outcomes ? `${e.outcomes.first_try} / ${e.outcomes.recovered} / ${e.outcomes.failed}` : '–'}</TableCell>
              <TableCell align="right">{show(e.avg_steps)}</TableCell>
              <TableCell align="right">{show(e.avg_wasted)}</TableCell>
              <TableCell align="right">{show(e.avg_llm_calls)}</TableCell>
              <TableCell align="right">{e.avg_tokens === null ? '–' : fmtInt(e.avg_tokens)}</TableCell>
              <TableCell align="right">{e.avg_cached_tokens == null ? '–' : fmtInt(e.avg_cached_tokens)}</TableCell>
              <TableCell align="right">{e.avg_cost_usd == null ? '–' : fmtUsd(e.avg_cost_usd)}</TableCell>
              <TableCell align="right">{show(e.avg_think_s, ' s')}</TableCell>
              <TableCell align="right">{e.engine === 'vector' || e.engine === 'lite' ? `${e.verified} / ${e.unverified} / ${e.failed_verification}` : '–'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </ScrollTable>
    </Card>
  );
}

const REPORT_LABEL: Record<string, { label: string; color: 'error' | 'warning' | 'default' | 'info' }> = {
  unclean_exit: { label: 'Page crashed / killed', color: 'error' },
  stuck_loader: { label: 'Stuck loader', color: 'warning' },
  main_thread_stall: { label: 'Page froze', color: 'error' },
  browser_crash: { label: 'Chrome crash report', color: 'error' },
  chat_error: { label: 'Chat request failed', color: 'error' },
  render_error: { label: 'Render error', color: 'error' },
  js_error: { label: 'JS error', color: 'warning' },
  unhandled_rejection: { label: 'Promise error', color: 'warning' },
  manual: { label: 'Manual', color: 'info' },
};

type Snap = {
  page?: string;
  since_boot_s?: number;
  memory?: { used_mb: number; limit_mb: number } | null;
  data_images?: number;
  data_image_mb?: number;
  images?: number;
  decoded_image_mb?: number;
  dom_nodes?: number;
  ws?: { frames?: number; frame_mb?: number; last_frame_s_ago?: number | null; opened?: number; closed?: number };
  long_tasks?: { count: number; total_ms: number };
  pending?: { method: string; path: string; age_s: number }[];
  auth?: Record<string, unknown> | null;
};

function browserName(ua: string | null): string {
  if (!ua) return '–';
  const edge = /Edg\/(\d+)/.exec(ua);
  if (edge) return `Edge ${edge[1]}`;
  const chrome = /Chrome\/(\d+)/.exec(ua);
  if (chrome) return `Chrome ${chrome[1]}${/Mobile/.test(ua) ? ' mobile' : ''}`;
  const firefox = /Firefox\/(\d+)/.exec(ua);
  if (firefox) return `Firefox ${firefox[1]}`;
  if (/Safari\//.test(ua)) return `Safari${/Mobile/.test(ua) ? ' mobile' : ''}`;
  return ua.slice(0, 24);
}

/** The few facts that usually explain a report, in one line. */
function reportFacts(r: ClientReport): string {
  const p = (r.payload ?? {}) as Record<string, unknown>;
  const snap = ((r.kind === 'unclean_exit' ? p.last_snapshot : p.snapshot) ?? null) as Snap | null;
  const bits: string[] = [];
  if (r.kind === 'unclean_exit') {
    if (p.was_discarded) bits.push('Chrome discarded the tab (memory)');
    if (p.was_hidden) bits.push('tab was in background');
    if (typeof p.previous_lifetime_s === 'number') bits.push(`died after ${p.previous_lifetime_s}s`);
  }
  if (r.kind === 'stuck_loader') {
    if (typeof p.after_s === 'number') bits.push(`loader up ${p.after_s}s`);
    if (typeof p.recovered_after_s === 'number') bits.push(`went away after ${p.recovered_after_s}s`);
  }
  if (r.kind === 'browser_crash') {
    const reason = p.reason === 'oom' ? 'out of memory' : p.reason === 'unresponsive' ? 'page hung (unresponsive)' : p.reason ? String(p.reason) : 'no reason given';
    bits.push(`Chrome: ${reason}`);
    if (p.visibility_state) bits.push(`tab ${p.visibility_state}`);
    if (typeof p.stack === 'string' && p.stack) bits.push('JS stack included');
  }
  if (r.kind === 'main_thread_stall') {
    if (p.recovered === false) bits.push(`frozen ${p.frozen_for_s ?? '?'}s and counting (seen by watchdog)`);
    else bits.push(`froze ${p.stalled_s ?? '?'}s, then recovered${typeof p.monotonic_s === 'number' && p.monotonic_s < Number(p.stalled_s) / 2 ? ' (likely the computer slept)' : ''}`);
  }
  if (r.kind === 'unclean_exit' && typeof p.previous_longest_stall_s === 'number' && p.previous_longest_stall_s > 0) bits.push(`longest freeze before it ${p.previous_longest_stall_s}s`);
  if (typeof p.message === 'string') bits.push(p.message.slice(0, 120));
  if (snap?.memory) bits.push(`heap ${snap.memory.used_mb}/${snap.memory.limit_mb} MB`);
  if (snap?.ws?.frames) bits.push(`${snap.ws.frames} frames (${snap.ws.frame_mb ?? 0} MB)`);
  if (typeof snap?.decoded_image_mb === 'number') bits.push(`${snap.images ?? 0} images ≈ ${snap.decoded_image_mb} MB decoded`);
  else if (snap?.data_images) bits.push(`${snap.data_images} inline images (${snap.data_image_mb ?? 0} MB)`);
  if (snap?.long_tasks?.count) bits.push(`${snap.long_tasks.count} long tasks`);
  if (snap?.pending?.length) bits.push(`${snap.pending.length} requests pending`);
  if (snap?.auth && snap.auth.auth_initialized === false) bits.push('auth not initialized');
  if (snap?.auth && snap.auth.has_token === false) bits.push('no token');
  return bits.join(' · ') || '–';
}

function BrowserReports({ days }: { days: number }) {
  const { data, isLoading } = useGetClientReportsQuery(days, { pollingInterval: 60_000 });
  const [open, setOpen] = useState<ClientReport | null>(null);
  const reports = data?.data ?? [];
  return (
    <Card variant="outlined" sx={{ p: 2 }}>
      <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
        Browser reports
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Page crashes, stuck loaders and errors caught in users' browsers, with what the page was doing at that moment. Open one for the full snapshot.
      </Typography>
      {isLoading ? (
        <Skeleton variant="rounded" height={80} />
      ) : !reports.length ? (
        <Typography variant="body2" color="text.secondary">
          No browser problems recorded in this period.
        </Typography>
      ) : (
        <ScrollTable>
          <TableHead>
            <TableRow>
              <TableCell>When</TableCell>
              <TableCell>Problem</TableCell>
              <TableCell>Page</TableCell>
              <TableCell>Browser</TableCell>
              <TableCell>What we know</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {reports.map((r) => {
              const meta = REPORT_LABEL[r.kind] ?? { label: r.kind, color: 'default' as const };
              return (
                <TableRow key={r.id} hover onClick={() => setOpen(r)} sx={{ cursor: 'pointer' }}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{new Date(r.created_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' })}</TableCell>
                  <TableCell>
                    <Chip size="small" variant="outlined" color={meta.color} label={meta.label} />
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.page ?? '–'}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{browserName(r.user_agent)}</TableCell>
                  <TableCell sx={{ maxWidth: 420 }}>
                    <Typography variant="body2" noWrap title={reportFacts(r)}>
                      {reportFacts(r)}
                    </Typography>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </ScrollTable>
      )}
      <Dialog open={open !== null} onClose={() => setOpen(null)} fullWidth maxWidth="md">
        <DialogTitle sx={{ pr: 6 }}>
          {open ? `${REPORT_LABEL[open.kind]?.label ?? open.kind} · #${open.id}` : ''}
          <IconButton onClick={() => setOpen(null)} sx={{ position: 'absolute', right: 12, top: 12 }} aria-label="Close">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {open ? (
            <Box component="pre" sx={{ m: 0, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: 'ui-monospace, monospace' }}>
              {JSON.stringify({ page: open.page, user_agent: open.user_agent, app_version: open.app_version, tab_id: open.tab_id, user_id: open.user_id, ...open.payload }, null, 2)}
            </Box>
          ) : null}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
