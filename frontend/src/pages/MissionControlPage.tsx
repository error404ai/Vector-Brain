import authManager from '@/_helpers/authManager';
import {
  useCancelMissionMutation,
  useGetMissionQuery,
  type Mission,
  type MissionItem,
  type MissionItemStatus,
} from '@/RTKService/missionService/missionService';
import {
  useConfirmCommandMutation,
  useGetChatHistoryQuery,
  useSendCommandMutation,
  type ChatReply,
} from '@/RTKService/commandChatService/commandChatService';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import SendIcon from '@mui/icons-material/Send';
import StopCircleOutlinedIcon from '@mui/icons-material/StopCircleOutlined';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  LinearProgress,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

/** Latest screen per phone, keyed by hardware id, as the server pushes them. */
type FrameMap = Record<string, { data: string; at: number }>;
import toast from 'react-hot-toast';

const EXAMPLES = [
  'Open Settings and turn on Wi-Fi on all phones',
  'On 5 phones, open Gmail and send an email to test@gmail.com with subject "Hello"',
  'On #PhoneBox phones, open YouTube and play the first result for lofi music',
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
  return data?.message || 'Could not start the mission';
}

function ItemRow({ item }: { item: MissionItem }) {
  const tone = ITEM_TONE[item.status];
  const retrying = item.status === 'PENDING' && item.attempts > 0;
  // The exact error the phone or agent gave, so a wrong-looking reason can be
  // checked on the spot instead of from the database.
  const detail = item.status === 'FAILED' && item.last_message ? item.last_message : null;
  return (
    <Box sx={{ py: 0.5, minWidth: 0 }}>
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      <Typography variant="body2" sx={{ fontWeight: 600, flexShrink: 0, maxWidth: 200 }} noWrap>
        {item.device_name}
      </Typography>
      <Chip size="small" label={retrying ? `Retrying (${item.attempts + 1})` : tone.label} color={retrying ? 'warning' : tone.color} variant={item.status === 'SUCCEEDED' ? 'filled' : 'outlined'} />
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
    </Box>
    {detail && (
      <Typography variant="caption" color="text.secondary" component="p" sx={{ pl: 1.5, mt: 0.25, borderLeft: '2px solid', borderColor: 'divider', wordBreak: 'break-word' }}>
        {detail.length > 240 ? `${detail.slice(0, 240)}…` : detail}
      </Typography>
    )}
    </Box>
  );
}

/** How long each running phone stays on the big screen before the next one. */
const ROTATE_MS = 4000;

/**
 * One socket for the page: keeps the newest frame each phone sends while it
 * runs. Frames are only kept, never rendered here, so a busy fleet does not
 * re-render the chat on every screenshot beyond the cards that show them.
 */
function useLiveFrames(): { frames: FrameMap; missionPush: Record<number, number> } {
  const [frames, setFrames] = useState<FrameMap>({});
  // Bumped whenever the server says a mission changed, so its card refetches
  // at once instead of waiting for the next poll.
  const [missionPush, setMissionPush] = useState<Record<number, number>>({});
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
          if (msg.event === 'mission:update' && typeof msg.payload?.id === 'number') {
            const id = msg.payload.id as number;
            setMissionPush((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
            return;
          }
          if (msg.event !== 'device:screen_capture') return;
          const hw = msg.payload?.deviceId;
          const data = msg.payload?.result?.screenCapture?.base64Data;
          if (typeof hw === 'string' && typeof data === 'string') {
            setFrames((prev) => ({ ...prev, [hw]: { data, at: Date.now() } }));
          }
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
  return { frames, missionPush };
}

function frameSrc(data: string): string {
  return data.startsWith('data:') ? data : `data:image/jpeg;base64,${data}`;
}

/**
 * The running phones' screens, one at a time on a large frame that moves to
 * the next phone every few seconds; the strip underneath shows all of them and
 * a click pins one.
 */
function LiveScreens({ items, frames }: { items: MissionItem[]; frames: FrameMap }) {
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
  const frame = current.device_hw_id ? frames[current.device_hw_id] : undefined;

  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start', mt: 1.5, mb: 1, flexWrap: { xs: 'wrap', sm: 'nowrap' } }}>
      <Box sx={{ width: 170, flexShrink: 0, mx: { xs: 'auto', sm: 0 } }}>
        <Box sx={{ aspectRatio: '9 / 19.5', borderRadius: 3, border: '6px solid', borderColor: 'grey.900', bgcolor: 'grey.900', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {frame ? (
            <Box component="img" src={frameSrc(frame.data)} alt={`${current.device_name} screen`} sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
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
      </Box>
      {live.length > 1 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignContent: 'flex-start' }}>
          {live.map((item) => {
            const thumb = item.device_hw_id ? frames[item.device_hw_id] : undefined;
            const active = item.id === current.id;
            return (
              <Tooltip key={item.id} title={pinned === item.id ? `Unpin ${item.device_name}` : `Pin ${item.device_name}`}>
                <Box
                  component="button"
                  type="button"
                  onClick={() => setPinned((p) => (p === item.id ? null : item.id))}
                  sx={{ p: 0, width: 54, aspectRatio: '9 / 19.5', borderRadius: 1.5, overflow: 'hidden', cursor: 'pointer', bgcolor: 'grey.900', border: '2px solid', borderColor: active ? 'primary.main' : 'transparent', outlineOffset: 2 }}
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

function MissionCard({ mission, frames, showRequest = true }: { mission: Mission; frames: FrameMap; showRequest?: boolean }) {
  const [cancelMission, { isLoading: cancelling }] = useCancelMissionMutation();
  const { progress } = mission;
  const running = mission.status === 'RUNNING';
  const settled = progress.succeeded + progress.failed;
  const percent = progress.total ? Math.round((settled / progress.total) * 100) : 0;

  const onCancel = async () => {
    try {
      await cancelMission(mission.id).unwrap();
      toast.success('Mission cancelled');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      {/* What the user asked, on the right like a chat (the chat shows its own). */}
      {showRequest && (
        <Box sx={{ alignSelf: 'flex-end', maxWidth: '80%', bgcolor: 'primary.main', color: 'primary.contrastText', px: 2, py: 1.25, borderRadius: 2, borderBottomRightRadius: 4 }}>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {mission.request}
          </Typography>
        </Box>
      )}

      <Paper variant="outlined" sx={{ alignSelf: 'flex-start', width: '100%', maxWidth: 720, p: 2, borderRadius: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          {running ? <CircularProgress size={16} /> : <RocketLaunchIcon fontSize="small" color={progress.failed ? 'warning' : 'success'} />}
          <Typography variant="subtitle2" sx={{ flex: 1 }}>
            {running
              ? `Working on ${progress.total} ${progress.total === 1 ? 'phone' : 'phones'} — ${progress.succeeded} done${progress.failed ? `, ${progress.failed} failed` : ''}${progress.queued ? `, ${progress.queued} in proxy queue` : ''}`
              : mission.status === 'CANCELLED'
                ? 'Cancelled'
                : `Finished — ${progress.succeeded}/${progress.total} done`}
          </Typography>
          {running && (
            <Button size="small" color="error" startIcon={<StopCircleOutlinedIcon />} onClick={onCancel} disabled={cancelling}>
              Stop
            </Button>
          )}
        </Box>

        {mission.prompt && mission.prompt !== mission.request && (
          <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
            Each phone runs: {mission.prompt}
          </Typography>
        )}

        {running && <LinearProgress variant="determinate" value={percent} sx={{ mb: 1, borderRadius: 1 }} />}

        {running && <LiveScreens items={mission.items} frames={frames} />}

        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          {mission.items.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
        </Box>

        {mission.summary && !running && (
          <Typography variant="body2" sx={{ mt: 1.5, whiteSpace: 'pre-wrap' }}>
            {mission.summary}
          </Typography>
        )}
        {running && mission.note && (
          <Typography variant="caption" color="warning.main" component="p" sx={{ mt: 1 }}>
            {mission.note}
          </Typography>
        )}
      </Paper>
    </Box>
  );
}

/** A message in the chat transcript: something you said, or the tool's reply. */
type ChatTurn =
  | { id: string; role: 'user'; text: string }
  | { id: string; role: 'assistant'; reply: ChatReply; confirming?: boolean };

/**
 * A mission started from the chat, kept current on its own: it polls just this
 * mission while it runs and refetches the moment the server pushes an update.
 * (It used to read a shared 20-mission list, and a card could sit on its first
 * snapshot — "Waiting" — while the phones had already finished.)
 */
function LiveMissionCard({ initial, frames, push }: { initial: Mission; frames: FrameMap; push: number }) {
  // The last response decides whether to keep polling; a finished mission stops.
  const [status, setStatus] = useState(initial.status);
  const { data, isError, refetch } = useGetMissionQuery(initial.id, { pollingInterval: status === 'RUNNING' ? 2000 : 0 });
  const mission = data?.data ?? initial;
  if (mission.status !== status) setStatus(mission.status);
  useEffect(() => {
    if (push > 0) void refetch();
  }, [push, refetch]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <MissionCard mission={mission} frames={frames} showRequest={false} />
      {isError && (
        <Typography variant="caption" color="warning.main">
          Couldn't refresh this mission — retrying.
        </Typography>
      )}
    </Box>
  );
}

function AssistantBubble({
  turn,
  frames,
  onConfirm,
  push,
}: {
  turn: Extract<ChatTurn, { role: 'assistant' }>;
  frames: FrameMap;
  onConfirm: (token: string) => void;
  push: number;
}) {
  const { reply } = turn;
  if (reply.kind === 'mission' && reply.mission) {
    return <LiveMissionCard initial={reply.mission} frames={frames} push={push} />;
  }
  const tone =
    reply.kind === 'error' ? 'error.main' : reply.kind === 'confirm' ? 'warning.main' : reply.kind === 'clarify' ? 'text.primary' : 'text.primary';
  return (
    <Paper variant="outlined" sx={{ alignSelf: 'flex-start', maxWidth: '80%', px: 2, py: 1.25, borderRadius: 2, borderBottomLeftRadius: 4 }}>
      <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', color: tone }}>
        {reply.text}
      </Typography>
      {reply.kind === 'confirm' && reply.confirm_token && (
        <Box sx={{ mt: 1 }}>
          <Button size="small" variant="contained" disabled={turn.confirming} onClick={() => onConfirm(reply.confirm_token as string)}>
            Confirm
          </Button>
        </Box>
      )}
    </Paper>
  );
}

export default function MissionControlPage() {
  const [input, setInput] = useState('');
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { frames, missionPush } = useLiveFrames();

  const [sendCommand, { isLoading: sending }] = useSendCommandMutation();
  const [confirmCommand] = useConfirmCommandMutation();

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns.length]);

  const pushTurn = (turn: ChatTurn) => setTurns((prev) => [...prev, turn]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput('');
    pushTurn({ id: `u${Date.now()}`, role: 'user', text });
    try {
      const res = await sendCommand(text).unwrap();
      pushTurn({ id: `a${Date.now()}`, role: 'assistant', reply: res.data });
    } catch (error) {
      pushTurn({ id: `a${Date.now()}`, role: 'assistant', reply: { kind: 'error', text: errorMessage(error) } });
    }
  };

  const onConfirm = async (token: string) => {
    setTurns((prev) => prev.map((t) => (t.role === 'assistant' && t.reply.confirm_token === token ? { ...t, confirming: true } : t)));
    try {
      const res = await confirmCommand(token).unwrap();
      pushTurn({ id: `a${Date.now()}`, role: 'assistant', reply: res.data });
    } catch (error) {
      pushTurn({ id: `a${Date.now()}`, role: 'assistant', reply: { kind: 'error', text: errorMessage(error) } });
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <Box sx={{ maxWidth: 820, mx: 'auto', px: { xs: 1.5, md: 3 }, py: 3, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)' }}>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Mission Control
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Ask in plain language — run a task across phones, check status, or change proxy rotation. Anything that changes a setting asks you to confirm first.
        </Typography>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2, pb: 2 }}>
        {loadingHistory && turns.length === 0 && <CircularProgress size={22} sx={{ alignSelf: 'center', mt: 4 }} />}
        {!loadingHistory && turns.length === 0 && (
          <Box sx={{ mt: 4 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Try:
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-start' }}>
              {EXAMPLES.map((example) => (
                <Chip key={example} label={example} onClick={() => setInput(example)} variant="outlined" sx={{ maxWidth: '100%', height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', py: 0.75 } }} />
              ))}
            </Box>
          </Box>
        )}
        {turns.map((turn) =>
          turn.role === 'user' ? (
            <Box key={turn.id} sx={{ alignSelf: 'flex-end', maxWidth: '80%', bgcolor: 'primary.main', color: 'primary.contrastText', px: 2, py: 1.25, borderRadius: 2, borderBottomRightRadius: 4 }}>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {turn.text}
              </Typography>
            </Box>
          ) : (
            <AssistantBubble
              key={turn.id}
              turn={turn}
              frames={frames}
              onConfirm={onConfirm}
              push={turn.reply.mission ? missionPush[turn.reply.mission.id] ?? 0 : 0}
            />
          ),
        )}
        <div ref={bottomRef} />
      </Box>

      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
          <TextField
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Message the fleet — e.g. how many phones are online?"
            multiline
            maxRows={6}
            fullWidth
            size="small"
            inputProps={{ maxLength: 4000, 'aria-label': 'Command chat message' }}
          />
          <IconButton color="primary" onClick={() => void send()} disabled={!input.trim() || sending} aria-label="Send">
            {sending ? <CircularProgress size={20} /> : <SendIcon />}
          </IconButton>
        </Box>
      </Paper>
    </Box>
  );
}
