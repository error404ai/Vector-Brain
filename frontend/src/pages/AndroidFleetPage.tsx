import {
  useCancelAndroidTaskMutation,
  useGetAndroidDevicesQuery,
  useGetAndroidTasksQuery,
  useRunAndroidTaskMutation,
  type AndroidAgentTask,
  type AndroidDevice,
} from '@/RTKService/androidService/androidService';
import { useGetAiConfigsQuery } from '@/RTKService/aiConfigService/aiConfigService';
import authManager from '@/_helpers/authManager';
import InteractiveDeviceScreen from '@/components/android/InteractiveDeviceScreen';
import FleetCoverageStrip from '@/components/android/FleetCoverageStrip';
import FleetStatusSpine from '@/components/android/FleetStatusSpine';
import SendFileDialog from '@/components/android/SendFileDialog';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloseIcon from '@mui/icons-material/Close';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HistoryIcon from '@mui/icons-material/History';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import RefreshIcon from '@mui/icons-material/Refresh';
import ReplayIcon from '@mui/icons-material/Replay';
import SendIcon from '@mui/icons-material/Send';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import StopCircleIcon from '@mui/icons-material/StopCircle';
import TouchAppIcon from '@mui/icons-material/TouchApp';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import {
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

/** Live state tracked per device from the WebSocket stream. */
interface DeviceRuntime {
  screenshot?: string;
  taskId?: number;
  prompt?: string;
  isRunning: boolean;
  stepIndex: number;
  lastThought?: string;
  lastAction?: string;
  finishedAt?: number;
  finishedOk?: boolean;
  finishedMessage?: string;
  startError?: string;
}

type RuntimeMap = Record<number, DeviceRuntime>;

interface DispatchResult {
  prompt: string;
  startedIds: number[];
  failedIds: number[];
}

const emptyRuntime: DeviceRuntime = { isRunning: false, stepIndex: 0 };

function timeAgo(iso?: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff)) return '';
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Pull a readable reason out of an RTK Query error. */
function errorMessage(error: unknown): string {
  const data = (error as { data?: { message?: string } })?.data;
  return data?.message || 'Could not start the task';
}

export default function AndroidFleetPage() {
  const navigate = useNavigate();

  const { data: devicesData, isLoading, refetch } = useGetAndroidDevicesQuery(undefined, {
    pollingInterval: 20_000,
  });
  const { data: tasksData } = useGetAndroidTasksQuery({ limit: 100 }, { pollingInterval: 20_000 });
  const { data: aiConfigsData } = useGetAiConfigsQuery();

  const [runTask] = useRunAndroidTaskMutation();
  const [cancelTask] = useCancelAndroidTaskMutation();

  const devices = useMemo<AndroidDevice[]>(() => devicesData?.data ?? [], [devicesData]);
  const tasks = useMemo<AndroidAgentTask[]>(() => tasksData?.data ?? [], [tasksData]);
  const aiConfigs = useMemo(() => aiConfigsData?.data ?? [], [aiConfigsData]);
  const activeAiConfig = aiConfigs.find((config) => config.is_active);

  const [runtime, setRuntime] = useState<RuntimeMap>({});
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [prompt, setPrompt] = useState('');
  const [maxSteps, setMaxSteps] = useState(40);
  // 0 = use the account's active provider
  const [broadcastConfigId, setBroadcastConfigId] = useState(0);
  const [deviceConfigIds, setDeviceConfigIds] = useState<Record<number, number>>({});
  const [isDispatching, setIsDispatching] = useState(false);
  const [lastDispatch, setLastDispatch] = useState<DispatchResult | null>(null);

  // Per-device inline prompt inputs
  const [cardPrompts, setCardPrompts] = useState<Record<number, string>>({});
  const [historyDeviceId, setHistoryDeviceId] = useState<number | null>(null);
  // Only one device streams frames at a time so the fleet view stays light.
  const [controlDeviceId, setControlDeviceId] = useState<number | null>(null);
  const [expandedDeviceId, setExpandedDeviceId] = useState<number | null>(null);
  const [fileDeviceId, setFileDeviceId] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);

  const patchRuntime = (deviceId: number | undefined, patch: Partial<DeviceRuntime>) => {
    if (deviceId === undefined || deviceId === null) return;
    setRuntime((prev) => ({ ...prev, [deviceId]: { ...(prev[deviceId] ?? emptyRuntime), ...patch } }));
  };

  // ---- Live stream -------------------------------------------------------
  useEffect(() => {
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        const payload = msg.payload || {};
        const deviceId: number | undefined = typeof payload.deviceId === 'number' ? payload.deviceId : undefined;

        switch (msg.event) {
          case 'device:screen_capture': {
            const capture = payload?.result?.screenCapture?.base64Data;
            const hardwareId = payload?.deviceId;
            const match = devices.find((device) => device.device_id === hardwareId || device.id === hardwareId);
            if (capture && match) patchRuntime(match.id, { screenshot: capture });
            break;
          }
          case 'task:started':
            patchRuntime(deviceId, {
              isRunning: true,
              taskId: payload.taskId,
              prompt: payload.prompt,
              stepIndex: 0,
              finishedAt: undefined,
              finishedMessage: undefined,
              startError: undefined,
            });
            break;
          case 'task:step':
            patchRuntime(deviceId, {
              isRunning: true,
              stepIndex: payload.stepIndex ?? 0,
              lastThought: payload.thought,
              lastAction: payload.action?.type,
            });
            break;
          case 'task:completed':
            patchRuntime(deviceId, {
              isRunning: false,
              finishedAt: Date.now(),
              finishedOk: Boolean(payload.success),
              finishedMessage: payload.message,
            });
            break;
          case 'task:cancelled':
            patchRuntime(deviceId, {
              isRunning: false,
              finishedAt: Date.now(),
              finishedOk: false,
              finishedMessage: 'Cancelled',
            });
            break;
          case 'task:error':
            patchRuntime(deviceId, {
              isRunning: false,
              finishedAt: Date.now(),
              finishedOk: false,
              finishedMessage: payload.error,
            });
            break;
          default:
            break;
        }
      } catch (err) {
        console.error('Fleet WS error:', err);
      }
    };

    const scheduleReconnect = () => {
      if (!disposed) reconnectTimer = setTimeout(connect, 2_000);
    };

    const connect = () => {
      const token = authManager.getAccessToken();
      if (!token) {
        scheduleReconnect();
        return;
      }
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(
        `${protocol}//${window.location.host}/ws/android?type=web&token=${encodeURIComponent(token)}`,
      );
      wsRef.current = ws;
      ws.onmessage = handleMessage;
      ws.onclose = scheduleReconnect;
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [devices]);

  // ---- Derived -----------------------------------------------------------
  const onlineDevices = devices.filter((device) => device.status === 'ONLINE');

  /** Running devices first, then idle online ones, then whatever is offline. */
  const orderedDevices = useMemo(() => {
    const rank = (device: AndroidDevice) => {
      if (runtime[device.id]?.isRunning) return 0;
      return device.status === 'ONLINE' ? 1 : 2;
    };
    return [...devices].sort((a, b) => rank(a) - rank(b) || a.device_name.localeCompare(b.device_name));
  }, [devices, runtime]);
  const runningCount = (Object.values(runtime) as DeviceRuntime[]).filter((state) => state.isRunning).length;

  const tasksByDevice = useMemo(() => {
    const map: Record<number, AndroidAgentTask[]> = {};
    for (const task of tasks) {
      if (typeof task.device_id !== 'number') continue;
      if (!map[task.device_id]) map[task.device_id] = [];
      map[task.device_id].push(task);
    }
    return map;
  }, [tasks]);

  const toggleDevice = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectAllOnline = () => {
    const ids = onlineDevices.map((device) => device.id);
    setSelectedIds((prev) => (prev.length === ids.length ? [] : ids));
  };

  // ---- Dispatch ----------------------------------------------------------
  const ensureReady = (): boolean => {
    if (!activeAiConfig) {
      toast.error('Configure an AI provider in Settings first');
      navigate('/settings');
      return false;
    }
    return true;
  };

  /** Starts the same prompt on a set of devices and records what failed. */
  const dispatchTo = async (deviceIds: number[], text: string) => {
    setIsDispatching(true);
    const outcomes = await Promise.allSettled(
      deviceIds.map((deviceId) =>
        runTask({
          device_id: deviceId,
          prompt: text,
          max_steps: maxSteps,
          ai_config_id: deviceConfigIds[deviceId] || broadcastConfigId || undefined,
        }).unwrap(),
      ),
    );
    setIsDispatching(false);

    const startedIds: number[] = [];
    const failedIds: number[] = [];

    outcomes.forEach((outcome, index) => {
      const deviceId = deviceIds[index];
      if (outcome.status === 'fulfilled') {
        startedIds.push(deviceId);
        patchRuntime(deviceId, { startError: undefined });
      } else {
        failedIds.push(deviceId);
        patchRuntime(deviceId, { startError: errorMessage(outcome.reason), isRunning: false });
      }
    });

    setLastDispatch({ prompt: text, startedIds, failedIds });
    // Keep only the failed ones selected so a retry hits exactly those.
    setSelectedIds(failedIds);

    if (startedIds.length) toast.success(`Started on ${startedIds.length} device${startedIds.length > 1 ? 's' : ''}`);
    if (failedIds.length) toast.error(`${failedIds.length} device${failedIds.length > 1 ? 's' : ''} could not start`);
  };

  const handleRunOnSelected = async () => {
    const text = prompt.trim();
    if (!text) return toast.error('Enter a task first');
    if (selectedIds.length === 0) return toast.error('Select at least one device');
    if (!ensureReady()) return;
    await dispatchTo(selectedIds, text);
  };

  const handleRetryFailed = async () => {
    if (!lastDispatch?.failedIds.length) return;
    if (!ensureReady()) return;
    await dispatchTo(lastDispatch.failedIds, lastDispatch.prompt);
  };

  const handleDismissDispatch = () => {
    setLastDispatch(null);
    setSelectedIds([]);
    setPrompt('');
  };

  /** Runs a device-specific prompt typed directly on its card. */
  const handleRunOnCard = async (deviceId: number) => {
    const text = (cardPrompts[deviceId] ?? '').trim();
    if (!text) return;
    if (!ensureReady()) return;

    try {
      await runTask({
        device_id: deviceId,
        prompt: text,
        max_steps: maxSteps,
        ai_config_id: deviceConfigIds[deviceId] || broadcastConfigId || undefined,
      }).unwrap();
      patchRuntime(deviceId, { startError: undefined });
      setCardPrompts((prev) => ({ ...prev, [deviceId]: '' }));
      toast.success('Task started');
    } catch (error) {
      const message = errorMessage(error);
      patchRuntime(deviceId, { startError: message });
      toast.error(message);
    }
  };

  const handleStopDevice = async (deviceId: number) => {
    const taskId = runtime[deviceId]?.taskId;
    if (!taskId) return;
    try {
      await cancelTask(taskId).unwrap();
      toast.success('Stop requested');
    } catch {
      toast.error('Could not stop the task');
    }
  };

  const handleStopAll = async () => {
    const ids = (Object.values(runtime) as DeviceRuntime[])
      .filter((state) => state.isRunning && typeof state.taskId === 'number')
      .map((state) => state.taskId as number);
    if (ids.length === 0) return;
    await Promise.allSettled(ids.map((taskId) => cancelTask(taskId).unwrap()));
    toast.success('Stop requested on all running devices');
  };

  const historyDevice = devices.find((device) => device.id === historyDeviceId);
  const fileDevice = devices.find((device) => device.id === fileDeviceId);
  const historyTasks = historyDeviceId !== null ? tasksByDevice[historyDeviceId] ?? [] : [];

  // ---- Render ------------------------------------------------------------
  return (
    <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1360, mx: 'auto' }}>
      {/* Header */}
      <Stack direction="row" alignItems="flex-end" flexWrap="wrap" gap={2} sx={{ mb: 2.5 }}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="h5" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
            Device Fleet
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            Send one instruction to every phone at once
          </Typography>
        </Box>

        {/* Counters read as a board, not as chips: the number carries the
            weight and the word underneath explains it. */}
        <Stack direction="row" spacing={3} sx={{ ml: { md: 2 } }}>
          {[
            { value: onlineDevices.length, label: 'online', tone: 'success.main' },
            { value: runningCount, label: 'running', tone: runningCount > 0 ? 'primary.main' : 'text.disabled' },
            { value: devices.length - onlineDevices.length, label: 'offline', tone: 'text.disabled' },
          ].map((stat) => (
            <Box key={stat.label}>
              <Typography
                sx={{ fontWeight: 800, fontSize: 26, lineHeight: 1, color: stat.tone, fontVariantNumeric: 'tabular-nums' }}
              >
                {stat.value}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {stat.label}
              </Typography>
            </Box>
          ))}
        </Stack>

        <Box sx={{ flexGrow: 1 }} />
        {runningCount > 0 && (
          <Button size="small" color="error" variant="outlined" startIcon={<StopCircleIcon />} onClick={handleStopAll}>
            Stop all
          </Button>
        )}
        <Tooltip title="Refresh devices">
          <IconButton size="small" onClick={() => refetch()}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      <FleetCoverageStrip devices={devices} />

      {/* Broadcast bar — the primary control on the page, so it is raised out of
          the flat outlined-paper treatment the rest of the page uses. */}
      <Paper
        elevation={0}
        sx={{
          p: 2.25,
          mb: 3,
          borderRadius: 2.5,
          border: '1px solid',
          borderColor: selectedIds.length > 0 ? 'primary.main' : 'divider',
          bgcolor: selectedIds.length > 0 ? 'action.hover' : 'background.paper',
          transition: 'border-color 200ms ease, background-color 200ms ease',
        }}
      >
        <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 1.5 }}>
          <SmartToyIcon fontSize="small" color="primary" />
          <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            Run one task on many devices
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          <Button size="small" onClick={selectAllOnline} disabled={onlineDevices.length === 0}>
            {selectedIds.length === onlineDevices.length && onlineDevices.length > 0
              ? 'Clear selection'
              : 'Select all online'}
          </Button>
        </Stack>

        <Stack direction={{ xs: 'column', md: 'row' }} gap={1.5}>
          <TextField
            fullWidth
            size="small"
            placeholder="e.g. Open YouTube and search for lofi beats"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleRunOnSelected();
              }
            }}
          />
          <TextField
            select
            size="small"
            label="Model"
            value={broadcastConfigId}
            onChange={(event) => setBroadcastConfigId(Number(event.target.value))}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value={0}>Active — {activeAiConfig?.model ?? 'none'}</MenuItem>
            {aiConfigs.map((config) => (
              <MenuItem key={config.id} value={config.id}>
                {config.model}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            type="number"
            label="Steps"
            value={maxSteps}
            onChange={(event) => setMaxSteps(Number(event.target.value))}
            onBlur={() => setMaxSteps((prev) => Math.min(200, Math.max(1, prev || 40)))}
            inputProps={{ min: 1, max: 200 }}
            helperText="1–200"
            sx={{ width: 120 }}
          />
          <Button
            variant="contained"
            startIcon={isDispatching ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
            disabled={isDispatching || selectedIds.length === 0 || !prompt.trim()}
            onClick={handleRunOnSelected}
            sx={{ whiteSpace: 'nowrap', minWidth: 170 }}
          >
            Run on {selectedIds.length || 0}
          </Button>
        </Stack>

        {/* Dispatch result strip */}
        {lastDispatch && (
          <Stack
            direction="row"
            alignItems="center"
            flexWrap="wrap"
            gap={1}
            sx={{ mt: 1.5, pt: 1.5, borderTop: 1, borderColor: 'divider' }}
          >
            {lastDispatch.startedIds.length > 0 && (
              <Chip
                size="small"
                icon={<CheckCircleIcon />}
                color="success"
                variant="outlined"
                label={`${lastDispatch.startedIds.length} started`}
              />
            )}
            {lastDispatch.failedIds.length > 0 && (
              <Chip
                size="small"
                icon={<ErrorOutlineIcon />}
                color="error"
                variant="outlined"
                label={`${lastDispatch.failedIds.length} failed`}
              />
            )}
            <Box sx={{ flexGrow: 1 }} />
            {lastDispatch.failedIds.length > 0 && (
              <Button size="small" startIcon={<ReplayIcon />} onClick={handleRetryFailed} disabled={isDispatching}>
                Retry failed
              </Button>
            )}
            <Button size="small" color="inherit" onClick={handleDismissDispatch}>
              Dismiss
            </Button>
          </Stack>
        )}
      </Paper>

      {/* Grid */}
      {isLoading ? (
        <Stack alignItems="center" sx={{ py: 6 }}>
          <CircularProgress />
        </Stack>
      ) : devices.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 5, textAlign: 'center', borderRadius: 2 }}>
          <Typography color="text.secondary">No paired devices yet.</Typography>
          <Button sx={{ mt: 2 }} variant="contained" onClick={() => navigate('/android-devices')}>
            Pair a device
          </Button>
        </Paper>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            // auto-fill rather than a fixed count: two devices on a wide screen
            // stay card-sized instead of stretching into two huge panels.
            gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))',
            alignItems: 'start',
          }}
        >
          {orderedDevices.map((device) => {
            const state = runtime[device.id] ?? emptyRuntime;
            const isOnline = device.status === 'ONLINE';
            const isSelected = selectedIds.includes(device.id);
            const historyCount = (tasksByDevice[device.id] ?? []).length;

            return (
              <Card
                key={device.id}
                variant="outlined"
                sx={{
                  position: 'relative',
                  borderRadius: 2,
                  overflow: 'hidden',
                  borderWidth: isSelected || state.startError ? 2 : 1,
                  borderColor: state.startError ? 'error.main' : isSelected ? 'primary.main' : undefined,
                  // Offline cards keep full contrast; the spine carries the state
                  // so the content stays readable.
                  display: 'flex',
                  flexDirection: 'column',
                  pl: '5px',
                  transition: 'border-color 180ms ease, box-shadow 180ms ease',
                  ...(state.isRunning && { boxShadow: '0 0 0 1px rgba(37, 99, 235, 0.28)' }),
                }}
              >
                <FleetStatusSpine
                  state={
                    state.isRunning
                      ? 'running'
                      : state.startError
                        ? 'failed'
                        : isOnline
                          ? 'idle'
                          : 'offline'
                  }
                />
                {/* Header */}
                <Stack direction="row" alignItems="center" gap={0.5} sx={{ px: 1, pt: 1 }}>
                  <Checkbox size="small" checked={isSelected} disabled={!isOnline} onChange={() => toggleDevice(device.id)} />
                  <Typography variant="body2" noWrap sx={{ fontWeight: 700, flexGrow: 1, minWidth: 0 }}>
                    {device.device_name}
                  </Typography>
                  <Chip
                    size="small"
                    label={isOnline ? 'ONLINE' : 'OFFLINE'}
                    color={isOnline ? 'success' : 'default'}
                    sx={{ height: 20, fontSize: 10, fontWeight: 700 }}
                  />
                </Stack>

                <Stack direction="row" alignItems="center" gap={0.25} sx={{ px: 1, pb: 0.5 }}>
                  <Typography variant="caption" color="text.secondary" noWrap sx={{ flexGrow: 1, minWidth: 0, pl: 0.5 }}>
                    {device.device_model || 'Android'} · {device.device_id.slice(-8)}
                  </Typography>
                  <Tooltip title="Enlarge screen">
                    <span>
                      <IconButton size="small" disabled={!isOnline} onClick={() => setExpandedDeviceId(device.id)}>
                        <OpenInFullIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title={controlDeviceId === device.id ? 'Stop manual control' : 'Take manual control'}>
                    <span>
                      <IconButton
                        size="small"
                        disabled={!isOnline}
                        color={controlDeviceId === device.id ? 'primary' : 'default'}
                        onClick={() => setControlDeviceId((prev) => (prev === device.id ? null : device.id))}
                      >
                        <TouchAppIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title={`Task history (${historyCount})`}>
                    <span>
                      <IconButton size="small" disabled={historyCount === 0} onClick={() => setHistoryDeviceId(device.id)}>
                        <HistoryIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Send a file to this device">
                    <span>
                      <IconButton size="small" onClick={() => setFileDeviceId(device.id)}>
                        <AttachFileIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Stack>

                {state.isRunning && <LinearProgress />}

                {/* Live screen */}
                {/* A 9:16 box inside a grid column becomes ~750px tall, which turned
                    every card into a column of black. On a board the screen is a
                    thumbnail, not the subject — the full view is behind Enlarge.
                    Fixed height keeps the rows aligned across the whole grid. */}
                {/* A phone screen is portrait, so a full-width landscape box wasted
                    most of its area on black bars and shrank the actual frame to a
                    sliver. Constraining by height instead keeps the real 9:16 shape
                    and gives every card the same row height. */}
                <Box
                  sx={{
                    mx: 'auto',
                    my: 1,
                    height: 250,
                    width: 141,
                    borderRadius: 2,
                    overflow: 'hidden',
                    bgcolor: 'grey.900',
                    cursor: controlDeviceId === device.id ? 'default' : 'pointer',
                  }}
                  onClick={
                    controlDeviceId === device.id
                      ? undefined
                      : () => navigate(`/android-agent?deviceId=${device.id}`)
                  }
                >
                  <InteractiveDeviceScreen
                    compact
                    fill
                    deviceId={device.id}
                    screenshot={state.screenshot}
                    onScreenshot={(base64) => patchRuntime(device.id, { screenshot: base64 })}
                    controlEnabled={controlDeviceId === device.id}
                    isAgentRunning={state.isRunning}
                  />
                </Box>

                <Divider />

                {/* Status */}
                <CardContent sx={{ py: 1.25, flexGrow: 1, '&:last-child': { pb: 1.25 } }}>
                  {state.startError ? (
                    <Stack direction="row" alignItems="flex-start" gap={0.75}>
                      <ErrorOutlineIcon fontSize="small" color="error" />
                      <Typography variant="caption" color="error">
                        {state.startError}
                      </Typography>
                    </Stack>
                  ) : state.isRunning ? (
                    <Stack gap={0.5}>
                      <Stack direction="row" alignItems="center" gap={0.75}>
                        <Chip
                          size="small"
                          label={`Step ${state.stepIndex}`}
                          color="warning"
                          sx={{ height: 20, fontSize: 10, fontWeight: 700 }}
                        />
                        {state.lastAction && (
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {state.lastAction}
                          </Typography>
                        )}
                        <Box sx={{ flexGrow: 1 }} />
                        <Tooltip title="Stop this task">
                          <IconButton size="small" color="error" onClick={() => handleStopDevice(device.id)}>
                            <StopCircleIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                      >
                        {state.lastThought || state.prompt || 'Working…'}
                      </Typography>
                    </Stack>
                  ) : state.finishedAt ? (
                    <Stack direction="row" alignItems="center" gap={0.75}>
                      {state.finishedOk ? (
                        <CheckCircleIcon fontSize="small" color="success" />
                      ) : (
                        <ErrorOutlineIcon fontSize="small" color="error" />
                      )}
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {state.finishedMessage || (state.finishedOk ? 'Completed' : 'Stopped')}
                      </Typography>
                    </Stack>
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      {isOnline ? 'Idle — ready for a task' : 'Device offline'}
                    </Typography>
                  )}
                </CardContent>

                {/* Per-device model override */}
                <Box sx={{ px: 1, pb: 0.75 }}>
                  <TextField
                    select
                    fullWidth
                    size="small"
                    label="Model"
                    disabled={state.isRunning}
                    value={deviceConfigIds[device.id] ?? 0}
                    onChange={(event) =>
                      setDeviceConfigIds((prev) => ({ ...prev, [device.id]: Number(event.target.value) }))
                    }
                    sx={{ '& .MuiInputBase-input': { fontSize: 12 } }}
                  >
                    <MenuItem value={0} sx={{ fontSize: 12 }}>
                      Use fleet default
                    </MenuItem>
                    {aiConfigs.map((config) => (
                      <MenuItem key={config.id} value={config.id} sx={{ fontSize: 12 }}>
                        {config.model}
                      </MenuItem>
                    ))}
                  </TextField>
                </Box>

                {/* Inline per-device prompt */}
                <Stack direction="row" gap={0.75} sx={{ px: 1, pb: 1 }}>
                  <TextField
                    fullWidth
                    size="small"
                    placeholder="Task for this device…"
                    disabled={!isOnline || state.isRunning}
                    value={cardPrompts[device.id] ?? ''}
                    onChange={(event) => setCardPrompts((prev) => ({ ...prev, [device.id]: event.target.value }))}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        handleRunOnCard(device.id);
                      }
                    }}
                    sx={{ '& .MuiInputBase-input': { fontSize: 13 } }}
                  />
                  <IconButton
                    size="small"
                    color="primary"
                    disabled={!isOnline || state.isRunning || !(cardPrompts[device.id] ?? '').trim()}
                    onClick={() => handleRunOnCard(device.id)}
                  >
                    <SendIcon fontSize="small" />
                  </IconButton>
                </Stack>
              </Card>
            );
          })}
        </Box>
      )}

      {/* Enlarged device view */}
      <Dialog
        open={expandedDeviceId !== null}
        onClose={() => setExpandedDeviceId(null)}
        maxWidth={false}
        slotProps={{
          paper: {
            sx: {
              height: '92vh',
              width: 480,
              maxWidth: '96vw',
              borderRadius: 3,
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            },
          },
        }}
      >
        {(() => {
          const device = devices.find((item) => item.id === expandedDeviceId);
          if (!device) return null;
          const state = runtime[device.id] ?? emptyRuntime;
          const controlling = controlDeviceId === device.id;

          return (
            <>
              <Stack
                direction="row"
                alignItems="center"
                gap={1}
                sx={{ px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}
              >
                <PhoneAndroidIcon fontSize="small" color="primary" />
                <Typography variant="subtitle2" sx={{ fontWeight: 800, flexGrow: 1 }} noWrap>
                  {device.device_name}
                </Typography>
                <Tooltip title={controlling ? 'Stop manual control' : 'Take manual control'}>
                  <span>
                    <IconButton
                      size="small"
                      color={controlling ? 'primary' : 'default'}
                      onClick={() => setControlDeviceId((prev) => (prev === device.id ? null : device.id))}
                    >
                      <TouchAppIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <IconButton size="small" onClick={() => setExpandedDeviceId(null)}>
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Stack>

              <Box sx={{ flexGrow: 1, minHeight: 0, p: 1.5, display: 'flex', bgcolor: 'grey.900' }}>
                <InteractiveDeviceScreen
                  fill
                  deviceId={device.id}
                  screenshot={state.screenshot}
                  onScreenshot={(base64) => patchRuntime(device.id, { screenshot: base64 })}
                  controlEnabled={controlling}
                  isAgentRunning={state.isRunning}
                />
              </Box>
            </>
          );
        })()}
      </Dialog>

      {/* Send a file to one device */}
      <SendFileDialog
        open={fileDeviceId !== null}
        deviceId={fileDeviceId}
        deviceName={fileDevice?.device_name}
        isOnline={fileDevice?.status === 'ONLINE'}
        onClose={() => setFileDeviceId(null)}
      />

      {/* Per-device history */}
      <Dialog open={historyDeviceId !== null} onClose={() => setHistoryDeviceId(null)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ pr: 6 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
            {historyDevice?.device_name ?? 'Device'} — task history
          </Typography>
          <IconButton
            size="small"
            onClick={() => setHistoryDeviceId(null)}
            sx={{ position: 'absolute', right: 12, top: 12 }}
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {historyTasks.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
              No tasks recorded for this device yet.
            </Typography>
          ) : (
            <Stack divider={<Divider flexItem />}>
              {historyTasks.map((task) => (
                <Stack
                  key={task.id}
                  direction="row"
                  alignItems="center"
                  gap={1.25}
                  sx={{ py: 1.25, cursor: 'pointer' }}
                  onClick={() => {
                    setHistoryDeviceId(null);
                    navigate(`/android-agent?deviceId=${task.device_id}&taskId=${task.id}`);
                  }}
                >
                  {task.is_running ? (
                    <CircularProgress size={16} />
                  ) : task.success ? (
                    <CheckCircleIcon fontSize="small" color="success" />
                  ) : (
                    <ErrorOutlineIcon fontSize="small" color="error" />
                  )}
                  <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                      {task.prompt}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {task.total_steps} steps · {task.model || 'unknown model'}
                    </Typography>
                  </Box>
                  <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                    {timeAgo(task.created_at)}
                  </Typography>
                </Stack>
              ))}
            </Stack>
          )}
        </DialogContent>
      </Dialog>
    </Box>
  );
}
