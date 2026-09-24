import authManager from '@/_helpers/authManager';
import {
  useConfirmCommandMutation,
  useDeleteConversationMutation,
  useGetChatHistoryQuery,
  useGetConversationsQuery,
  useNewConversationMutation,
  useRerunFromChatMutation,
  useSendCommandMutation,
  type ChatReply,
  type Conversation,
} from '@/RTKService/commandChatService/commandChatService';
import {
  useCancelMissionMutation,
  useGetMissionQuery, useGetFinalScreenQuery,
  type Mission,
  type MissionItem,
  type MissionItemStatus,
} from '@/RTKService/missionService/missionService';
import {
  ease,
  glowError,
  glowSuccess,
  popIn,
  pulseDot,
  reducedMotion,
  riseIn,
  screenFade,
  shake,
  shimmer,
  slideStep,
  typingDot,
} from '@/components/mission/motion';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ErrorRoundedIcon from '@mui/icons-material/ErrorRounded';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SendIcon from '@mui/icons-material/Send';
import StopCircleOutlinedIcon from '@mui/icons-material/StopCircleOutlined';
import { useGetFleetStateQuery } from '@/RTKService/androidService/androidService';
import { useGetDeviceProxiesQuery, useUpdateDeviceProxyMutation } from '@/RTKService/androidService/proxyService';
import ReplayIcon from '@mui/icons-material/Replay';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { Box, Button, Chip, CircularProgress, Dialog, Drawer, FormControlLabel, IconButton, LinearProgress, MenuItem, MenuList, Paper, Switch, TextField, Tooltip, Typography, useMediaQuery } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import toast from 'react-hot-toast';

// -----------------------------------------------------------------------------
// Live feed: one page socket carrying screens, steps, rounds and mission pushes
// -----------------------------------------------------------------------------

/** Latest screen per phone, keyed by hardware id. */
type FrameMap = Record<string, { data: string; at: number }>;
/** One agent step as the server announces it. */
interface LiveStep {
  index: number;
  thought: string;
  action: string;
  at: number;
}
interface LiveFeed {
  frames: FrameMap;
  /** Recent steps per run, keyed by agent task id (a phone's old missions stay clean). */
  steps: Record<number, LiveStep[]>;
  /** Current round of a timed run, keyed by agent task id. */
  rounds: Record<number, { round: number; endsAt: number }>;
  /** Bumped when the server says a mission changed, so its card refetches. */
  missionPush: Record<number, number>;
}

const MAX_STEPS_KEPT = 40;

function describeAction(action: unknown): string {
  const type = (action as { type?: string })?.type ?? '';
  return type.replace(/_/g, ' ');
}

function useLiveFeed(): LiveFeed {
  const [feed, setFeed] = useState<LiveFeed>({ frames: {}, steps: {}, rounds: {}, missionPush: {} });
  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      const token = authManager.getAccessToken();
      if (!token) {
        retry = setTimeout(connect, 2000);
        return;
      }
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${window.location.host}/ws/android?type=web&token=${encodeURIComponent(token)}`);
      socket.onmessage = (event) => {
        let msg: { event?: string; payload?: Record<string, unknown> };
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        const p = msg.payload ?? {};
        switch (msg.event) {
          case 'device:screen_capture': {
            const hw = p.deviceId;
            const data = (p.result as { screenCapture?: { base64Data?: string } })?.screenCapture?.base64Data;
            if (typeof hw === 'string' && typeof data === 'string') {
              setFeed((prev) => ({ ...prev, frames: { ...prev.frames, [hw]: { data, at: Date.now() } } }));
            }
            break;
          }
          case 'task:started': {
            const id = p.taskId;
            if (typeof id === 'number') setFeed((prev) => ({ ...prev, steps: { ...prev.steps, [id]: [] } }));
            break;
          }
          case 'task:step': {
            const id = p.taskId;
            if (typeof id !== 'number') break;
            const step: LiveStep = {
              index: Number(p.stepIndex) || 0,
              thought: String(p.thought ?? '').slice(0, 220),
              action: describeAction(p.action),
              at: Date.now(),
            };
            setFeed((prev) => ({
              ...prev,
              steps: { ...prev.steps, [id]: [...(prev.steps[id] ?? []), step].slice(-MAX_STEPS_KEPT) },
            }));
            break;
          }
          case 'task:round': {
            const id = p.taskId;
            if (typeof id === 'number') {
              setFeed((prev) => ({ ...prev, rounds: { ...prev.rounds, [id]: { round: Number(p.round) || 1, endsAt: Number(p.endsAt) } } }));
            }
            break;
          }
          case 'mission:update': {
            const id = p.id;
            if (typeof id === 'number') {
              setFeed((prev) => ({ ...prev, missionPush: { ...prev.missionPush, [id]: (prev.missionPush[id] ?? 0) + 1 } }));
            }
            break;
          }
        }
      };
      socket.onclose = () => {
        if (!disposed) retry = setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, []);
  return feed;
}

function frameSrc(data: string): string {
  return data.startsWith('data:') ? data : `data:image/jpeg;base64,${data}`;
}

function minutesLeft(endsAt: number): string {
  const ms = endsAt - Date.now();
  if (ms <= 0) return 'finishing';
  const min = Math.round(ms / 60_000);
  return min < 1 ? '<1 min left' : `${min} min left`;
}

// -----------------------------------------------------------------------------
// Pieces
// -----------------------------------------------------------------------------

const EXAMPLES = [
  'Who are you?',
  'How many phones are online?',
  'On 5 phones, open Chrome and browse random websites for 30 minutes',
  'On #PhoneBox phones, open YouTube and play lofi music',
];

const ITEM_TONE: Record<MissionItemStatus, { label: string; color: 'default' | 'info' | 'warning' | 'success' | 'error' }> = {
  PENDING: { label: 'Waiting', color: 'default' },
  QUEUED: { label: 'In proxy queue', color: 'warning' },
  RUNNING: { label: 'Running', color: 'info' },
  SUCCEEDED: { label: 'Done', color: 'success' },
  FAILED: { label: 'Failed', color: 'error' },
  CANCELLED: { label: 'Cancelled', color: 'default' },
};

function errorMessage(error: unknown): string {
  const data = (error as { data?: { message?: string } })?.data;
  return data?.message || 'Something went wrong';
}

function StatusChip({ item }: { item: MissionItem }) {
  const tone = ITEM_TONE[item.status];
  const retrying = item.status === 'PENDING' && item.attempts > 0;
  // Keyed by status so each change replays its own entrance.
  const motion =
    item.status === 'SUCCEEDED'
      ? { animation: `${popIn} 420ms ${ease}` }
      : item.status === 'FAILED'
        ? { animation: `${shake} 420ms ease` }
        : { animation: `${riseIn} 220ms ${ease}` };
  return (
    <Chip
      key={item.status}
      size="small"
      icon={
        item.status === 'RUNNING' ? (
          <Box component="span" sx={{ width: 8, height: 8, ml: '8px !important', borderRadius: '50%', bgcolor: 'info.main', animation: `${pulseDot} 1.6s infinite`, ...reducedMotion }} />
        ) : item.status === 'SUCCEEDED' ? (
          <CheckCircleRoundedIcon />
        ) : item.status === 'FAILED' ? (
          <ErrorRoundedIcon />
        ) : undefined
      }
      label={retrying ? `Retrying (${item.attempts + 1})` : tone.label}
      color={retrying ? 'warning' : tone.color}
      variant={item.status === 'SUCCEEDED' ? 'filled' : 'outlined'}
      sx={{ ...motion, ...reducedMotion }}
    />
  );
}

/** How long each running phone stays on the big screen before the next one. */
const ROTATE_MS = 4000;

function LiveScreens({ items, feed }: { items: MissionItem[]; feed: LiveFeed }) {
  const live = items.filter((item) => item.status === 'RUNNING' && item.device_hw_id);
  const [tick, setTick] = useState(0);
  const [pinned, setPinned] = useState<number | null>(null);

  useEffect(() => {
    if (pinned !== null || live.length < 2) return;
    const timer = setInterval(() => setTick((t) => t + 1), ROTATE_MS);
    return () => clearInterval(timer);
  }, [pinned, live.length]);

  if (live.length === 0) return null;
  const pinnedItem = pinned !== null ? live.find((item) => item.id === pinned) : undefined;
  const current = pinnedItem ?? live[tick % live.length];
  const frame = current.device_hw_id ? feed.frames[current.device_hw_id] : undefined;
  const latest = (current.agent_task_id ? feed.steps[current.agent_task_id] ?? [] : []).slice(-1)[0];

  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', mt: 1.5, mb: 1.5, flexWrap: { xs: 'wrap', sm: 'nowrap' }, animation: `${riseIn} 320ms ${ease}`, ...reducedMotion }}>
      <Box sx={{ width: 170, flexShrink: 0, mx: { xs: 'auto', sm: 0 } }}>
        <Box
          sx={{
            aspectRatio: '9 / 19.5',
            borderRadius: 3,
            border: '6px solid',
            borderColor: 'grey.900',
            bgcolor: 'grey.900',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 10px 30px rgba(15, 23, 42, 0.18)',
          }}
        >
          {frame ? (
            <Box
              key={`${current.id}-${frame.at}`}
              component="img"
              src={frameSrc(frame.data)}
              alt={`${current.device_name} screen`}
              sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', animation: `${screenFade} 280ms ${ease}`, ...reducedMotion }}
            />
          ) : (
            <Typography variant="caption" sx={{ color: 'grey.500', px: 2, textAlign: 'center' }}>
              Waiting for the first screen…
            </Typography>
          )}
        </Box>
        <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', mt: 0.5, fontWeight: 600 }} noWrap>
          {current.device_name}
          {pinnedItem ? ' · pinned' : live.length > 1 ? ` · ${live.indexOf(current) + 1}/${live.length}` : ''}
        </Typography>
        {latest && (
          <Typography key={latest.index} variant="caption" color="text.secondary" component="p" sx={{ textAlign: 'center', lineHeight: 1.35, mt: 0.25, animation: `${slideStep} 240ms ${ease}`, ...reducedMotion }}>
            {latest.thought || latest.action}
          </Typography>
        )}
      </Box>
      {live.length > 1 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignContent: 'flex-start' }}>
          {live.map((item) => {
            const thumb = item.device_hw_id ? feed.frames[item.device_hw_id] : undefined;
            const active = item.id === current.id;
            return (
              <Tooltip key={item.id} title={pinned === item.id ? `Unpin ${item.device_name}` : `Pin ${item.device_name}`}>
                <Box
                  component="button"
                  type="button"
                  onClick={() => setPinned((p) => (p === item.id ? null : item.id))}
                  sx={{
                    p: 0,
                    width: 54,
                    aspectRatio: '9 / 19.5',
                    borderRadius: 1.5,
                    overflow: 'hidden',
                    cursor: 'pointer',
                    bgcolor: 'grey.900',
                    border: '2px solid',
                    borderColor: active ? 'primary.main' : 'transparent',
                    transition: `transform 180ms ${ease}, border-color 180ms`,
                    transform: active ? 'translateY(-2px)' : 'none',
                    '&:hover': { transform: 'translateY(-2px)' },
                    ...reducedMotion,
                  }}
                  aria-label={`Show ${item.device_name}`}
                >
                  {thumb && <Box component="img" src={frameSrc(thumb.data)} alt="" sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />}
                </Box>
              </Tooltip>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

type RerunHandler = (missionId: number, options: { scope: 'failed' | 'all'; continue?: boolean }) => void;

const COUNT_TONE: { key: MissionItemStatus; label: string; color: string }[] = [
  { key: 'RUNNING', label: 'Running', color: '#0284c7' },
  { key: 'QUEUED', label: 'In queue', color: '#b45309' },
  { key: 'PENDING', label: 'Waiting', color: '#64748b' },
  { key: 'SUCCEEDED', label: 'Done', color: '#15803d' },
  { key: 'FAILED', label: 'Failed', color: '#dc2626' },
  { key: 'CANCELLED', label: 'Cancelled', color: '#64748b' },
];

/** "20 Running · 3 Failed · 25 Done" — only the counts that are not zero. */
function SummaryLine({ items }: { items: MissionItem[] }) {
  const parts = COUNT_TONE.map((tone) => ({ ...tone, n: items.filter((i) => i.status === tone.key).length })).filter((p) => p.n > 0);
  return (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
      {parts.map((p) => (
        <Box key={p.key} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, px: 1.25, py: 0.5, borderRadius: 99, bgcolor: `${p.color}14` }}>
          <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: p.color }} />
          <Typography variant="body2" sx={{ fontWeight: 700, color: p.color }}>
            {p.n}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {p.label}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

/** Failed phones grouped by why they failed; details on demand. */
function FailureGroups({ items }: { items: MissionItem[] }) {
  const failed = items.filter((i) => i.status === 'FAILED');
  const [open, setOpen] = useState(false);
  if (!failed.length) return null;
  const groups = new Map<string, MissionItem[]>();
  for (const item of failed) {
    const key = item.reason_text ?? 'failed';
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return (
    <Box sx={{ border: '1px solid', borderColor: 'error.light', bgcolor: 'rgba(220,38,38,0.04)', borderRadius: 2, px: 1.5, py: 1 }}>
      <Box component="button" type="button" onClick={() => setOpen((v) => !v)} sx={{ all: 'unset', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 1, width: '100%' }} aria-expanded={open}>
        <ErrorRoundedIcon fontSize="small" color="error" />
        <Typography variant="body2" sx={{ fontWeight: 700, flex: 1 }}>
          {failed.length} failed —{' '}
          <Box component="span" sx={{ fontWeight: 400, color: 'text.secondary' }}>
            {[...groups.entries()].map(([why, list]) => `${list.length} ${why}`).join(' · ')}
          </Box>
        </Typography>
        {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
      </Box>
      {open && (
        <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {[...groups.entries()].map(([why, list]) => (
            <Box key={why}>
              <Typography variant="caption" sx={{ fontWeight: 700, color: 'error.main' }}>
                {why}
              </Typography>
              {list.map((item) => (
                <Typography key={item.id} variant="caption" component="p" color="text.secondary" sx={{ pl: 1.5 }}>
                  {item.device_name}
                  {item.last_message ? ` — ${item.last_message.slice(0, 160)}` : ''}
                </Typography>
              ))}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

/** A small tile for one phone: name, status, and its latest step or result. */
function PhoneTile({ item, steps, round }: { item: MissionItem; steps: LiveStep[]; round?: { round: number; endsAt: number } }) {
  const latest = steps[steps.length - 1];
  const line =
    item.status === 'RUNNING'
      ? latest
        ? `Step ${latest.index} · ${latest.thought || latest.action}`
        : 'Starting…'
      : item.status === 'SUCCEEDED'
        ? item.last_message ?? 'Done'
        : item.status === 'FAILED'
          ? item.reason_text ?? 'Failed'
          : ITEM_TONE[item.status].label;
  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, px: 1.25, py: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, flex: 1, minWidth: 0 }} noWrap>
          {item.device_name}
        </Typography>
        <StatusChip item={item} />
      </Box>
      <Typography key={latest?.index} variant="caption" color="text.secondary" noWrap sx={{ animation: `${slideStep} 240ms ${ease}`, ...reducedMotion }}>
        {item.status === 'RUNNING' && round ? `Round ${round.round} · ${minutesLeft(round.endsAt)} · ` : ''}
        {line}
      </Typography>
    </Box>
  );
}

const RUNNING_SHOWN = 6;

/** Fetch a thumbnail only once it is near the viewport. */
function useInView<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setInView(true);
      },
      { rootMargin: '250px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView]);
  return { ref, inView };
}

/** One target phone's final screen: the live last frame if we have it, else lazy-fetched. */
function FinalScreenThumb({ item, feed, onOpen }: { item: MissionItem; feed: LiveFeed; onOpen: (src: string, name: string) => void }) {
  const liveFrame = item.device_hw_id ? feed.frames[item.device_hw_id] : undefined;
  const { ref, inView } = useInView<HTMLDivElement>();
  const { data, isFetching } = useGetFinalScreenQuery(item.id, { skip: !!liveFrame || !inView });
  const src = liveFrame ? frameSrc(liveFrame.data) : data?.data?.base64 ? frameSrc(data.data.base64) : null;
  return (
    <Box ref={ref} sx={{ width: 82, flexShrink: 0 }}>
      <Box
        component={src ? 'button' : 'div'}
        aria-label={src ? `Enlarge ${item.device_name} final screen` : undefined}
        onClick={src ? () => onOpen(src, item.device_name) : undefined}
        sx={{ p: 0, border: 'none', bgcolor: 'transparent', cursor: src ? 'zoom-in' : 'default', width: '100%', display: 'block' }}
      >
        <Box sx={{ aspectRatio: '9 / 19.5', borderRadius: 2, border: '3px solid', borderColor: 'grey.900', bgcolor: 'grey.900', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {src ? (
            <Box component="img" src={src} alt={`${item.device_name} final screen`} sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', animation: `${screenFade} 280ms ${ease}`, ...reducedMotion }} />
          ) : (
            <Typography variant="caption" sx={{ color: 'grey.600', fontSize: 10, textAlign: 'center', px: 0.5 }}>
              {isFetching ? '…' : 'no screen'}
            </Typography>
          )}
        </Box>
      </Box>
      <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', mt: 0.25, fontSize: 11 }} noWrap>
        {item.device_name}
      </Typography>
    </Box>
  );
}

/** The row of final screens for a finished mission — only the phones the task ran on. */
function FinalScreens({ items, feed }: { items: MissionItem[]; feed: LiveFeed }) {
  const [zoom, setZoom] = useState<{ src: string; name: string } | null>(null);
  const ran = items.filter((i) => i.agent_task_id);
  if (ran.length === 0) return null;
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
        Last screen on each phone
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, overflowX: 'auto', pb: 0.5 }}>
        {ran.map((item) => (
          <FinalScreenThumb key={item.id} item={item} feed={feed} onOpen={(src, name) => setZoom({ src, name })} />
        ))}
      </Box>
      <Dialog open={!!zoom} onClose={() => setZoom(null)} maxWidth="xs">
        {zoom && (
          <Box sx={{ p: 1 }}>
            <Box component="img" src={zoom.src} alt={zoom.name} sx={{ width: '100%', borderRadius: 2, display: 'block' }} />
            <Typography variant="caption" sx={{ textAlign: 'center', display: 'block', mt: 0.5 }}>
              {zoom.name}
            </Typography>
          </Box>
        )}
      </Dialog>
    </Box>
  );
}

function MissionCard({ mission, feed, onRerun, showLive = true }: { mission: Mission; feed: LiveFeed; onRerun?: RerunHandler; showLive?: boolean }) {
  const [cancelMission, { isLoading: cancelling }] = useCancelMissionMutation();
  const [showAll, setShowAll] = useState(false);
  const { progress, items } = mission;
  const running = mission.status === 'RUNNING';
  const settled = progress.succeeded + progress.failed;
  const percent = progress.total ? Math.round((settled / progress.total) * 100) : 0;
  const finishedClean = mission.status === 'DONE' && progress.failed === 0;
  const finishedWithFailures = mission.status === 'DONE' && progress.failed > 0;
  const stepsFor = (item: MissionItem) => (item.agent_task_id ? feed.steps[item.agent_task_id] ?? [] : []);
  const roundFor = (item: MissionItem) => (item.agent_task_id ? feed.rounds[item.agent_task_id] : undefined);
  const runningItems = items.filter((i) => i.status === 'RUNNING');

  const title = running
    ? `Running on ${progress.total} ${progress.total === 1 ? 'phone' : 'phones'}`
    : mission.status === 'CANCELLED'
      ? 'Stopped'
      : finishedClean
        ? `Finished — all ${progress.total} done`
        : `Finished — ${progress.succeeded} of ${progress.total} done`;
  const tone = running ? 'info.main' : finishedClean ? 'success.main' : mission.status === 'CANCELLED' ? 'text.secondary' : 'warning.main';

  const onCancel = async () => {
    try {
      await cancelMission(mission.id).unwrap();
      toast.success('Mission stopped');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Paper
      // Replays the finish glow once, when the status flips.
      key={mission.status}
      variant="outlined"
      sx={{
        width: '100%',
        borderRadius: 3,
        overflow: 'hidden',
        animation: finishedClean
          ? `${riseIn} 300ms ${ease}, ${glowSuccess} 1.1s ease-out`
          : finishedWithFailures
            ? `${riseIn} 300ms ${ease}, ${glowError} 1.1s ease-out`
            : `${riseIn} 300ms ${ease}`,
        ...reducedMotion,
      }}
    >
      {/* Header band: the one thing to read first. */}
      <Box sx={{ px: 2.5, pt: 2, pb: 1.5, borderLeft: '4px solid', borderColor: tone, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
          {running ? (
            <CircularProgress size={20} thickness={5} />
          ) : finishedClean ? (
            <CheckCircleRoundedIcon color="success" sx={{ animation: `${popIn} 480ms ${ease}`, ...reducedMotion }} />
          ) : (
            <ErrorRoundedIcon sx={{ color: tone, animation: `${popIn} 480ms ${ease}`, ...reducedMotion }} />
          )}
          <Typography variant="h6" sx={{ fontWeight: 800, flex: 1, lineHeight: 1.2 }}>
            {title}
          </Typography>
          {running && (
            <Button size="small" color="error" variant="outlined" startIcon={<StopCircleOutlinedIcon />} onClick={onCancel} disabled={cancelling}>
              Stop
            </Button>
          )}
        </Box>
        {mission.prompt && (
          <Typography variant="body2" color="text.secondary">
            {mission.prompt}
            {mission.duration_seconds ? ` · for ${Math.round(mission.duration_seconds / 60)} min` : ''}
          </Typography>
        )}
        <SummaryLine items={items} />
        {running && (
          <Box sx={{ position: 'relative', overflow: 'hidden', borderRadius: 1 }}>
            <LinearProgress variant="determinate" value={percent} sx={{ height: 6, borderRadius: 1, '& .MuiLinearProgress-bar': { transition: `transform 600ms ${ease}` } }} />
            <Box sx={{ position: 'absolute', inset: 0, background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)', animation: `${shimmer} 1.8s linear infinite`, ...reducedMotion }} />
          </Box>
        )}
      </Box>

      {/* Body: secondary detail. */}
      <Box sx={{ px: 2.5, pb: 2, pt: 0.5, display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {running && showLive && <LiveScreens items={items} feed={feed} />}
        {!running && <FinalScreens items={items} feed={feed} />}

        {running && runningItems.length > 0 && !showAll && (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 1 }}>
            {runningItems.slice(0, RUNNING_SHOWN).map((item) => (
              <PhoneTile key={item.id} item={item} steps={stepsFor(item)} round={roundFor(item)} />
            ))}
          </Box>
        )}

        <FailureGroups items={items} />

        {mission.note && (
          <Typography variant="caption" color="warning.main">
            {mission.note}
          </Typography>
        )}

        {showAll && (
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 1, animation: `${riseIn} 220ms ${ease}`, ...reducedMotion }}>
            {items.map((item) => (
              <PhoneTile key={item.id} item={item} steps={stepsFor(item)} round={roundFor(item)} />
            ))}
          </Box>
        )}

        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button size="small" onClick={() => setShowAll((v) => !v)} endIcon={showAll ? <ExpandLessIcon /> : <ExpandMoreIcon />}>
            {showAll ? 'Hide phones' : `Show all ${items.length} phones`}
          </Button>
          <Box sx={{ flex: 1 }} />
          {!running && onRerun && (
            <>
              {items.some((i) => i.status === 'FAILED' && (i.last_reason === 'STEP_LIMIT' || i.last_reason === 'UNFINISHED')) && (
                <Button size="small" variant="contained" startIcon={<PlayArrowRoundedIcon />} onClick={() => onRerun(mission.id, { scope: 'failed', continue: true })}>
                  Continue
                </Button>
              )}
              {progress.failed > 0 && (
                <Button size="small" variant="outlined" startIcon={<ReplayIcon />} onClick={() => onRerun(mission.id, { scope: 'failed' })}>
                  Retry failed
                </Button>
              )}
              <Button size="small" startIcon={<RestartAltIcon />} onClick={() => onRerun(mission.id, { scope: 'all' })}>
                Run again
              </Button>
            </>
          )}
        </Box>
      </Box>
    </Paper>
  );
}

/**
 * A mission started from the chat, kept current on its own: it polls just this
 * mission while it runs and refetches the moment the server pushes an update.
 */
function LiveMissionCard({ initial, feed, onRerun, showLive = true }: { initial: Mission; feed: LiveFeed; onRerun?: RerunHandler; showLive?: boolean }) {
  const [status, setStatus] = useState(initial.status);
  const { data, isError, refetch } = useGetMissionQuery(initial.id, { pollingInterval: status === 'RUNNING' ? 2000 : 0 });
  const mission = data?.data ?? initial;
  if (mission.status !== status) setStatus(mission.status);
  const push = feed.missionPush[initial.id] ?? 0;
  useEffect(() => {
    if (push > 0) void refetch();
  }, [push, refetch]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <MissionCard mission={mission} feed={feed} onRerun={onRerun} showLive={showLive} />
      {isError && (
        <Typography variant="caption" color="warning.main">
          Couldn't refresh this mission — retrying.
        </Typography>
      )}
    </Box>
  );
}

// -----------------------------------------------------------------------------
// Chat
// -----------------------------------------------------------------------------

interface RotationEvent {
  ok: boolean;
  laneName: string;
  oldIp: string | null;
  newIp: string | null;
  status: string | null;
  deviceName: string | null;
}

type ChatTurn =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; reply: ChatReply; confirming?: boolean }
  | { id: string; role: 'rotation'; event: RotationEvent };

const bubbleIn = { animation: `${riseIn} 280ms ${ease}`, ...reducedMotion };

/**
 * Listens on its own socket for proxy rotations and hands each one to the
 * chat as it happens: which lane changed IP, from what to what, or why it
 * failed. Kept apart from the live-frame feed so neither disturbs the other.
 */
function useRotationEvents(onRotation: (event: RotationEvent) => void) {
  const cbRef = useRef(onRotation);
  useEffect(() => {
    cbRef.current = onRotation;
  }, [onRotation]);
  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      const token = authManager.getAccessToken();
      if (!token) {
        retry = setTimeout(connect, 2000);
        return;
      }
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${protocol}//${window.location.host}/ws/android?type=web&token=${encodeURIComponent(token)}`);
      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.event !== 'proxy:rotated') return;
          const p = msg.payload ?? {};
          cbRef.current({
            ok: Boolean(p.ok),
            laneName: p.proxyName ?? 'Proxy',
            oldIp: p.oldIp ?? null,
            newIp: p.newIp ?? null,
            status: p.status ?? null,
            deviceName: p.deviceName ?? null,
          });
        } catch {
          /* not ours */
        }
      };
      socket.onclose = () => {
        if (!disposed) retry = setTimeout(connect, 2000);
      };
    };
    connect();
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      socket?.close();
    };
  }, []);
}

/** A rotation as a slim centered chip in the conversation. */
function RotationRow({ event }: { event: RotationEvent }) {
  const after = event.deviceName ? ` · after ${event.deviceName}` : '';
  return (
    <Box sx={{ alignSelf: 'center', maxWidth: '90%', animation: `${riseIn} 260ms ${ease}`, ...reducedMotion }}>
      <Box
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 0.75,
          borderRadius: 99,
          border: '1px solid',
          borderColor: event.ok ? 'divider' : 'error.light',
          bgcolor: event.ok ? 'action.hover' : 'rgba(220,38,38,0.06)',
        }}
      >
        <Box component="span" sx={{ fontSize: 14 }} aria-hidden>
          {event.ok ? '🔄' : '⚠️'}
        </Box>
        {event.ok ? (
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            <b>{event.laneName}</b> lane —{' '}
            {event.newIp ? (
              event.oldIp ? (
                <>
                  IP changed <Box component="span" sx={{ fontFamily: 'monospace', color: 'text.primary' }}>{event.oldIp}</Box> →{' '}
                  <Box component="span" sx={{ fontFamily: 'monospace', color: 'text.primary' }}>{event.newIp}</Box>
                </>
              ) : (
                <>new IP <Box component="span" sx={{ fontFamily: 'monospace', color: 'text.primary' }}>{event.newIp}</Box></>
              )
            ) : (
              'rotated'
            )}
            {after}
          </Typography>
        ) : (
          <Typography variant="caption" sx={{ color: 'error.main' }}>
            <b>{event.laneName}</b> lane didn't rotate — {event.status ?? 'unknown error'}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

function VectorAvatar() {
  return (
    <Box
      sx={{
        width: 28,
        height: 28,
        borderRadius: '50%',
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        fontSize: 13,
        fontWeight: 800,
        color: 'primary.contrastText',
        bgcolor: 'primary.main',
        mt: 0.25,
      }}
      aria-hidden
    >
      V
    </Box>
  );
}

function AssistantRow({ children }: { children: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start', alignSelf: 'stretch', ...bubbleIn }}>
      <VectorAvatar />
      <Box sx={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>{children}</Box>
    </Box>
  );
}

/** What a Confirm will do, laid out — phones, task, estimate — with the two choices. */
function PlanCard({
  plan,
  text,
  confirming,
  onConfirm,
  onCancel,
}: {
  plan: NonNullable<ChatReply['plan']>;
  text: string;
  confirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const phones = plan.phones ?? [];
  const rows: { label: string; value: React.ReactNode }[] = [];
  if (plan.kind === 'mission') {
    rows.push({ label: 'Task', value: plan.instruction });
    rows.push({
      label: `Phones · ${phones.length}`,
      value: (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {phones.slice(0, 6).map((name) => (
            <Chip key={name} size="small" label={name} variant="outlined" />
          ))}
          {phones.length > 6 && <Chip size="small" label={`+${phones.length - 6} more`} />}
        </Box>
      ),
    });
    if (plan.duration_minutes) rows.push({ label: 'Duration', value: `${plan.duration_minutes} min per phone` });
    rows.push({ label: 'Estimate', value: `~${plan.steps} AI steps · ~$${(plan.cost_usd ?? 0).toFixed(2)}` });
  } else {
    rows.push({ label: plan.kind === 'rotation' ? 'Proxy rotation' : 'Lane', value: plan.setting });
    rows.push({ label: 'Lanes', value: (plan.lanes ?? []).join(', ') });
  }
  const intro = text.split('\n\n')[0];
  return (
    <Paper variant="outlined" sx={{ alignSelf: 'flex-start', width: '100%', maxWidth: 640, borderRadius: 3, overflow: 'hidden', borderColor: 'warning.light', animation: `${riseIn} 280ms ${ease}`, ...reducedMotion }}>
      <Box sx={{ px: 2, pt: 1.5, pb: 1 }}>
        <Typography variant="caption" sx={{ fontWeight: 800, letterSpacing: 0.4, color: 'warning.dark' }}>
          PLAN · NEEDS YOUR CONFIRM
        </Typography>
        {intro && (
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {intro}
          </Typography>
        )}
      </Box>
      <Box sx={{ px: 2, pb: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {rows.map((row) => (
          <Box key={row.label} sx={{ display: 'grid', gridTemplateColumns: '110px 1fr', gap: 1.5, alignItems: 'start' }}>
            <Typography variant="caption" color="text.secondary" sx={{ pt: 0.25 }}>
              {row.label}
            </Typography>
            <Box sx={{ typography: 'body2', minWidth: 0 }}>{row.value}</Box>
          </Box>
        ))}
      </Box>
      <Box sx={{ display: 'flex', gap: 1, px: 2, py: 1.25, bgcolor: 'action.hover' }}>
        <Button variant="contained" disabled={confirming} onClick={onConfirm} sx={{ fontWeight: 700 }}>
          {confirming ? 'Confirmed' : 'Confirm'}
        </Button>
        <Button disabled={confirming} onClick={onCancel}>
          Cancel
        </Button>
      </Box>
    </Paper>
  );
}

function AssistantBubble({
  turn,
  feed,
  onConfirm,
  onRerun,
  onQuickReply,
  isLatest,
  showLive = true,
}: {
  turn: Extract<ChatTurn, { role: 'assistant' }>;
  feed: LiveFeed;
  onConfirm: (token: string) => void;
  onRerun: RerunHandler;
  onQuickReply: (text: string) => void;
  isLatest: boolean;
  showLive?: boolean;
}) {
  const { reply } = turn;
  if (reply.kind === 'mission' && reply.mission) {
    return (
      <AssistantRow>
        {reply.text && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 0.75 }}>
            {reply.text}
          </Typography>
        )}
        <LiveMissionCard initial={reply.mission} feed={feed} onRerun={onRerun} showLive={showLive} />
      </AssistantRow>
    );
  }
  if (reply.kind === 'confirm' && reply.plan && reply.confirm_token) {
    return (
      <AssistantRow>
        <PlanCard
          plan={reply.plan}
          text={reply.text}
          confirming={turn.confirming}
          onConfirm={() => onConfirm(reply.confirm_token as string)}
          onCancel={() => onQuickReply('cancel')}
        />
      </AssistantRow>
    );
  }
  const error = reply.kind === 'error';
  return (
    <AssistantRow>
      <Paper
        variant="outlined"
        sx={{
          alignSelf: 'flex-start',
          maxWidth: '85%',
          px: 2,
          py: 1.25,
          borderRadius: 3,
          borderTopLeftRadius: 6,
          borderColor: error ? 'error.light' : reply.kind === 'confirm' ? 'warning.light' : 'divider',
          animation: error ? `${shake} 380ms ease` : undefined,
          ...reducedMotion,
        }}
      >
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: error ? 'error.main' : 'text.primary' }}>
          {reply.text}
        </Typography>
        {isLatest && reply.quick_replies && reply.quick_replies.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap', mt: 1 }}>
            {reply.quick_replies.map((option, index) => (
              <Chip
                key={option}
                label={option}
                size="small"
                color="primary"
                variant="outlined"
                onClick={() => onQuickReply(option)}
                sx={{ animation: `${riseIn} 260ms ${ease} ${index * 45}ms both`, ...reducedMotion }}
              />
            ))}
          </Box>
        )}
        {reply.kind === 'confirm' && reply.confirm_token && (
          <Box sx={{ mt: 1 }}>
            <Button size="small" variant="contained" disabled={turn.confirming} onClick={() => onConfirm(reply.confirm_token as string)}>
              Confirm
            </Button>
          </Box>
        )}
      </Paper>
    </AssistantRow>
  );
}

function TypingIndicator() {
  return (
    <AssistantRow>
      <Paper variant="outlined" sx={{ alignSelf: 'flex-start', px: 1.75, py: 1.25, borderRadius: 3, borderTopLeftRadius: 6, display: 'flex', gap: 0.6 }} aria-label="Vector is thinking">
        {[0, 1, 2].map((i) => (
          <Box key={i} sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: 'text.secondary', animation: `${typingDot} 1.1s ${i * 0.15}s infinite ease-in-out`, ...reducedMotion }} />
        ))}
      </Paper>
    </AssistantRow>
  );
}

/**
 * One switch for proxy rotation on every lane, always showing the real state.
 * Off = 0 (never rotate); on = after every task.
 */
function RotationSwitch() {
  const { data, refetch, isLoading } = useGetDeviceProxiesQuery();
  const [updateProxy] = useUpdateDeviceProxyMutation();
  const [saving, setSaving] = useState(false);
  const lanes = data?.data ?? [];
  if (isLoading || lanes.length === 0) return null;
  const rotating = lanes.filter((p) => p.rotate_every_tasks > 0);
  const on = rotating.length > 0;
  const mixed = on && rotating.length < lanes.length;

  const toggle = async () => {
    setSaving(true);
    try {
      await Promise.all(lanes.map((p) => updateProxy({ id: p.id, rotate_every_tasks: on ? 0 : 1 }).unwrap()));
      await refetch();
      toast.success(on ? 'Proxy rotation OFF on all lanes' : 'Proxy rotation ON (after every task) on all lanes');
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Tooltip
      title={
        mixed
          ? `On for ${rotating.map((p) => p.name).join(', ')} only — switching turns it off everywhere`
          : on
            ? 'ON: IP changes after every task; phones on a lane take turns (queue)'
            : 'OFF: IP never changes; all phones start together (no queue)'
      }
    >
      <FormControlLabel
        sx={{ m: 0, ml: 0.5 }}
        control={<Switch size="small" checked={on} onChange={toggle} disabled={saving} />}
        label={
          <Typography variant="caption" color="text.secondary">
            Proxy rotation: <b>{on ? (mixed ? 'ON (some lanes)' : 'ON') : 'OFF'}</b>
          </Typography>
        }
      />
    </Tooltip>
  );
}

function ConversationSidebar({
  open,
  conversations,
  activeId,
  onNew,
  onOpen,
  onDelete,
}: {
  open: boolean;
  conversations: Conversation[];
  activeId: number | null;
  onNew: () => void;
  onOpen: (id: number) => void;
  onDelete: (id: number) => void;
}) {
  const [now] = useState(() => Date.now());
  const groups = useMemo(() => {
    const bucket = (d: string) => {
      const days = (now - new Date(d).getTime()) / 86_400_000;
      if (days < 1) return 'Today';
      if (days < 2) return 'Yesterday';
      if (days < 7) return 'This week';
      return 'Earlier';
    };
    const out: { label: string; items: Conversation[] }[] = [];
    for (const c of conversations) {
      const label = bucket(c.last_message_at);
      (out.find((g) => g.label === label) ?? out[out.push({ label, items: [] }) - 1]).items.push(c);
    }
    return out;
  }, [conversations, now]);
  if (!open) return null;
  return (
    <Box sx={{ width: 240, flexShrink: 0, borderRight: '1px solid', borderColor: 'divider', display: 'flex', flexDirection: 'column', minHeight: 0, bgcolor: 'background.paper' }}>
      <Box sx={{ p: 1.5 }}>
        <Button fullWidth variant="outlined" startIcon={<AddIcon />} onClick={onNew} sx={{ justifyContent: 'flex-start', borderRadius: 2 }}>
          New chat
        </Button>
      </Box>
      <Box sx={{ flex: 1, overflowY: 'auto', px: 1, pb: 1 }}>
        {conversations.length === 0 && (
          <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>
            No chats yet.
          </Typography>
        )}
        {groups.map((group) => (
          <Box key={group.label} sx={{ mb: 1 }}>
            <Typography variant="caption" sx={{ px: 1, color: 'text.disabled', textTransform: 'uppercase', letterSpacing: 0.4, fontSize: 11 }}>
              {group.label}
            </Typography>
            {group.items.map((c) => (
              <Box
                key={c.id}
                onClick={() => onOpen(c.id)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1,
                  py: 0.9,
                  borderRadius: 2,
                  cursor: 'pointer',
                  bgcolor: c.id === activeId ? 'action.selected' : 'transparent',
                  '&:hover': { bgcolor: c.id === activeId ? 'action.selected' : 'action.hover', '& .del': { opacity: 1 } },
                }}
              >
                <ChatBubbleOutlineIcon sx={{ fontSize: 16, color: c.id === activeId ? 'primary.main' : 'text.disabled' }} />
                <Typography variant="body2" noWrap sx={{ flex: 1, fontWeight: c.id === activeId ? 600 : 400 }}>
                  {c.title}
                </Typography>
                <IconButton
                  size="small"
                  className="del"
                  aria-label="Delete chat"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(c.id);
                  }}
                  sx={{ opacity: 0, transition: 'opacity 150ms' }}
                >
                  <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

export default function MissionControlPage() {
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const feed = useLiveFeed();
  // Stable per-page ids for new turns (history turns use their database id).
  const turnSeq = useRef(0);
  const nextId = (prefix: string) => `${prefix}${(turnSeq.current += 1)}`;
  useRotationEvents((event) =>
    setTurns((prev) => {
      // Collapse duplicate bursts: same lane + IP within a few seconds.
      const last = prev[prev.length - 1];
      if (last?.role === 'rotation' && last.event.laneName === event.laneName && last.event.newIp === event.newIp) return prev;
      return [...prev, { id: nextId('r'), role: 'rotation', event }];
    }),
  );

  const [sendCommand, { isLoading: sending }] = useSendCommandMutation();
  const [confirmCommand] = useConfirmCommandMutation();
  const [rerunFromChat, { isLoading: rerunning }] = useRerunFromChatMutation();

  // Conversations (the sidebar). null = a fresh unsaved chat.
  const [conversationId, setConversationId] = useState<number | null>(null);
  // On phones the sidebar is a temporary overlay and starts closed so the chat
  // gets the full width; on wider screens it sits beside the chat, open.
  const isMobile = useMediaQuery('(max-width:900px)');
  const [sidebarOpen, setSidebarOpen] = useState(() => (typeof window === 'undefined' ? true : window.innerWidth > 900));
  const { data: convData, refetch: refetchConversations } = useGetConversationsQuery();
  const [newConversation] = useNewConversationMutation();
  const [deleteConversation] = useDeleteConversationMutation();
  const conversations = convData?.data ?? [];

  // Names and tags for @ / # suggestions in the input.
  const { data: fleetData } = useGetFleetStateQuery();
  const phoneNames = (fleetData?.data?.devices ?? []).map((d) => d.name);
  const tagNames = [...new Set((fleetData?.data?.devices ?? []).map((d) => (d.tag ?? '').split(':').pop()?.trim()).filter(Boolean))] as string[];

  // The active conversation is stored on the server; a reload picks it back up.
  const { data: historyData, isFetching: fetchingHistory } = useGetChatHistoryQuery(conversationId ?? undefined, {
    refetchOnMountOrArgChange: true,
  });
  const loadingHistory = fetchingHistory;
  const [loadedFor, setLoadedFor] = useState<number | 'first' | null>(null);
  // Adopt history only when the fetch has settled AND its conversation_id is
  // the one we asked for — a stale cached result for another thread is ignored.
  const wantKey = conversationId ?? 'first';
  const gotId = historyData?.data.conversation_id ?? null;
  const matches = conversationId === null ? true : gotId === conversationId;
  if (historyData && !fetchingHistory && matches && loadedFor !== wantKey) {
    setLoadedFor(wantKey);
    if (conversationId === null && gotId) setConversationId(gotId);
    setTurns(
      historyData.data.turns.map((t): ChatTurn =>
        t.role === 'user' ? { id: `h${t.id}`, role: 'user', text: t.text } : { id: `h${t.id}`, role: 'assistant', reply: t.reply },
      ),
    );
  }

  const startNewChat = async () => {
    try {
      const res = await newConversation().unwrap();
      setConversationId(res.data.id);
      setTurns([]);
      setLoadedFor(res.data.id);
      if (isMobile) setSidebarOpen(false);
      await refetchConversations();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const openConversation = (id: number) => {
    if (isMobile) setSidebarOpen(false);
    if (id === conversationId) return;
    setConversationId(id);
    setTurns([]);
    setLoadedFor(null);
  };

  const removeConversation = async (id: number) => {
    try {
      await deleteConversation(id).unwrap();
      if (id === conversationId) {
        setConversationId(null);
        setTurns([]);
        setLoadedFor(null);
      }
      await refetchConversations();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  // Block body on purpose: an effect's return value is called as its cleanup,
  // and recent Chrome returns a Promise from scrollIntoView.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length, sending]);

  const pushTurn = (turn: ChatTurn) => setTurns((prev) => [...prev, turn]);

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || sending) return;
    setInput('');
    pushTurn({ id: nextId('u'), role: 'user', text });
    try {
      const res = await sendCommand({ message: text, conversation_id: conversationId ?? undefined }).unwrap();
      if (res.data.conversation_id && res.data.conversation_id !== conversationId) {
        setConversationId(res.data.conversation_id);
        setLoadedFor(res.data.conversation_id);
      }
      pushTurn({ id: nextId('a'), role: 'assistant', reply: res.data });
      void refetchConversations();
    } catch (error) {
      pushTurn({ id: nextId('a'), role: 'assistant', reply: { kind: 'error', text: errorMessage(error) } });
    }
  };

  const onConfirm = async (token: string) => {
    setTurns((prev) => prev.map((t) => (t.role === 'assistant' && t.reply.confirm_token === token ? { ...t, confirming: true } : t)));
    try {
      const res = await confirmCommand(token).unwrap();
      pushTurn({ id: nextId('a'), role: 'assistant', reply: res.data });
    } catch (error) {
      pushTurn({ id: nextId('a'), role: 'assistant', reply: { kind: 'error', text: errorMessage(error) } });
    }
  };

  const onRerun: RerunHandler = async (missionId, options) => {
    pushTurn({ id: nextId('u'), role: 'user', text: options.continue ? 'Continue' : options.scope === 'all' ? 'Run again' : 'Retry failed phones' });
    try {
      const res = await rerunFromChat({ mission_id: missionId, ...options }).unwrap();
      pushTurn({ id: nextId('a'), role: 'assistant', reply: res.data });
    } catch (error) {
      pushTurn({ id: nextId('a'), role: 'assistant', reply: { kind: 'error', text: errorMessage(error) } });
    }
  };

  // @phone / #tag suggestions for the word being typed.
  const mention = /(^|\s)([@#])([^\s@#]*)$/.exec(input);
  const suggestions = mention
    ? (mention[2] === '@' ? phoneNames : tagNames)
        .filter((name) => name.toLowerCase().includes(mention[3].toLowerCase()))
        .slice(0, 6)
    : [];
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const applySuggestion = (name: string) => {
    if (!mention) return;
    const start = input.length - mention[3].length - 1;
    setInput(`${input.slice(0, start)}${mention[2]}${name} `);
    setActiveSuggestion(0);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (suggestions.length > 0) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActiveSuggestion((i) => (i + step + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        applySuggestion(suggestions[Math.min(activeSuggestion, suggestions.length - 1)]);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  const insertTrigger = (trigger: '@' | '#') => {
    setInput((prev) => `${prev}${prev && !prev.endsWith(' ') ? ' ' : ''}${trigger}`);
    inputRef.current?.focus();
  };

  return (
    <Box sx={{ display: 'flex', height: 'calc(100vh - 64px)', minHeight: 0 }}>
    {isMobile ? (
      <Drawer
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        ModalProps={{ keepMounted: true }}
        PaperProps={{ sx: { width: 260, top: { xs: 60, md: 64 }, height: { xs: 'calc(100% - 60px)', md: 'calc(100% - 64px)' } } }}
      >
        <ConversationSidebar
          open
          conversations={conversations}
          activeId={conversationId}
          onNew={startNewChat}
          onOpen={openConversation}
          onDelete={removeConversation}
        />
      </Drawer>
    ) : (
      <ConversationSidebar
        open={sidebarOpen}
        conversations={conversations}
        activeId={conversationId}
        onNew={startNewChat}
        onOpen={openConversation}
        onDelete={removeConversation}
      />
    )}
    <Box sx={{ flex: 1, minWidth: 0, maxWidth: 1120, mx: 'auto', width: '100%', px: { xs: 1.5, md: 3 }, py: { xs: 1.5, md: 3 }, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <IconButton size="small" aria-label={sidebarOpen ? 'Hide chats' : 'Show chats'} onClick={() => setSidebarOpen((v) => !v)}>
          <MenuIcon />
        </IconButton>
        <VectorAvatar />
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
            Vector
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: { xs: 'none', sm: 'block' } }}>
            Android mobile automation — run tasks across phones, check status, manage proxy rotation. Setting changes ask you first.
          </Typography>
        </Box>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, pb: 2, pr: 0.5 }}>
        {loadingHistory && turns.length === 0 && <CircularProgress size={22} sx={{ alignSelf: 'center', mt: 4 }} />}
        {!loadingHistory && turns.length === 0 && (
          <Box sx={{ mt: 4, ...bubbleIn }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Try one of these:
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-start' }}>
              {EXAMPLES.map((example) => (
                <Chip
                  key={example}
                  label={example}
                  onClick={() => void send(example)}
                  variant="outlined"
                  sx={{ maxWidth: '100%', height: 'auto', transition: `transform 160ms ${ease}`, '&:hover': { transform: 'translateX(3px)' }, '& .MuiChip-label': { whiteSpace: 'normal', py: 0.75 }, ...reducedMotion }}
                />
              ))}
            </Box>
          </Box>
        )}
        {turns.map((turn, index) =>
          turn.role === 'rotation' ? (
            <RotationRow key={turn.id} event={turn.event} />
          ) : turn.role === 'user' ? (
            <Box
              key={turn.id}
              sx={{ alignSelf: 'flex-end', maxWidth: '80%', bgcolor: 'primary.main', color: 'primary.contrastText', px: 2, py: 1.25, borderRadius: 3, borderBottomRightRadius: 6, ...bubbleIn }}
            >
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {turn.text}
              </Typography>
            </Box>
          ) : (
            <AssistantBubble
              key={turn.id}
              turn={turn}
              feed={feed}
              onConfirm={onConfirm}
              onRerun={onRerun}
              onQuickReply={(text) => void send(text)}
              isLatest={index === turns.length - 1 && !sending}
            />
          ),
        )}
        {(sending || rerunning) && <TypingIndicator />}
        <div ref={bottomRef} />
      </Box>

      {suggestions.length > 0 && (
        <Paper elevation={6} sx={{ mb: 0.75, borderRadius: 2, overflow: 'hidden', alignSelf: 'flex-start', minWidth: 260, animation: `${riseIn} 180ms ${ease}`, ...reducedMotion }}>
          <Typography variant="caption" color="text.secondary" sx={{ px: 1.5, pt: 0.75, display: 'block' }}>
            {mention?.[2] === '@' ? 'Phones' : 'Tags'} · ↑↓ to pick, Enter to insert
          </Typography>
          <MenuList dense>
            {suggestions.map((name, i) => (
              <MenuItem key={name} selected={i === Math.min(activeSuggestion, suggestions.length - 1)} onMouseDown={(e) => { e.preventDefault(); applySuggestion(name); }}>
                {mention?.[2]}
                {name}
              </MenuItem>
            ))}
          </MenuList>
        </Paper>
      )}

      <Paper
        variant="outlined"
        sx={{ px: 1.5, pt: 1.25, pb: 1, borderRadius: 4, boxShadow: '0 10px 30px rgba(15, 23, 42, 0.08)', transition: 'box-shadow 200ms', '&:focus-within': { boxShadow: '0 0 0 3px rgba(37, 99, 235, 0.18), 0 10px 30px rgba(15, 23, 42, 0.08)' } }}
      >
        <TextField
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Tell Vector what the phones should do…"
          multiline
          minRows={2}
          maxRows={8}
          fullWidth
          variant="standard"
          inputRef={inputRef}
          InputProps={{ disableUnderline: true, sx: { px: 0.75, fontSize: 16 } }}
          inputProps={{ maxLength: 4000, 'aria-label': 'Message Vector' }}
        />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.75, flexWrap: 'wrap' }}>
          <Chip label="@ Phones" size="small" variant="outlined" onClick={() => insertTrigger('@')} />
          <Chip label="# Tags" size="small" variant="outlined" onClick={() => insertTrigger('#')} />
          <RotationSwitch />
          <Box sx={{ flex: 1 }} />
          <Button
            variant="contained"
            onClick={() => void send()}
            disabled={!input.trim() || sending}
            endIcon={sending ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
            sx={{ borderRadius: 99, px: 2.5, fontWeight: 700 }}
          >
            Send
          </Button>
        </Box>
      </Paper>
    </Box>
    </Box>
  );
}
