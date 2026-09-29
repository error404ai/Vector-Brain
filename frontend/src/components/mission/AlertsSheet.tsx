import { Box, ButtonBase, CircularProgress, Paper, Typography } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import NotificationsRoundedIcon from '@mui/icons-material/NotificationsRounded';
import type { AlertKind, AlertLevel, FleetAlert } from './alertRules';

const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const INK = '#0E1630';
const MUTED = '#5D6785';
const LINE = '#E2E7F3';

const beat = keyframes`0%,100% { transform: scale(1); } 50% { transform: scale(1.15); }`;
const ring = keyframes`0%,80%,100% { transform: rotate(0); } 84% { transform: rotate(14deg); } 88% { transform: rotate(-12deg); } 92% { transform: rotate(8deg); } 96% { transform: rotate(-4deg); }`;
const slideUp = keyframes`from { opacity: 0; transform: translateY(16px) scale(.98); } to { opacity: 1; transform: none; }`;
const rise = keyframes`from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; }`;
const reduced = { '@media (prefers-reduced-motion: reduce)': { '&, & *': { animation: 'none !important' } } };

const KIND: Record<AlertKind, { label: string; bg: string; ink: string }> = {
  ip: { label: 'IP', bg: '#EEF3FF', ink: '#1D4ED8' },
  lang: { label: 'Language', bg: '#F3EEFF', ink: '#6D28D9' },
  tz: { label: 'Timezone', bg: '#FFF4E5', ink: '#B45309' },
  clock: { label: 'Clock', bg: '#E9FBF5', ink: '#0B7A5E' },
  rtc: { label: 'WebRTC', bg: '#FFEEF3', ink: '#BE185D' },
  sim: { label: 'SIM', bg: '#EEF1F6', ink: '#3F4865' },
};
const LEVEL: Record<AlertLevel, { title: string; color: string }> = {
  high: { title: 'Needs attention now', color: '#F0445A' },
  mid: { title: 'Worth checking', color: '#F59E0B' },
  low: { title: 'Minor', color: '#94A0BA' },
};

/** The composer chip beside Attach: rings and shows a count while any phone needs a look. */
export function AlertsChip({ count, open, onClick }: { count: number; open: boolean; onClick: () => void }) {
  const active = count > 0;
  return (
    <ButtonBase
      onClick={onClick}
      aria-label={`Fleet alerts${active ? `: ${count}` : ''}`}
      aria-expanded={open}
      sx={{
        position: 'relative',
        gap: 0.6,
        px: 1.25,
        height: 24,
        borderRadius: 99,
        font: '600 12.5px inherit',
        border: '1px solid',
        borderColor: active ? 'rgba(245,158,11,.55)' : 'divider',
        bgcolor: open ? 'rgba(245,158,11,.14)' : active ? 'rgba(245,158,11,.07)' : 'transparent',
        color: active ? '#B45309' : 'text.secondary',
        transition: 'transform 150ms, background-color 150ms',
        '&:hover': { transform: 'translateY(-1px)' },
        '&:focus-visible': { outline: '2px solid #F59E0B', outlineOffset: 2 },
        ...reduced,
      }}
    >
      <NotificationsRoundedIcon sx={{ fontSize: 15, transformOrigin: '50% 10%', animation: active ? `${ring} 3.2s ease-in-out infinite` : 'none' }} />
      Alerts
      {active && (
        <Box
          component="span"
          sx={{
            position: 'absolute',
            top: -8,
            right: -8,
            minWidth: 18,
            height: 18,
            px: 0.5,
            borderRadius: 99,
            bgcolor: '#F0445A',
            color: '#fff',
            font: '800 10.5px inherit',
            display: 'grid',
            placeItems: 'center',
            boxShadow: '0 0 0 2px #fff',
            animation: `${beat} 1.8s ease-in-out infinite`,
          }}
        >
          {count}
        </Box>
      )}
    </ButtonBase>
  );
}

/**
 * The pull-up sheet above the composer: every phone that needs a look,
 * grouped by urgency, each with a Fix that writes the command into the
 * composer (nothing runs until Send).
 */
export function AlertsSheet({
  alerts,
  onFix,
  onRefresh,
  refreshing,
  onClose,
}: {
  alerts: FleetAlert[];
  onFix: (command: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
  onClose: () => void;
}) {
  const phones = new Set(alerts.map((a) => a.phone)).size;
  return (
    <Paper
      elevation={0}
      sx={{
        mb: 1,
        borderRadius: '20px',
        border: `1px solid ${LINE}`,
        overflow: 'hidden',
        boxShadow: '0 30px 60px -30px rgba(14,22,48,.45)',
        animation: `${slideUp} 380ms cubic-bezier(.2,.9,.3,1.1)`,
        ...reduced,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 2, py: 1.5, background: 'linear-gradient(90deg, #FFF6E8, #FFF0F4 60%, #F5F0FF)', borderBottom: `1px solid ${LINE}`, flexWrap: 'wrap' }}>
        <Box sx={{ fontSize: 18 }}>🔔</Box>
        <Typography sx={{ fontWeight: 800, fontSize: 17, flex: 1, color: INK }}>
          {alerts.length ? `${phones} ${phones === 1 ? 'phone needs' : 'phones need'} a look` : 'Every phone looks right'}
        </Typography>
        <SheetButton onClick={onRefresh} disabled={refreshing}>
          {refreshing ? <CircularProgress size={12} thickness={6} /> : 'Refresh all'}
        </SheetButton>
        <SheetButton onClick={onClose}>Close</SheetButton>
      </Box>
      <Box sx={{ maxHeight: { xs: 320, md: 380 }, overflowY: 'auto', overscrollBehavior: 'contain', py: 0.5 }}>
        {!alerts.length && (
          <Typography sx={{ px: 2, py: 2, color: MUTED, fontSize: 14 }}>
            IP, language, timezone, clock and SIM match on every phone that has reported. Phones check in every 15 minutes and after a proxy rotation.
          </Typography>
        )}
        {(['high', 'mid', 'low'] as AlertLevel[]).map((level) => {
          const list = alerts.filter((a) => a.level === level);
          if (!list.length) return null;
          return (
            <Box key={level} sx={{ px: 2, py: 1 }}>
              <Typography sx={{ font: `700 10.5px ${MONO}`, letterSpacing: '.12em', color: MUTED, mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: LEVEL[level].color }} />
                {LEVEL[level].title.toUpperCase()} · {list.length}
              </Typography>
              {list.map((a, i) => (
                <Box
                  key={a.key}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: '4px minmax(0,1fr) auto',
                    gap: 1.5,
                    alignItems: 'center',
                    px: 1.25,
                    py: 1,
                    mb: 0.75,
                    borderRadius: '12px',
                    border: `1px solid ${LINE}`,
                    bgcolor: '#fff',
                    animation: `${rise} 380ms cubic-bezier(.2,.8,.2,1) ${Math.min(i, 8) * 60}ms both`,
                  }}
                >
                  <Box sx={{ alignSelf: 'stretch', borderRadius: 4, bgcolor: LEVEL[a.level].color }} />
                  <Box sx={{ minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
                      <Typography sx={{ fontWeight: 700, fontSize: 14, color: INK }}>{a.phone}</Typography>
                      <Box component="span" sx={{ font: `700 11.5px ${MONO}`, px: 0.9, borderRadius: '6px', bgcolor: KIND[a.kind].bg, color: KIND[a.kind].ink }}>
                        {KIND[a.kind].label}
                      </Box>
                    </Box>
                    <Typography sx={{ fontSize: 12.5, color: MUTED, lineHeight: 1.45 }}>{a.detail}</Typography>
                  </Box>
                  {a.fix ? (
                    <SheetButton onClick={() => onFix(a.fix as string)} tone="fix">
                      Fix
                    </SheetButton>
                  ) : (
                    <Typography sx={{ fontSize: 11.5, color: MUTED, maxWidth: 120, textAlign: 'right', lineHeight: 1.3 }}>
                      {a.phone.includes(' · ') ? 'Name shared by other phones: rename it to fix from here' : ''}
                    </Typography>
                  )}
                </Box>
              ))}
            </Box>
          );
        })}
      </Box>
    </Paper>
  );
}

function SheetButton({ onClick, disabled, tone, children }: { onClick: () => void; disabled?: boolean; tone?: 'fix'; children: React.ReactNode }) {
  return (
    <ButtonBase
      onClick={onClick}
      disabled={disabled}
      sx={{
        font: '700 12px inherit',
        px: 1.25,
        py: 0.6,
        minWidth: 44,
        borderRadius: '9px',
        border: `1px solid ${tone === 'fix' ? '#C9D6FF' : LINE}`,
        bgcolor: tone === 'fix' ? '#F4F7FF' : '#fff',
        color: tone === 'fix' ? '#2F6BFF' : INK,
        transition: 'transform 150ms, box-shadow 150ms',
        '&:hover': { transform: 'translateY(-1px)', boxShadow: '0 8px 18px -10px rgba(47,107,255,.6)' },
        '&:focus-visible': { outline: '2px solid #2F6BFF', outlineOffset: 2 },
      }}
    >
      {children}
    </ButtonBase>
  );
}
