import {
  useCancelAndroidTaskMutation,
  useGetAndroidDevicesQuery,
  useRunAndroidTaskMutation,
} from '@/RTKService/androidService/androidService';
import authManager from '@/_helpers/authManager';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopCircleIcon from '@mui/icons-material/StopCircle';
import TouchAppIcon from '@mui/icons-material/TouchApp';
import {
  alpha,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useSearchParams } from 'react-router-dom';

interface StepUpdate {
  stepIndex: number;
  thought: string;
  action?: { type?: string; packageName?: string; [key: string]: unknown };
  screenshot?: string;
  foregroundApp?: string;
  durationMs?: number;
  status?: 'EXECUTING' | 'SUCCESS' | 'FAILED';
  result?: string;
}

interface ApiMutationError {
  data?: { message?: string };
}

export function AndroidAgentPage() {
  const theme = useTheme();
  const [searchParams] = useSearchParams();
  const initialDeviceId = searchParams.get('deviceId') ? Number(searchParams.get('deviceId')) : undefined;

  const { data: devicesData } = useGetAndroidDevicesQuery();
  const devices = useMemo(() => devicesData?.data || [], [devicesData?.data]);

  const [selectedDeviceId, setSelectedDeviceId] = useState<number | undefined>(initialDeviceId);
  const [promptInput, setPromptInput] = useState('');
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [steps, setSteps] = useState<StepUpdate[]>([]);
  const [latestScreenshot, setLatestScreenshot] = useState<string | null>(null);

  const [runTask, { isLoading: isStartingTask }] = useRunAndroidTaskMutation();
  const [cancelTask, { isLoading: isCancelling }] = useCancelAndroidTaskMutation();

  const wsRef = useRef<WebSocket | null>(null);
  const stepsEndRef = useRef<HTMLDivElement | null>(null);

  const effectiveSelectedDeviceId =
    selectedDeviceId ?? devices.find((device) => device.status === 'ONLINE')?.id ?? devices[0]?.id;

  // Connect to Vector-Brain WebSocket for live reactive streaming
  useEffect(() => {
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);

        if (msg.event === 'task:started') {
          setIsRunning(true);
          setActiveTaskId(msg.payload.taskId);
          setSteps([]);
        } else if (msg.event === 'task:step') {
          const step = msg.payload;
          if (step.screenshot) {
            setLatestScreenshot(step.screenshot);
          }
          setSteps((prev) => [
            ...prev,
            {
              stepIndex: step.stepIndex,
              thought: step.thought,
              action: step.action,
              screenshot: step.screenshot,
              foregroundApp: step.foregroundApp,
              status: 'EXECUTING',
            },
          ]);
        } else if (msg.event === 'task:step_result') {
          const result = msg.payload;
          setSteps((previous) =>
            previous.map((step) =>
              step.stepIndex === result.stepIndex
                ? {
                    ...step,
                    status: result.status,
                    result: result.result || result.error,
                  }
                : step,
            ),
          );
        } else if (msg.event === 'task:completed') {
          setIsRunning(false);
          if (msg.payload.success) {
            toast.success(msg.payload.message || 'Task completed successfully');
          } else {
            toast.error(msg.payload.message || 'Task did not complete');
          }
        } else if (msg.event === 'task:cancelled') {
          setIsRunning(false);
          toast('Task was cancelled', { icon: '🛑' });
        } else if (msg.event === 'task:error') {
          setIsRunning(false);
          toast.error(msg.payload.error || 'Task failed');
        }
      } catch (err) {
        console.error('Error handling WS event:', err);
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
  }, []);

  // Auto-scroll trajectory logs
  useEffect(() => {
    stepsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [steps]);

  const handleStartTask = async () => {
    if (!effectiveSelectedDeviceId) {
      toast.error('Please select an Android device');
      return;
    }
    if (!promptInput.trim()) {
      toast.error('Please enter a task prompt');
      return;
    }

    try {
      setSteps([]);
      setIsRunning(true);
      const res = await runTask({
        device_id: effectiveSelectedDeviceId,
        prompt: promptInput,
      }).unwrap();

      setActiveTaskId(res.data.taskId);
      toast.success('Agent autonomous loop started');
    } catch (err: unknown) {
      setIsRunning(false);
      toast.error((err as ApiMutationError)?.data?.message || 'Failed to start task');
    }
  };

  const handleCancelTask = async () => {
    if (!activeTaskId) return;
    try {
      await cancelTask(activeTaskId).unwrap();
      setIsRunning(false);
    } catch (err: unknown) {
      toast.error((err as ApiMutationError)?.data?.message || 'Failed to cancel task');
    }
  };

  const selectedDevice = devices.find((d) => d.id === effectiveSelectedDeviceId);
  const isDeviceOnline = selectedDevice?.status === 'ONLINE';

  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto', p: { xs: 1, sm: 2 } }}>
      {/* Control Header Card */}
      <Card sx={{ mb: 3, borderRadius: 3, border: '1px solid', borderColor: 'divider' }}>
        <CardContent sx={{ p: 2.5 }}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', md: '240px 1fr 180px' },
              gap: 2,
              alignItems: 'center',
            }}
          >
            {/* Device Selector */}
            <Box>
              <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
                Target Device
              </Typography>
              <Select
                size="small"
                fullWidth
                value={effectiveSelectedDeviceId || ''}
                onChange={(e) => setSelectedDeviceId(Number(e.target.value))}
                displayEmpty
                disabled={isRunning}
              >
                {devices.map((d) => (
                  <MenuItem key={d.id} value={d.id}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: d.status === 'ONLINE' ? 'success.main' : 'grey.400' }} />
                      <Typography variant="body2" fontWeight={700}>
                        {d.device_name}
                      </Typography>
                    </Stack>
                  </MenuItem>
                ))}
              </Select>
            </Box>

            {/* Prompt Input */}
            <Box>
              <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
                Autonomous Goal Prompt
              </Typography>
              <TextField
                fullWidth
                size="small"
                placeholder="e.g. Open YouTube and search for Synthwave mix, or Open Settings and check Battery"
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !isRunning && isDeviceOnline) {
                    e.preventDefault();
                    handleStartTask();
                  }
                }}
                disabled={isRunning}
              />
            </Box>

            {/* Actions */}
            <Box sx={{ pt: { md: 2.5 } }}>
              {isRunning ? (
                <Button
                  fullWidth
                  variant="contained"
                  color="error"
                  startIcon={isCancelling ? <CircularProgress size={16} color="inherit" /> : <StopCircleIcon />}
                  onClick={handleCancelTask}
                  disabled={isCancelling}
                  sx={{ borderRadius: 2, fontWeight: 700 }}
                >
                  Emergency Stop
                </Button>
              ) : (
                <Button
                  fullWidth
                  variant="contained"
                  startIcon={isStartingTask ? <CircularProgress size={16} color="inherit" /> : <PlayArrowIcon />}
                  onClick={handleStartTask}
                  disabled={!isDeviceOnline || isStartingTask || !promptInput.trim()}
                  sx={{
                    borderRadius: 2,
                    fontWeight: 700,
                    background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                  }}
                >
                  Run Agent
                </Button>
              )}
            </Box>
          </Box>

          {/* Quick suggestions */}
          <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', gap: 1 }}>
            <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center', mr: 0.5 }}>
              Try:
            </Typography>
            {[
              'Open Settings and check Battery',
              'Open YouTube and search for Lo-Fi Beats',
              'Open Clock and set an alarm for 7 AM',
            ].map((suggest) => (
              <Chip
                key={suggest}
                label={suggest}
                size="small"
                variant="outlined"
                clickable={!isRunning}
                onClick={() => setPromptInput(suggest)}
                sx={{ fontSize: 11, borderRadius: 1.5 }}
              />
            ))}
          </Stack>
        </CardContent>
      </Card>

      {/* Main Workspace (Split View) */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '360px 1fr' },
          gap: 3,
        }}
      >
        {/* Left Column: Live Screen Frame */}
        <Box>
          <Card sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
            <Box sx={{ p: 2, bgcolor: alpha(theme.palette.primary.main, 0.04), borderBottom: '1px solid', borderColor: 'divider' }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Stack direction="row" spacing={1} alignItems="center">
                  <PhoneAndroidIcon fontSize="small" color="primary" />
                  <Typography variant="subtitle2" fontWeight={800}>
                    Device Screen View
                  </Typography>
                </Stack>
                {isRunning && (
                  <Chip
                    label="LIVE CAPTURE"
                    size="small"
                    color="error"
                    sx={{ height: 20, fontSize: 9, fontWeight: 900, animation: 'pulse 1.5s infinite' }}
                  />
                )}
              </Stack>
            </Box>

            <CardContent sx={{ p: 2, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              {/* Phone Mockup Frame */}
              <Box
                sx={{
                  width: '100%',
                  maxWidth: 290,
                  aspectRatio: '9 / 19',
                  bgcolor: '#090a0f',
                  borderRadius: 5,
                  border: '6px solid #1f232e',
                  boxShadow: '0 12px 36px rgba(0,0,0,0.3)',
                  overflow: 'hidden',
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {latestScreenshot ? (
                  <img
                    src={`data:image/png;base64,${latestScreenshot}`}
                    alt="Android Screen Frame"
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                ) : (
                  <Stack spacing={1.5} alignItems="center" sx={{ p: 3, textAlign: 'center' }}>
                    <PhoneAndroidIcon sx={{ fontSize: 48, color: 'text.disabled' }} />
                    <Typography variant="caption" color="text.secondary">
                      {isDeviceOnline ? 'Screen capture will appear when task starts' : 'Device is offline'}
                    </Typography>
                  </Stack>
                )}
              </Box>

              <Typography variant="caption" color="text.secondary" sx={{ mt: 2 }}>
                High-fidelity frames received via MediaProjection WebSocket stream
              </Typography>
            </CardContent>
          </Card>
        </Box>

        {/* Right Column: AI Reasoning & Trajectory Stream */}
        <Box>
          <Card sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', minHeight: 560 }}>
            <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Stack direction="row" spacing={1} alignItems="center">
                  <AutoAwesomeIcon fontSize="small" color="primary" />
                  <Typography variant="subtitle2" fontWeight={800}>
                    AI Autonomous Trajectory
                  </Typography>
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {steps.length} Steps Executed
                </Typography>
              </Stack>
            </Box>

            <CardContent sx={{ p: 2.5, maxHeight: 600, overflowY: 'auto' }}>
              {steps.length === 0 ? (
                <Box sx={{ py: 12, textAlign: 'center' }}>
                  <AutoAwesomeIcon sx={{ fontSize: 52, color: 'text.disabled', mb: 1.5 }} />
                  <Typography variant="subtitle1" fontWeight={700} color="text.primary">
                    Ready to Execute
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 420, mx: 'auto', mt: 0.5 }}>
                    Enter a prompt and launch the agent. Multimodal reasoning steps, UI tree evaluations, and atomic actions will stream live.
                  </Typography>
                </Box>
              ) : (
                <Stack spacing={2}>
                  {steps.map((step, idx) => (
                    <Paper
                      key={idx}
                      elevation={0}
                      sx={{
                        p: 2,
                        borderRadius: 2.5,
                        border: '1px solid',
                        borderColor: alpha(theme.palette.primary.main, 0.15),
                        bgcolor: alpha(theme.palette.background.paper, 0.8),
                      }}
                    >
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ mb: 1 }}>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Chip label={`Step ${step.stepIndex}`} size="small" color="primary" sx={{ fontWeight: 800, height: 22 }} />
                          {step.action?.type && (
                            <Chip
                              icon={<TouchAppIcon />}
                              label={`${step.action.type}${step.action.packageName ? `: ${step.action.packageName}` : ''}`}
                              size="small"
                              variant="outlined"
                              sx={{ fontWeight: 700, height: 22 }}
                            />
                          )}
                        </Stack>

                        <Chip
                          icon={<CheckCircleOutlineIcon />}
                          label={step.status === 'EXECUTING' ? 'Executing' : step.status === 'FAILED' ? 'Failed' : 'Executed'}
                          size="small"
                          color={step.status === 'FAILED' ? 'error' : step.status === 'EXECUTING' ? 'warning' : 'success'}
                          variant="outlined"
                          sx={{ height: 20, fontSize: 10, fontWeight: 700 }}
                        />
                      </Stack>

                      {/* AI Thought Bubble */}
                      <Typography variant="body2" color="text.primary" sx={{ mt: 1, fontWeight: 500, lineHeight: 1.6 }}>
                        💬 <strong>Reasoning:</strong> {step.thought}
                      </Typography>

                      {step.foregroundApp && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                          App: <code>{step.foregroundApp}</code>
                        </Typography>
                      )}
                      {step.result && (
                        <Typography variant="caption" color={step.status === 'FAILED' ? 'error' : 'text.secondary'} sx={{ display: 'block', mt: 0.5 }}>
                          Result: {step.result}
                        </Typography>
                      )}
                    </Paper>
                  ))}
                  <div ref={stepsEndRef} />
                </Stack>
              )}
            </CardContent>
          </Card>
        </Box>
      </Box>
    </Box>
  );
}

export default AndroidAgentPage;
