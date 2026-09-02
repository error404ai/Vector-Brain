import {
  useCancelAndroidTaskMutation,
  useGetAndroidDevicesQuery,
  useRunAndroidTaskMutation,
  type AndroidDevice,
} from '@/RTKService/androidService/androidService';
import { useGetAiConfigsQuery } from '@/RTKService/aiConfigService/aiConfigService';
import authManager from '@/_helpers/authManager';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import RefreshIcon from '@mui/icons-material/Refresh';
import SendIcon from '@mui/icons-material/Send';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import StopCircleIcon from '@mui/icons-material/StopCircle';
import {
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  LinearProgress,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router';

/** Live state tracked per device from the WebSocket stream. */
interface DeviceRuntime {
  screenshot?: string;
  taskId?: number;
  prompt?: string;
  isRunning: boolean;
  stepIndex: number;
  lastThought?: string;
  lastAction?: string;
  lastStatus?: 'EXECUTING' | 'SUCCESS' | 'FAILED';
  finishedAt?: number;
  finishedOk?: boolean;
  finishedMessage?: string;
}

type RuntimeMap = Record<number, DeviceRuntime>;

const emptyRuntime: DeviceRuntime = { isRunning: false, stepIndex: 0 };

export default function AndroidFleetPage() {
  const navigate = useNavigate();

  const { data: devicesData, isLoading, refetch } = useGetAndroidDevicesQuery(undefined, {
    pollingInterval: 20_000,
  });
  const { data: aiConfigsData } = useGetAiConfigsQuery();
  const [runTask] = useRunAndroidTaskMutation();
  const [cancelTask] = useCancelAndroidTaskMutation();

  const devices = useMemo<AndroidDevice[]>(() => devicesData?.data ?? [], [devicesData]);
  const activeAiConfig = aiConfigsData?.data?.find((config) => config.is_active);

  const [runtime, setRuntime] = useState<RuntimeMap>({});
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [prompt, setPrompt] = useState('');
  const [isDispatching, setIsDispatching] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);

  const patchRuntime = (deviceId: number | undefined, patch: Partial<DeviceRuntime>) => {
    if (deviceId === undefined || deviceId === null) return;
    setRuntime((prev) => ({
      ...prev,
      [deviceId]: { ...(prev[deviceId] ?? emptyRuntime), ...patch },
    }));
  };

  // ---- Live stream -------------------------------------------------------
  useEffect(() => {
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        const payload = msg.payload || {};
        const deviceId: number | undefined =
          typeof payload.deviceId === 'number' ? payload.deviceId : undefined;

        switch (msg.event) {
          case 'device:screen_capture': {
            const capture = payload?.result?.screenCapture?.base64Data;
            // This event carries the hardware device id, so match it back to a row.
            const hardwareId = payload?.deviceId;
            const match = devices.find(
              (device) => device.device_id === hardwareId || device.id === hardwareId,
            );
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
            });
            break;
          case 'task:step':
            patchRuntime(deviceId, {
              isRunning: true,
              stepIndex: payload.stepIndex ?? 0,
              lastThought: payload.thought,
              lastAction: payload.action?.type,
              lastStatus: 'EXECUTING',
            });
            break;
          case 'task:step_result':
            patchRuntime(deviceId, { lastStatus: payload.status });
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
      const wsUrl = `${protocol}//${window.location.host}/ws/android?type=web&token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(wsUrl);
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
    // devices is needed so screen_capture can be matched to a row
  }, [devices]);

  // ---- Selection ---------------------------------------------------------
  const onlineDevices = devices.filter((device) => device.status === 'ONLINE');

  const toggleDevice = (id: number) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const selectAllOnline = () => {
    const ids = onlineDevices.map((device) => device.id);
    setSelectedIds((prev) => (prev.length === ids.length ? [] : ids));
  };

  // ---- Dispatch ----------------------------------------------------------
  const handleRunOnSelected = async () => {
    const text = prompt.trim();
    if (!text) {
      toast.error('Enter a task first');
      return;
    }
    if (selectedIds.length === 0) {
      toast.error('Select at least one device');
      return;
    }
    if (!activeAiConfig) {
      toast.error('Configure an AI provider in Settings first');
      navigate('/settings');
      return;
    }

    setIsDispatching(true);
    const results = await Promise.allSettled(
      selectedIds.map((deviceId) => runTask({ device_id: deviceId, prompt: text }).unwrap()),
    );
    setIsDispatching(false);

    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.length - ok;

    if (ok > 0) toast.success(`Task started on ${ok} device${ok > 1 ? 's' : ''}`);
    if (failed > 0) toast.error(`${failed} device${failed > 1 ? 's' : ''} could not start`);
    if (ok > 0) setPrompt('');
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
    const runningTaskIds = (Object.values(runtime) as DeviceRuntime[])
      .filter((state) => state.isRunning && typeof state.taskId === 'number')
      .map((state) => state.taskId as number);

    if (runningTaskIds.length === 0) return;
    await Promise.allSettled(runningTaskIds.map((taskId) => cancelTask(taskId).unwrap()));
    toast.success('Stop requested on all running devices');
  };

  const runningCount = (Object.values(runtime) as DeviceRuntime[]).filter((state) => state.isRunning).length;

  // ---- Render ------------------------------------------------------------
  return (
    <Box sx={{ p: { xs: 2, md: 3 } }}>
      {/* Header */}
      <Stack direction="row" alignItems="center" flexWrap="wrap" gap={1.5} sx={{ mb: 2 }}>
        <PhoneAndroidIcon color="primary" />
        <Typography variant="h5" sx={{ fontWeight: 800 }}>
          Device Fleet
        </Typography>
        <Chip size="small" label={`${onlineDevices.length} online`} color="success" variant="outlined" />
        {runningCount > 0 && (
          <Chip size="small" label={`${runningCount} running`} color="warning" variant="outlined" />
        )}
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

      {/* Broadcast bar */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3, borderRadius: 2 }}>
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
          <Button
            variant="contained"
            startIcon={isDispatching ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
            disabled={isDispatching || selectedIds.length === 0 || !prompt.trim()}
            onClick={handleRunOnSelected}
            sx={{ whiteSpace: 'nowrap', minWidth: 190 }}
          >
            Run on {selectedIds.length || 0}
          </Button>
        </Stack>
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
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, 1fr)',
              lg: 'repeat(3, 1fr)',
              xl: 'repeat(4, 1fr)',
            },
          }}
        >
          {devices.map((device) => {
            const state = runtime[device.id] ?? emptyRuntime;
            const isOnline = device.status === 'ONLINE';
            const isSelected = selectedIds.includes(device.id);

            return (
              <Card
                key={device.id}
                variant="outlined"
                sx={{
                  borderRadius: 2,
                  borderColor: isSelected ? 'primary.main' : undefined,
                  borderWidth: isSelected ? 2 : 1,
                  opacity: isOnline ? 1 : 0.65,
                  transition: 'border-color .15s ease',
                }}
              >
                {/* Card header */}
                <Stack direction="row" alignItems="center" gap={0.5} sx={{ px: 1, pt: 1 }}>
                  <Checkbox
                    size="small"
                    checked={isSelected}
                    disabled={!isOnline}
                    onChange={() => toggleDevice(device.id)}
                  />
                  <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                    <Typography variant="body2" noWrap sx={{ fontWeight: 700 }}>
                      {device.device_name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {device.device_model || device.device_id}
                    </Typography>
                  </Box>
                  <Chip
                    size="small"
                    label={isOnline ? 'ONLINE' : 'OFFLINE'}
                    color={isOnline ? 'success' : 'default'}
                    sx={{ height: 20, fontSize: 10, fontWeight: 700 }}
                  />
                </Stack>

                {state.isRunning && <LinearProgress sx={{ mt: 1 }} />}

                {/* Live screen */}
                <Box
                  onClick={() => navigate(`/android-agent?deviceId=${device.id}`)}
                  sx={{
                    m: 1,
                    borderRadius: 1.5,
                    overflow: 'hidden',
                    bgcolor: 'grey.900',
                    aspectRatio: '9 / 16',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                  }}
                >
                  {state.screenshot ? (
                    <Box
                      component="img"
                      src={`data:image/jpeg;base64,${state.screenshot}`}
                      alt={device.device_name}
                      sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
                    />
                  ) : (
                    <Stack alignItems="center" gap={1} sx={{ color: 'grey.500' }}>
                      <PhoneAndroidIcon />
                      <Typography variant="caption">No frame yet</Typography>
                    </Stack>
                  )}
                </Box>

                <Divider />

                {/* Status footer */}
                <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
                  {state.isRunning ? (
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
                        sx={{
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
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
              </Card>
            );
          })}
        </Box>
      )}
    </Box>
  );
}
