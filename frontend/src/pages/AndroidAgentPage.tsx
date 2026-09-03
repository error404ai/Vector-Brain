import {
  useCancelAndroidTaskMutation,
  useGetAndroidDevicesQuery,
  useGetAndroidTasksQuery,
  useClarifyPromptMutation,
  useLazyGetActiveAndroidTaskQuery,
  useLazyGetAndroidTaskLogsQuery,
  useLazyGetAndroidTasksQuery,
  useRunAndroidTaskMutation,
  type AndroidTaskLog,
} from '@/RTKService/androidService/androidService';
import { useGetAiConfigsQuery } from '@/RTKService/aiConfigService/aiConfigService';
import authManager from '@/_helpers/authManager';
import { explainError } from '@/utils/errorExplain';
import { getModelMeta, sortModelsForDisplay } from '@/utils/modelMeta';
import { verifyResultClaims } from '@/utils/verifyResult';
import SearchIcon from '@mui/icons-material/Search';
import StarIcon from '@mui/icons-material/Star';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AgentMarkdown from '@/components/android/AgentMarkdown';
import InteractiveDeviceScreen from '@/components/android/InteractiveDeviceScreen';
import ClearAllIcon from '@mui/icons-material/ClearAll';
import HistoryIcon from '@mui/icons-material/History';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import CloseIcon from '@mui/icons-material/Close';
import TouchAppIcon from '@mui/icons-material/TouchApp';
import PersonIcon from '@mui/icons-material/Person';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import PsychologyIcon from '@mui/icons-material/Psychology';
import SendIcon from '@mui/icons-material/Send';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import StopCircleIcon from '@mui/icons-material/StopCircle';
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
  Dialog,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Select,
  Stack,
  TextField,
  Tooltip,
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
/** Rough cost of one phone screenshot once encoded for a vision model. */
const IMAGE_TOKENS_ESTIMATE = 1000;
// Approximate size of the constant part of every request (system prompt + tool schemas).
const BASE_PROMPT_CHARS = 4000;

/**
 * Starter tasks shown on an empty conversation. Curated around what the agent
 * is actually good at (concrete actions), not content extraction.
 */
const CURATED_SUGGESTIONS = [
  'Open Chrome and go to google.com',
  'Open YouTube and play Lo-Fi Beats',
  'Set an alarm for 7:00 AM',
  'Turn on Wi-Fi from Settings',
  'Open Settings and check battery level',
  "Open Calendar and check today's events",
  'Open Chrome and search for the weather today',
  'Go to the Home screen and open the Clock app',
];


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
  // Failed steps get a plain-language translation; the raw text stays behind the toggle.
  const explanation = failed ? explainError(result) : null;

  return (
    <Box sx={{ mt: 0.5 }}>
      {explanation && (
        <Box
          sx={{
            mb: 0.5,
            px: 1,
            py: 0.75,
            borderRadius: 1.5,
            bgcolor: (t) => alpha(t.palette.error.main, 0.06),
            border: (t) => `1px solid ${alpha(t.palette.error.main, 0.22)}`,
          }}
        >
          <Typography variant="caption" sx={{ fontWeight: 800, color: 'error.main', display: 'block' }}>
            {explanation.title}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
            {explanation.cause} {explanation.suggestion}
          </Typography>
        </Box>
      )}
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
  const [searchParams, setSearchParams] = useSearchParams();
  const initialDeviceId = searchParams.get('deviceId') ? Number(searchParams.get('deviceId')) : undefined;
  const requestedTaskId = searchParams.get('taskId') ? Number(searchParams.get('taskId')) : undefined;
  // A prompt handed over in the URL (e.g. from a run report's Re-run button).
  const requestedPrompt = searchParams.get('prompt');

  const { data: devicesData } = useGetAndroidDevicesQuery(undefined, { pollingInterval: 5_000 });
  const { data: deviceTasksData, refetch: refetchSessions } = useGetAndroidTasksQuery(
    { limit: 40 },
    { pollingInterval: 30_000 },
  );
  const devices = useMemo(() => devicesData?.data || [], [devicesData?.data]);

  const { data: aiConfigsData } = useGetAiConfigsQuery();
  const aiConfigs = useMemo(() => aiConfigsData?.data ?? [], [aiConfigsData?.data]);
  const activeAiConfig = useMemo(() => aiConfigs.find((c) => c.is_active), [aiConfigs]);

  const [selectedDeviceId, setSelectedDeviceId] = useState<number | undefined>(initialDeviceId);
  const [promptInput, setPromptInput] = useState('');
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [latestScreenshot, setLatestScreenshot] = useState<string | null>(null);
  // Run configuration: 0 = use the account's active provider
  const [selectedConfigId, setSelectedConfigId] = useState(0);
  const [maxSteps, setMaxSteps] = useState(40);
  const [manualControl, setManualControl] = useState(false);
  const [screenExpanded, setScreenExpanded] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(true);
  const [clarifyPrompt, { isLoading: isCheckingPrompt }] = useClarifyPromptMutation();
  const [clarification, setClarification] = useState<{ prompt: string; question: string; options: string[] } | null>(
    null,
  );

  // The provider this run will actually use: the explicit pick, else the active one.
  const runningConfig = useMemo(
    () => (selectedConfigId ? aiConfigs.find((c) => c.id === selectedConfigId) ?? activeAiConfig : activeAiConfig),
    [aiConfigs, selectedConfigId, activeAiConfig],
  );

  // Live token / cost estimation for the current session
  const [tokenStats, setTokenStats] = useState({ promptTokens: 0, completionTokens: 0 });
  const contextCharsRef = useRef(0);

  // Conversational Chat Messages List (BrowserWorker Style)
  const [messages, setMessages] = useState<ChatMessage[]>([]);

  const [runTask, { isLoading: isStartingTask }] = useRunAndroidTaskMutation();
  const [cancelTask, { isLoading: isCancelling }] = useCancelAndroidTaskMutation();
  const [fetchTaskLogs] = useLazyGetAndroidTaskLogsQuery();
  const [fetchActiveTask] = useLazyGetActiveAndroidTaskQuery();
  const [fetchDeviceTasks] = useLazyGetAndroidTasksQuery();
  const [isRestoring, setIsRestoring] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Live copy of the selected device id so the WebSocket handler (registered once)
  // can ignore events belonging to other devices.
  const selectedDeviceIdRef = useRef<number | undefined>(undefined);
  const selectedDeviceHardwareIdRef = useRef<string | undefined>(undefined);
  const restoredKeyRef = useRef<string>('');
  // Once the user starts or clears a session, auto-restore must never overwrite it.
  const userOwnsChatRef = useRef(false);
  const previousDeviceRef = useRef<number | undefined>(undefined);
  // Task currently shown in the transcript, used to highlight the sessions rail.
  const [viewingTaskId, setViewingTaskId] = useState<number | null>(null);

  const effectiveSelectedDeviceId =
    selectedDeviceId ?? devices.find((device) => device.status === 'ONLINE')?.id ?? devices[0]?.id;
  const selectedDevice = devices.find((device) => device.id === effectiveSelectedDeviceId);
  selectedDeviceIdRef.current = effectiveSelectedDeviceId;
  selectedDeviceHardwareIdRef.current = selectedDevice?.device_id;
  const isDeviceOnline = selectedDevice?.status === 'ONLINE';
  const hasAccessibility = selectedDevice?.capabilities?.accessibility === true;
  const hasScreenCapture = selectedDevice?.capabilities?.screenCapture === true;
  const deviceReady = isDeviceOnline && hasAccessibility && hasScreenCapture;

  /** Past runs on the selected device, newest first. */
  const sessions = useMemo(
    () => (deviceTasksData?.data ?? []).filter((task) => task.device_id === effectiveSelectedDeviceId),
    [deviceTasksData, effectiveSelectedDeviceId],
  );

  // Sessions rail search + outcome filter (client-side; the rail already holds the data).
  const [sessionQuery, setSessionQuery] = useState('');
  const [sessionOutcome, setSessionOutcome] = useState<'all' | 'ok' | 'fail'>('all');
  const filteredSessions = useMemo(() => {
    const query = sessionQuery.trim().toLowerCase();
    return sessions.filter((session) => {
      if (query && !session.prompt.toLowerCase().includes(query)) return false;
      if (sessionOutcome === 'ok') return session.success && !session.is_running;
      if (sessionOutcome === 'fail') return !session.success && !session.is_running;
      return true;
    });
  }, [sessions, sessionQuery, sessionOutcome]);

  /** Loads a stored run into the transcript by pointing the restore effect at it. */
  const openSession = (taskId: number) => {
    if (!effectiveSelectedDeviceId) return;
    userOwnsChatRef.current = false;
    restoredKeyRef.current = '';
    setSearchParams({ deviceId: String(effectiveSelectedDeviceId), taskId: String(taskId) });
  };

  // Derived live usage estimate
  const usageEstimate = useMemo(() => {
    const totalTokens = tokenStats.promptTokens + tokenStats.completionTokens;
    const price = priceFor(runningConfig?.model);
    const cost =
      (tokenStats.promptTokens / 1_000_000) * price.in + (tokenStats.completionTokens / 1_000_000) * price.out;
    return { totalTokens, cost };
  }, [tokenStats, runningConfig?.model]);

  // Auto-scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /**
   * Re-run handoff: a ?prompt= param prefills the input (never auto-runs) and
   * is then removed from the URL so a refresh does not re-apply it.
   */
  useEffect(() => {
    if (!requestedPrompt) return;
    setPromptInput(requestedPrompt);
    userOwnsChatRef.current = true;
    const next = new URLSearchParams(searchParams);
    next.delete('prompt');
    setSearchParams(next, { replace: true });
    inputRef.current?.focus();
  }, [requestedPrompt, searchParams, setSearchParams]);

  /** A different device means a different conversation — start it clean. */
  useEffect(() => {
    const previous = previousDeviceRef.current;
    previousDeviceRef.current = effectiveSelectedDeviceId;
    if (previous === undefined || previous === effectiveSelectedDeviceId) return;

    setMessages([]);
    setActiveTaskId(null);
    setViewingTaskId(null);
    setClarification(null);
    setLatestScreenshot(null);
    setManualControl(false);
    userOwnsChatRef.current = false;
    restoredKeyRef.current = '';
  }, [effectiveSelectedDeviceId]);

  /**
   * Pin the auto-picked device. Without this the fallback re-evaluates on every
   * status refresh: the moment the current phone drops offline the page
   * silently jumps to another device and auto-restores THAT device's last
   * session — which looks like an old chat opening on its own.
   */
  useEffect(() => {
    if (selectedDeviceId === undefined && effectiveSelectedDeviceId !== undefined) {
      setSelectedDeviceId(effectiveSelectedDeviceId);
    }
  }, [selectedDeviceId, effectiveSelectedDeviceId]);

  /** Rebuilds the chat from a stored task so history and reloads keep context. */
  useEffect(() => {
    if (!effectiveSelectedDeviceId) return;

    // Opening a session from history is explicit and always allowed. Automatic
    // restore is not: it must never clobber a conversation the user just started.
    if (!requestedTaskId && userOwnsChatRef.current) return;

    const key = `${effectiveSelectedDeviceId}:${requestedTaskId ?? 'active'}`;
    if (restoredKeyRef.current === key) return;

    let cancelled = false;

    const buildMessages = (
      taskId: number,
      prompt: string,
      summary: string,
      createdAt: string,
      running: boolean,
      success: boolean,
      logs: AndroidTaskLog[],
    ): ChatMessage[] => {
      const startedAt = new Date(createdAt).getTime() || Date.now();
      const steps: StepUpdate[] = logs.map((log) => ({
        stepIndex: log.step_index,
        thought: log.thought_reasoning || `Executing ${log.action_type}`,
        action: { type: log.action_type, ...(log.action_payload || {}) },
        status: log.status === 'SUCCESS' ? 'SUCCESS' : log.status === 'FAILED' ? 'FAILED' : 'EXECUTING',
        result: log.result_message,
        durationMs: log.duration_ms,
      }));

      return [
        { id: `restored-user-${taskId}`, role: 'user', content: prompt, timestamp: startedAt },
        {
          id: `restored-assistant-${taskId}`,
          role: 'assistant',
          content: summary,
          timestamp: startedAt + 1,
          steps,
          status: running ? 'running' : success ? 'done' : 'error',
          taskId,
        },
      ];
    };

    const restore = async () => {
      setIsRestoring(true);
      try {
        let taskId = requestedTaskId;

        // No explicit task: re-attach to whatever is still running on this
        // device, and otherwise fall back to its most recent conversation.
        if (!taskId) {
          const active = await fetchActiveTask(effectiveSelectedDeviceId).unwrap();
          taskId = active?.data?.id;
        }
        if (!taskId) {
          const recent = await fetchDeviceTasks({ deviceId: effectiveSelectedDeviceId, limit: 1 }).unwrap();
          taskId = recent?.data?.[0]?.id;
        }
        if (!taskId || cancelled) return;

        const response = await fetchTaskLogs(taskId).unwrap();
        if (cancelled) return;

        const task = response.task;
        const logs = response.data ?? [];
        const running = Boolean(task?.is_running);

        setMessages(
          buildMessages(
            taskId,
            task?.prompt ?? 'Restored task',
            task?.message ?? '',
            task?.created_at ?? new Date().toISOString(),
            running,
            Boolean(task?.success),
            logs,
          ),
        );
        setActiveTaskId(running ? taskId : null);
        setViewingTaskId(taskId);
        setIsRunning(running);
        restoredKeyRef.current = key;
      } catch {
        // A missing or unreadable task simply leaves the chat empty.
      } finally {
        // Always clear the flag: leaving it set pins the header on "Loading".
        setIsRestoring(false);
      }
    };

    restore();
    return () => {
      cancelled = true;
    };
  }, [effectiveSelectedDeviceId, requestedTaskId, fetchActiveTask, fetchTaskLogs, fetchDeviceTasks]);

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
          const resultLen = typeof step.result === 'string' ? step.result.length : 0;
          // Screen dumps come back inside each action result, so they grow the
          // context just like thoughts do — leaving them out is what made the
          // old estimate read far below the real usage.
          contextCharsRef.current += thoughtLen + resultLen;
          // Vision steps additionally carry an image; a phone screenshot lands
          // around a thousand tokens once encoded.
          const imageTokens = step.action?.type === 'capture_screen' ? IMAGE_TOKENS_ESTIMATE : 0;
          setTokenStats((prev) => ({
            promptTokens: prev.promptTokens + Math.round(promptChars / CHARS_PER_TOKEN) + imageTokens,
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
          refetchSessions();
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

  const handleSendPrompt = async (textToSend?: string, options?: { maxStepsOverride?: number }) => {
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

    // A vague instruction makes the agent spend its whole step budget deciding what
    // to do, so ask one question first. Skip when the user already answered one.
    if (!textToSend) {
      try {
        const review = await clarifyPrompt({ prompt: text }).unwrap();
        if (review?.data?.needsClarification && review.data.question) {
          setClarification({
            prompt: text,
            question: review.data.question,
            options: review.data.options ?? [],
          });
          return;
        }
      } catch {
        // Clarification is optional — fall through and run the task as written.
      }
    }
    setClarification(null);
    userOwnsChatRef.current = true;

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
        max_steps: options?.maxStepsOverride ?? maxSteps,
        ai_config_id: selectedConfigId || undefined,
      }).unwrap();

      setActiveTaskId(res.data.taskId);
      setViewingTaskId(res.data.taskId);
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
    setViewingTaskId(null);
    setClarification(null);
    setTokenStats({ promptTokens: 0, completionTokens: 0 });
    contextCharsRef.current = 0;
    userOwnsChatRef.current = true;
    restoredKeyRef.current = '';
    // Drop any taskId in the URL so a refresh does not reopen the old run.
    if (effectiveSelectedDeviceId) {
      setSearchParams({ deviceId: String(effectiveSelectedDeviceId) });
    }
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
                onChange={(e) => {
                  const nextId = Number(e.target.value);
                  setSelectedDeviceId(nextId);
                  // Keep the URL truthful so reloads and shares land on the same device.
                  setSearchParams({ deviceId: String(nextId) }, { replace: true });
                }}
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
              {aiConfigs.length > 0 && (
                <Select
                  size="small"
                  value={selectedConfigId}
                  onChange={(e) => setSelectedConfigId(Number(e.target.value))}
                  disabled={isRunning}
                  startAdornment={<PsychologyIcon fontSize="small" sx={{ mr: 0.75, color: 'primary.main' }} />}
                  sx={{ minWidth: 220, height: 34, fontWeight: 700, borderRadius: 2, fontSize: 13 }}
                >
                  <MenuItem value={0} sx={{ fontSize: 13 }}>
                    Active — {activeAiConfig?.model ?? 'none'}
                  </MenuItem>
                  {sortModelsForDisplay(aiConfigs).map((config) => {
                    const meta = getModelMeta(config.model);
                    return (
                      <MenuItem key={config.id} value={config.id} sx={{ fontSize: 13, gap: 0.5 }}>
                        {config.model}
                        {meta && (
                          <Tooltip title={meta.note}>
                            {meta.tag === 'recommended' ? (
                              <StarIcon sx={{ fontSize: 14, color: 'success.main' }} />
                            ) : (
                              <WarningAmberIcon sx={{ fontSize: 14, color: 'warning.main' }} />
                            )}
                          </Tooltip>
                        )}
                      </MenuItem>
                    );
                  })}
                </Select>
              )}

              <TextField
                size="small"
                type="number"
                label="Steps"
                value={maxSteps}
                disabled={isRunning}
                onChange={(e) => setMaxSteps(Number(e.target.value))}
                onBlur={() => setMaxSteps((prev) => Math.min(200, Math.max(1, prev || 40)))}
                inputProps={{ min: 1, max: 200 }}
                sx={{ width: 96, '& .MuiInputBase-root': { height: 34 } }}
              />

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

      {/* Main layout: sessions rail · conversation · live device */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            lg: sessionsOpen ? '260px 360px 1fr' : '56px 360px 1fr',
          },
          gap: 2.5,
          alignItems: 'flex-start',
          transition: 'grid-template-columns .2s ease',
        }}
      >
        {/* Sessions rail */}
        <Card
          sx={{
            borderRadius: 3,
            border: '1px solid',
            borderColor: 'divider',
            position: { lg: 'sticky' },
            top: { lg: 20 },
            display: { xs: 'none', lg: 'block' },
            overflow: 'hidden',
          }}
        >
          <Stack
            direction="row"
            alignItems="center"
            sx={{ px: sessionsOpen ? 1.5 : 0.5, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}
          >
            {sessionsOpen && (
              <Typography variant="subtitle2" sx={{ fontWeight: 800, flexGrow: 1 }}>
                Sessions
              </Typography>
            )}
            <Tooltip title={sessionsOpen ? 'Collapse' : 'Sessions'}>
              <IconButton size="small" onClick={() => setSessionsOpen((prev) => !prev)} sx={{ mx: 'auto' }}>
                <HistoryIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>

          {sessionsOpen && (
            <>
              <Box sx={{ p: 1.25 }}>
                <Button
                  fullWidth
                  size="small"
                  variant="outlined"
                  startIcon={<ClearAllIcon />}
                  onClick={handleClearChat}
                  sx={{ borderRadius: 2, fontWeight: 700 }}
                >
                  New session
                </Button>

                <TextField
                  fullWidth
                  size="small"
                  placeholder="Search sessions…"
                  value={sessionQuery}
                  onChange={(e) => setSessionQuery(e.target.value)}
                  sx={{ mt: 1, '& .MuiInputBase-root': { borderRadius: 2, fontSize: 13 } }}
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <SearchIcon sx={{ fontSize: 16 }} />
                        </InputAdornment>
                      ),
                    },
                  }}
                />

                <Stack direction="row" spacing={0.5} sx={{ mt: 1 }}>
                  {(
                    [
                      { key: 'all', label: 'All' },
                      { key: 'ok', label: '✓ Done' },
                      { key: 'fail', label: '✗ Failed' },
                    ] as const
                  ).map((option) => (
                    <Chip
                      key={option.key}
                      label={option.label}
                      size="small"
                      color={sessionOutcome === option.key ? 'primary' : 'default'}
                      variant={sessionOutcome === option.key ? 'filled' : 'outlined'}
                      onClick={() => setSessionOutcome(option.key)}
                      sx={{ height: 22, fontSize: 10.5, fontWeight: 700, cursor: 'pointer' }}
                    />
                  ))}
                </Stack>
              </Box>

              <Box sx={{ maxHeight: 520, overflowY: 'auto', pb: 1 }}>
                {filteredSessions.length === 0 ? (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, py: 3 }}>
                    {sessions.length === 0 ? 'No runs on this device yet.' : 'No sessions match the filter.'}
                  </Typography>
                ) : (
                  filteredSessions.map((session) => {
                    const isOpen = viewingTaskId === session.id;
                    return (
                      <Box
                        key={session.id}
                        onClick={() => openSession(session.id)}
                        sx={{
                          px: 1.5,
                          py: 1,
                          cursor: 'pointer',
                          borderLeft: '3px solid',
                          borderColor: isOpen ? 'primary.main' : 'transparent',
                          bgcolor: isOpen ? alpha(theme.palette.primary.main, 0.06) : 'transparent',
                          '&:hover': { bgcolor: alpha(theme.palette.primary.main, 0.04) },
                        }}
                      >
                        <Stack direction="row" alignItems="center" gap={0.75}>
                          {session.is_running ? (
                            <CircularProgress size={12} />
                          ) : session.success ? (
                            <CheckCircleIcon sx={{ fontSize: 14 }} color="success" />
                          ) : (
                            <StopCircleIcon sx={{ fontSize: 14 }} color="error" />
                          )}
                          <Typography
                            variant="caption"
                            sx={{
                              fontWeight: 600,
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                              lineHeight: 1.35,
                            }}
                          >
                            {session.prompt}
                          </Typography>
                        </Stack>
                        <Typography variant="caption" color="text.secondary" sx={{ pl: 2.6, fontSize: 10 }}>
                          {session.total_steps} steps
                        </Typography>
                      </Box>
                    );
                  })
                )}
              </Box>
            </>
          )}
        </Card>

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
                <Box sx={{ flexGrow: 1 }} />
                <Tooltip title="Enlarge screen">
                  <span>
                    <IconButton size="small" disabled={!isDeviceOnline} onClick={() => setScreenExpanded(true)}>
                      <OpenInFullIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={manualControl ? 'Stop manual control' : 'Take manual control'}>
                  <span>
                    <IconButton
                      size="small"
                      color={manualControl ? 'primary' : 'default'}
                      disabled={!isDeviceOnline}
                      onClick={() => setManualControl((prev) => !prev)}
                    >
                      <TouchAppIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
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
                {latestScreenshot || manualControl ? (
                  <Box sx={{ width: '100%', height: '100%', display: 'flex' }}>
                    <InteractiveDeviceScreen
                      fill
                      deviceId={effectiveSelectedDeviceId}
                      screenshot={latestScreenshot}
                      onScreenshot={setLatestScreenshot}
                      controlEnabled={manualControl}
                      isAgentRunning={isRunning}
                    />
                  </Box>
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
                {isRestoring && messages.length === 0
                  ? 'Loading conversation…'
                  : messages.length
                    ? `${messages.length} conversation turns`
                    : 'Ready to start'}
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

                {/* Quick Action Suggestion Chips — curated around actions the agent is good at */}
                <Typography
                  variant="overline"
                  sx={{ display: 'block', mt: 3, fontWeight: 800, letterSpacing: 1, color: 'text.secondary' }}
                >
                  Try one of these
                </Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', justifyContent: 'center', gap: 1, maxWidth: 620, mx: 'auto' }}>
                  {CURATED_SUGGESTIONS.map((preset) => (
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

                {/* One-tap repeats of what already worked on this device */}
                {sessions.some((session) => session.success && !session.is_running) && (
                  <>
                    <Typography
                      variant="overline"
                      sx={{ display: 'block', mt: 2.5, fontWeight: 800, letterSpacing: 1, color: 'text.secondary' }}
                    >
                      Run again
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', justifyContent: 'center', gap: 1, maxWidth: 620, mx: 'auto' }}>
                      {sessions
                        .filter((session) => session.success && !session.is_running)
                        .slice(0, 3)
                        .map((session) => (
                          <Chip
                            key={session.id}
                            icon={<HistoryIcon sx={{ fontSize: 14 }} />}
                            label={session.prompt.length > 48 ? `${session.prompt.slice(0, 48)}…` : session.prompt}
                            clickable={!isRunning && deviceReady}
                            onClick={() => handleSendPrompt(session.prompt)}
                            variant="outlined"
                            color="success"
                            sx={{ borderRadius: 2, fontWeight: 600, py: 2 }}
                          />
                        ))}
                    </Stack>
                  </>
                )}
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
                            {msg.steps
                              .filter((step) => step.action?.type !== 'task_snapshot')
                              .map((step, stepIdx) => {
                              const isLast = stepIdx === (msg.steps?.length ?? 0) - 1;
                              const dotColor =
                                step.status === 'FAILED'
                                  ? theme.palette.error.main
                                  : step.status === 'EXECUTING'
                                    ? theme.palette.warning.main
                                    : theme.palette.success.main;

                              return (
                                <Box
                                  key={step.stepIndex}
                                  sx={{
                                    display: 'flex',
                                    gap: 1.25,
                                    position: 'relative',
                                    ...(step.status === 'EXECUTING' && {
                                      bgcolor: alpha(theme.palette.warning.main, 0.07),
                                      borderRadius: 1.5,
                                      mx: -1,
                                      px: 1,
                                      pt: 0.75,
                                    }),
                                  }}
                                >
                                  {/* Timeline rail */}
                                  <Box
                                    sx={{
                                      width: 18,
                                      flexShrink: 0,
                                      display: 'flex',
                                      flexDirection: 'column',
                                      alignItems: 'center',
                                      pt: 0.5,
                                    }}
                                  >
                                    <Box
                                      sx={{
                                        width: 9,
                                        height: 9,
                                        borderRadius: '50%',
                                        bgcolor: dotColor,
                                        boxShadow: `0 0 0 3px ${alpha(dotColor, 0.18)}`,
                                        flexShrink: 0,
                                        ...(step.status === 'EXECUTING' && {
                                          animation: 'vbPulse 1.2s ease-in-out infinite',
                                          '@keyframes vbPulse': {
                                            '0%, 100%': { boxShadow: `0 0 0 3px ${alpha(dotColor, 0.18)}` },
                                            '50%': { boxShadow: `0 0 0 7px ${alpha(dotColor, 0.05)}` },
                                          },
                                        }),
                                      }}
                                    />
                                    {!isLast && (
                                      <Box sx={{ width: 2, flexGrow: 1, mt: 0.5, bgcolor: 'divider', borderRadius: 1 }} />
                                    )}
                                  </Box>

                                  {/* Step body */}
                                  <Box sx={{ flexGrow: 1, minWidth: 0, pb: isLast ? 0 : 1.75 }}>
                                    <Stack direction="row" alignItems="center" gap={0.75} flexWrap="wrap">
                                      <Typography
                                        variant="caption"
                                        sx={{ fontWeight: 800, color: 'text.secondary', fontSize: 10.5 }}
                                      >
                                        STEP {step.stepIndex}
                                      </Typography>
                                      {step.action?.type && (
                                        <Typography
                                          variant="caption"
                                          sx={{
                                            fontFamily: 'monospace',
                                            fontSize: 10.5,
                                            px: 0.75,
                                            py: 0.125,
                                            borderRadius: 0.75,
                                            bgcolor: alpha(theme.palette.primary.main, 0.08),
                                            color: 'primary.main',
                                            fontWeight: 700,
                                          }}
                                        >
                                          {step.action.type}
                                          {step.action.packageName ? ` · ${step.action.packageName}` : ''}
                                        </Typography>
                                      )}
                                      {step.status === 'EXECUTING' && <CircularProgress size={11} />}
                                    </Stack>

                                    <Typography
                                      variant="body2"
                                      sx={{ mt: 0.5, color: 'text.primary', lineHeight: 1.55, fontSize: 13.5 }}
                                    >
                                      {step.thought}
                                    </Typography>

                                    {step.result && (
                                      <StepResult result={step.result} failed={step.status === 'FAILED'} />
                                    )}
                                  </Box>
                                </Box>
                              );
                            })}
                          </Stack>
                        )}

                        {/* Final answer — the part the user actually reads */}
                        {msg.content && (
                          <Box
                            sx={{
                              mt: msg.steps?.length ? 2 : 0,
                              p: 1.75,
                              borderRadius: 2,
                              border: '1px solid',
                              borderColor:
                                msg.status === 'error'
                                  ? alpha(theme.palette.error.main, 0.35)
                                  : alpha(theme.palette.success.main, 0.3),
                              bgcolor:
                                msg.status === 'error'
                                  ? alpha(theme.palette.error.main, 0.05)
                                  : alpha(theme.palette.success.main, 0.05),
                            }}
                          >
                            <Stack direction="row" alignItems="center" gap={0.75} sx={{ mb: 0.75 }}>
                              {msg.status === 'running' ? (
                                <CircularProgress size={13} />
                              ) : msg.status === 'error' ? (
                                <StopCircleIcon sx={{ fontSize: 15 }} color="error" />
                              ) : (
                                <CheckCircleIcon sx={{ fontSize: 15 }} color="success" />
                              )}
                              <Typography
                                variant="caption"
                                sx={{ fontWeight: 800, letterSpacing: 0.4, fontSize: 10.5, color: 'text.secondary' }}
                              >
                                {msg.status === 'running' ? 'WORKING' : msg.status === 'error' ? 'RESULT' : 'RESULT'}
                              </Typography>
                            </Stack>

                            {/* Honesty check: flag sites the result claims but no step ever saw */}
                            {msg.status === 'done' &&
                              (() => {
                                const verification = verifyResultClaims(msg.content, [
                                  ...(msg.steps ?? []).map((step) => step.result),
                                  ...(msg.steps ?? []).map((step) => step.thought),
                                ]);
                                if (verification.claimedCount === 0 || verification.verified) return null;
                                return (
                                  <Box
                                    sx={{
                                      mb: 1,
                                      px: 1.25,
                                      py: 0.75,
                                      borderRadius: 1.5,
                                      bgcolor: alpha(theme.palette.warning.main, 0.1),
                                      border: `1px solid ${alpha(theme.palette.warning.main, 0.35)}`,
                                    }}
                                  >
                                    <Typography variant="caption" sx={{ fontWeight: 800, color: 'warning.dark', display: 'block' }}>
                                      Partially unverified result
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                                      Not found in step evidence: {verification.unsupportedDomains.join(', ')}. The model may
                                      be overstating what it actually did.
                                    </Typography>
                                  </Box>
                                );
                              })()}

                            <AgentMarkdown text={msg.content} />

                            {/* One-click continue when the run only stopped because of the step budget */}
                            {msg.status === 'error' &&
                              /step[ -]limit/i.test(msg.content) &&
                              (() => {
                                const idx = messages.findIndex((m) => m.id === msg.id);
                                let runPrompt: string | null = null;
                                for (let i = idx - 1; i >= 0; i--) {
                                  if (messages[i].role === 'user') {
                                    runPrompt = messages[i].content;
                                    break;
                                  }
                                }
                                if (!runPrompt) return null;
                                const bumpedSteps = Math.min(200, maxSteps + 20);
                                const continuePrompt = runPrompt.startsWith('Continue the unfinished task')
                                  ? runPrompt
                                  : `Continue the unfinished task: "${runPrompt}". The phone screen is already where the last run left off — continue from there, do not start over.`;
                                return (
                                  <Button
                                    size="small"
                                    variant="contained"
                                    color="warning"
                                    disabled={isRunning || !deviceReady}
                                    onClick={() => {
                                      setMaxSteps(bumpedSteps);
                                      handleSendPrompt(continuePrompt, { maxStepsOverride: bumpedSteps });
                                    }}
                                    sx={{ mt: 1, borderRadius: 2, fontWeight: 800 }}
                                  >
                                    Continue task (+20 steps)
                                  </Button>
                                );
                              })()}

                            {/* Plain-language failure translation with a one-tap recovery */}
                            {msg.status === 'error' &&
                              (() => {
                                const explanation = explainError(msg.content);
                                if (!explanation) return null;
                                return (
                                  <Box
                                    sx={{
                                      mt: 1,
                                      px: 1.25,
                                      py: 0.75,
                                      borderRadius: 1.5,
                                      bgcolor: alpha(theme.palette.error.main, 0.05),
                                      border: `1px solid ${alpha(theme.palette.error.main, 0.2)}`,
                                    }}
                                  >
                                    <Typography variant="caption" sx={{ fontWeight: 800, color: 'error.main', display: 'block' }}>
                                      {explanation.title}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                                      {explanation.cause} {explanation.suggestion}
                                    </Typography>
                                    {explanation.recoveryPrompt && (
                                      <Chip
                                        label={`Try: ${explanation.recoveryPrompt}`}
                                        size="small"
                                        color="warning"
                                        onClick={() => handleSendPrompt(explanation.recoveryPrompt)}
                                        disabled={isRunning || !deviceReady}
                                        sx={{ mt: 0.75, fontWeight: 700, cursor: 'pointer' }}
                                      />
                                    )}
                                  </Box>
                                );
                              })()}
                          </Box>
                        )}
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
            {/* One clarifying question before a vague task is dispatched */}
            {clarification && (
              <Paper
                variant="outlined"
                sx={{
                  p: 1.5,
                  mb: 1.5,
                  borderRadius: 2,
                  borderColor: 'warning.main',
                  bgcolor: alpha(theme.palette.warning.main, 0.06),
                }}
              >
                <Typography variant="body2" sx={{ fontWeight: 700, mb: 1 }}>
                  {clarification.question}
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {clarification.options.map((option) => (
                    <Chip
                      key={option}
                      label={option}
                      size="small"
                      color="warning"
                      onClick={() => handleSendPrompt(`${clarification.prompt} — ${option}`)}
                      sx={{ fontWeight: 700, cursor: 'pointer' }}
                    />
                  ))}
                  <Chip
                    label="Run as written"
                    size="small"
                    variant="outlined"
                    onClick={() => handleSendPrompt(clarification.prompt)}
                    sx={{ fontWeight: 700, cursor: 'pointer' }}
                  />
                  <Chip
                    label="Cancel"
                    size="small"
                    variant="outlined"
                    color="default"
                    onClick={() => setClarification(null)}
                    sx={{ cursor: 'pointer' }}
                  />
                </Stack>
              </Paper>
            )}

            {/* Suggestion Chips when in-between actions */}
            {!isRunning && !clarification && messages.length > 0 && (
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
                  disabled={!promptInput.trim() || isStartingTask || isCheckingPrompt || !deviceReady}
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

      {/* Enlarged device view — same controls, more room to work */}
      <Dialog
        open={screenExpanded}
        onClose={() => setScreenExpanded(false)}
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
        <Stack
          direction="row"
          alignItems="center"
          gap={1}
          sx={{ px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}
        >
          <PhoneAndroidIcon fontSize="small" color="primary" />
          <Typography variant="subtitle2" sx={{ fontWeight: 800, flexGrow: 1 }} noWrap>
            {selectedDevice?.device_name ?? 'Device'}
          </Typography>
          <Tooltip title={manualControl ? 'Stop manual control' : 'Take manual control'}>
            <span>
              <IconButton
                size="small"
                color={manualControl ? 'primary' : 'default'}
                disabled={!isDeviceOnline}
                onClick={() => setManualControl((prev) => !prev)}
              >
                <TouchAppIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <IconButton size="small" onClick={() => setScreenExpanded(false)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>

        <Box sx={{ flexGrow: 1, minHeight: 0, p: 1.5, display: 'flex', bgcolor: 'grey.900' }}>
          <InteractiveDeviceScreen
            fill
            deviceId={effectiveSelectedDeviceId}
            screenshot={latestScreenshot}
            onScreenshot={setLatestScreenshot}
            controlEnabled={manualControl}
            isAgentRunning={isRunning}
          />
        </Box>
      </Dialog>
    </Box>
  );
}

export default AndroidAgentPage;
