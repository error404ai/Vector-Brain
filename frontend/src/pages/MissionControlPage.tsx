import {
  useCancelMissionMutation,
  useCreateMissionMutation,
  useGetMissionsQuery,
  type Mission,
  type MissionItem,
  type MissionItemStatus,
} from '@/RTKService/missionService/missionService';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import SendIcon from '@mui/icons-material/Send';
import StopCircleOutlinedIcon from '@mui/icons-material/StopCircleOutlined';
import {
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
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
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.5, minWidth: 0 }}>
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
  );
}

function MissionCard({ mission }: { mission: Mission }) {
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
      {/* What the user asked, on the right like a chat. */}
      <Box sx={{ alignSelf: 'flex-end', maxWidth: '80%', bgcolor: 'primary.main', color: 'primary.contrastText', px: 2, py: 1.25, borderRadius: 2, borderBottomRightRadius: 4 }}>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {mission.request}
        </Typography>
      </Box>

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

export default function MissionControlPage() {
  const [request, setRequest] = useState('');
  const [maxSteps, setMaxSteps] = useState(20);
  const [noInternet, setNoInternet] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // A short list, polled while the page is open and the tab is in view.
  const { data, isLoading } = useGetMissionsQuery(20, { pollingInterval: 2500, skipPollingIfUnfocused: true });
  const [createMission, { isLoading: sending }] = useCreateMissionMutation();

  // Oldest first, like a conversation.
  const missions = useMemo(() => [...(data?.data ?? [])].reverse(), [data]);
  // Block body on purpose: whatever an effect returns, React later calls as its
  // cleanup. Recent Chrome returns a Promise from scrollIntoView, and an arrow
  // that returned it crashed the page with "a is not a function".
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [missions.length]);

  const send = async () => {
    const text = request.trim();
    if (!text || sending) return;
    try {
      await createMission({ request: text, max_steps: maxSteps, no_internet: noInternet || undefined }).unwrap();
      setRequest('');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <Box sx={{ maxWidth: 900, mx: 'auto', px: { xs: 1.5, md: 3 }, py: 3, display: 'flex', flexDirection: 'column', height: 'calc(100vh - 64px)' }}>
      <Box sx={{ mb: 2 }}>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Mission Control
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Tell the fleet what to do. Each phone runs it, failures that a retry can fix are retried, and you get one summary.
        </Typography>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3, pb: 2 }}>
        {isLoading && <CircularProgress sx={{ alignSelf: 'center', mt: 4 }} />}
        {!isLoading && missions.length === 0 && (
          <Box sx={{ mt: 4 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Say which phones — a number, "all phones", or a tag — and what to do. For example:
            </Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, alignItems: 'flex-start' }}>
              {EXAMPLES.map((example) => (
                <Chip key={example} label={example} onClick={() => setRequest(example)} variant="outlined" sx={{ maxWidth: '100%', height: 'auto', '& .MuiChip-label': { whiteSpace: 'normal', py: 0.75 } }} />
              ))}
            </Box>
          </Box>
        )}
        {missions.map((mission) => (
          <MissionCard key={mission.id} mission={mission} />
        ))}
        <div ref={bottomRef} />
      </Box>

      <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
          <TextField
            value={request}
            onChange={(event) => setRequest(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder='e.g. On 5 phones, open Gmail and send an email to test@gmail.com'
            multiline
            maxRows={6}
            fullWidth
            size="small"
            inputProps={{ maxLength: 8000, 'aria-label': 'Mission request' }}
          />
          <IconButton color="primary" onClick={() => void send()} disabled={!request.trim() || sending} aria-label="Send mission">
            {sending ? <CircularProgress size={20} /> : <SendIcon />}
          </IconButton>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mt: 1, flexWrap: 'wrap' }}>
          <TextField
            label="Steps per phone"
            type="number"
            size="small"
            value={maxSteps}
            onChange={(event) => setMaxSteps(Math.max(1, Math.min(500, Number(event.target.value) || 1)))}
            sx={{ width: 140 }}
          />
          <Tooltip title="Only for tasks that use no website or online service, like changing a setting. Skips the proxy queue so all phones start at once.">
            <FormControlLabel control={<Checkbox size="small" checked={noInternet} onChange={(event) => setNoInternet(event.target.checked)} />} label={<Typography variant="body2">No internet needed</Typography>} />
          </Tooltip>
        </Box>
      </Paper>
    </Box>
  );
}
