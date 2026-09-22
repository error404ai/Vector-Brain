import type { AndroidAgentTask, AndroidDevice } from '@/RTKService/androidService/androidService';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ReplayIcon from '@mui/icons-material/Replay';
import {
  Box,
  Button,
  Collapse,
  Divider,
  IconButton,
  Stack,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material';
import { memo, useMemo, useState } from 'react';

type Filter = 'all' | 'failed' | 'success';

/**
 * A single place that answers "what happened across the fleet?" — which phones
 * succeeded, which failed and why, without scrolling twenty cards.
 *
 * It reads the same task list the page already polls, so there is no new data
 * source: it just groups and surfaces it. A failed row carries its reason and a
 * one-click retry; the whole thing collapses so it never gets in the way when
 * you don't need it.
 */
function FleetActivityPanel({
  tasks,
  devices,
  onRetry,
}: {
  tasks: AndroidAgentTask[];
  devices: AndroidDevice[];
  onRetry: (deviceId: number, prompt: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [filter, setFilter] = useState<Filter>('all');

  const deviceName = useMemo(() => {
    const map = new Map<number, string>();
    for (const device of devices) map.set(device.id, device.device_name);
    return (id?: number | null) => (id != null ? map.get(id) ?? `Device ${id}` : 'Unknown device');
  }, [devices]);

  // Newest first, most recent 60 — enough to cover a fleet run without turning
  // into an endless log.
  const recent = useMemo(
    () =>
      [...tasks]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 60),
    [tasks],
  );

  const counts = useMemo(() => {
    let running = 0;
    let success = 0;
    let failed = 0;
    for (const task of recent) {
      if (task.is_running) running += 1;
      else if (task.success) success += 1;
      else failed += 1;
    }
    return { running, success, failed, total: recent.length };
  }, [recent]);

  const shown = useMemo(() => {
    if (filter === 'failed') return recent.filter((t) => !t.is_running && !t.success);
    if (filter === 'success') return recent.filter((t) => !t.is_running && t.success);
    return recent;
  }, [recent, filter]);

  if (recent.length === 0) return null;

  const chip = (label: string, value: number, color: string, key: Filter) => {
    const active = filter === key;
    return (
      <Box
        role="button"
        onClick={() => setFilter(active ? 'all' : key)}
        sx={{
          px: 1.25,
          py: 0.4,
          borderRadius: 5,
          fontSize: 12.5,
          fontWeight: 700,
          cursor: 'pointer',
          userSelect: 'none',
          color: active ? '#fff' : color,
          bgcolor: active ? color : alpha(color, 0.12),
          border: '1px solid',
          borderColor: active ? color : 'transparent',
          '&:hover': { borderColor: color },
        }}
      >
        {value} {label}
      </Box>
    );
  };

  return (
    <Box
      sx={{
        borderRadius: 3,
        border: '1px solid',
        borderColor: 'divider',
        bgcolor: 'background.paper',
        overflow: 'hidden',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        gap={1}
        sx={{ px: 2, py: 1.25, cursor: 'pointer' }}
        onClick={() => setOpen((v) => !v)}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
          Run activity
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <Stack direction="row" gap={0.75} onClick={(e) => e.stopPropagation()}>
          {counts.running > 0 && chip('running', counts.running, '#2563eb', 'all')}
          {chip('ok', counts.success, '#059669', 'success')}
          {chip('failed', counts.failed, '#dc2626', 'failed')}
        </Stack>
        <IconButton size="small">{open ? <ExpandLessIcon /> : <ExpandMoreIcon />}</IconButton>
      </Stack>

      <Collapse in={open} timeout={140}>
        <Divider />
        <Box sx={{ maxHeight: 'calc(55vh - 56px)', overflowY: 'auto' }}>
          {shown.map((task) => {
            const failed = !task.is_running && !task.success;
            const accent = task.is_running ? '#2563eb' : task.success ? '#059669' : '#dc2626';
            return (
              <Stack
                key={task.id}
                direction="row"
                alignItems="center"
                gap={1}
                sx={{
                  px: 2,
                  py: 1,
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  '&:last-of-type': { borderBottom: 'none' },
                }}
              >
                <Box sx={{ color: accent, display: 'flex' }}>
                  {task.is_running ? (
                    <PlayArrowIcon fontSize="small" />
                  ) : task.success ? (
                    <CheckCircleIcon fontSize="small" />
                  ) : (
                    <ErrorOutlineIcon fontSize="small" />
                  )}
                </Box>

                <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                  <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                    {deviceName(task.device_id)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                    {task.is_running
                      ? task.prompt || 'Running…'
                      : failed
                        ? task.message || 'Failed'
                        : task.message || task.prompt || 'Completed'}
                  </Typography>
                </Box>

                {!task.is_running && (
                  <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
                    {task.total_steps ? `${task.total_steps} steps` : ''}
                    {task.total_duration_seconds ? ` · ${Math.round(task.total_duration_seconds)}s` : ''}
                  </Typography>
                )}

                {failed && task.device_id != null && task.prompt && (
                  <Tooltip title="Retry this task">
                    <IconButton size="small" sx={{ color: '#dc2626' }} onClick={() => onRetry(task.device_id as number, task.prompt)}>
                      <ReplayIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )}
              </Stack>
            );
          })}
          {shown.length === 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ px: 2, py: 2, display: 'block' }}>
              Nothing here yet.
            </Typography>
          )}
        </Box>

        {counts.failed > 1 && filter !== 'failed' && (
          <>
            <Divider />
            <Box sx={{ px: 2, py: 1 }}>
              <Button size="small" startIcon={<ReplayIcon fontSize="small" />} onClick={() => setFilter('failed')} sx={{ textTransform: 'none', fontWeight: 700 }}>
                Show only the {counts.failed} failed
              </Button>
            </Box>
          </>
        )}
      </Collapse>
    </Box>
  );
}

// Memoized: the fleet page re-renders often; this only redraws when its tasks,
// devices or retry handler actually change.
export default memo(FleetActivityPanel);
