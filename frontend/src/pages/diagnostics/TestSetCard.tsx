import { useGetFleetStateQuery } from '@/RTKService/androidService/androidService';
import { useGetTestSetQuery, useStartTestSetMutation, type TestSetRun, type TestSetTaskResult } from '@/RTKService/diagnosticsService/diagnosticsService';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import { Box, Button, Card, Chip, Collapse, IconButton, LinearProgress, Stack, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from '@mui/material';
import { alpha, keyframes } from '@mui/material/styles';
import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';

const MAX_PHONES = 10;
const rise = keyframes`from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; }`;
const usd = (n: number) => (n === 0 ? '$0' : n < 0.01 ? `$${n.toFixed(4)}` : n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`);
const rate = (passed: number, finished: number) => (finished > 0 ? Math.round((passed / finished) * 100) : null);
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * The fixed test set: the same everyday tasks on the same few phones before a
 * change goes out, and each run next to the one before it. A task whose pass
 * rate dropped is flagged, so a fix for one kind of task cannot quietly break
 * another.
 */
export default function TestSetCard() {
  const fleet = useGetFleetStateQuery();
  // Owner page only: a light refresh shows a run's progress without a reload.
  const testSet = useGetTestSetQuery(undefined, { pollingInterval: 20_000, skipPollingIfUnfocused: true });
  const [start, { isLoading: starting }] = useStartTestSetMutation();
  const [picked, setPicked] = useState<number[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  const devices = useMemo(
    () => [...(fleet.data?.data.devices ?? [])].sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)),
    [fleet.data],
  );
  const tasks = testSet.data?.data.tasks ?? [];
  const runs = testSet.data?.data.runs ?? [];

  const lastPerTask = runs.length ? runs[0].costUsd / Math.max(1, runs[0].finished) : 0.003;
  const estimate = tasks.length * picked.length * lastPerTask;

  const toggle = (id: number) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_PHONES ? p : [...p, id]));

  const handleStart = async () => {
    try {
      const res = await start({ device_ids: picked }).unwrap();
      toast.success(`Test set started: ${res.data.missions} tasks on ${picked.length} phone${picked.length === 1 ? '' : 's'}`);
      setOpen(res.data.run);
    } catch (error) {
      toast.error((error as { data?: { message?: string } })?.data?.message ?? 'Could not start the test set');
    }
  };

  return (
    <Card variant="outlined" sx={{ p: 2, overflow: 'hidden', position: 'relative' }}>
      <Box
        aria-hidden
        sx={(t) => ({
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: `radial-gradient(120% 80% at 100% 0%, ${alpha(t.palette.primary.main, 0.08)}, transparent 60%)`,
        })}
      />
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ position: 'relative' }} justifyContent="space-between" alignItems={{ md: 'flex-start' }}>
        <Box sx={{ maxWidth: 560 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
            Test set
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {tasks.length} fixed everyday tasks — open, search, play, count, follow, type — run on the same phones before every change. Each run is compared with the one before it.
          </Typography>
        </Box>
        <Stack alignItems={{ md: 'flex-end' }} spacing={0.5}>
          <Button
            variant="contained"
            disableElevation
            startIcon={<PlayArrowRoundedIcon />}
            disabled={!picked.length || starting || !tasks.length}
            onClick={handleStart}
            sx={{ borderRadius: 2, fontWeight: 700, whiteSpace: 'nowrap' }}
          >
            Run on {picked.length || 'no'} phone{picked.length === 1 ? '' : 's'}
          </Button>
          <Typography variant="caption" color="text.secondary">
            {picked.length ? `${tasks.length * picked.length} runs · about ${usd(estimate)}` : `Pick up to ${MAX_PHONES} phones`}
          </Typography>
        </Stack>
      </Stack>

      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1.5, position: 'relative' }}>
        {devices.map((d) => {
          const on = picked.includes(d.id);
          return (
            <Chip
              key={d.id}
              size="small"
              label={d.name}
              onClick={() => toggle(d.id)}
              color={on ? 'primary' : 'default'}
              variant={on ? 'filled' : 'outlined'}
              sx={{ opacity: d.online ? 1 : 0.5, transition: 'all 160ms ease', fontWeight: on ? 700 : 500 }}
            />
          );
        })}
      </Box>

      <Stack spacing={1} sx={{ mt: 2, position: 'relative' }}>
        {testSet.isLoading ? <LinearProgress /> : null}
        {!testSet.isLoading && !runs.length ? (
          <Typography variant="body2" color="text.secondary">
            No runs yet. Pick 3–5 phones and run it once now, so the next change has something to be compared with.
          </Typography>
        ) : null}
        {runs.map((r, i) => (
          <RunRow key={r.run} run={r} previous={runs[i + 1]} open={open === r.run} onToggle={() => setOpen(open === r.run ? null : r.run)} />
        ))}
      </Stack>
    </Card>
  );
}

function RunRow({ run, previous, open, onToggle }: { run: TestSetRun; previous?: TestSetRun; open: boolean; onToggle: () => void }) {
  const pass = rate(run.passed, run.finished);
  const before = previous ? rate(previous.passed, previous.finished) : null;
  const delta = pass !== null && before !== null ? pass - before : null;
  const done = run.finished >= run.total;
  const drops = previous ? run.tasks.filter((t) => dropped(t, previous.tasks.find((p) => p.key === t.key))).length : 0;
  return (
    <Box sx={(t) => ({ border: `1px solid ${t.palette.divider}`, borderRadius: 2, animation: `${rise} 260ms ease`, bgcolor: open ? alpha(t.palette.primary.main, 0.03) : 'transparent' })}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ px: 1.5, py: 1, cursor: 'pointer' }} onClick={onToggle}>
        <Box sx={{ width: 64, textAlign: 'center' }}>
          <Typography sx={{ fontWeight: 800, fontSize: 22, lineHeight: 1, color: pass === null ? 'text.disabled' : pass >= 90 ? 'success.main' : pass >= 75 ? 'warning.main' : 'error.main' }}>
            {pass === null ? '–' : `${pass}%`}
          </Typography>
          {delta !== null && done ? (
            <Typography variant="caption" sx={{ fontWeight: 700, color: delta > 0 ? 'success.main' : delta < 0 ? 'error.main' : 'text.secondary' }}>
              {delta > 0 ? `▲ ${delta}` : delta < 0 ? `▼ ${-delta}` : '='} pts
            </Typography>
          ) : null}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 700 }}>
            {when(run.startedAt)} · {run.phones} phone{run.phones === 1 ? '' : 's'}
            {run.model ? ` · ${run.model.split('/').pop()}` : ''}
            {run.engine ? ` · ${run.engine}` : ''}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {run.passed} passed ({run.verified} verified by the system) · {run.finished - run.passed} failed · {usd(run.costUsd)} ({usd(run.costUsd / Math.max(1, run.finished))} per run)
            {drops ? ` · ${drops} task${drops === 1 ? '' : 's'} got worse` : ''}
          </Typography>
          {!done ? <LinearProgress variant="determinate" value={(run.finished / Math.max(1, run.total)) * 100} sx={{ mt: 0.5, borderRadius: 1, height: 4 }} /> : null}
        </Box>
        {drops ? <Chip size="small" color="error" variant="outlined" label={`${drops} worse`} /> : null}
        <IconButton size="small" aria-label={open ? 'Hide tasks' : 'Show tasks'} sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 200ms ease' }}>
          <KeyboardArrowDownRoundedIcon fontSize="small" />
        </IconButton>
      </Stack>
      <Collapse in={open} unmountOnExit>
        <Box sx={{ overflowX: 'auto', px: 1, pb: 1 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Task</TableCell>
                <TableCell align="right">Passed</TableCell>
                <TableCell align="right">Before</TableCell>
                <TableCell align="right">Avg steps</TableCell>
                <TableCell align="right">Cost</TableCell>
                <TableCell>Why it failed</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {run.tasks.map((t) => {
                const prev = previous?.tasks.find((p) => p.key === t.key);
                const worse = dropped(t, prev);
                return (
                  <TableRow key={t.key} sx={(th) => ({ bgcolor: worse ? alpha(th.palette.error.main, 0.06) : undefined })}>
                    <TableCell sx={{ maxWidth: 360 }}>
                      <Tooltip title={t.prompt}>
                        <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                          {t.key}
                        </Typography>
                      </Tooltip>
                      <Typography variant="caption" color="text.secondary">
                        {t.kind}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      {t.passed}/{t.passed + t.failed}
                      {t.pending ? <Typography component="span" variant="caption" color="text.secondary">{` +${t.pending} waiting`}</Typography> : null}
                    </TableCell>
                    <TableCell align="right">{prev ? `${prev.passed}/${prev.passed + prev.failed}` : '–'}</TableCell>
                    <TableCell align="right">{t.passed + t.failed ? Math.round(t.steps / (t.passed + t.failed)) : '–'}</TableCell>
                    <TableCell align="right">{usd(t.costUsd)}</TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {t.reasons.map((r) => `${r.reason} ×${r.count}`).join(', ') || '—'}
                      </Typography>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      </Collapse>
    </Box>
  );
}

/** This task passed on a smaller share of its phones than in the run before. */
function dropped(now: TestSetTaskResult, before?: TestSetTaskResult): boolean {
  if (!before) return false;
  const a = rate(now.passed, now.passed + now.failed);
  const b = rate(before.passed, before.passed + before.failed);
  return a !== null && b !== null && a < b;
}
