import { Badge, Box, IconButton, Tooltip, Typography } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import MenuIcon from '@mui/icons-material/Menu';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import NotificationsNoneRoundedIcon from '@mui/icons-material/NotificationsNoneRounded';
import { useGetProfileQuery } from '@/RTKService/authService/authService';
import { APP_MENU_EVENT, PROFILE_MENU_EVENT } from '@/components/layout/layoutEvents';
import { reducedMotion } from './motion';

/**
 * Mission Control on a phone, "Prism Ring": one frosted top bar, a compact
 * mission card with a progress ring and one row per phone, and a pill composer.
 * Colours and type follow the Prism system used on Settings.
 */
export const PRISM = {
  accent: '#3b4cff',
  violet: '#6d28d9',
  pink: '#ec4899',
  ink: '#141a2e',
  muted: '#3c435e',
  line: '#c3c8de',
  track: '#e4e6f3',
  label: '#3730a3',
  gradient: 'linear-gradient(135deg, #3b4cff, #6d28d9)',
  send: 'linear-gradient(135deg, #3b4cff, #ec4899)',
} as const;

export const glass = {
  bgcolor: 'rgba(255,255,255,.74)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  border: '1px solid rgba(255,255,255,.95)',
  borderRadius: '24px',
  boxShadow: '0 24px 60px rgba(30,40,90,.09)',
} as const;

export const monoLabel = {
  fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  fontWeight: 700,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
} as const;

const spin = keyframes`to { transform: rotate(360deg); }`;
export const livePulse = keyframes`
  0%   { box-shadow: 0 0 0 0 rgba(59,76,255,.45); }
  70%  { box-shadow: 0 0 0 7px rgba(59,76,255,0); }
  100% { box-shadow: 0 0 0 0 rgba(59,76,255,0); }
`;
export const thumbShimmer = keyframes`
  from { background-position: 180% 0; }
  to   { background-position: -80% 0; }
`;

/** A secondary button in the Prism style: white, thin ink border. */
export const quietButton = {
  height: 36,
  px: 1.75,
  borderRadius: '12px',
  border: `1.5px solid ${PRISM.line}`,
  bgcolor: '#fff',
  color: '#262c48',
  fontWeight: 700,
  fontSize: 13,
  textTransform: 'none',
  minWidth: 0,
  '&:hover': { bgcolor: '#f7f8fd', borderColor: '#aab0cc' },
} as const;

function initials(name?: string | null): string {
  return (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

/** The phone top bar: app menu, which mission this is, chats, alerts and the account. */
export function MobileTopBar({
  title,
  alerts,
  alertsOpen,
  onAlerts,
  onChats,
  showAlerts,
}: {
  title: string;
  alerts: number;
  alertsOpen: boolean;
  onAlerts: () => void;
  onChats: () => void;
  showAlerts: boolean;
}) {
  const { data: profile } = useGetProfileQuery();
  const name = profile?.data?.name;
  const iconSx = { width: 44, height: 44, borderRadius: '14px', color: PRISM.ink } as const;
  return (
    <Box
      component="header"
      sx={{
        position: 'relative',
        zIndex: 2,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        minHeight: 56,
        pl: 0.75,
        pr: 1.5,
        pt: 'env(safe-area-inset-top, 0px)',
        bgcolor: 'rgba(255,255,255,.62)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: '1px solid rgba(255,255,255,.95)',
      }}
    >
      <IconButton aria-label="Open menu" onClick={() => window.dispatchEvent(new Event(APP_MENU_EVENT))} sx={iconSx}>
        <MenuIcon />
      </IconButton>
      <Box sx={{ flex: 1, minWidth: 0, pl: 0.25 }}>
        <Typography sx={{ ...monoLabel, fontSize: 10.5, color: PRISM.label, lineHeight: 1.3 }}>Mission Control</Typography>
        <Typography noWrap sx={{ fontWeight: 800, fontSize: 16, letterSpacing: '-.02em', color: PRISM.ink, lineHeight: 1.3 }}>
          {title}
        </Typography>
      </Box>
      <Tooltip title="Chats">
        <IconButton aria-label="Chats" onClick={onChats} sx={iconSx}>
          <HistoryRoundedIcon />
        </IconButton>
      </Tooltip>
      {showAlerts && (
        <IconButton aria-label={`Fleet alerts: ${alerts}`} aria-expanded={alertsOpen} onClick={onAlerts} sx={iconSx}>
          <Badge
            variant="dot"
            invisible={!alerts}
            sx={{ '& .MuiBadge-dot': { bgcolor: PRISM.pink, width: 10, height: 10, borderRadius: '50%', border: '2px solid #fff', top: 3, right: 3 } }}
          >
            <NotificationsNoneRoundedIcon />
          </Badge>
        </IconButton>
      )}
      <Box
        component="button"
        type="button"
        aria-label="Account"
        onClick={(event: React.MouseEvent<HTMLButtonElement>) => window.dispatchEvent(new CustomEvent(PROFILE_MENU_EVENT, { detail: event.currentTarget }))}
        sx={{
          ml: 0.5,
          width: 36,
          height: 36,
          flexShrink: 0,
          border: 0,
          borderRadius: '50%',
          background: PRISM.gradient,
          color: '#fff',
          font: '800 12.5px Inter, system-ui, sans-serif',
          cursor: 'pointer',
          boxShadow: '0 8px 18px -10px rgba(59,76,255,.9)',
        }}
      >
        {initials(name) || '·'}
      </Box>
    </Box>
  );
}

/**
 * Settled phones out of all, as a ring: the done part in the Prism gradient,
 * and while it runs a faint arc keeps turning so a live mission never looks frozen.
 */
export function ProgressRing({ done, total, running, tone }: { done: number; total: number; running: boolean; tone?: string }) {
  const r = 20;
  const length = 2 * Math.PI * r;
  const part = total ? Math.min(1, done / total) * length : 0;
  return (
    <Box sx={{ position: 'relative', width: 48, height: 48, flexShrink: 0 }} role="img" aria-label={`${done} of ${total} finished`}>
      <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden="true">
        <defs>
          <linearGradient id="prism-ring" x1="0" x2="1" y1="0" y2="1">
            <stop offset="0" stopColor={PRISM.accent} />
            <stop offset="1" stopColor={PRISM.pink} />
          </linearGradient>
        </defs>
        <circle cx="24" cy="24" r={r} fill="none" stroke={PRISM.track} strokeWidth="5" />
        {part > 0 && (
          <circle
            cx="24"
            cy="24"
            r={r}
            fill="none"
            stroke={tone ?? 'url(#prism-ring)'}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${part} ${length}`}
            transform="rotate(-90 24 24)"
            style={{ transition: 'stroke-dasharray 600ms cubic-bezier(.2,.8,.2,1)' }}
          />
        )}
      </svg>
      {running && (
        <Box component="svg" viewBox="0 0 48 48" aria-hidden="true" sx={{ position: 'absolute', inset: 0, width: 48, height: 48, animation: `${spin} 5s linear infinite`, ...reducedMotion }}>
          <circle cx="24" cy="24" r={r} fill="none" stroke={PRISM.accent} strokeOpacity=".35" strokeWidth="5" strokeLinecap="round" strokeDasharray={`10 ${length - 10}`} />
        </Box>
      )}
      <Typography
        component="span"
        sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontFamily: monoLabel.fontFamily, fontWeight: 700, fontSize: total >= 100 ? 10 : 12.5, color: PRISM.ink }}
      >
        {done}/{total}
      </Typography>
    </Box>
  );
}

export type BadgeTone = 'done' | 'live' | 'off' | 'failed' | 'wait' | 'paused' | 'busy' | 'stopped';

const BADGE: Record<BadgeTone, { text: string; color: string; bg: string }> = {
  done: { text: 'DONE', color: '#0a7a55', bg: '#d9f6e9' },
  live: { text: 'LIVE', color: '#fff', bg: PRISM.gradient },
  off: { text: 'OFF', color: '#8a4b0f', bg: '#fde9d2' },
  failed: { text: 'FAILED', color: '#b42318', bg: '#fde2e1' },
  wait: { text: 'WAIT', color: PRISM.muted, bg: '#eceef6' },
  paused: { text: 'PAUSED', color: '#92400e', bg: '#fdf0d5' },
  busy: { text: 'BUSY', color: '#5b21b6', bg: '#ede4ff' },
  stopped: { text: 'STOPPED', color: PRISM.muted, bg: '#eceef6' },
};

export function StatusBadge({ tone, label }: { tone: BadgeTone; label?: string }) {
  const b = BADGE[tone];
  return (
    <Box component="span" sx={{ ...monoLabel, flexShrink: 0, fontSize: 11, letterSpacing: '.06em', color: b.color, background: b.bg, px: 1, py: '5px', borderRadius: '8px', lineHeight: 1 }}>
      {label ?? b.text}
    </Box>
  );
}
