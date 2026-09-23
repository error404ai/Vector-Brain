import authManager from '@/_helpers/authManager';
import {
  useConfirmCommandMutation,
  useGetChatHistoryQuery,
  useRerunFromChatMutation,
  useSendCommandMutation,
  type ChatReply,
} from '@/RTKService/commandChatService/commandChatService';
import {
  useCancelMissionMutation,
  useGetMissionQuery,
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
import { Box, Button, Chip, CircularProgress, FormControlLabel, IconButton, LinearProgress, MenuItem, MenuList, Paper, Switch, TextField, Tooltip, Typography } from '@mui/material';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
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

function ItemRow({ item, steps, round }: { item: MissionItem; steps: LiveStep[]; round?: { round: number; endsAt: number } }) {
  const [open, setOpen] = useState(false);
  const latest = steps[steps.length - 1];
  const live = item.status === 'RUNNING';
  // The exact error the phone or agent gave, checkable on the spot.
  // Step-limit text was written for the fleet page ("raise the Steps value in
  // the header"); in the chat the card's Continue button says it better.
  const detail =
    item.status === 'FAILED' && item.last_message && item.last_reason !== 'STEP_LIMIT' && item.last_reason !== 'UNFINISHED' ? item.last_message : null;
  return (
    <Box sx={{ py: 0.75, minWidth: 0, borderBottom: '1px solid', borderColor: 'divider', '&:last-of-type': { borderBottom: 0 } }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600, flexShrink: 0, maxWidth: 220 }} noWrap>
          {item.device_name}
        </Typography>
        <StatusChip item={item} />
        {live && round && (
          <Typography variant="caption" color="text.secondary" noWrap>
            Round {round.round} · {minutesLeft(round.endsAt)}
          </Typography>
        )}
        {item.attempts > 1 && item.status !== 'PENDING' && (
          <Typography variant="caption" color="text.secondary">
            {item.attempts} tries
          </Typography>
        )}
        {item.reason_text && item.status !== 'SUCCEEDED' && (
          <Tooltip title={item.last_message ?? ''} disableHoverListener={!item.last_message}>
            <Typography variant="caption" color="text.secondary" noWrap sx={{ minWidth: 0 }}>
              {item.reason_text}
            </Typography>
          </Tooltip>
        )}
        <Box sx={{ flex: 1 }} />
        {steps.length > 0 && (
          <Tooltip title={open ? 'Hide steps' : 'Show steps'}>
            <IconButton size="small" onClick={() => setOpen((v) => !v)} aria-label={open ? 'Hide steps' : 'Show steps'}>
              {open ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {live && latest && !open && (
        <Typography
          key={latest.index}
          variant="caption"
          color="text.secondary"
          component="p"
          noWrap
          sx={{ mt: 0.25, animation: `${slideStep} 260ms ${ease}`, ...reducedMotion }}
        >
          Step {latest.index} · {latest.action}
          {latest.thought ? ` — ${latest.thought}` : ''}
        </Typography>
      )}

      {open && (
        <Box sx={{ mt: 0.75, pl: 1.25, borderLeft: '2px solid', borderColor: 'divider', maxHeight: 220, overflowY: 'auto' }}>
          {steps.map((step) => (
            <Typography key={`${step.index}-${step.at}`} variant="caption" component="p" sx={{ py: 0.25, animation: `${slideStep} 220ms ${ease}`, ...reducedMotion }}>
              <Box component="span" sx={{ color: 'text.disabled', mr: 0.75 }}>
                {step.index}
              </Box>
              <Box component="span" sx={{ fontWeight: 600 }}>
                {step.action}
              </Box>
              {step.thought ? <Box component="span" sx={{ color: 'text.secondary' }}>{` — ${step.thought}`}</Box> : null}
            </Typography>
          ))}
        </Box>
      )}

      {item.status === 'SUCCEEDED' && item.last_message && /^Worked for /.test(item.last_message) && (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 0.25 }}>
          {item.last_message}
        </Typography>
      )}

      {detail && (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ pl: 1.5, mt: 0.25, borderLeft: '2px solid', borderColor: 'error.light', wordBreak: 'break-word' }}>
          {detail.length > 240 ? `${detail.slice(0, 240)}…` : detail}
        </Typography>
      )}
    </Box>
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

function MissionCard({ mission, feed, onRerun }: { mission: Mission; feed: LiveFeed; onRerun?: RerunHandler }) {
  const [cancelMission, { isLoading: cancelling }] = useCancelMissionMutation();
  const { progress } = mission;
  const running = mission.status === 'RUNNING';
  const settled = progress.succeeded + progress.failed;
  const percent = progress.total ? Math.round((settled / progress.total) * 100) : 0;
  const finishedClean = mission.status === 'DONE' && progress.failed === 0;
  const finishedWithFailures = mission.status === 'DONE' && progress.failed > 0;

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
        alignSelf: 'flex-start',
        width: '100%',
        maxWidth: 720,
        p: 2,
        borderRadius: 3,
        animation: finishedClean
          ? `${riseIn} 300ms ${ease}, ${glowSuccess} 1.1s ease-out`
          : finishedWithFailures
            ? `${riseIn} 300ms ${ease}, ${glowError} 1.1s ease-out`
            : `${riseIn} 300ms ${ease}`,
        ...reducedMotion,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        {running ? (
          <CircularProgress size={16} />
        ) : finishedClean ? (
          <CheckCircleRoundedIcon fontSize="small" color="success" sx={{ animation: `${popIn} 480ms ${ease}`, ...reducedMotion }} />
        ) : (
          <ErrorRoundedIcon fontSize="small" color={mission.status === 'CANCELLED' ? 'disabled' : 'warning'} sx={{ animation: `${popIn} 480ms ${ease}`, ...reducedMotion }} />
        )}
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          {running
            ? `Working on ${progress.total} ${progress.total === 1 ? 'phone' : 'phones'} — ${progress.succeeded} done${progress.failed ? `, ${progress.failed} failed` : ''}${progress.queued ? `, ${progress.queued} in proxy queue` : ''}`
            : mission.status === 'CANCELLED'
              ? 'Stopped'
              : `Finished — ${progress.succeeded}/${progress.total} done`}
        </Typography>
        {running && (
          <Button size="small" color="error" startIcon={<StopCircleOutlinedIcon />} onClick={onCancel} disabled={cancelling}>
            Stop
          </Button>
        )}
      </Box>

      {mission.prompt && (
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
          Each phone runs: {mission.prompt}
          {mission.duration_seconds ? ` · for ${Math.round(mission.duration_seconds / 60)} min` : ''}
        </Typography>
      )}

      {running && (
        <Box sx={{ position: 'relative', overflow: 'hidden', borderRadius: 1, mb: 1 }}>
          <LinearProgress variant="determinate" value={percent} sx={{ height: 6, borderRadius: 1, '& .MuiLinearProgress-bar': { transition: `transform 600ms ${ease}` } }} />
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.55), transparent)',
              animation: `${shimmer} 1.8s linear infinite`,
              ...reducedMotion,
            }}
          />
        </Box>
      )}

      {running && <LiveScreens items={mission.items} feed={feed} />}

      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
        {mission.items.map((item) => (
          <ItemRow
            key={item.id}
            item={item}
            steps={item.agent_task_id ? feed.steps[item.agent_task_id] ?? [] : []}
            round={item.agent_task_id ? feed.rounds[item.agent_task_id] : undefined}
          />
        ))}
      </Box>

      {!running && onRerun && (
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1.5, animation: `${riseIn} 320ms ${ease}`, ...reducedMotion }}>
          {mission.items.some((i) => i.status === 'FAILED' && (i.last_reason === 'STEP_LIMIT' || i.last_reason === 'UNFINISHED')) && (
            <Button size="small" variant="contained" startIcon={<PlayArrowRoundedIcon />} onClick={() => onRerun(mission.id, { scope: 'failed', continue: true })}>
              Continue
            </Button>
          )}
          {progress.failed > 0 && (
            <Button size="small" variant="outlined" startIcon={<ReplayIcon />} onClick={() => onRerun(mission.id, { scope: 'failed' })}>
              Retry failed
            </Button>
          )}
          <Button size="small" variant="text" startIcon={<RestartAltIcon />} onClick={() => onRerun(mission.id, { scope: 'all' })}>
            Run again
          </Button>
        </Box>
      )}

      {mission.summary && !running && (
        <Typography variant="body2" sx={{ mt: 1.5, whiteSpace: 'pre-wrap', animation: `${riseIn} 360ms ${ease}`, ...reducedMotion }}>
          {mission.summary}
        </Typography>
      )}
      {running && mission.note && (
        <Typography variant="caption" color="warning.main" component="p" sx={{ mt: 1 }}>
          {mission.note}
        </Typography>
      )}
    </Paper>
  );
}

/**
 * A mission started from the chat, kept current on its own: it polls just this
 * mission while it runs and refetches the moment the server pushes an update.
 */
function LiveMissionCard({ initial, feed, onRerun }: { initial: Mission; feed: LiveFeed; onRerun?: RerunHandler }) {
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
      <MissionCard mission={mission} feed={feed} onRerun={onRerun} />
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

type ChatTurn =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; reply: ChatReply; confirming?: boolean };

const bubbleIn = { animation: `${riseIn} 280ms ${ease}`, ...reducedMotion };

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

function AssistantBubble({
  turn,
  feed,
  onConfirm,
  onRerun,
  onQuickReply,
  isLatest,
}: {
  turn: Extract<ChatTurn, { role: 'assistant' }>;
  feed: LiveFeed;
  onConfirm: (token: string) => void;
  onRerun: RerunHandler;
  onQuickReply: (text: string) => void;
  isLatest: boolean;
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
        <LiveMissionCard initial={reply.mission} feed={feed} onRerun={onRerun} />
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
            ? 'IP changes after every task on all lanes'
            : 'IP never changes on its own'
      }
    >
      <FormControlLabel
        sx={{ m: 0, mt: 0.5, ml: 0.5 }}
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

export default function MissionControlPage() {
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const feed = useLiveFeed();

  const [sendCommand, { isLoading: sending }] = useSendCommandMutation();
  const [confirmCommand] = useConfirmCommandMutation();
  const [rerunFromChat, { isLoading: rerunning }] = useRerunFromChatMutation();

  // Names and tags for @ / # suggestions in the input.
  const { data: fleetData } = useGetFleetStateQuery();
  const phoneNames = (fleetData?.data?.devices ?? []).map((d) => d.name);
  const tagNames = [...new Set((fleetData?.data?.devices ?? []).map((d) => (d.tag ?? '').split(':').pop()?.trim()).filter(Boolean))] as string[];

  // The conversation is stored on the server; a reload picks it back up.
  const { data: historyData, isLoading: loadingHistory } = useGetChatHistoryQuery();
  const [historyLoaded, setHistoryLoaded] = useState(false);
  if (!historyLoaded && historyData) {
    setHistoryLoaded(true);
    setTurns((prev) => [
      ...historyData.data.map((t): ChatTurn => (t.role === 'user' ? { id: `h${t.id}`, role: 'user', text: t.text } : { id: `h${t.id}`, role: 'assistant', reply: t.reply })),
      ...prev,
    ]);
  }

  // Block body on purpose: an effect's return value is called as its cleanup,
  // and recent Chrome returns a Promise from scrollIntoView.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length, sending]);

  const pushTurn = (turn: ChatTurn) => setTurns((prev) => [...prev, turn]);
  // Stable per-page ids for new turns (history turns use their database id).
  const turnSeq = useRef(0);
  const nextId = (prefix: string) => `${prefix}${(turnSeq.current += 1)}`;

  const send = async (override?: string) => {
    const text = (override ?? input).trim();
    if (!text || sending) return;
    setInput('');
    pushTurn({ id: nextId('u'), role: 'user', text });
    try {
      const res = await sendCommand(text).unwrap();
      pushTurn({ id: nextId('a'), role: 'assistant', reply: res.data });
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

  return (
    <Box sx={{ maxWidth: 860, mx: 'auto', px: { xs: 1.5, md: 3 }, py: 3, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)' }}>
      <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1.25 }}>
        <VectorAvatar />
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
            Vector
          </Typography>
          <Typography variant="caption" color="text.secondary">
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
          turn.role === 'user' ? (
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

      <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 3, transition: 'box-shadow 200ms', '&:focus-within': { boxShadow: '0 0 0 3px rgba(37, 99, 235, 0.15)' } }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
          <TextField
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Message Vector — type @ for a phone, # for a tag"
            multiline
            maxRows={6}
            fullWidth
            size="small"
            variant="standard"
            InputProps={{ disableUnderline: true, sx: { px: 1, py: 0.5 } }}
            inputProps={{ maxLength: 4000, 'aria-label': 'Message Vector' }}
          />
          <IconButton color="primary" onClick={() => void send()} disabled={!input.trim() || sending} aria-label="Send">
            {sending ? <CircularProgress size={20} /> : <SendIcon />}
          </IconButton>
        </Box>
        <RotationSwitch />
      </Paper>
    </Box>
  );
}
