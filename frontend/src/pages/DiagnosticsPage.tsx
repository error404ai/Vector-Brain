import PageHeader, { HeaderActions } from '@/components/ui/PageHeader';
import {
  downloadDiagnosticsExport,
  useGetDiagnosticsRunQuery,
  useGetDiagnosticsRunsQuery,
  useGetDiagnosticsSummaryQuery,
  useGetDiagnosticsSyncQuery,
  useSyncDiagnosticsNowMutation,
  type DiagnosticsRun,
  type DiagnosticsStep,
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

const fmtInt = (n: number) => Math.round(n).toLocaleString('en-IN');
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
          <TableCell>Result</TableCell>
          <TableCell align="right">Steps</TableCell>
          <TableCell align="right">Wasted</TableCell>
          <TableCell align="right">AI calls</TableCell>
          <TableCell align="right">Tokens</TableCell>
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
              <TableCell>
                <Chip size="small" variant="outlined" color={r.status === 'SUCCEEDED' ? 'success' : r.status === 'FAILED' ? 'error' : 'default'} label={r.status === 'SUCCEEDED' ? 'Done' : r.reason ?? r.status} />
              </TableCell>
              <TableCell align="right">{r.total_steps}</TableCell>
              <TableCell align="right">{d ? `${d.wasted} (${pct(d.wasted, d.steps)})` : '–'}</TableCell>
              <TableCell align="right">{d ? d.llm_calls : '–'}</TableCell>
              <TableCell align="right">{d?.tokens_reported ? fmtInt(d.prompt_tokens + d.completion_tokens) : '–'}</TableCell>
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
                {run.reason_code ? ` (${run.reason_code})` : ''} · {run.total_steps} steps in {Math.round(run.total_duration_seconds)}s · {run.model ?? ''}
              </Typography>
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
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small" sx={{ minWidth: 820 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>#</TableCell>
                    <TableCell>By</TableCell>
                    <TableCell>Action</TableCell>
                    <TableCell>App</TableCell>
                    <TableCell align="right">AI think</TableCell>
                    <TableCell align="right">Phone</TableCell>
                    <TableCell align="right">Tokens</TableCell>
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
      <TableCell align="right">{step.prompt_tokens ? fmtInt(step.prompt_tokens + (step.completion_tokens ?? 0)) : ''}</TableCell>
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
