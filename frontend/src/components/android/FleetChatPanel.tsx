import CloseIcon from '@mui/icons-material/Close';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import SendIcon from '@mui/icons-material/Send';
import StopIcon from '@mui/icons-material/Stop';
import {
  Box,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
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
 * A fleet run is many conversations at once, and the grid can only ever show
 * the latest line of each. This panel keeps them side by side: every selected
 * device gets its own thread, collapsed to its current step so twenty of them
 * still fit, and expandable when one needs watching. The box at the bottom
 * sends the same follow-up to all of them, which is how a fleet is usually
 * corrected mid-run.
 */
export default function FleetChatPanel({ devices, onClose, onFollowUp, onBroadcast, onStop, onOpenFull }: FleetChatPanelProps) {
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [broadcast, setBroadcast] = useState('');
  const [isSending, setIsSending] = useState(false);

  // Only one device expanded at a time keeps the panel readable; expanding a
  // second would push the first out of view anyway.
  const toggle = (deviceId: number) =>
    setExpanded((current) => ({ ...current, [deviceId]: !current[deviceId] }));

  const sendFollowUp = async (deviceId: number) => {
    const text = (drafts[deviceId] ?? '').trim();
    if (!text) return;
    setIsSending(true);
    try {
      await onFollowUp(deviceId, text);
      setDrafts((current) => ({ ...current, [deviceId]: '' }));
    } finally {
      setIsSending(false);
    }
  };

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
        width: { xs: '100%', md: 400 },
        flexShrink: 0,
        borderLeft: '1px solid',
        borderColor: 'divider',
        display: 'flex',
        flexDirection: 'column',
        // Sticks while the device grid scrolls, so the conversations stay put.
        position: 'sticky',
        top: 0,
        maxHeight: '100vh',
        bgcolor: 'background.paper',
      }}
    >
      <Stack direction="row" alignItems="center" gap={1} sx={{ px: 2, py: 1.5 }}>
        <Typography sx={{ fontWeight: 800, flexGrow: 1 }}>
          Conversations
          <Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>
            {devices.length} selected
          </Typography>
        </Typography>
        <IconButton size="small" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>
      <Divider />

      <Box sx={{ flexGrow: 1, overflowY: 'auto', px: 1.5, py: 1 }}>
        {devices.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
            Select devices to follow their runs here.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {devices.map((device) => (
              <DeviceThread
                key={device.id}
                device={device}
                expanded={Boolean(expanded[device.id])}
                draft={drafts[device.id] ?? ''}
                isSending={isSending}
                onToggle={() => toggle(device.id)}
                onDraftChange={(value) => setDrafts((current) => ({ ...current, [device.id]: value }))}
                onSend={() => void sendFollowUp(device.id)}
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
          placeholder={`Follow-up for all ${devices.length}…`}
          value={broadcast}
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
            <IconButton color="primary" disabled={isSending || !broadcast.trim() || devices.length === 0} onClick={() => void sendBroadcast()}>
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
  draft,
  isSending,
  onToggle,
  onDraftChange,
  onSend,
  onStop,
  onOpenFull,
}: {
  device: ChatPanelDevice;
  expanded: boolean;
  draft: string;
  isSending: boolean;
  onToggle: () => void;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onOpenFull: () => void;
}) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const steps = device.steps ?? [];

  // Follow the newest step while a run is in progress.
  useEffect(() => {
    if (expanded && device.isRunning) endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [expanded, device.isRunning, steps.length]);

  const status = device.isRunning
    ? `Step ${device.stepIndex}`
    : device.isQueued
      ? 'Waiting for lane'
      : device.startError
        ? 'Failed to start'
        : device.finishedMessage
          ? device.finishedOk
            ? 'Done'
            : 'Failed'
          : device.isOnline
            ? 'Idle'
            : 'Offline';

  return (
    <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1.5, overflow: 'hidden' }}>
      <Stack
        direction="row"
        alignItems="center"
        gap={0.75}
        sx={{ px: 1, py: 0.75, cursor: 'pointer', bgcolor: device.isRunning ? 'action.hover' : undefined }}
        onClick={onToggle}
      >
        {device.proxyColor && <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: device.proxyColor, flexShrink: 0 }} />}
        <Typography variant="body2" noWrap sx={{ fontWeight: 700, flexGrow: 1, minWidth: 0 }}>
          {device.name}
        </Typography>
        <Chip
          size="small"
          label={status}
          color={device.isRunning ? 'primary' : device.finishedOk === false || device.startError ? 'error' : 'default'}
          sx={{ height: 20, fontSize: '0.68rem' }}
        />
        {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
      </Stack>

      {/* Collapsed: the single line that matters right now. */}
      {!expanded && (
        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', px: 1, pb: 0.75 }}>
          {device.isRunning
            ? steps[steps.length - 1]?.thought || 'Working…'
            : device.startError || device.finishedMessage || device.prompt || 'No run yet'}
        </Typography>
      )}

      {expanded && (
        <Box sx={{ px: 1, pb: 1 }}>
          {device.prompt && (
            <Box sx={{ my: 0.75, p: 0.75, borderRadius: 1, bgcolor: 'primary.main', color: 'primary.contrastText' }}>
              <Typography variant="caption">{device.prompt}</Typography>
            </Box>
          )}

          <Stack spacing={0.5} sx={{ maxHeight: 260, overflowY: 'auto' }}>
            {steps.length === 0 && !device.finishedMessage && (
              <Typography variant="caption" color="text.secondary">
                No steps yet.
              </Typography>
            )}

            {steps.map((step) => (
              <Box key={`${step.index}-${step.action ?? ''}`} sx={{ p: 0.75, borderRadius: 1, bgcolor: 'action.hover' }}>
                <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>
                  Step {step.index}
                  {step.action ? ` · ${step.action}` : ''}
                </Typography>
                {step.thought && <Typography variant="caption">{step.thought}</Typography>}
              </Box>
            ))}

            {device.finishedMessage && (
              <Box
                sx={{
                  p: 0.75,
                  borderRadius: 1,
                  bgcolor: device.finishedOk ? 'success.light' : 'error.light',
                  color: device.finishedOk ? 'success.contrastText' : 'error.contrastText',
                }}
              >
                <Typography variant="caption">{device.finishedMessage}</Typography>
              </Box>
            )}

            {device.startError && (
              <Typography variant="caption" color="error.main">
                {device.startError}
              </Typography>
            )}
            <div ref={endRef} />
          </Stack>

          <Stack direction="row" gap={0.5} alignItems="center" sx={{ mt: 1 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="Follow-up for this device…"
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  onSend();
                }
              }}
            />
            <Tooltip title="Send to this device">
              <span>
                <IconButton size="small" color="primary" disabled={isSending || !draft.trim()} onClick={onSend}>
                  <SendIcon fontSize="small" />
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
