import { useGetAndroidTasksQuery } from '@/RTKService/androidService/androidService';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloseIcon from '@mui/icons-material/Close';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import SendIcon from '@mui/icons-material/Send';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import StopIcon from '@mui/icons-material/Stop';
import {
  Box,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  LinearProgress,
  Stack,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

export interface ChatPanelStep {
  index: number;
  thought?: string;
  action?: string;
}

export interface ChatPanelDevice {
  id: number;
  name: string;
  isOnline: boolean;
  isRunning: boolean;
  isQueued: boolean;
  prompt?: string;
  stepIndex: number;
  steps?: ChatPanelStep[];
  finishedOk?: boolean;
  finishedMessage?: string;
  startError?: string;
  proxyName?: string;
  proxyColor?: string;
  tag?: string | null;
}

interface FleetChatPanelProps {
  devices: ChatPanelDevice[];
  onClose: () => void;
  onFollowUp: (deviceId: number, text: string) => Promise<void> | void;
  onBroadcast: (text: string) => Promise<void> | void;
  onStop: (deviceId: number) => Promise<void> | void;
  onOpenFull: (deviceId: number) => void;
}

/**
 * Live conversations for the devices currently selected.
 *
 * A fleet run is many conversations at once and the grid can only show the
 * latest line of each. Every selected device gets a thread here, collapsed to
 * its current state so twenty still fit; opening one shows the same shape the
 * agent page does — what was asked, what the agent did, how it ended — with
 * earlier runs above it, so a thread is a history rather than a status line.
 */
export default function FleetChatPanel({ devices, onClose, onFollowUp, onBroadcast, onStop, onOpenFull }: FleetChatPanelProps) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [broadcast, setBroadcast] = useState('');
  const [isSending, setIsSending] = useState(false);

  const runningCount = devices.filter((device) => device.isRunning).length;

  const sendBroadcast = async () => {
    const text = broadcast.trim();
    if (!text) return;
    setIsSending(true);
    try {
      await onBroadcast(text);
      setBroadcast('');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Box
      sx={{
        width: { xs: '100%', md: 420 },
        flexShrink: 0,
        borderLeft: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        position: 'sticky',
        top: 0,
        height: '100vh',
        bgcolor: 'background.paper',
      }}
    >
      <Stack direction="row" alignItems="center" gap={1} sx={{ px: 2, py: 1.5 }}>
        <SmartToyIcon fontSize="small" color="primary" />
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 800, lineHeight: 1.2 }}>Conversations</Typography>
          <Typography variant="caption" color="text.secondary">
            {devices.length} selected{runningCount > 0 ? ` · ${runningCount} running` : ''}
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>
      {runningCount > 0 && <LinearProgress sx={{ height: 2 }} />}
      <Divider />

      <Box sx={{ flexGrow: 1, overflowY: 'auto', px: 1.5, py: 1.5 }}>
        {devices.length === 0 ? (
          <Stack alignItems="center" gap={1} sx={{ py: 6, px: 3, textAlign: 'center' }}>
            <SmartToyIcon sx={{ fontSize: 40, color: 'text.disabled' }} />
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              No devices selected
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Tick the phones you want to follow. Each one gets its own thread here, with the history of what it has
              already run.
            </Typography>
          </Stack>
        ) : (
          <Stack spacing={1.25}>
            {devices.map((device) => (
              <DeviceThread
                key={device.id}
                device={device}
                expanded={Boolean(expanded[device.id])}
                onToggle={() => setExpanded((current) => ({ ...current, [device.id]: !current[device.id] }))}
                onFollowUp={(text) => onFollowUp(device.id, text)}
                onStop={() => void onStop(device.id)}
                onOpenFull={() => onOpenFull(device.id)}
              />
            ))}
          </Stack>
        )}
      </Box>

      <Divider />
      <Stack direction="row" gap={1} alignItems="center" sx={{ p: 1.5 }}>
        <TextField
          fullWidth
          size="small"
          placeholder={devices.length > 0 ? `Follow-up for all ${devices.length}…` : 'Select devices first…'}
          value={broadcast}
          disabled={devices.length === 0}
          onChange={(event) => setBroadcast(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void sendBroadcast();
            }
          }}
        />
        <Tooltip title="Send to every selected device">
          <span>
            <IconButton
              color="primary"
              disabled={isSending || !broadcast.trim() || devices.length === 0}
              onClick={() => void sendBroadcast()}
            >
              {isSending ? <CircularProgress size={18} /> : <SendIcon fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
      </Stack>
    </Box>
  );
}

function DeviceThread({
  device,
  expanded,
  onToggle,
  onFollowUp,
  onStop,
  onOpenFull,
}: {
  device: ChatPanelDevice;
  expanded: boolean;
  onToggle: () => void;
  onFollowUp: (text: string) => Promise<void> | void;
  onStop: () => void;
  onOpenFull: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);

  // Only fetched once a thread is opened: twenty devices asking for their
  // history on mount would be twenty requests nobody asked for.
  const { data: historyData, isFetching } = useGetAndroidTasksQuery(
    { deviceId: device.id, limit: 6 },
    { skip: !expanded },
  );

  const steps = device.steps ?? [];
  // Oldest first, so the thread reads downwards like a conversation.
  const history = [...(historyData?.data ?? [])].reverse();

  useEffect(() => {
    if (expanded && device.isRunning) endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [expanded, device.isRunning, steps.length]);

  const status = device.isRunning
    ? { label: `Running · step ${device.stepIndex}`, bg: 'warning.main', fg: 'warning.contrastText' }
    : device.isQueued
      ? { label: 'Waiting for lane', bg: 'warning.light', fg: 'warning.contrastText' }
      : device.startError
        ? { label: 'Failed to start', bg: 'error.main', fg: 'error.contrastText' }
        : device.finishedMessage
          ? device.finishedOk
            ? { label: 'Completed', bg: 'success.main', fg: 'success.contrastText' }
            : { label: 'Failed', bg: 'error.main', fg: 'error.contrastText' }
          : device.isOnline
            ? { label: 'Idle', bg: 'action.hover', fg: 'text.secondary' }
            : { label: 'Offline', bg: 'action.disabledBackground', fg: 'text.disabled' };

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setIsSending(true);
    try {
      await onFollowUp(text);
      setDraft('');
    } finally {
      setIsSending(false);
    }
  };

  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: device.isRunning ? 'warning.main' : 'divider',
        borderRadius: 2,
        overflow: 'hidden',
        bgcolor: 'background.paper',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        gap={0.75}
        sx={{
          px: 1.25,
          py: 1,
          cursor: 'pointer',
          bgcolor: device.isRunning ? (theme) => alpha(theme.palette.warning.main, 0.1) : 'transparent',
        }}
        onClick={onToggle}
      >
        {device.proxyColor && <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: device.proxyColor, flexShrink: 0 }} />}
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="body2" noWrap sx={{ fontWeight: 800 }}>
            {device.name}
          </Typography>
          {device.tag && (
            <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
              {device.tag}
            </Typography>
          )}
        </Box>
        <Chip size="small" label={status.label} sx={{ height: 20, fontSize: 10, fontWeight: 800, bgcolor: status.bg, color: status.fg }} />
        {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
      </Stack>

      {!expanded && (
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', px: 1.25, pb: 1 }}>
          {device.isRunning
            ? steps[steps.length - 1]?.thought || 'Working…'
            : device.startError || device.finishedMessage || device.prompt || 'No run yet'}
        </Typography>
      )}

      {expanded && (
        <Box sx={{ px: 1.25, pb: 1.25 }}>
          <Box sx={{ maxHeight: 340, overflowY: 'auto', pr: 0.5 }}>
            {isFetching && history.length === 0 && (
              <Stack alignItems="center" sx={{ py: 2 }}>
                <CircularProgress size={18} />
              </Stack>
            )}

            {!isFetching && history.length === 0 && steps.length === 0 && !device.prompt && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', py: 1 }}>
                Nothing has run on this device yet.
              </Typography>
            )}

            {/* Earlier runs, so a thread has a past and not just a present. */}
            {history.map((task) => (
              <Box key={task.id} sx={{ mb: 1.5 }}>
                <Bubble side="user">{task.prompt}</Bubble>
                <Bubble side="agent" tone={task.success ? 'success' : 'error'}>
                  <Stack direction="row" alignItems="flex-start" gap={0.75}>
                    {task.success ? (
                      <CheckCircleIcon sx={{ fontSize: 15, mt: '2px' }} />
                    ) : (
                      <ErrorOutlineIcon sx={{ fontSize: 15, mt: '2px' }} />
                    )}
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="caption" sx={{ display: 'block' }}>
                        {task.message || (task.success ? 'Completed' : 'Failed')}
                      </Typography>
                      <Typography variant="caption" sx={{ opacity: 0.7 }}>
                        {task.total_steps} steps · {new Date(task.created_at).toLocaleString()}
                      </Typography>
                    </Box>
                  </Stack>
                </Bubble>
              </Box>
            ))}

            {history.length > 0 && (device.isRunning || steps.length > 0) && (
              <Divider sx={{ my: 1 }}>
                <Typography variant="caption" color="text.secondary">
                  This run
                </Typography>
              </Divider>
            )}

            {device.prompt && (device.isRunning || steps.length > 0) && <Bubble side="user">{device.prompt}</Bubble>}

            {steps.map((step) => (
              <Box
                key={`${step.index}-${step.action ?? ''}`}
                sx={{ mb: 0.5, p: 0.75, borderRadius: 1.5, bgcolor: 'action.hover' }}
              >
                <Typography variant="caption" sx={{ fontWeight: 800, display: 'block' }}>
                  Step {step.index}
                  {step.action ? ` · ${step.action}` : ''}
                </Typography>
                {step.thought && <Typography variant="caption">{step.thought}</Typography>}
              </Box>
            ))}

            {device.isQueued && (
              <Stack direction="row" alignItems="center" gap={0.75} sx={{ py: 1, color: 'text.secondary' }}>
                <HourglassEmptyIcon fontSize="small" />
                <Typography variant="caption">Waiting for its proxy lane to free up…</Typography>
              </Stack>
            )}

            {device.startError && (
              <Bubble side="agent" tone="error">
                <Typography variant="caption">{device.startError}</Typography>
              </Bubble>
            )}

            {!device.isRunning && device.finishedMessage && steps.length > 0 && (
              <Bubble side="agent" tone={device.finishedOk ? 'success' : 'error'}>
                <Typography variant="caption">{device.finishedMessage}</Typography>
              </Bubble>
            )}

            <div ref={endRef} />
          </Box>

          <Stack direction="row" gap={0.5} alignItems="center" sx={{ mt: 1 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="Message this device…"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <Tooltip title="Send to this device">
              <span>
                <IconButton size="small" color="primary" disabled={isSending || !draft.trim()} onClick={() => void send()}>
                  {isSending ? <CircularProgress size={16} /> : <SendIcon fontSize="small" />}
                </IconButton>
              </span>
            </Tooltip>
            {device.isRunning && (
              <Tooltip title="Stop this run">
                <IconButton size="small" color="error" onClick={onStop}>
                  <StopIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
            <Tooltip title="Open the full agent view">
              <IconButton size="small" onClick={onOpenFull}>
                <OpenInNewIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
        </Box>
      )}
    </Box>
  );
}

/** A chat bubble: the instruction on the right, the agent's reply on the left. */
function Bubble({ side, tone, children }: { side: 'user' | 'agent'; tone?: 'success' | 'error'; children: ReactNode }) {
  const isUser = side === 'user';

  return (
    <Stack direction="row" justifyContent={isUser ? 'flex-end' : 'flex-start'} sx={{ mb: 0.75 }}>
      <Box
        sx={{
          maxWidth: '88%',
          px: 1.25,
          py: 0.75,
          borderRadius: 2,
          borderTopRightRadius: isUser ? 4 : 16,
          borderTopLeftRadius: isUser ? 16 : 4,
          bgcolor: isUser ? 'primary.main' : tone === 'error' ? 'error.light' : tone === 'success' ? 'success.light' : 'action.hover',
          color: isUser ? 'primary.contrastText' : tone ? `${tone}.contrastText` : 'text.primary',
        }}
      >
        {typeof children === 'string' ? <Typography variant="caption">{children}</Typography> : children}
      </Box>
    </Stack>
  );
}
