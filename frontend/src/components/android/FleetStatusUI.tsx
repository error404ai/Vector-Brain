import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ReplayIcon from '@mui/icons-material/Replay';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import WifiOffIcon from '@mui/icons-material/WifiOff';
import { Box, Button, LinearProgress, Stack, Typography, alpha } from '@mui/material';
import type { ReactNode } from 'react';

/**
 * The one status vocabulary the fleet UI renders. Kept deliberately small and
 * mapped from data that actually exists in the runtime/device model — no
 * invented backend states. Pause/retry-attempt states are intentionally absent
 * until the backend can supply them.
 */
export type FleetStatus =
  | 'running'
  | 'waiting'
  | 'failed'
  | 'completed'
  | 'idle'
  | 'needs_setup'
  | 'offline';

interface StatusStyle {
  label: string;
  accent: string;
  surface: string;
  icon: ReactNode;
  /** Active states breathe so movement on the page always means live work. */
  live?: boolean;
}

const STATUS_STYLES: Record<FleetStatus, StatusStyle> = {
  running: { label: 'Running', accent: '#2563eb', surface: alpha('#2563eb', 0.10), icon: <PlayArrowIcon fontSize="small" />, live: true },
  waiting: { label: 'Waiting', accent: '#b45309', surface: alpha('#d97706', 0.12), icon: <HourglassEmptyIcon fontSize="small" /> },
  failed: { label: 'Failed', accent: '#dc2626', surface: alpha('#dc2626', 0.10), icon: <ErrorOutlineIcon fontSize="small" /> },
  completed: { label: 'Completed', accent: '#059669', surface: alpha('#059669', 0.10), icon: <CheckCircleIcon fontSize="small" /> },
  idle: { label: 'Ready', accent: '#6b7280', surface: alpha('#6b7280', 0.10), icon: <CheckCircleOutlineIcon fontSize="small" /> },
  needs_setup: { label: 'Service needed', accent: '#ea580c', surface: alpha('#ea580c', 0.12), icon: <ReportProblemIcon fontSize="small" /> },
  offline: { label: 'Offline', accent: '#9ca3af', surface: alpha('#9ca3af', 0.14), icon: <WifiOffIcon fontSize="small" /> },
};

/** The single semantic colour for a status — used by the summary dots too. */
export function statusAccent(status: FleetStatus): string {
  return STATUS_STYLES[status].accent;
}

/**
 * The status badge shown at the top of every device card.
 *
 * A tinted surface plus a saturated left rail marks the state without flooding
 * the card with colour, so twenty cards stay readable. `labelSuffix` carries a
 * step counter ("· step 7"); `trailing` carries per-state controls (stop/retry)
 * so the badge owns its whole row.
 */
export function DeviceStatusBadge({
  status,
  labelSuffix,
  trailing,
}: {
  status: FleetStatus;
  labelSuffix?: string;
  trailing?: ReactNode;
}) {
  const style = STATUS_STYLES[status];
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        pl: 1.25,
        pr: 0.5,
        py: 0.6,
        borderRadius: 1.5,
        bgcolor: style.surface,
        color: style.accent,
        position: 'relative',
        overflow: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 3,
          bgcolor: style.accent,
        },
        ...(style.live && {
          '& .fleet-status-dot': {
            animation: 'fleetDotPulse 1.4s ease-in-out infinite',
          },
          '@keyframes fleetDotPulse': {
            '0%, 100%': { opacity: 1, transform: 'scale(1)' },
            '50%': { opacity: 0.4, transform: 'scale(0.82)' },
          },
        }),
        // A light gleam sweeps across a just-completed badge, so a successful
        // finish reads as a small celebration rather than a flat green bar. It
        // runs a few times then settles — attention without distraction.
        ...(status === 'completed' && {
          '&::after': {
            content: '""',
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: '-40%',
            width: '40%',
            background: `linear-gradient(100deg, transparent 0%, ${alpha('#ffffff', 0.65)} 50%, transparent 100%)`,
            transform: 'skewX(-18deg)',
            animation: 'fleetShine 2.2s ease-in-out 3',
          },
          '@keyframes fleetShine': {
            '0%': { left: '-40%' },
            '60%, 100%': { left: '140%' },
          },
        }),
      }}
    >
      {style.live ? (
        <Box
          className="fleet-status-dot"
          sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: style.accent, flexShrink: 0 }}
        />
      ) : (
        <Box
          component="span"
          sx={{
            display: 'inline-flex',
            ...(status === 'completed' && {
              animation: 'fleetPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) 1',
              '@keyframes fleetPop': {
                '0%': { transform: 'scale(0.2)', opacity: 0 },
                '100%': { transform: 'scale(1)', opacity: 1 },
              },
            }),
          }}
        >
          {style.icon}
        </Box>
      )}
      <Typography variant="caption" sx={{ fontWeight: 800, flexGrow: 1, letterSpacing: 0.1 }} noWrap>
        {style.label}
        {labelSuffix ? (
          <Box component="span" sx={{ fontWeight: 600, opacity: 0.8 }}>{` ${labelSuffix}`}</Box>
        ) : null}
      </Typography>
      {trailing}
    </Box>
  );
}

/**
 * Progress + live activity for a running task.
 *
 * The denominator is the run's step budget (maxSteps), so the bar is honest
 * even though the agent does not know its own total ahead of time — it fills
 * toward the ceiling and reads "step N / budget". Elapsed time comes from the
 * moment the run started.
 */
export function TaskProgress({
  step,
  budget,
  startedAt,
  action,
}: {
  step: number;
  budget: number;
  startedAt?: number;
  action?: string;
}) {
  const pct = budget > 0 ? Math.min(100, Math.round((step / budget) * 100)) : undefined;
  return (
    <Stack gap={0.5} sx={{ px: 0.25 }}>
      <LinearProgress
        variant={pct === undefined ? 'indeterminate' : 'determinate'}
        value={pct}
        sx={{
          height: 5,
          borderRadius: 3,
          bgcolor: alpha('#2563eb', 0.12),
          '& .MuiLinearProgress-bar': { borderRadius: 3, backgroundColor: '#2563eb' },
        }}
      />
      <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1}>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ flexGrow: 1 }}>
          {action ? (
            <Box component="span" sx={{ fontFamily: 'monospace', fontSize: 11 }}>{action}</Box>
          ) : (
            'Working…'
          )}
        </Typography>
        {startedAt !== undefined && <ElapsedTime startedAt={startedAt} />}
      </Stack>
    </Stack>
  );
}

/** Live-ticking elapsed time, mm:ss, from a start timestamp. */
function ElapsedTime({ startedAt }: { startedAt: number }) {
  const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const mm = Math.floor(seconds / 60);
  const ss = seconds % 60;
  return (
    <Typography variant="caption" color="text.secondary" sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>
      {mm}:{ss.toString().padStart(2, '0')}
    </Typography>
  );
}

/** Prominent-but-compact retry, exposed inline on a failed card. */
export function RetryButton({ onClick }: { onClick: () => void }) {
  return (
    <Button
      size="small"
      startIcon={<ReplayIcon fontSize="small" />}
      onClick={onClick}
      sx={{
        alignSelf: 'flex-start',
        textTransform: 'none',
        fontWeight: 700,
        color: '#dc2626',
        bgcolor: alpha('#dc2626', 0.08),
        '&:hover': { bgcolor: alpha('#dc2626', 0.16) },
        px: 1.25,
      }}
    >
      Retry task
    </Button>
  );
}

export interface FleetCounts {
  total: number;
  running: number;
  waiting: number;
  failed: number;
  completed: number;
  idle: number;
  needs_setup: number;
  offline: number;
}

/**
 * The fleet-wide status summary: one row that answers "what is the whole fleet
 * doing?" in a glance. Each chip is a toggle filter; the active one is filled,
 * the rest are quiet. A zero-count chip stays visible but dimmed so the row
 * does not jump around as states change.
 */
export function FleetStatusSummary({
  counts,
  activeFilter,
  onFilter,
}: {
  counts: FleetCounts;
  activeFilter: FleetStatus | null;
  onFilter: (status: FleetStatus | null) => void;
}) {
  const chips: { key: FleetStatus; count: number }[] = [
    { key: 'running', count: counts.running },
    { key: 'waiting', count: counts.waiting },
    { key: 'failed', count: counts.failed },
    { key: 'completed', count: counts.completed },
    { key: 'idle', count: counts.idle },
    { key: 'needs_setup', count: counts.needs_setup },
    { key: 'offline', count: counts.offline },
  ];

  return (
    <Stack direction="row" alignItems="center" gap={0.75} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
      <Box
        sx={{
          px: 1.25,
          py: 0.5,
          borderRadius: 5,
          bgcolor: 'background.paper',
          border: '1px solid',
          borderColor: 'divider',
          fontWeight: 800,
          fontSize: 13,
        }}
      >
        {counts.total} devices
      </Box>

      {chips.map(({ key, count }) => {
        const accent = statusAccent(key);
        const active = activeFilter === key;
        const style = STATUS_STYLES[key];
        return (
          <Box
            key={key}
            role="button"
            onClick={() => onFilter(active ? null : key)}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.75,
              px: 1.25,
              py: 0.5,
              borderRadius: 5,
              cursor: 'pointer',
              userSelect: 'none',
              fontSize: 13,
              fontWeight: 700,
              opacity: count === 0 && !active ? 0.45 : 1,
              color: active ? '#fff' : accent,
              bgcolor: active ? accent : style.surface,
              border: '1px solid',
              borderColor: active ? accent : 'transparent',
              transition: 'all 140ms ease',
              '&:hover': { borderColor: accent },
            }}
          >
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: active ? '#fff' : accent }} />
            {count} {style.label}
          </Box>
        );
      })}

      {activeFilter && (
        <Button size="small" variant="text" onClick={() => onFilter(null)} sx={{ fontWeight: 600 }}>
          Clear filter
        </Button>
      )}
    </Stack>
  );
}
