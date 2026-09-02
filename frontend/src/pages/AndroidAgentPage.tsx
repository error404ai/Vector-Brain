import {
  useCancelAndroidTaskMutation,
  useGetAndroidDevicesQuery,
  useGetAndroidTasksQuery,
  useLazyGetActiveAndroidTaskQuery,
  useLazyGetAndroidTaskLogsQuery,
  useRunAndroidTaskMutation,
  type AndroidTaskLog,
} from '@/RTKService/androidService/androidService';
import { useGetAiConfigsQuery } from '@/RTKService/aiConfigService/aiConfigService';
import authManager from '@/_helpers/authManager';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ClearAllIcon from '@mui/icons-material/ClearAll';
import HistoryIcon from '@mui/icons-material/History';
import PersonIcon from '@mui/icons-material/Person';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import PsychologyIcon from '@mui/icons-material/Psychology';
import SendIcon from '@mui/icons-material/Send';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import StopCircleIcon from '@mui/icons-material/StopCircle';
import TouchAppIcon from '@mui/icons-material/TouchApp';
import {
  Alert,
  alpha,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  ListItemText,
  Menu,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import toast from 'react-hot-toast';
import { useNavigate, useSearchParams } from 'react-router-dom';

export interface StepUpdate {
  stepIndex: number;
  thought: string;
  action?: { type?: string; packageName?: string; [key: string]: unknown };
  screenshot?: string;
  foregroundApp?: string;
  durationMs?: number;
  status?: 'EXECUTING' | 'SUCCESS' | 'FAILED';
  result?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  steps?: StepUpdate[];
  status?: 'running' | 'done' | 'error' | 'cancelled';
  screenshot?: string;
  taskId?: number;
}

interface ApiMutationError {
  data?: { message?: string };
}

// Approximate USD price per 1M tokens. Adjust to match your provider's actual rates.
const MODEL_PRICING: Record<string, { in: number; out: number }> = {
  'deepseek-v4-flash': { in: 0.28, out: 0.42 },
  'gemini-2.5-flash': { in: 0.3, out: 2.5 },
  'qwen3.7-flash': { in: 0.2, out: 0.6 },
  'nemotron-3.5-lightning': { in: 0.1, out: 0.3 },
  'minimax-m3': { in: 0.2, out: 0.6 },
  default: { in: 0.3, out: 1.0 },
};

const priceFor = (model?: string): { in: number; out: number } => {
  if (!model) return MODEL_PRICING.default;
  if (model.includes(':free')) return { in: 0, out: 0 };
  const key = Object.keys(MODEL_PRICING).find((k) => k !== 'default' && model.includes(k));
  return key ? MODEL_PRICING[key] : MODEL_PRICING.default;
};

// Rough char-per-token ratio used for the live estimate.
const CHARS_PER_TOKEN = 4;
// Approximate size of the constant part of every request (system prompt + tool schemas).
const BASE_PROMPT_CHARS = 4000;


/**
 * Renders an action result. The raw "UPDATED SCREEN ELEMENTS" dump is huge and
 * only useful for debugging, so only the human-readable first line is shown and
 * the rest is hidden behind a toggle.
 */
function StepResult({ result, failed }: { result: string; failed?: boolean }) {
  const [expanded, setExpanded] = useState(false);

  const splitAt = result.search(/(UPDATED SCREEN ELEMENTS|VISIBLE UI ELEMENTS|CURRENT APP:)/);
  const summary = (splitAt > 0 ? result.slice(0, splitAt) : result).trim();
  const details = splitAt > 0 ? result.slice(splitAt).trim() : '';

  return (
    <Box sx={{ mt: 0.5 }}>
      <Typography variant="caption" color={failed ? 'error' : 'text.secondary'} sx={{ display: 'block' }}>
        {summary || (failed ? 'Action failed' : 'Action completed')}
      </Typography>

      {details && (
        <>
          <Button
            size="small"
            onClick={() => setExpanded((prev) => !prev)}
            sx={{ mt: 0.25, px: 0.5, minWidth: 0, fontSize: 10, textTransform: 'none' }}
          >
            {expanded ? 'Hide screen details' : `Screen details (${Math.round(details.length / 100) / 10}k chars)`}
          </Button>
          {expanded && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                display: 'block',
                mt: 0.5,
                p: 1,
                borderRadius: 1,
                bgcolor: 'action.hover',
                fontFamily: 'monospace',
                fontSize: 10,
                maxHeight: 220,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {details}
            </Typography>
          )}
        </>
      )}
    </Box>
  );
}

export function AndroidAgentPage() {
  const theme = useTheme();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const initialDeviceId = searchParams.get('deviceId') ? Number(searchParams.get('deviceId')) : undefined;

  const { data: devicesData } = useGetAndroidDevicesQuery(undefined, { pollingInterval: 5_000 });
  const devices = useMemo(() => devicesData?.data || [], [devicesData?.data]);

  const { data: aiConfigsData } = useGetAiConfigsQuery();
  const activeAiConfig = useMemo(() => aiConfigsData?.data?.find((c) => c.is_active), [aiConfigsData?.data]);

  const [selectedDeviceId, setSelectedDeviceId] = useState<number | undefined>(initialDeviceId);
  const [promptInput, setPromptInput] = useState('');
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [latestScreenshot, setLatestScreenshot] = useState<string | null>(null);

  // Live token / cost estimation for the current session
  const [tokenStats, setTokenStats] = useState({ promptTokens: 0, completionTokens: 0 });
  const contextCharsRef = useRef(0);

  // Conversational Chat Messages List (BrowserWorker Style)
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const [runTask, { isLoading: isStartingTask }] = useRunAndroidTaskMutation();
  const [cancelTask, { isLoading: isCancelling }] = useCancelAndroidTaskMutation();
  const [fetchTaskLogs] = useLazyGetAndroidTaskLogsQuery();
  const [fetchActiveTask] = useLazyGetActiveAndroidTaskQuery();

  // History menu
  const [historyAnchor, setHistoryAnchor] = useState<null | HTMLElement>(null);
  const [isRestoring, setIsRestoring] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Live copy of the selected device id so the WebSocket handler (registered once)
  // can ignore events belonging to other devices.
  const selectedDeviceIdRef = useRef<number | undefined>(undefined);
  const selectedDeviceHardwareIdRef = useRef<string | undefined>(undefined);
  const restoredForDeviceRef = useRef<number | undefined>(undefined);

  const effectiveSelectedDeviceId =
    selectedDeviceId ?? devices.find((device) => device.status === 'ONLINE')?.id ?? devices[0]?.id;
  const selectedDevice = devices.find((device) => device.id === effectiveSelectedDeviceId);
  selectedDeviceIdRef.current = effectiveSelectedDeviceId;
  selectedDeviceHardwareIdRef.current = selectedDevice?.device_id;
  const isDeviceOnline = selectedDevice?.status === 'ONLINE';
  const hasAccessibility = selectedDevice?.capabilities?.accessibility === true;
  const hasScreenCapture = selectedDevice?.capabilities?.screenCapture === true;
  const deviceReady = isDeviceOnline && hasAccessibility && hasScreenCapture;

  // Derived live usage estimate
  const usageEstimate = useMemo(() => {
    const totalTokens = tokenStats.promptTokens + tokenStats.completionTokens;
    const price = priceFor(activeAiConfig?.model);
    const cost =
      (tokenStats.promptTokens / 1_000_000) * price.in + (tokenStats.completionTokens / 1_000_000) * price.out;
    return { totalTokens, cost };
  }, [tokenStats, activeAiConfig?.model]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Connect to Vector-Brain WebSocket for live reactive streaming
  useEffect(() => {
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const handleMessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);

        // With several devices running at once, only render events for the
        // device this page is currently showing.
        const eventDeviceId = msg.payload?.deviceId;
        const currentDeviceId = selectedDeviceIdRef.current;
        if (
          msg.event !== 'device:screen_capture' &&
          typeof eventDeviceId === 'number' &&
          typeof currentDeviceId === 'number' &&
          eventDeviceId !== currentDeviceId
        ) {
          return;
        }

        if (msg.event === 'task:started') {
          setIsRunning(true);
          setActiveTaskId(msg.payload.taskId);
          if (msg.payload.screenshot) {
            setLatestScreenshot(msg.payload.screenshot);
          }
        } else if (msg.event === 'device:screen_capture') {
          // This event carries the hardware device id, so match it separately.
          const hardwareId = msg.payload?.deviceId;
          const belongsToSelected = !hardwareId || hardwareId === selectedDeviceHardwareIdRef.current;
          const capture = msg.payload?.result?.screenCapture?.base64Data;
          if (capture && belongsToSelected) setLatestScreenshot(capture);
        } else if (msg.event === 'task:step') {
          const step = msg.payload;

          // Estimate tokens: every step re-sends the accumulated context to the model.
          const promptChars = BASE_PROMPT_CHARS + contextCharsRef.current;
          const thoughtLen = typeof step.thought === 'string' ? step.thought.length : 0;
          contextCharsRef.current += thoughtLen;
          setTokenStats((prev) => ({
            promptTokens: prev.promptTokens + Math.round(promptChars / CHARS_PER_TOKEN),
            completionTokens: prev.completionTokens + Math.round(thoughtLen / CHARS_PER_TOKEN),
          }));

          if (step.screenshot) {
            setLatestScreenshot(step.screenshot);
          }

          setMessages((prev) => {
            if (prev.length === 0) return prev;
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            const lastMsg = updated[lastIdx];

            if (lastMsg.role === 'assistant') {
              const currentSteps = lastMsg.steps || [];
              const exists = currentSteps.find((s) => s.stepIndex === step.stepIndex);
              const newSteps = exists
                ? currentSteps.map((s) => (s.stepIndex === step.stepIndex ? { ...s, ...step, status: 'EXECUTING' as const } : s))
                : [
                    ...currentSteps,
                    {
                      stepIndex: step.stepIndex,
                      thought: step.thought,
                      action: step.action,
                      screenshot: step.screenshot,
                      foregroundApp: step.foregroundApp,
                      status: 'EXECUTING' as const,
                    },
                  ];

              updated[lastIdx] = {
                ...lastMsg,
                steps: newSteps,
                screenshot: step.screenshot || lastMsg.screenshot,
                status: 'running',
              };
            }
            return updated;
          });
        } else if (msg.event === 'task:step_result') {
          const result = msg.payload;

          // The tool result text becomes part of the context for every later step.
          contextCharsRef.current += typeof result.result === 'string' ? result.result.length : 0;

          if (result.screenshot) {
            setLatestScreenshot(result.screenshot);
          }

          setMessages((prev) => {
            if (prev.length === 0) return prev;
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            const lastMsg = updated[lastIdx];

            if (lastMsg.role === 'assistant' && lastMsg.steps) {
              const updatedSteps = lastMsg.steps.map((s) =>
                s.stepIndex === result.stepIndex
                  ? {
                      ...s,
                      status: result.status,
                      result: result.result || result.error,
                      screenshot: result.screenshot || s.screenshot,
                    }
                  : s,
              );

              updated[lastIdx] = {
                ...lastMsg,
                steps: updatedSteps,
                screenshot: result.screenshot || lastMsg.screenshot,
              };
            }
            return updated;
          });
        } else if (msg.event === 'task:completed') {
          if (msg.payload.screenshot) {
            setLatestScreenshot(msg.payload.screenshot);
          }
          setIsRunning(false);
          setActiveTaskId(null);

          setMessages((prev) => {
            if (prev.length === 0) return prev;
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            const lastMsg = updated[lastIdx];

            if (lastMsg.role === 'assistant') {
              updated[lastIdx] = {
                ...lastMsg,
                content: msg.payload.message || (msg.payload.success ? 'Task completed successfully.' : 'Task ended.'),
                status: msg.payload.success ? 'done' : 'error',
                screenshot: msg.payload.screenshot || lastMsg.screenshot,
              };
            }
            return updated;
          });

          if (msg.payload.success) {
            toast.success(msg.payload.message || 'Task completed successfully');
          } else {
            toast.error(msg.payload.message || 'Task completed with errors');
          }
        } else if (msg.event === 'task:cancelled') {
          setIsRunning(false);
          setActiveTaskId(null);

          setMessages((prev) => {
            if (prev.length === 0) return prev;
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            const lastMsg = updated[lastIdx];

            if (lastMsg.role === 'assistant') {
              updated[lastIdx] = {
                ...lastMsg,
                content: 'Task was cancelled by user.',
                status: 'cancelled',
              };
            }
            return updated;
          });

          toast('Task was cancelled', { icon: '🛑' });
        } else if (msg.event === 'task:error') {
          setIsRunning(false);
          setActiveTaskId(null);

          setMessages((prev) => {
            if (prev.length === 0) return prev;
            const updated = [...prev];
            const lastIdx = updated.length - 1;
            const lastMsg = updated[lastIdx];

            if (lastMsg.role === 'assistant') {
              updated[lastIdx] = {
                ...lastMsg,
                content: `Error: ${msg.payload.error || 'Execution failed'}`,
                status: 'error',
              };
            }
            return updated;
          });

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

  const handleSendPrompt = async (textToSend?: string) => {
    const text = (textToSend ?? promptInput).trim();
    if (!text) return;

    if (!activeAiConfig && !aiConfigsData?.data?.length) {
      toast.error('Please configure your AI provider in Settings first');
      navigate('/settings');
      return;
    }
    if (!effectiveSelectedDeviceId) {
      toast.error('Please select an Android device');
      return;
    }
    if (!deviceReady) {
      toast.error('Selected device is not ready for automation');
      return;
    }

    const userMsgId = `user-${Date.now()}`;
    const assistantMsgId = `asst-${Date.now() + 1}`;

    const userMsg: ChatMessage = {
      id: userMsgId,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };

    const assistantPlaceholder: ChatMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: 'Planning and executing workflow on device...',
      timestamp: Date.now(),
      steps: [],
      status: 'running',
    };

    setMessages((prev) => [...prev, userMsg, assistantPlaceholder]);
    setPromptInput('');
    setIsRunning(true);

    try {
      const res = await runTask({
        device_id: effectiveSelectedDeviceId,
        prompt: text,
        task_id: activeTaskId || undefined,
      }).unwrap();

      setActiveTaskId(res.data.taskId);
    } catch (err: unknown) {
      setIsRunning(false);
      const errMsg = (err as ApiMutationError)?.data?.message || 'Failed to dispatch task';
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantMsgId ? { ...m, content: `Error: ${errMsg}`, status: 'error' } : m)),
      );
      toast.error(errMsg);
    }
  };

  const handleCancel = async () => {
    if (!activeTaskId) {
      setIsRunning(false);
      return;
    }
    try {
      await cancelTask(activeTaskId).unwrap();
      setIsRunning(false);
      setActiveTaskId(null);
      toast.success('Task stopped');
    } catch (err: unknown) {
      setIsRunning(false);
      setActiveTaskId(null);
      toast.error((err as ApiMutationError)?.data?.message || 'Failed to cancel task');
    }
  };

  const handleClearChat = () => {
    if (isRunning) {
      toast.error('Cannot clear conversation while task is running');
      return;
    }
    setMessages([]);
    setActiveTaskId(null);
    setTokenStats({ promptTokens: 0, completionTokens: 0 });
    contextCharsRef.current = 0;
    toast.success('Conversation cleared');
  };

  return (
    <Box sx={{ maxWidth: 1440, mx: 'auto', p: { xs: 1, sm: 2 } }}>
      <Helmet>
        <title>Android Agent — Vector Brain</title>
      </Helmet>

      {/* Missing AI Config Warning Banner */}
      {!activeAiConfig && aiConfigsData && (
        <Alert
          severity="warning"
          variant="filled"
          sx={{ mb: 2, borderRadius: 2 }}
          action={
            <Button color="inherit" size="small" onClick={() => navigate('/settings')}>
              Configure Now
            </Button>
          }
        >
          No active AI Provider configured. Please add and activate your AI model in Settings to execute automation tasks.
        </Alert>
      )}

      {/* Top Header Card */}
      <Card sx={{ mb: 2.5, borderRadius: 3, border: '1px solid', borderColor: 'divider', boxShadow: 'none' }}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            justifyContent="space-between"
            alignItems={{ xs: 'flex-start', sm: 'center' }}
            spacing={2}
          >
            {/* Device & Status Selector */}
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ width: { xs: '100%', sm: 'auto' } }}>
              <Select
                size="small"
                value={effectiveSelectedDeviceId || ''}
                onChange={(e) => setSelectedDeviceId(Number(e.target.value))}
                displayEmpty
                disabled={isRunning}
                sx={{ minWidth: 200, fontWeight: 700, borderRadius: 2 }}
              >
                {devices.map((d) => (
                  <MenuItem key={d.id} value={d.id}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          bgcolor: d.status === 'ONLINE' ? 'success.main' : 'grey.400',
                        }}
                      />
                      <Typography variant="body2" fontWeight={700}>
                        {d.device_name}
                      </Typography>
                    </Stack>
                  </MenuItem>
                ))}
              </Select>

              {selectedDevice && (
                <Chip
                  label={deviceReady ? 'Ready' : isDeviceOnline ? 'Service Needed' : 'Offline'}
                  size="small"
                  color={deviceReady ? 'success' : isDeviceOnline ? 'warning' : 'default'}
                  variant="outlined"
                  sx={{ fontWeight: 800, height: 26 }}
                />
              )}
            </Stack>

            {/* Active Model Indicator & Actions */}
            <Stack direction="row" spacing={1} alignItems="center" sx={{ width: { xs: '100%', sm: 'auto' } }}>
              {activeAiConfig && (
                <Chip
                  icon={<PsychologyIcon fontSize="small" />}
                  label={`${activeAiConfig.provider.toUpperCase()} : ${activeAiConfig.model}`}
                  size="small"
                  color="primary"
                  variant="outlined"
                  onClick={() => navigate('/settings')}
                  sx={{ fontWeight: 700, cursor: 'pointer', height: 28 }}
                />
              )}

              {usageEstimate.totalTokens > 0 && (
                <Chip
                  label={`≈ ${(usageEstimate.totalTokens / 1000).toFixed(1)}K tok · $${usageEstimate.cost.toFixed(3)}`}
                  size="small"
                  variant="outlined"
                  color={isRunning ? 'warning' : 'default'}
                  title={`Estimated usage — prompt: ${tokenStats.promptTokens.toLocaleString()} tokens, completion: ${tokenStats.completionTokens.toLocaleString()} tokens`}
                  sx={{ fontWeight: 700, height: 28, fontVariantNumeric: 'tabular-nums' }}
                />
              )}

              {isRunning ? (
                <Button
                  variant="contained"
                  color="error"
                  size="small"
                  startIcon={isCancelling ? <CircularProgress size={14} color="inherit" /> : <StopCircleIcon />}
                  onClick={handleCancel}
                  disabled={isCancelling}
                  sx={{ borderRadius: 2, fontWeight: 700, px: 2 }}
                >
                  Emergency Stop
                </Button>
              ) : (
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<ClearAllIcon />}
                  onClick={handleClearChat}
                  disabled={messages.length === 0}
                  sx={{ borderRadius: 2, fontWeight: 600 }}
                >
                  New Session
                </Button>
              )}
            </Stack>
          </Stack>
        </CardContent>
      </Card>

      {/* Main Split Layout: Left Phone Mockup, Right Conversational Feed */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', lg: '380px 1fr' },
          gap: 3,
          alignItems: 'flex-start',
        }}
      >
        {/* Left Sticky Column: Live Phone Mockup */}
        <Box sx={{ position: { lg: 'sticky' }, top: { lg: 20 } }}>
          <Card sx={{ borderRadius: 3, border: '1px solid', borderColor: 'divider', overflow: 'hidden' }}>
            <Box
              sx={{
                p: 2,
                bgcolor: alpha(theme.palette.primary.main, 0.04),
                borderBottom: '1px solid',
                borderColor: 'divider',
              }}
            >
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Stack direction="row" spacing={1} alignItems="center">
                  <PhoneAndroidIcon fontSize="small" color="primary" />
                  <Typography variant="subtitle2" fontWeight={800}>
                    Live Screen View
                  </Typography>
                </Stack>
                {isRunning && (
                  <Chip
                    label="STREAMING"
                    size="small"
                    color="error"
                    sx={{ height: 20, fontSize: 9, fontWeight: 900, animation: 'pulse 1.5s infinite' }}
                  />
                )}
              </Stack>
            </Box>

            <CardContent sx={{ p: 2.5, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              {/* Phone Frame */}
              <Box
                sx={{
                  width: '100%',
                  maxWidth: 310,
                  aspectRatio: '9 / 19',
                  bgcolor: '#090a0f',
                  borderRadius: 6,
                  border: '7px solid #1e2230',
                  boxShadow: '0 16px 40px rgba(0,0,0,0.35)',
                  overflow: 'hidden',
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {latestScreenshot ? (
                  <img
                    src={`data:image/jpeg;base64,${latestScreenshot}`}
                    alt="Android Live Stream"
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                ) : (
                  <Stack spacing={1.5} alignItems="center" sx={{ p: 3, textAlign: 'center' }}>
                    <PhoneAndroidIcon sx={{ fontSize: 48, color: 'text.disabled' }} />
                    <Typography variant="caption" color="text.secondary">
                      {!isDeviceOnline
                        ? 'Device is offline'
                        : !hasScreenCapture
                          ? 'Enable screen capture in the companion app'
                          : 'Live frame updates automatically when agent interacts'}
                    </Typography>
                  </Stack>
                )}
              </Box>

              <Typography variant="caption" color="text.secondary" sx={{ mt: 2, textAlign: 'center' }}>
                Secure on-demand frames via MediaProjection & Accessibility
              </Typography>
            </CardContent>
          </Card>
        </Box>

        {/* Right Column: BrowserWorker Conversational Agent Feed */}
        <Card
          sx={{
            borderRadius: 3,
            border: '1px solid',
            borderColor: 'divider',
            minHeight: 650,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Conversation Feed Header */}
          <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Stack direction="row" spacing={1} alignItems="center">
                <AutoAwesomeIcon fontSize="small" color="primary" />
                <Typography variant="subtitle2" fontWeight={800}>
                  Agent Conversation & Autonomous Steps
                </Typography>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {messages.length ? `${messages.length} conversation turns` : 'Ready to start'}
              </Typography>
            </Stack>
          </Box>

          {/* Messages Scroll Area */}
          <Box
            sx={{
              p: 2.5,
              flexGrow: 1,
              maxHeight: 'calc(100vh - 340px)',
              minHeight: 450,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 2.5,
            }}
          >
            {messages.length === 0 ? (
              <Box sx={{ py: 8, textAlign: 'center' }}>
                <SmartToyIcon sx={{ fontSize: 56, color: 'primary.main', mb: 1.5, opacity: 0.8 }} />
                <Typography variant="h6" fontWeight={800} color="text.primary">
                  How can I help with your Android phone?
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 460, mx: 'auto', mt: 1 }}>
                  Type a goal or command below. The AI agent will inspect the live screen, execute navigation and clicks,
                  and keep you updated step-by-step.
                </Typography>

                {/* Quick Action Suggestion Chips */}
                <Stack direction="row" spacing={1} sx={{ mt: 3, flexWrap: 'wrap', justifyContent: 'center', gap: 1 }}>
                  {[
                    'Open Chrome and go to google.com',
                    'Open YouTube and search for Lo-Fi Beats',
                    'Open Settings and check Battery',
                    'Open Clock and check alarms',
                  ].map((preset) => (
                    <Chip
                      key={preset}
                      label={preset}
                      clickable={!isRunning && deviceReady}
                      onClick={() => handleSendPrompt(preset)}
                      variant="outlined"
                      sx={{
                        borderRadius: 2,
                        fontWeight: 600,
                        py: 2,
                        '&:hover': { borderColor: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.05) },
                      }}
                    />
                  ))}
                </Stack>
              </Box>
            ) : (
              messages.map((msg) => (
                <Box
                  key={msg.id}
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  }}
                >
                  {/* User Message Bubble */}
                  {msg.role === 'user' ? (
                    <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ maxWidth: '85%' }}>
                      <Paper
                        elevation={0}
                        sx={{
                          p: 2,
                          borderRadius: '16px 16px 4px 16px',
                          bgcolor: 'primary.main',
                          color: 'primary.contrastText',
                          boxShadow: '0 4px 12px rgba(79, 70, 229, 0.25)',
                        }}
                      >
                        <Typography variant="body1" fontWeight={600} sx={{ whiteSpace: 'pre-wrap' }}>
                          {msg.content}
                        </Typography>
                      </Paper>
                      <Avatar sx={{ width: 32, height: 32, bgcolor: 'primary.dark' }}>
                        <PersonIcon fontSize="small" />
                      </Avatar>
                    </Stack>
                  ) : (
                    /* Assistant Agent Card (BrowserWorker Style) */
                    <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ width: '100%', maxWidth: '100%' }}>
                      <Avatar sx={{ width: 32, height: 32, bgcolor: alpha(theme.palette.primary.main, 0.15), color: 'primary.main' }}>
                        <SmartToyIcon fontSize="small" />
                      </Avatar>

                      <Paper
                        elevation={0}
                        sx={{
                          p: 2.5,
                          width: '100%',
                          borderRadius: '16px 16px 16px 4px',
                          border: '1px solid',
                          borderColor: alpha(theme.palette.divider, 0.8),
                          bgcolor: alpha(theme.palette.background.paper, 0.6),
                        }}
                      >
                        {/* Status Header */}
                        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
                          <Typography variant="subtitle2" fontWeight={800} color="primary">
                            Android Autonomous Agent
                          </Typography>
                          {msg.status === 'running' ? (
                            <Chip
                              icon={<CircularProgress size={12} color="inherit" />}
                              label="Executing..."
                              size="small"
                              color="primary"
                              sx={{ fontWeight: 700, height: 22 }}
                            />
                          ) : msg.status === 'done' ? (
                            <Chip
                              icon={<CheckCircleIcon />}
                              label="Completed"
                              size="small"
                              color="success"
                              variant="outlined"
                              sx={{ fontWeight: 700, height: 22 }}
                            />
                          ) : msg.status === 'cancelled' ? (
                            <Chip label="Cancelled" size="small" color="warning" variant="outlined" sx={{ fontWeight: 700, height: 22 }} />
                          ) : (
                            <Chip label="Failed" size="small" color="error" variant="outlined" sx={{ fontWeight: 700, height: 22 }} />
                          )}
                        </Stack>

                        {/* Step Execution Timeline (BrowserWorker Style Action Cards) */}
                        {msg.steps && msg.steps.length > 0 && (
                          <Stack spacing={1.5} sx={{ my: 1.5 }}>
                            {msg.steps.map((step) => (
                              <Paper
                                key={step.stepIndex}
                                elevation={0}
                                sx={{
                                  p: 1.5,
                                  borderRadius: 2,
                                  border: '1px solid',
                                  borderColor: alpha(theme.palette.primary.main, 0.15),
                                  bgcolor: alpha(theme.palette.background.paper, 0.9),
                                }}
                              >
                                <Stack direction="row" justifyContent="space-between" alignItems="center">
                                  <Stack direction="row" spacing={1} alignItems="center">
                                    <Chip
                                      label={`Step ${step.stepIndex}`}
                                      size="small"
                                      color="primary"
                                      sx={{ fontWeight: 800, height: 20, fontSize: 10 }}
                                    />
                                    {step.action?.type && (
                                      <Chip
                                        icon={<TouchAppIcon sx={{ fontSize: 13 }} />}
                                        label={`${step.action.type}${step.action.packageName ? `: ${step.action.packageName}` : ''}`}
                                        size="small"
                                        variant="outlined"
                                        sx={{ fontWeight: 700, height: 20, fontSize: 11 }}
                                      />
                                    )}
                                  </Stack>
                                  <Chip
                                    label={step.status === 'EXECUTING' ? 'Executing' : step.status === 'FAILED' ? 'Failed' : 'Success'}
                                    size="small"
                                    color={step.status === 'FAILED' ? 'error' : step.status === 'EXECUTING' ? 'warning' : 'success'}
                                    variant="outlined"
                                    sx={{ height: 18, fontSize: 9, fontWeight: 800 }}
                                  />
                                </Stack>

                                {/* Reasoning thought */}
                                <Typography variant="body2" sx={{ mt: 1, fontWeight: 500, color: 'text.primary', lineHeight: 1.5 }}>
                                  💭 {step.thought}
                                </Typography>

                                {step.result && <StepResult result={step.result} failed={step.status === 'FAILED'} />}
                              </Paper>
                            ))}
                          </Stack>
                        )}

                        {/* Summary / Reply Text */}
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, fontWeight: 600 }}>
                          {msg.content}
                        </Typography>
                      </Paper>
                    </Stack>
                  )}
                </Box>
              ))
            )}
            <div ref={chatEndRef} />
          </Box>

          {/* Sticky Bottom Prompt & Follow-up Input Bar */}
          <Box
            sx={{
              p: 2,
              borderTop: '1px solid',
              borderColor: 'divider',
              bgcolor: alpha(theme.palette.background.paper, 0.95),
            }}
          >
            {/* Suggestion Chips when in-between actions */}
            {!isRunning && messages.length > 0 && (
              <Stack direction="row" spacing={1} sx={{ mb: 1.5, overflowX: 'auto', pb: 0.5 }}>
                <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center', mr: 0.5 }}>
                  Follow-up:
                </Typography>
                {[
                  'Go to Home screen',
                  'Scroll down',
                  'Tap on the first search result',
                  'Take a screenshot',
                ].map((followup) => (
                  <Chip
                    key={followup}
                    label={followup}
                    size="small"
                    variant="outlined"
                    onClick={() => handleSendPrompt(followup)}
                    sx={{ fontSize: 11, borderRadius: 1.5, cursor: 'pointer' }}
                  />
                ))}
              </Stack>
            )}

            <Stack direction="row" spacing={1.5} alignItems="center">
              <TextField
                inputRef={inputRef}
                fullWidth
                size="small"
                placeholder={
                  isRunning
                    ? 'Agent is currently executing actions...'
                    : messages.length === 0
                      ? 'Type an Android task (e.g. Open YouTube and search for Jazz mix)...'
                      : 'Type a follow-up instruction (e.g. Now tap the second video)...'
                }
                value={promptInput}
                onChange={(e) => setPromptInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !isRunning && deviceReady) {
                    e.preventDefault();
                    handleSendPrompt();
                  }
                }}
                disabled={isRunning || !deviceReady}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 3,
                    bgcolor: alpha(theme.palette.background.default, 0.6),
                  },
                }}
              />

              {isRunning ? (
                <Button
                  variant="contained"
                  color="error"
                  onClick={handleCancel}
                  disabled={isCancelling}
                  startIcon={isCancelling ? <CircularProgress size={16} color="inherit" /> : <StopCircleIcon />}
                  sx={{ borderRadius: 3, px: 2.5, height: 40, fontWeight: 700 }}
                >
                  Stop
                </Button>
              ) : (
                <Button
                  variant="contained"
                  onClick={() => handleSendPrompt()}
                  disabled={!promptInput.trim() || isStartingTask || !deviceReady}
                  endIcon={isStartingTask ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
                  sx={{
                    borderRadius: 3,
                    px: 2.5,
                    height: 40,
                    fontWeight: 700,
                    background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
                  }}
                >
                  Send
                </Button>
              )}
            </Stack>
          </Box>
        </Card>
      </Box>
    </Box>
  );
}

export default AndroidAgentPage;
