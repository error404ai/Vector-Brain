import { useGetFleetStateQuery } from '@/RTKService/androidService/androidService';
import {
  useGetTestLabFreeModelsQuery,
  useGetTestLabNightQuery,
  useGetTestLabQuery,
  useRunTestLabMutation,
  useSaveTestLabSettingsMutation,
  useStopTestLabMutation,
  type TestLabBucket,
  type TestLabNightRow,
  type TestLabReport,
  type TestLabSettings,
} from '@/RTKService/diagnosticsService/diagnosticsService';
import BugReportRoundedIcon from '@mui/icons-material/BugReportRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import OpenInNewRoundedIcon from '@mui/icons-material/OpenInNewRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import ScienceRoundedIcon from '@mui/icons-material/ScienceRounded';
import StopRoundedIcon from '@mui/icons-material/StopRounded';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  Chip,
  Collapse,
  FormControlLabel,
  IconButton,
  LinearProgress,
  MenuItem,
  Slider,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, keyframes, useTheme, type Theme } from '@mui/material/styles';
import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';

const drift = keyframes`0% { transform: translate3d(-4%, -2%, 0) scale(1); } 50% { transform: translate3d(3%, 2%, 0) scale(1.06); } 100% { transform: translate3d(-4%, -2%, 0) scale(1); }`;
const pulse = keyframes`0% { box-shadow: 0 0 0 0 currentColor; } 70% { box-shadow: 0 0 0 7px transparent; } 100% { box-shadow: 0 0 0 0 transparent; }`;
const rise = keyframes`from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; }`;
const grow = keyframes`from { transform: scaleX(0); } to { transform: scaleX(1); }`;

const usd = (n: number) => (n === 0 ? '$0' : n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(3)}`);
const pct = (n: number | null | undefined) => (n == null ? '–' : `${Math.round(n * 100)}%`);
const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

const BUCKETS: { key: TestLabBucket; label: string; hint: string }[] = [
  { key: 'pass', label: 'Pass', hint: 'Done, and the system check confirmed it' },
  { key: 'unsure', label: 'Unsure', hint: 'The agent says done; no check could confirm or deny it' },
  { key: 'engine', label: 'Engine', hint: 'Failed on every model it ran on: fix these' },
  { key: 'model', label: 'Model habit', hint: 'Failed on this model, passed on another: not an engine bug' },
  { key: 'setup', label: 'Setup', hint: 'The phone lacked an app, a sign-in or was offline' },
  { key: 'quota', label: 'Quota', hint: "The free model's daily limit: not counted" },
  { key: 'platform', label: 'Platform', hint: 'Our server (restart, dropped queue)' },
  { key: 'skipped', label: 'Skipped', hint: 'Never ran (stopped, out of time, no model left)' },
];

function bucketColor(t: Theme, b: TestLabBucket): string {
  switch (b) {
    case 'pass':
      return t.palette.success.main;
    case 'unsure':
      return t.palette.info.main;
    case 'engine':
      return t.palette.error.main;
    case 'model':
      return t.palette.warning.main;
    case 'setup':
      return t.palette.secondary.main;
    case 'quota':
      return t.palette.grey[500];
    case 'platform':
      return t.palette.grey[700];
    default:
      return t.palette.divider;
  }
}

const KINDS = ['open', 'navigate', 'settings', 'read', 'web', 'search', 'media', 'count', 'social', 'install', 'input', 'form', 'multi'];

/**
 * Test Lab: every night, a sample of everyday phone tasks runs on the test
 * phones with free models — each task on two models — and the failures are
 * sorted into what to fix (engine), what to ignore (one model's habit) and
 * what to set up (a phone without an app or a sign-in).
 */
export default function TestLabCard({ onOpenRun }: { onOpenRun: (taskId: number) => void }) {
  const lab = useGetTestLabQuery(undefined, { pollingInterval: 15_000, skipPollingIfUnfocused: true });
  const [run, { isLoading: starting }] = useRunTestLabMutation();
  const [stop, { isLoading: stopping }] = useStopTestLabMutation();
  const [settingsChoice, setSettingsOpen] = useState<boolean | null>(null);
  const [nightId, setNightId] = useState<number | null>(null);

  const overview = lab.data?.data;
  const nights = useMemo(() => overview?.nights ?? [], [overview?.nights]);
  const running = nights.find((n) => n.status === 'RUNNING') ?? null;
  const shownId = nightId ?? nights.find((n) => n.status !== 'RUNNING')?.id ?? running?.id ?? null;
  const night = useGetTestLabNightQuery(shownId ?? 0, { skip: !shownId, pollingInterval: running && running.id === shownId ? 15_000 : 0 });

  // Open by itself until the lab has phones and models; after that, as the user leaves it.
  const settingsOpen = settingsChoice ?? Boolean(overview && !overview.settings.models.length && !overview.settings.device_ids.length);

  const handleRun = async () => {
    try {
      const res = await run().unwrap();
      toast.success(`Test Lab started: ${res.data.jobs} runs`);
      setNightId(res.data.id);
    } catch (error) {
      toast.error((error as { data?: { message?: string } })?.data?.message ?? 'Could not start the Test Lab');
    }
  };
  const handleStop = async () => {
    try {
      await stop().unwrap();
      toast.success('Test Lab stopped; the report covers what ran');
    } catch (error) {
      toast.error((error as { data?: { message?: string } })?.data?.message ?? 'Could not stop it');
    }
  };

  const report = night.data?.data.report ?? null;
  const settings = overview?.settings;

  return (
    <Card variant="outlined" sx={{ p: 0, overflow: 'hidden', position: 'relative', borderRadius: 3 }}>
      {/* Header: a slow gradient field, the schedule and the run controls. */}
      <Box sx={{ position: 'relative', px: { xs: 2, md: 3 }, py: 2.5, overflow: 'hidden' }}>
        <Box
          aria-hidden
          sx={(t) => ({
            position: 'absolute',
            inset: '-20%',
            pointerEvents: 'none',
            background: `radial-gradient(40% 60% at 15% 30%, ${alpha(t.palette.primary.main, 0.22)}, transparent 70%), radial-gradient(35% 55% at 85% 20%, ${alpha(t.palette.secondary.main, 0.18)}, transparent 70%), radial-gradient(50% 60% at 60% 110%, ${alpha(t.palette.success.main, 0.14)}, transparent 70%)`,
            animation: `${drift} 18s ease-in-out infinite`,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          })}
        />
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} justifyContent="space-between" alignItems={{ md: 'center' }} sx={{ position: 'relative' }}>
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box
              sx={(t) => ({
                width: 44,
                height: 44,
                borderRadius: 2.5,
                display: 'grid',
                placeItems: 'center',
                color: t.palette.primary.contrastText,
                background: `linear-gradient(135deg, ${t.palette.primary.main}, ${t.palette.secondary.main})`,
                boxShadow: `0 8px 24px ${alpha(t.palette.primary.main, 0.35)}`,
              })}
            >
              <ScienceRoundedIcon />
            </Box>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 900, letterSpacing: -0.3, lineHeight: 1.1 }}>
                Test Lab
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5, flexWrap: 'wrap', rowGap: 0.5 }}>
                <ScheduleChip settings={settings} />
                {running ? <RunningChip night={running} /> : null}
              </Stack>
            </Box>
          </Stack>
          <Stack direction="row" spacing={1} alignItems="center">
            <Tooltip title="Settings">
              <IconButton onClick={() => setSettingsOpen(!settingsOpen)} sx={(t) => ({ bgcolor: alpha(t.palette.background.paper, 0.7), backdropFilter: 'blur(6px)' })}>
                <TuneRoundedIcon />
              </IconButton>
            </Tooltip>
            {running ? (
              <Button variant="outlined" color="error" startIcon={<StopRoundedIcon />} onClick={handleStop} disabled={stopping} sx={{ borderRadius: 2, fontWeight: 700 }}>
                Stop
              </Button>
            ) : (
              <Button
                variant="contained"
                disableElevation
                startIcon={<PlayArrowRoundedIcon />}
                onClick={handleRun}
                disabled={starting || !settings?.models.length || !settings?.device_ids.length}
                sx={{ borderRadius: 2, fontWeight: 800, px: 2.5 }}
              >
                Run now
              </Button>
            )}
          </Stack>
        </Stack>
        {overview && !overview.openrouter_ready ? (
          <Alert severity="warning" sx={{ mt: 2, position: 'relative', borderRadius: 2 }}>
            Add an OpenRouter key in Settings → AI first. The Test Lab runs the free models with it, and copies it into one "Test Lab" config per model.
          </Alert>
        ) : null}
      </Box>

      {lab.isLoading ? <LinearProgress /> : null}

      <Collapse in={settingsOpen} unmountOnExit>
        {settings ? <SettingsPanel initial={settings} onSaved={() => setSettingsOpen(false)} /> : null}
      </Collapse>

      <Box sx={{ px: { xs: 2, md: 3 }, pb: 3, pt: 1 }}>
        {nights.length ? <NightStrip nights={nights} selected={shownId} onSelect={setNightId} /> : null}

        {!nights.length && !lab.isLoading ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            No nights yet. Pick the test phones and two free models in settings, then Run now once — after that it runs by itself every night.
          </Typography>
        ) : null}

        {night.isFetching && !night.data ? <LinearProgress sx={{ mt: 2 }} /> : null}
        {night.data && !report ? <LiveNight jobs={night.data.data.jobs} /> : null}
        {report ? <NightReport report={report} onOpenRun={onOpenRun} /> : null}
        {overview && !overview.github ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
            GitHub copy is off (DIAG_GITHUB_REPO / DIAG_GITHUB_TOKEN not set): reports stay here only.
          </Typography>
        ) : null}
      </Box>
    </Card>
  );
}

function ScheduleChip({ settings }: { settings?: TestLabSettings }) {
  if (!settings) return null;
  return (
    <Chip
      size="small"
      label={settings.enabled ? `Nightly ${hourLabel(settings.hour)} IST · ${settings.runs_per_night} runs · ${settings.device_ids.length} phones` : 'Nightly run off'}
      sx={(t) => ({
        fontWeight: 700,
        bgcolor: settings.enabled ? alpha(t.palette.success.main, 0.14) : alpha(t.palette.text.primary, 0.06),
        color: settings.enabled ? t.palette.success.dark : t.palette.text.secondary,
      })}
    />
  );
}

function RunningChip({ night }: { night: TestLabNightRow }) {
  return (
    <Chip
      size="small"
      icon={<Box component="span" sx={(t) => ({ width: 8, height: 8, borderRadius: '50%', bgcolor: t.palette.primary.main, color: alpha(t.palette.primary.main, 0.6), animation: `${pulse} 1.6s infinite`, ml: '8px !important' })} />}
      label={`Running · ${night.done}/${night.jobs} done · ${night.running} on phones`}
      sx={(t) => ({ fontWeight: 700, bgcolor: alpha(t.palette.primary.main, 0.12), color: t.palette.primary.main })}
    />
  );
}

/** Recent nights as a strip: pass rate per night, with a trend line behind it. */
function NightStrip({ nights, selected, onSelect }: { nights: TestLabNightRow[]; selected: number | null; onSelect: (id: number) => void }) {
  const theme = useTheme();
  const ordered = [...nights].reverse();
  const points = ordered.map((n, i) => ({ x: ordered.length === 1 ? 50 : (i / (ordered.length - 1)) * 100, y: n.totals?.pass_rate ?? null })).filter((p): p is { x: number; y: number } => p.y !== null);
  return (
    <Box sx={{ position: 'relative', mt: 1 }}>
      {points.length >= 2 ? (
        <Box component="svg" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0.5, pointerEvents: 'none' }}>
          <polyline fill="none" stroke={theme.palette.primary.main} strokeWidth={0.6} vectorEffect="non-scaling-stroke" points={points.map((p) => `${p.x},${28 - p.y * 26}`).join(' ')} />
        </Box>
      ) : null}
      <Stack direction="row" spacing={1} sx={{ overflowX: 'auto', py: 1, position: 'relative' }}>
        {ordered.map((n) => {
          const on = n.id === selected;
          return (
            <Box
              key={n.id}
              onClick={() => onSelect(n.id)}
              sx={(t) => ({
                minWidth: 92,
                px: 1.25,
                py: 1,
                borderRadius: 2,
                cursor: 'pointer',
                border: `1px solid ${on ? t.palette.primary.main : t.palette.divider}`,
                bgcolor: on ? alpha(t.palette.primary.main, 0.08) : alpha(t.palette.background.paper, 0.8),
                transition: 'all 160ms ease',
                '&:hover': { borderColor: t.palette.primary.light, transform: 'translateY(-1px)' },
              })}
            >
              <Typography sx={{ fontWeight: 900, fontSize: 18, lineHeight: 1.1 }} color={n.status === 'RUNNING' ? 'primary' : 'text.primary'}>
                {n.status === 'RUNNING' ? `${n.done}/${n.jobs}` : pct(n.totals?.pass_rate)}
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                {new Date(n.day).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                {n.manual ? ' · manual' : ''}
                {n.status === 'STOPPED' ? ' · stopped' : ''}
              </Typography>
            </Box>
          );
        })}
      </Stack>
    </Box>
  );
}

function Ring({ value }: { value: number | null }) {
  const theme = useTheme();
  const r = 42;
  const c = 2 * Math.PI * r;
  const v = value ?? 0;
  const color = value === null ? theme.palette.text.disabled : v >= 0.9 ? theme.palette.success.main : v >= 0.75 ? theme.palette.warning.main : theme.palette.error.main;
  return (
    <Box sx={{ position: 'relative', width: 116, height: 116, flexShrink: 0 }}>
      <svg width="116" height="116" viewBox="0 0 116 116" aria-hidden>
        <circle cx="58" cy="58" r={r} fill="none" stroke={alpha(theme.palette.text.primary, 0.08)} strokeWidth="10" />
        <circle
          cx="58"
          cy="58"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          transform="rotate(-90 58 58)"
          style={{ transition: 'stroke-dashoffset 900ms cubic-bezier(.2,.8,.2,1)' }}
        />
      </svg>
      <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
        <Box>
          <Typography sx={{ fontWeight: 900, fontSize: 26, lineHeight: 1, color }}>{pct(value)}</Typography>
          <Typography variant="caption" color="text.secondary">
            pass rate
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}

function BucketBar({ counts, total }: { counts: Partial<Record<TestLabBucket, number>>; total: number }) {
  return (
    <Box sx={{ display: 'flex', height: 12, borderRadius: 6, overflow: 'hidden', bgcolor: (t) => alpha(t.palette.text.primary, 0.06) }}>
      {BUCKETS.map((b) => {
        const n = counts[b.key] ?? 0;
        if (!n || !total) return null;
        return (
          <Tooltip key={b.key} title={`${b.label}: ${n} — ${b.hint}`}>
            <Box sx={(t) => ({ width: `${(n / total) * 100}%`, bgcolor: bucketColor(t, b.key), transformOrigin: 'left', animation: `${grow} 700ms cubic-bezier(.2,.8,.2,1)` })} />
          </Tooltip>
        );
      })}
    </Box>
  );
}

function LiveNight({ jobs }: { jobs: { status: string; key: string; model: string; device_id?: number | null }[] }) {
  const done = jobs.filter((j) => j.status === 'done' || j.status === 'skipped').length;
  const onPhones = jobs.filter((j) => j.status === 'running');
  return (
    <Box sx={{ mt: 2, animation: `${rise} 300ms ease` }}>
      <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.75 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
          In progress
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {done} of {jobs.length} finished
        </Typography>
      </Stack>
      <LinearProgress variant="determinate" value={jobs.length ? (done / jobs.length) * 100 : 0} sx={{ height: 8, borderRadius: 4 }} />
      <Stack direction="row" spacing={0.75} sx={{ mt: 1.25, flexWrap: 'wrap', rowGap: 0.75 }}>
        {onPhones.map((j) => (
          <Chip key={`${j.key}-${j.model}`} size="small" variant="outlined" label={`${j.key} · ${j.model.split('/')[1] ?? j.model} · phone ${j.device_id ?? '—'}`} />
        ))}
      </Stack>
    </Box>
  );
}

function NightReport({ report, onOpenRun }: { report: TestLabReport; onOpenRun: (taskId: number) => void }) {
  const t = report.totals;
  const [openSig, setOpenSig] = useState<string | null>(report.engine[0]?.signature ?? null);
  return (
    <Box sx={{ mt: 2, animation: `${rise} 320ms ease` }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} alignItems={{ sm: 'center' }}>
        <Ring value={t.pass_rate} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            {t.counted} counted of {t.runs} runs · {usd(t.cost_usd)} · quota, setup and skipped runs are not counted in the rate
          </Typography>
          <BucketBar counts={t} total={t.runs} />
          <Stack direction="row" spacing={0.75} sx={{ mt: 1.25, flexWrap: 'wrap', rowGap: 0.75 }}>
            {BUCKETS.filter((b) => t[b.key]).map((b) => (
              <Tooltip key={b.key} title={b.hint}>
                <Chip
                  size="small"
                  label={`${b.label} ${t[b.key]}`}
                  sx={(th) => ({ fontWeight: 700, bgcolor: alpha(bucketColor(th, b.key), 0.14), color: th.palette.mode === 'dark' ? bucketColor(th, b.key) : th.palette.text.primary, borderLeft: `3px solid ${bucketColor(th, b.key)}` })}
                />
              </Tooltip>
            ))}
          </Stack>
        </Box>
      </Stack>

      {/* Models side by side. */}
      <Typography variant="overline" sx={{ display: 'block', mt: 3, fontWeight: 800, letterSpacing: 1.2 }} color="text.secondary">
        Models
      </Typography>
      <Stack spacing={1}>
        {report.per_model.map((m) => (
          <Box key={m.model} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'minmax(160px, 260px) 1fr auto' }, gap: 1.5, alignItems: 'center' }}>
            <Typography variant="body2" sx={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={m.model}>
              {m.model}
            </Typography>
            <BucketBar counts={{ pass: m.pass, unsure: m.unsure, engine: m.engine, model: m.model_fault, quota: m.quota }} total={m.runs} />
            <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
              {m.pass + m.unsure}/{m.runs - m.quota} · {m.avg_steps} steps · {usd(m.cost_usd)}
            </Typography>
          </Box>
        ))}
      </Stack>

      {/* The fix list. */}
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 3 }}>
        <BugReportRoundedIcon fontSize="small" color="error" />
        <Typography variant="overline" sx={{ fontWeight: 800, letterSpacing: 1.2 }} color="text.secondary">
          Engine failures — fix these
        </Typography>
      </Stack>
      {report.failed_everywhere.length ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Failed on every model: {report.failed_everywhere.join(', ')}
        </Typography>
      ) : null}
      {!report.engine.length ? (
        <Typography variant="body2" color="text.secondary">
          None tonight.
        </Typography>
      ) : null}
      <Stack spacing={1}>
        {report.engine.map((g) => {
          const open = openSig === g.signature;
          return (
            <Box key={g.signature} sx={(th) => ({ border: `1px solid ${open ? alpha(th.palette.error.main, 0.4) : th.palette.divider}`, borderRadius: 2, overflow: 'hidden', transition: 'border-color 160ms ease' })}>
              <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 1.5, py: 1, cursor: 'pointer' }} onClick={() => setOpenSig(open ? null : g.signature)}>
                <Box sx={(th) => ({ minWidth: 32, height: 24, px: 0.75, borderRadius: 1.5, display: 'grid', placeItems: 'center', fontWeight: 900, fontSize: 13, bgcolor: alpha(th.palette.error.main, 0.12), color: th.palette.error.main })}>
                  ×{g.count}
                </Box>
                <Typography variant="body2" sx={{ fontWeight: 700, flex: 1 }}>
                  {g.signature}
                </Typography>
                <KeyboardArrowDownRoundedIcon sx={{ transition: 'transform 160ms ease', transform: open ? 'rotate(180deg)' : 'none' }} />
              </Stack>
              <Collapse in={open}>
                <Stack spacing={0.75} sx={{ px: 1.5, pb: 1.25 }}>
                  {g.runs.map((r, i) => (
                    <FailureLine key={`${r.key}-${i}`} title={`${r.key} · ${r.model.split('/')[1] ?? r.model} · phone ${r.device_id ?? '—'}`} why={r.why} taskId={r.task_id} onOpenRun={onOpenRun} />
                  ))}
                </Stack>
              </Collapse>
            </Box>
          );
        })}
      </Stack>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2, mt: 3 }}>
        <Box>
          <Typography variant="overline" sx={{ fontWeight: 800, letterSpacing: 1.2 }} color="text.secondary">
            Model habits (not engine bugs)
          </Typography>
          {!report.model_quirks.length ? (
            <Typography variant="body2" color="text.secondary">
              None.
            </Typography>
          ) : null}
          <Stack spacing={0.75}>
            {report.model_quirks.map((q, i) => (
              <FailureLine key={i} title={`${q.key} · ${q.model.split('/')[1] ?? q.model}`} why={q.why} taskId={q.task_id} onOpenRun={onOpenRun} />
            ))}
          </Stack>
        </Box>
        <Box>
          <Typography variant="overline" sx={{ fontWeight: 800, letterSpacing: 1.2 }} color="text.secondary">
            Setup gaps on the phones
          </Typography>
          {!report.setup.length ? (
            <Typography variant="body2" color="text.secondary">
              None.
            </Typography>
          ) : null}
          <Stack spacing={0.75}>
            {report.setup.map((s, i) => (
              <FailureLine key={i} title={`phone ${s.device_id ?? '—'} · ${s.key}`} why={s.why} taskId={s.task_id} onOpenRun={onOpenRun} />
            ))}
          </Stack>
        </Box>
      </Box>

      <Typography variant="overline" sx={{ display: 'block', mt: 3, fontWeight: 800, letterSpacing: 1.2 }} color="text.secondary">
        By kind of task
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 1 }}>
        {report.per_kind.map((k) => {
          const rate = k.runs ? k.pass / k.runs : null;
          return (
            <Box key={k.kind} sx={(th) => ({ p: 1.25, borderRadius: 2, border: `1px solid ${th.palette.divider}`, position: 'relative', overflow: 'hidden' })}>
              <Box aria-hidden sx={(th) => ({ position: 'absolute', left: 0, bottom: 0, height: 3, width: `${(rate ?? 0) * 100}%`, bgcolor: k.engine ? th.palette.error.main : th.palette.success.main, transition: 'width 600ms ease' })} />
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'capitalize' }}>
                {k.kind}
              </Typography>
              <Typography sx={{ fontWeight: 900 }}>
                {k.pass}/{k.runs}
                {k.engine ? (
                  <Typography component="span" variant="caption" color="error" sx={{ ml: 0.75, fontWeight: 700 }}>
                    {k.engine} engine
                  </Typography>
                ) : null}
              </Typography>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

function FailureLine({ title, why, taskId, onOpenRun }: { title: string; why: string; taskId: number | null; onOpenRun: (id: number) => void }) {
  return (
    <Stack direction="row" spacing={1} alignItems="flex-start" sx={(t) => ({ p: 1, borderRadius: 1.5, bgcolor: alpha(t.palette.text.primary, 0.03) })}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="caption" sx={{ fontWeight: 800, display: 'block' }}>
          {title}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', wordBreak: 'break-word' }}>
          {why || '—'}
        </Typography>
      </Box>
      {taskId ? (
        <Tooltip title={`Open run #${taskId}`}>
          <IconButton size="small" onClick={() => onOpenRun(taskId)}>
            <OpenInNewRoundedIcon fontSize="inherit" />
          </IconButton>
        </Tooltip>
      ) : null}
    </Stack>
  );
}

function SettingsPanel({ initial, onSaved }: { initial: TestLabSettings; onSaved: () => void }) {
  const fleet = useGetFleetStateQuery();
  const free = useGetTestLabFreeModelsQuery();
  const [save, { isLoading }] = useSaveTestLabSettingsMutation();
  const [s, setS] = useState<TestLabSettings>(initial);
  const [coreText, setCoreText] = useState(initial.core.map((c) => c.prompt).join('\n'));
  const devices = useMemo(() => [...(fleet.data?.data.devices ?? [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })), [fleet.data]);
  const set = <K extends keyof TestLabSettings>(key: K, value: TestLabSettings[K]) => setS((p) => ({ ...p, [key]: value }));
  const perTask = s.models.length >= 2 ? 2 : 1;

  const handleSave = async () => {
    const core = coreText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((prompt, i) => ({ key: initial.core.find((c) => c.prompt === prompt)?.key ?? `core-${i + 1}`, prompt }));
    try {
      await save({ ...s, core }).unwrap();
      toast.success('Test Lab settings saved');
      onSaved();
    } catch (error) {
      toast.error((error as { data?: { message?: string } })?.data?.message ?? 'Could not save');
    }
  };

  return (
    <Box sx={(t) => ({ px: { xs: 2, md: 3 }, py: 2.5, borderTop: `1px solid ${t.palette.divider}`, borderBottom: `1px solid ${t.palette.divider}`, bgcolor: alpha(t.palette.primary.main, 0.025) })}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2.5 }}>
        <Stack spacing={2}>
          <FormControlLabel control={<Switch checked={s.enabled} onChange={(e) => set('enabled', e.target.checked)} />} label={<Typography sx={{ fontWeight: 700 }}>Run every night</Typography>} />
          <TextField select size="small" label="Start at (India time)" value={s.hour} onChange={(e) => set('hour', Number(e.target.value))}>
            {Array.from({ length: 24 }, (_, h) => (
              <MenuItem key={h} value={h}>
                {hourLabel(h)}
              </MenuItem>
            ))}
          </TextField>
          <Autocomplete
            multiple
            freeSolo
            size="small"
            options={(free.data?.data ?? []).map((m) => m.id)}
            value={s.models}
            onChange={(_, v) => set('models', (v as string[]).map((x) => x.trim()).filter(Boolean).slice(0, 6))}
            loading={free.isLoading}
            renderInput={(params) => (
              <TextField {...params} label="Models (OpenRouter)" helperText="Two or more: each task runs on two, so a failure on both is the engine's and a failure on one is that model's habit. Free models that can call tools are listed." />
            )}
          />
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              Runs per night: {s.runs_per_night}
            </Typography>
            <Slider value={s.runs_per_night} min={4} max={120} step={2} onChange={(_, v) => set('runs_per_night', v as number)} />
            <Typography variant="caption" color="text.secondary">
              {Math.floor(s.runs_per_night / perTask)} tasks × {perTask} model{perTask === 1 ? '' : 's'} · roughly {s.runs_per_night * 20} model requests. Free models have a daily request cap per account; runs past it are marked quota, not failed.
            </Typography>
          </Box>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              Reworded tasks: {Math.round(s.variant_share * 100)}%
            </Typography>
            <Slider value={s.variant_share} min={0} max={1} step={0.05} onChange={(_, v) => set('variant_share', v as number)} />
            <Typography variant="caption" color="text.secondary">
              A model rewrites this share of tasks the way someone else would type them (often Hinglish), keeping every number, URL and quote.
            </Typography>
          </Box>
          <TextField size="small" type="number" label="Max steps per run" value={s.max_steps} onChange={(e) => set('max_steps', Number(e.target.value))} inputProps={{ min: 5, max: 150 }} />
        </Stack>
        <Stack spacing={2}>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.75 }}>
              Test phones ({s.device_ids.length})
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {devices.map((d) => {
                const on = s.device_ids.includes(d.id);
                return (
                  <Chip
                    key={d.id}
                    size="small"
                    label={d.name}
                    color={on ? 'primary' : 'default'}
                    variant={on ? 'filled' : 'outlined'}
                    onClick={() => set('device_ids', on ? s.device_ids.filter((x) => x !== d.id) : [...s.device_ids, d.id].slice(0, 10))}
                    sx={{ opacity: d.online ? 1 : 0.55, fontWeight: on ? 700 : 500 }}
                  />
                );
              })}
            </Box>
            <Typography variant="caption" color="text.secondary">
              Each phone runs one job at a time. Signed in to Google, with Instagram, YouTube and Chrome installed.
            </Typography>
          </Box>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.75 }}>
              Leave out
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
              {KINDS.map((k) => {
                const off = s.skip_kinds.includes(k);
                return (
                  <Chip
                    key={k}
                    size="small"
                    label={k}
                    variant={off ? 'filled' : 'outlined'}
                    color={off ? 'error' : 'default'}
                    onClick={() => set('skip_kinds', off ? s.skip_kinds.filter((x) => x !== k) : [...s.skip_kinds, k])}
                    sx={{ textDecoration: off ? 'line-through' : 'none' }}
                  />
                );
              })}
            </Box>
          </Box>
          <TextField
            multiline
            minRows={4}
            size="small"
            label="Your core tasks (one per line, run every night first)"
            value={coreText}
            onChange={(e) => setCoreText(e.target.value)}
            placeholder={'Open Chrome and visit 10 UK news websites\ninstagram pe 5 reels like karo'}
          />
          <Stack direction="row" justifyContent="flex-end">
            <Button variant="contained" disableElevation onClick={handleSave} disabled={isLoading} sx={{ borderRadius: 2, fontWeight: 800, px: 3 }}>
              Save
            </Button>
          </Stack>
        </Stack>
      </Box>
    </Box>
  );
}
