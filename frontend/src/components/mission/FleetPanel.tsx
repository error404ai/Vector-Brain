/**
 * The right-hand Fleet panel on wide screens: how many phones are up, what
 * needs a look, what is running now, and one phone kept live while you chat.
 * Everything here is data the page already has (fleet state, alerts, missions,
 * the live frame feed); the only thing it starts is a screen stream for the
 * phone you pick to watch, and it stops that stream when you pick none.
 */
import { Box, ButtonBase, MenuItem, Select, Typography } from '@mui/material';
import NotificationsRoundedIcon from '@mui/icons-material/NotificationsRounded';
import { keyframes } from '@mui/material/styles';
import { useEffect, useState } from 'react';
import type { FleetStateDevice } from '@/RTKService/androidService/androidService';
import { useUnwatchDeviceScreenMutation, useWatchDeviceScreenMutation } from '@/RTKService/androidService/androidService';
import type { Mission } from '@/RTKService/missionService/missionService';
import type { FleetAlert } from './alertRules';
import { useLiveThumbnail } from '@/_helpers/screenThumbs';

const INK = '#0f172a';
const MUTED = '#64748b';
const LINE = 'rgba(15,23,42,.08)';
const BLUE = '#2563eb';

const livePulse = keyframes`0%,100% { box-shadow: 0 0 0 0 rgba(34,197,94,.5); } 50% { box-shadow: 0 0 0 6px rgba(34,197,94,0); }`;
const bellRing = keyframes`0%,80%,100% { transform: rotate(0); } 84% { transform: rotate(14deg); } 88% { transform: rotate(-12deg); } 92% { transform: rotate(8deg); }`;
const reduced = { '@media (prefers-reduced-motion: reduce)': { animation: 'none' } };

/** Frosted card every section of the panel sits on. */
const card = {
  bgcolor: 'rgba(255,255,255,.72)',
  backdropFilter: 'blur(18px) saturate(1.3)',
  WebkitBackdropFilter: 'blur(18px) saturate(1.3)',
  border: `1px solid ${LINE}`,
  borderRadius: '18px',
  px: 2,
  py: 1.75,
} as const;

const KIND_TONE: Record<FleetAlert['kind'], { label: string; bg: string; fg: string }> = {
  tz: { label: 'TIMEZONE', bg: '#FFF4E5', fg: '#B45309' },
  ip: { label: 'IP', bg: '#EEF3FF', fg: '#1D4ED8' },
  lang: { label: 'LANGUAGE', bg: '#F3EEFF', fg: '#6D28D9' },
  clock: { label: 'CLOCK', bg: '#E9FBF5', fg: '#0B7A5E' },
  rtc: { label: 'WEBRTC', bg: '#FFEEF3', fg: '#BE185D' },
  sim: { label: 'SIM', bg: '#EEF1F6', fg: '#3F4865' },
};

const ALERTS_SHOWN = 4;
/** The server stops a screen stream when nobody says they are still watching. */
const KEEP_ALIVE_MS = 20_000;

function stateColor(state: FleetStateDevice['state']): string {
  if (state === 'offline') return '#cbd5e1';
  if (state === 'running') return '#0284c7';
  if (state === 'failed' || state === 'interrupted') return '#ef4444';
  if (state === 'needs_setup') return '#f59e0b';
  return '#22c55e';
}

function FleetCard({ devices }: { devices: FleetStateDevice[] }) {
  const offline = devices.filter((d) => d.state === 'offline').length;
  const busy = devices.filter((d) => d.state === 'running' || d.state === 'waiting').length;
  const online = devices.length - offline;
  // Online first, so the bar reads green-to-grey left to right.
  const ordered = [...devices].sort((a, b) => Number(a.state === 'offline') - Number(b.state === 'offline'));
  return (
    <Box sx={card}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box component="span" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#22c55e', animation: `${livePulse} 1.8s ease-out infinite`, ...reduced }} />
        <Typography sx={{ fontWeight: 700, fontSize: 14, flex: 1 }}>Fleet</Typography>
        <Typography sx={{ fontSize: 12, color: MUTED }}>live</Typography>
      </Box>
      <Typography sx={{ mt: 0.5, fontSize: 22, fontWeight: 800, letterSpacing: '-.02em' }}>
        {online}{' '}
        <Box component="span" sx={{ fontSize: 13, fontWeight: 500, color: MUTED, letterSpacing: 0 }}>
          online · {offline} offline · {busy} busy
        </Box>
      </Typography>
      {devices.length > 0 && (
        <Box role="img" aria-label={`${online} online, ${offline} offline`} sx={{ display: 'flex', gap: '2px', mt: 1 }}>
          {ordered.map((d) => (
            <Box key={d.id} title={`${d.name} · ${d.state.replace('_', ' ')}`} sx={{ flex: 1, height: 8, borderRadius: '2px', bgcolor: stateColor(d.state) }} />
          ))}
        </Box>
      )}
    </Box>
  );
}

function AlertsCard({ alerts, onFix, onOpen }: { alerts: FleetAlert[]; onFix: (command: string) => void; onOpen: () => void }) {
  const phones = new Set(alerts.map((a) => a.phone)).size;
  return (
    <Box sx={{ ...card, pb: 0.75 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
        <NotificationsRoundedIcon
          sx={{ fontSize: 18, color: phones ? '#f59e0b' : MUTED, transformOrigin: '50% 10%', animation: phones ? `${bellRing} 3s ease-in-out infinite` : 'none', ...reduced }}
        />
        <Typography sx={{ fontWeight: 700, fontSize: 14 }}>Alerts</Typography>
        {phones > 0 && <Box sx={{ bgcolor: '#ef4444', color: '#fff', borderRadius: 99, fontSize: 11, fontWeight: 700, px: 0.9, lineHeight: '18px' }}>{phones}</Box>}
        <Box sx={{ flex: 1 }} />
        <ButtonBase onClick={onOpen} sx={{ fontSize: 12, fontWeight: 600, color: BLUE, borderRadius: 1, px: 0.5 }}>
          {alerts.length > ALERTS_SHOWN ? `All ${alerts.length}` : 'Details'}
        </ButtonBase>
      </Box>
      {alerts.length === 0 && <Typography sx={{ fontSize: 12.5, color: MUTED, py: 1 }}>Nothing needs a look.</Typography>}
      {alerts.slice(0, ALERTS_SHOWN).map((a) => {
        const tone = KIND_TONE[a.kind];
        return (
          <Box key={a.key} sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 1, alignItems: 'center', py: 1, borderTop: `1px solid ${LINE}` }}>
            <Box sx={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.04em', borderRadius: '6px', px: 0.75, py: 0.4, bgcolor: tone.bg, color: tone.fg }}>{tone.label}</Box>
            <Box sx={{ minWidth: 0 }}>
              <Typography noWrap sx={{ fontSize: 12.5, fontWeight: 600 }}>
                {a.phone}
              </Typography>
              <Typography noWrap title={a.detail} sx={{ fontSize: 11.5, color: MUTED }}>
                {a.title}
              </Typography>
            </Box>
            {a.fix ? (
              <ButtonBase
                onClick={() => onFix(a.fix as string)}
                sx={{ fontSize: 11.5, fontWeight: 600, color: BLUE, border: `1px solid ${LINE}`, borderRadius: '8px', px: 1, py: 0.4 }}
              >
                Fix
              </ButtonBase>
            ) : (
              <span />
            )}
          </Box>
        );
      })}
    </Box>
  );
}

function RunningCard({ missions }: { missions: Mission[] }) {
  const open = (id: number) => document.getElementById(`mission-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return (
    <Box sx={card}>
      <Box sx={{ display: 'flex', alignItems: 'baseline' }}>
        <Typography sx={{ fontWeight: 700, fontSize: 14, flex: 1 }}>Running now</Typography>
        <Typography sx={{ fontSize: 12, color: MUTED }}>{missions.length ? `${missions.length} ${missions.length === 1 ? 'mission' : 'missions'}` : 'nothing'}</Typography>
      </Box>
      {missions.length === 0 && <Typography sx={{ fontSize: 12.5, color: MUTED, mt: 0.75 }}>No task is running. Ask Vector in the chat.</Typography>}
      {missions.slice(0, 3).map((m) => {
        const p = m.progress;
        const inChat = typeof document !== 'undefined' && !!document.getElementById(`mission-${m.id}`);
        const rest = Math.max(0, p.total - p.succeeded - p.failed - p.running);
        return (
          <Box key={m.id} sx={{ mt: 1.25, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            <Typography noWrap title={m.prompt ?? m.request} sx={{ fontSize: 13, fontWeight: 600 }}>
              {m.status === 'PAUSED' ? 'Paused · ' : ''}
              {m.prompt ?? m.request}
            </Typography>
            <Box role="img" aria-label={`${p.succeeded} done, ${p.failed} failed, ${p.running} running of ${p.total}`} sx={{ display: 'flex', gap: '2px', height: 6, borderRadius: 1, overflow: 'hidden', bgcolor: 'rgba(15,23,42,.05)' }}>
              {p.succeeded > 0 && <Box sx={{ flexGrow: p.succeeded, flexBasis: 0, bgcolor: '#16a34a' }} />}
              {p.failed > 0 && <Box sx={{ flexGrow: p.failed, flexBasis: 0, bgcolor: '#dc2626' }} />}
              {p.running > 0 && <Box sx={{ flexGrow: p.running, flexBasis: 0, bgcolor: '#0284c7' }} />}
              {rest > 0 && <Box sx={{ flexGrow: rest, flexBasis: 0 }} />}
            </Box>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Typography sx={{ fontSize: 12, color: MUTED, flex: 1 }}>
                {p.succeeded} of {p.total} done{p.running ? ` · ${p.running} running` : ''}
                {p.failed ? ` · ${p.failed} failed` : ''}
              </Typography>
              {inChat && (
                <ButtonBase onClick={() => open(m.id)} sx={{ fontSize: 12, fontWeight: 600, color: BLUE, borderRadius: 1, px: 0.5 }}>
                  Open ↓
                </ButtonBase>
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

/** One phone kept live in the panel; picking none stops the stream. */
type LiveFrame = { data: string; at: number };

function WatchCard({ devices, frameOf }: { devices: FleetStateDevice[]; frameOf: (hwId: string) => LiveFrame | undefined }) {
  const [watchId, setWatchId] = useState<number | ''>('');
  const [watch] = useWatchDeviceScreenMutation();
  const [unwatch] = useUnwatchDeviceScreenMutation();
  const online = devices.filter((d) => d.state !== 'offline');
  const picked = devices.find((d) => d.id === watchId);
  const goneOffline = picked?.state === 'offline';

  useEffect(() => {
    if (!watchId || goneOffline) return;
    const ping = () => void watch({ id: watchId, interval_ms: 1000 }).unwrap().catch(() => undefined);
    ping();
    const keepAlive = window.setInterval(ping, KEEP_ALIVE_MS);
    return () => {
      window.clearInterval(keepAlive);
      void unwatch(watchId).unwrap().catch(() => undefined);
    };
  }, [watchId, goneOffline, watch, unwatch]);

  // Drawn 64px wide: a downscaled copy every 2s, not the full frame every second.
  const src = useLiveThumbnail(picked?.device_id, picked ? frameOf(picked.device_id) : undefined, 2000) ?? undefined;
  return (
    <Box sx={{ ...card, display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
      <Box
        sx={{ width: 64, flexShrink: 0, aspectRatio: '9 / 19.5', borderRadius: '10px', border: '3px solid #111', bgcolor: '#111', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        {src ? (
          <Box component="img" src={src} alt={`${picked?.name} live screen`} sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        ) : (
          <Typography sx={{ fontSize: 9.5, color: '#94a3b8', textAlign: 'center', px: 0.5 }}>{picked ? (goneOffline ? 'Offline' : 'Connecting…') : 'No phone'}</Typography>
        )}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Typography sx={{ fontWeight: 700, fontSize: 13.5 }}>Watching</Typography>
        <Select
          size="small"
          value={watchId}
          displayEmpty
          onChange={(e) => {
            const v = String(e.target.value);
            setWatchId(v === '' ? '' : Number(v));
          }}
          inputProps={{ 'aria-label': 'Phone to watch' }}
          sx={{ fontSize: 12.5, bgcolor: 'rgba(255,255,255,.7)', '& .MuiSelect-select': { py: 0.75 } }}
        >
          <MenuItem value="" sx={{ fontSize: 13 }}>
            None
          </MenuItem>
          {online.map((d) => (
            <MenuItem key={d.id} value={d.id} sx={{ fontSize: 13 }}>
              {d.name}
            </MenuItem>
          ))}
        </Select>
        <Typography sx={{ fontSize: 11.5, color: MUTED, lineHeight: 1.4 }}>
          {picked ? (src ? '● Live while this panel is open.' : 'Waiting for the first screen…') : 'Pick a phone to keep it live here while you chat.'}
        </Typography>
      </Box>
    </Box>
  );
}

export default function FleetPanel({
  devices,
  alerts,
  missions,
  onFix,
  onOpenAlerts,
  frameOf,
}: {
  devices: FleetStateDevice[];
  alerts: FleetAlert[];
  missions: Mission[];
  onFix: (command: string) => void;
  onOpenAlerts: () => void;
  frameOf: (hwId: string) => LiveFrame | undefined;
}) {
  return (
    <Box
      component="aside"
      aria-label="Fleet panel"
      sx={{ position: 'relative', zIndex: 1, width: 300, flexShrink: 0, py: 3, pr: 3, display: 'flex', flexDirection: 'column', gap: 1.5, overflowY: 'auto', color: INK }}
    >
      <FleetCard devices={devices} />
      <AlertsCard alerts={alerts} onFix={onFix} onOpen={onOpenAlerts} />
      <RunningCard missions={missions} />
      <WatchCard devices={devices} frameOf={frameOf} />
    </Box>
  );
}
