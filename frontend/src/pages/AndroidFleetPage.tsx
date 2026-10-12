import {
  useCancelAndroidTaskMutation,
  useGetAndroidDevicesQuery,
  useGetFleetStateQuery,
  useGetAndroidTasksQuery,
  useRunAndroidTaskMutation,
  useSetDeviceTagMutation,
  type AndroidAgentTask,
  type AndroidDevice,
  useSendDirectActionMutation,
} from '@/RTKService/androidService/androidService';
import { useGetAiConfigsQuery } from '@/RTKService/aiConfigService/aiConfigService';
import authManager from '@/_helpers/authManager';
import InteractiveDeviceScreen from '@/components/android/InteractiveDeviceScreen';
import FleetCoverageStrip from '@/components/android/FleetCoverageStrip';
import {
  DeviceStatusBadge,
  RetryButton,
  statusAccent,
  TaskProgress,
  type FleetCounts,
  type FleetStatus,
} from '@/components/android/FleetStatusUI';
import { isInterruption, reasonLabel } from '@/components/android/taskReasons';
import PhoneFrame3D from '@/components/android/PhoneFrame3D';
import SendFileDialog from '@/components/android/SendFileDialog';
import { describeInstallStage } from '@/components/android/installStage';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloseIcon from '@mui/icons-material/Close';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HistoryIcon from '@mui/icons-material/History';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import PublicIcon from '@mui/icons-material/Public';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import TuneIcon from '@mui/icons-material/Tune';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import RefreshIcon from '@mui/icons-material/Refresh';
import ReplayIcon from '@mui/icons-material/Replay';
import SendIcon from '@mui/icons-material/Send';
import StopCircleIcon from '@mui/icons-material/StopCircle';
import TouchAppIcon from '@mui/icons-material/TouchApp';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import {
  alpha,
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
  Menu,
} from '@mui/material';
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { keyframes } from '@mui/material/styles';
import toast from 'react-hot-toast';
import { useGetProfileQuery } from '@/RTKService/authService/authService';
import { canManageLandingShots } from '@/_helpers/landingAccess';
import { useCaptureLandingPhonesMutation } from '@/RTKService/landingShotService/landingShotService';
import {
  INLINE_UPLOAD_LIMIT,
  UPLOAD_CHUNK_SIZE,
  sha256Hex,
  uploadChunk,
  useFinishDeviceUploadMutation,
  useInitDeviceUploadMutation,
  useQueueDeviceFileMutation,
} from '@/RTKService/androidService/deviceFileService';
import DeviceControls from '@/components/android/DeviceControls';
import PasteToDevices from '@/components/android/PasteToDevices';
import FleetPromptField from '@/components/android/FleetPromptField';
import DeviceProxySelect from '@/components/android/DeviceProxySelect';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import DeviceEmailRow from '@/components/android/DeviceEmailRow';
import DeviceNetworkRow from '@/components/android/DeviceNetworkRow';
import DeviceTagChip, { TAG_COLORS, parseTag, type TagColor } from '@/components/android/DeviceTagChip';
import ProxyManagerDialog from '@/components/android/ProxyManagerDialog';
import { proxyColor, proxyShortName } from '@/components/android/proxyColors';
import PrismBackground from '@/components/ui/PrismBackground';
import { monoLabel, PRISM_ACCENT, PRISM_INK, PRISM_MUTED, PRISM_PINK } from '@/components/settings/settingsStyle';
import {
  useAssignDeviceProxyMutation,
  useCancelQueuedTaskMutation,
  useGetDeviceProxiesQuery,
  useGetTaskQueueQuery,
  useClearAllQueuedMutation,
} from '@/RTKService/androidService/proxyService';
import { useNavigate } from 'react-router-dom';

const riseIn = keyframes`from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; }`;
const barSlide = keyframes`to { background-position: 200% 0; }`;
const haloShift = keyframes`0% { background-position: 0% 50%; } 100% { background-position: 300% 50%; }`;

/** The status bar's order: live work first, then outcomes, then phones that cannot run. */
const statusOrder: FleetStatus[] = ['running', 'waiting', 'failed', 'interrupted', 'cancelled', 'completed', 'idle', 'needs_setup', 'offline'];
const statusLabel: Record<FleetStatus, string> = {
  running: 'running',
  waiting: 'waiting',
  failed: 'failed',
  interrupted: 'interrupted',
  cancelled: 'cancelled',
  completed: 'done',
  idle: 'ready',
  needs_setup: 'need setup',
  offline: 'offline',
};

/** A run option under the instruction pill. */
const glassChip = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0.75,
  height: 40,
  px: 1.75,
  border: 0,
  borderRadius: '999px',
  bgcolor: 'rgba(255,255,255,.7)',
  boxShadow: '0 0 0 1px rgba(20,26,46,.07)',
  font: 'inherit',
  fontSize: 13.5,
  color: PRISM_INK,
} as const;
const glassField = {
  height: 40,
  borderRadius: '999px',
  bgcolor: 'rgba(255,255,255,.7)',
  fontSize: 13.5,
  '& fieldset': { borderColor: 'rgba(20,26,46,.07)' },
} as const;
const toolButton = {
  height: 36,
  px: 1.5,
  borderRadius: '12px',
  whiteSpace: 'nowrap',
  textTransform: 'none',
  fontWeight: 700,
  color: PRISM_INK,
  bgcolor: 'rgba(255,255,255,.8)',
  '&:hover': { bgcolor: '#fff' },
} as const;

/** Live state tracked per device from the WebSocket stream. */
/** One line of a device's run, kept so the chat panel can show a transcript. */
export interface RuntimeStep {
  index: number;
  thought?: string;
  action?: string;
}

/**
 * Steps kept per device.
 *
 * Twenty-odd phones each holding an unbounded transcript would grow the page's
 * memory for as long as it stays open, so only the recent part of a run is
 * kept — enough to follow what a device is doing without becoming a log store.
 */
const MAX_STEPS_KEPT = 30;

interface DeviceRuntime {
  screenshot?: string;
  taskId?: number;
  prompt?: string;
  isRunning: boolean;
  startedAt?: number;
  stepIndex: number;
  lastThought?: string;
  lastAction?: string;
  steps?: RuntimeStep[];
  finishedAt?: number;
  finishedOk?: boolean;
  finishedMessage?: string;
  /** Backend reason code for a finished run (SERVER_RESTART, USER_CANCELLED, ...). */
  finishedReason?: string;
  startError?: string;
}

type RuntimeMap = Record<number, DeviceRuntime>;

interface DispatchResult {
  prompt: string;
  startedIds: number[];
  failedIds: number[];
}

const emptyRuntime: DeviceRuntime = { isRunning: false, stepIndex: 0 };

/** Tag-filter key for phones with no tag. */
const UNTAGGED = '__untagged__';

/** Matches MAX_FILE_BYTES in DeviceFileService, so the refusal arrives before the upload does. */
const MAX_FILE_BYTES = 100 * 1024 * 1024;

/**
 * Renders one device card, but only when something that card actually shows
 * has changed. The fleet page re-renders constantly — every task step, frame
 * and poll — and redrawing two dozen heavy cards (phone frame, screenshot, MUI
 * controls) each time pinned the main thread, so every click on the page lagged
 * one or two seconds. `deps` lists exactly what a card depends on; when none of
 * it moved, the previous output is reused and the card costs nothing.
 */
const MemoCard = memo(
  function MemoCard({ render }: { render: () => ReactNode; deps: unknown[] }) {
    return <>{render()}</>;
  },
  (prev, next) =>
    prev.deps.length === next.deps.length && prev.deps.every((value, index) => Object.is(value, next.deps[index])),
);

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

/**
 * The screens worth one click.
 *
 * Ordered by how often a fleet needs them rather than alphabetically — time,
 * language and network come first because those are what geo testing changes.
 */
const SETTINGS_SHORTCUTS: { screen: string; label: string }[] = [
  { screen: 'DATE_TIME', label: 'Date & time' },
  { screen: 'LANGUAGE', label: 'Language & region' },
  { screen: 'WIFI', label: 'Wi-Fi' },
  { screen: 'MOBILE_NETWORK', label: 'Network & internet' },
  { screen: 'LOCATION', label: 'Location' },
  { screen: 'BATTERY', label: 'Battery' },
  { screen: 'DISPLAY', label: 'Display' },
  { screen: 'SOUND', label: 'Sound' },
  { screen: 'STORAGE', label: 'Storage' },
  { screen: 'APPS', label: 'Apps' },
  { screen: 'ACCESSIBILITY', label: 'Accessibility' },
  { screen: 'ABOUT', label: 'About phone' },
  { screen: 'ROOT', label: 'Settings home' },
];

export default function AndroidFleetPage() {
  const navigate = useNavigate();

  // This page also has its own socket for live device and task events, so the
  // lists below are only a fallback for what the socket missed.
  const { data: devicesData, isLoading, refetch } = useGetAndroidDevicesQuery(undefined, {
    pollingInterval: 60_000,
  });
  const { data: tasksData } = useGetAndroidTasksQuery({ limit: 100 }, { pollingInterval: 30_000 });
  const { data: aiConfigsData } = useGetAiConfigsQuery();

  const [runTask] = useRunAndroidTaskMutation();
  const [cancelTask] = useCancelAndroidTaskMutation();

  const devices = useMemo<AndroidDevice[]>(() => devicesData?.data ?? [], [devicesData]);
  const tasks = useMemo<AndroidAgentTask[]>(() => tasksData?.data ?? [], [tasksData]);

  // What the server says every phone is doing. The page used to work this out
  // from three separate lists and forgot all of it on reload; this survives a
  // refresh and cannot disagree with the agent page or Telegram.
  const { data: fleetStateData } = useGetFleetStateQuery(undefined, { pollingInterval: 10_000 });
  /** Compares dotted versions numerically: 0.10.0 is newer than 0.9.0. */
  const compareVersions = (a: string, b: string): number => {
    const left = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
    const right = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
      const diff = (left[index] ?? 0) - (right[index] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  };

  const serverStateByDevice = useMemo(
    () => new Map((fleetStateData?.data?.devices ?? []).map((entry) => [entry.id, entry])),
    [fleetStateData],
  );
  const aiConfigs = useMemo(() => aiConfigsData?.data ?? [], [aiConfigsData]);
  const activeAiConfig = aiConfigs.find((config) => config.is_active);

  const [runtime, setRuntime] = useState<RuntimeMap>({});
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const { data: profile } = useGetProfileQuery();
  // Admins, plus a temporary allowlist while the first landing shots are taken.
  const isAdmin = canManageLandingShots(profile?.data);
  const [captureLandingPhones, { isLoading: capturingLanding }] = useCaptureLandingPhonesMutation();
  /** Full-resolution screenshots for the landing page (admins only); review them under Landing shots. */
  const captureForLanding = async (ids: number[]) => {
    if (!ids.length) return;
    const pending = toast.loading(ids.length === 1 ? 'Capturing the screen…' : `Capturing ${ids.length} screens…`);
    try {
      const res = await captureLandingPhones(ids).unwrap();
      const results = res.data.results;
      const saved = results.filter((r) => r.shot_id).length;
      const skipped = results.filter((r) => r.error);
      toast.dismiss(pending);
      if (saved) toast.success(`${saved} screen${saved === 1 ? '' : 's'} saved to Landing shots`);
      if (skipped.length) toast.error(skipped.slice(0, 3).map((r) => `${r.label}: ${r.error}`).join('\n') + (skipped.length > 3 ? `\n+${skipped.length - 3} more` : ''));
    } catch (error) {
      toast.dismiss(pending);
      toast.error(errorMessage(error));
    }
  };
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [queueFile, { isLoading: isSendingFile }] = useQueueDeviceFileMutation();
  const [initDeviceUpload] = useInitDeviceUploadMutation();
  const [finishDeviceUpload] = useFinishDeviceUploadMutation();
  const [isRefreshingFrames, setIsRefreshingFrames] = useState(false);
  const [proxyDialogOpen, setProxyDialogOpen] = useState(false);
  const { data: proxyData, refetch: refetchProxies } = useGetDeviceProxiesQuery();
  // Polled: entries leave the queue on the server when a lane frees up, with no
  // socket event of their own.
  const { data: queueData, refetch: refetchQueue } = useGetTaskQueueQuery(undefined, { pollingInterval: 15_000 });
  const [clearAllQueued] = useClearAllQueuedMutation();
  const [cancelQueued] = useCancelQueuedTaskMutation();
  const queuedByDevice = new Map((queueData?.data ?? []).map((entry) => [entry.device_id, entry]));
  const [assignProxy] = useAssignDeviceProxyMutation();
  const proxies = useMemo(() => proxyData?.data ?? [], [proxyData]);
  const proxyById = new Map(proxies.map((proxy) => [proxy.id, proxy]));

  /**
   * Proxy choices applied locally before the server confirms them.
   *
   * The dropdown reads its value from the device list, which only refreshes on
   * its poll — so without this the first pick appears to do nothing and people
   * pick again. Refetching instead would redraw every card mid-click.
   */
  const [proxyOverrides, setProxyOverrides] = useState<Record<number, number | null>>({});

  // Stable handler so the memoized proxy picker is not re-created every render.
  const handleProxyChange = useCallback(
    async (deviceId: number, nextProxyId: number | null) => {
      let previous: number | null = null;
      setProxyOverrides((current) => {
        previous = current[deviceId] ?? null;
        return { ...current, [deviceId]: nextProxyId };
      });
      try {
        await assignProxy({ device_id: deviceId, proxy_id: nextProxyId }).unwrap();
        refetchProxies();
      } catch {
        setProxyOverrides((current) => ({ ...current, [deviceId]: previous }));
        toast.error('Could not change the proxy');
      }
    },
    [assignProxy, refetchProxies],
  );

  const proxyIdFor = (device: AndroidDevice): number | null =>
    device.id in proxyOverrides ? proxyOverrides[device.id] : (device.proxy_id ?? null);
  const [groupByProxy, setGroupByProxy] = useState(true);
  const [setDeviceTag] = useSetDeviceTagMutation();

  /** Saves a device's colour tag ('' removes it). Returns false on failure. */
  const saveTag = async (deviceId: number, value: string): Promise<boolean> => {
    try {
      await setDeviceTag({ id: deviceId, tag: value.trim() }).unwrap();
      refetch();
      return true;
    } catch {
      toast.error('Could not save the tag');
      return false;
    }
  };
  const [prompt, setPrompt] = useState('');
  const [maxSteps, setMaxSteps] = useState(500);
  /**
   * Some work never touches the internet — a settings change, something inside
   * an app — so there is no exit IP to share and no reason to wait for the
   * phone's proxy lane. Unassigning the proxy used to be the only way round it.
   */
  const [skipProxyLane, setSkipProxyLane] = useState(false);
  const [statusFilter, setStatusFilter] = useState<FleetStatus | null>(null);
  // One tag at a time, like the status filter. Keyed by lowercased tag text;
  // UNTAGGED picks phones with no tag.
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [promptResetSignal, setPromptResetSignal] = useState(0);
  // 0 = use the account's active provider
  const [broadcastConfigId, setBroadcastConfigId] = useState(0);
  const [deviceConfigIds, setDeviceConfigIds] = useState<Record<number, number>>({});
  const [isDispatching, setIsDispatching] = useState(false);
  const [lastDispatch, setLastDispatch] = useState<DispatchResult | null>(null);

  // Per-device inline prompt inputs
  const [historyDeviceId, setHistoryDeviceId] = useState<number | null>(null);
  // Only one device streams frames at a time so the fleet view stays light.
  const [controlDeviceId, setControlDeviceId] = useState<number | null>(null);
  const [expandedDeviceId, setExpandedDeviceId] = useState<number | null>(null);
  const [fileDeviceId, setFileDeviceId] = useState<number | null>(null);
  const [settingsMenu, setSettingsMenu] = useState<{ anchor: HTMLElement; deviceId: number } | null>(null);
  const [sendDirectAction] = useSendDirectActionMutation();

  /**
   * Opens one Settings screen on a phone in a single call.
   *
   * Goes through the direct-action endpoint rather than the agent: there is
   * nothing to reason about, so paying for a planner round trip would be waste.
   */
  const openSettingsScreen = async (deviceId: number, screen: string, label: string) => {
    setSettingsMenu(null);
    try {
      await sendDirectAction({ device_id: deviceId, action: { type: 'OpenSettings', screen } as any }).unwrap();
      toast.success(`Opened ${label} on the phone`);
    } catch (error: any) {
      toast.error(error?.data?.message || `Could not open ${label}`);
    }
  };

  const wsRef = useRef<WebSocket | null>(null);

  const patchRuntime = (deviceId: number | undefined, patch: Partial<DeviceRuntime>) => {
    if (deviceId === undefined || deviceId === null) return;
    setRuntime((prev) => ({ ...prev, [deviceId]: { ...(prev[deviceId] ?? emptyRuntime), ...patch } }));
  };

  // Rebuild running-state from the backend on load and on every task poll.
  // The live runtime map lives only in React memory, so a page refresh or a
  // trip to another page wiped it — tasks that were genuinely still running on
  // the phones came back showing "Idle". The tasks query already knows which
  // ones are running (is_running); this reflects that into the runtime map so a
  // reload shows the true state. Live WebSocket events still update it on top.
  useEffect(() => {
    // device_id -> the running task on it, so we can restore taskId (needed to
    // cancel it) and prompt (needed to retry it), not just the isRunning flag.
    const runningByDevice = new Map<number, { taskId: number; prompt: string }>();
    for (const task of tasksData?.data ?? []) {
      if (task.is_running && typeof task.device_id === 'number') {
        runningByDevice.set(task.device_id, { taskId: task.id, prompt: task.prompt ?? '' });
      }
    }
    setRuntime((prev) => {
      let changed = false;
      const next: RuntimeMap = { ...prev };
      // Only ever turn running ON here — this effect exists to restore running
      // state after a reload, when the live runtime map is empty. Turning it
      // OFF was wrong: the tasks poll lags a few seconds behind the live
      // WebSocket, so a just-started task still shows is_running=false in the
      // list, and forcing false here flipped a genuinely running phone back to
      // "Idle". Completion is already handled by the task:complete WS event.
      runningByDevice.forEach(({ taskId, prompt: taskPrompt }, deviceId) => {
        const existing = next[deviceId];
        // Restore isRunning, and — crucially — the taskId, so Stop all can
        // cancel a task that started before this page was open.
        if (!existing?.isRunning || existing.taskId === undefined) {
          next[deviceId] = {
            ...(existing ?? emptyRuntime),
            isRunning: true,
            taskId,
            prompt: existing?.prompt || taskPrompt,
            startedAt: existing?.startedAt ?? Date.now(),
          };
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasksData]);


  // ---- Live stream -------------------------------------------------------
  // The socket reads the device list through a ref. It used to depend on
  // `devices` directly, and every device refetch (~20s) produced a new array,
  // closed the socket and opened a fresh one — dropping frames and flooding
  // the server log with "Web UI client connected".
  const devicesRef = useRef(devices);
  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);

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
            const match = devicesRef.current.find((device) => device.device_id === hardwareId || device.id === hardwareId);
            if (capture && match) patchRuntime(match.id, { screenshot: capture });
            break;
          }
          case 'task:started':
            patchRuntime(deviceId, {
              isRunning: true,
              startedAt: Date.now(),
              taskId: payload.taskId,
              prompt: payload.prompt,
              stepIndex: 0,
              // A new run starts a new transcript rather than continuing the
              // previous one.
              steps: [],
              finishedAt: undefined,
              finishedMessage: undefined,
              startError: undefined,
            });
            break;
          case 'task:step': {
            // Narrowed here because the transcript update indexes by this id,
            // and a step event without a device is not one we can place.
            if (deviceId === undefined) break;
            const stepDeviceId = deviceId;

            setRuntime((current) => {
              const existing = current[stepDeviceId] ?? emptyRuntime;
              const steps = [
                ...(existing.steps ?? []),
                { index: payload.stepIndex ?? 0, thought: payload.thought, action: payload.action?.type },
              ].slice(-MAX_STEPS_KEPT);

              return {
                ...current,
                [stepDeviceId]: {
                  ...existing,
                  isRunning: true,
                  stepIndex: payload.stepIndex ?? 0,
                  lastThought: payload.thought,
                  lastAction: payload.action?.type,
                  steps,
                },
              };
            });
            break;
          }
          case 'queue:dropped': {
            // Its turn came and the phone could not take it. Said out loud,
            // because a queued card simply vanishing looks like a bug.
            toast.error(`${payload.deviceName ?? 'A device'} was skipped: ${payload.reason ?? 'could not start'}`, {
              duration: 7000,
            });
            refetchQueue();
            break;
          }
          case 'proxy:rotated': {
            // The rotation is the moment the user cares about: the phone is
            // done and the lane now has a different address. Shown as it
            // happens rather than left for them to discover.
            const laneName = payload.proxyName ?? 'Proxy';
            const finishedOn = payload.deviceName ? ` after ${payload.deviceName}` : '';

            if (payload.ok) {
              toast.success(
                payload.newIp
                  ? `${laneName}: new IP ${payload.newIp}${finishedOn}`
                  : `${laneName}: rotated${finishedOn}`,
                { duration: 5000 },
              );
            } else {
              toast.error(`${laneName}: rotation failed — ${payload.status ?? 'unknown error'}`, { duration: 7000 });
            }

            // Keeps the lane header's IP honest without waiting for a refetch.
            refetchProxies();
            break;
          }
          case 'task:completed':
            patchRuntime(deviceId, {
              isRunning: false,
              finishedAt: Date.now(),
              finishedOk: Boolean(payload.success),
              finishedMessage: payload.message,
              finishedReason: payload.reasonCode ?? undefined,
            });
            break;
          case 'task:cancelled':
            patchRuntime(deviceId, {
              isRunning: false,
              finishedAt: Date.now(),
              finishedOk: false,
              finishedMessage: 'Cancelled',
              finishedReason: 'USER_CANCELLED',
            });
            break;
          case 'task:error':
            patchRuntime(deviceId, {
              isRunning: false,
              finishedAt: Date.now(),
              finishedOk: false,
              finishedMessage: payload.error,
              finishedReason: payload.reasonCode ?? undefined,
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
    // One socket for the page's lifetime; handlers read live data through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  // Single source of truth for a device's status, mapped only from data that
  // exists — used by both the card badge and the fleet summary so they never
  // disagree.
  /** Newest companion build anyone in this fleet is running. */
  const newestAppVersion = useMemo(() => {
    const versions = (fleetStateData?.data?.devices ?? [])
      .map((entry) => entry.app_version)
      .filter((value): value is string => Boolean(value));
    if (!versions.length) return null;
    return versions.reduce((newest, value) => (compareVersions(value, newest) > 0 ? value : newest));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fleetStateData]);

  const deviceStatusOf = (device: AndroidDevice): FleetStatus => {
    if (device.status !== 'ONLINE') return 'offline';
    const state = runtime[device.id];
    if (state?.startError) return 'failed';
    if (state?.isRunning) return 'running';
    // Waiting for a lane is what this phone is doing now, so it outranks how its
    // previous run ended — otherwise a queued phone kept showing yesterday's
    // result until the page was reloaded.
    if (queuedByDevice.has(device.id)) return 'waiting';
    // Nothing live for this phone in this tab — use the server's answer, which
    // is what keeps a result on the card after a reload.
    const server = serverStateByDevice.get(device.id);
    if (server && !state?.finishedAt && server.state !== 'idle') return server.state as FleetStatus;
    if (state?.finishedAt) {
      if (state.finishedOk) return 'completed';
      if (isInterruption(state.finishedReason)) return 'interrupted';
      if (state.finishedReason === 'USER_CANCELLED') return 'cancelled';
      return 'failed';
    }
    // Connected but the accessibility service is off — after a reboot Android
    // disables it, and the socket reconnects on its own, so the device reads
    // ONLINE while it actually can't run anything. Surface that instead of a
    // false "Ready", which would only fail the moment a task is sent.
    if (device.capabilities && device.capabilities.accessibility === false) return 'needs_setup';
    return 'idle';
  };

  const fleetCounts: FleetCounts = devices.reduce(
    (acc, device) => {
      acc.total += 1;
      acc[deviceStatusOf(device)] += 1;
      return acc;
    },
    { total: 0, running: 0, waiting: 0, failed: 0, completed: 0, idle: 0, needs_setup: 0, interrupted: 0, cancelled: 0, offline: 0 } as FleetCounts,
  );

  /** The instruction a phone last ran: this page's live copy, else the server's record. */
  const lastPromptOf = (deviceId: number): string | undefined =>
    runtime[deviceId]?.prompt ?? serverStateByDevice.get(deviceId)?.task?.prompt ?? undefined;

  /** Failed or interrupted, online, and with an instruction to send again. User-cancelled runs are left alone. */
  const isRetryable = (device: AndroidDevice): boolean => {
    const status = deviceStatusOf(device);
    return (status === 'failed' || status === 'interrupted') && device.status === 'ONLINE' && Boolean(lastPromptOf(device.id));
  };
  const retryableCount = devices.filter(isRetryable).length;

  // When a status filter is active, a device is shown only if it matches.
  const tagKeyOf = (device: AndroidDevice): string => {
    const parsed = parseTag(device.tag);
    return parsed ? parsed.text.toLowerCase() : UNTAGGED;
  };

  // Every distinct tag in the fleet with its colour and how many phones carry it.
  const tagSummary = useMemo(() => {
    const byKey = new Map<string, { text: string; color: TagColor; count: number }>();
    let untagged = 0;
    for (const device of devices) {
      const parsed = parseTag(device.tag);
      if (!parsed) {
        untagged += 1;
        continue;
      }
      const key = parsed.text.toLowerCase();
      const entry = byKey.get(key);
      if (entry) entry.count += 1;
      else byKey.set(key, { text: parsed.text, color: parsed.color, count: 1 });
    }
    const tags = Array.from(byKey.entries())
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
    return { tags, untagged };
  }, [devices]);

  // A tag filter pointing at a tag nobody has any more would hide everything.
  useEffect(() => {
    if (tagFilter === null) return;
    const stillThere =
      tagFilter === UNTAGGED ? tagSummary.untagged > 0 : tagSummary.tags.some((tag) => tag.key === tagFilter);
    if (!stillThere) setTagFilter(null);
  }, [tagFilter, tagSummary]);

  // Status and tag filters combine: both must match.
  const matchesFilter = (device: AndroidDevice) =>
    (statusFilter === null || deviceStatusOf(device) === statusFilter) &&
    (tagFilter === null || tagKeyOf(device) === tagFilter);

  const renderDeviceCard = (device: AndroidDevice) => {
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
                  borderRadius: '26px',
                  overflow: 'hidden',
                  // Near-opaque white instead of a blur: twenty cards with live
                  // screens would make backdrop blur expensive to repaint.
                  bgcolor: 'rgba(255,255,255,.84)',
                  border: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  // State shows as a ring: red when a run could not start, the
                  // accent while selected, a soft white edge otherwise. Running
                  // phones get the moving halo behind the handset instead.
                  boxShadow: [
                    state.startError
                      ? 'inset 0 0 0 2px #dc2626'
                      : isSelected
                        ? `inset 0 0 0 2px ${alpha(PRISM_ACCENT, 0.7)}`
                        : 'inset 0 0 0 1px rgba(255,255,255,.95)',
                    state.isRunning ? '0 26px 56px -20px rgba(59, 76, 255, 0.4)' : '0 18px 40px -24px rgba(30, 40, 90, 0.3)',
                  ].join(', '),
                  transition: 'box-shadow 250ms ease, transform 250ms cubic-bezier(.2,.8,.2,1)',
                  '&:hover': { transform: 'translateY(-3px)' },
                  '@media (prefers-reduced-motion: reduce)': { transition: 'none', '&:hover': { transform: 'none' } },
                }}
              >
                {/* Header */}
                <Stack direction="row" alignItems="center" gap={0.5} sx={{ px: 1, pt: 1 }}>
                  <Checkbox size="small" checked={isSelected} disabled={!isOnline} onChange={() => toggleDevice(device.id)} />
                  <Typography
                    variant="body2"
                    noWrap
                    sx={{ fontWeight: 800, fontSize: 14.5, minWidth: 0, flexShrink: 1, letterSpacing: '-0.01em' }}
                  >
                    {device.device_name}
                  </Typography>
                  <DeviceTagChip tag={device.tag} onSave={(value) => saveTag(device.id, value)} />
                  {(() => {
                    // Phones report their companion build on every heartbeat.
                    // Anything behind the newest build in the fleet is flagged,
                    // so a rollout can be finished without checking each handset.
                    const version = serverStateByDevice.get(device.id)?.app_version;
                    if (!version) return null;
                    const behind = newestAppVersion !== null && compareVersions(version, newestAppVersion) < 0;
                    return (
                      <Tooltip title={behind ? `Companion ${version} — newest in this fleet is ${newestAppVersion}` : `Companion ${version}`}>
                        <Box
                          component="span"
                          sx={{
                            px: 0.7,
                            py: '1px',
                            borderRadius: 1,
                            fontSize: 10.5,
                            fontWeight: 700,
                            flexShrink: 0,
                            color: behind ? 'warning.dark' : 'text.disabled',
                            bgcolor: behind ? alpha('#ea580c', 0.14) : 'transparent',
                            border: behind ? 'none' : '1px solid',
                            borderColor: 'divider',
                          }}
                        >
                          {behind ? `v${version} · update` : `v${version}`}
                        </Box>
                      </Tooltip>
                    );
                  })()}
                  {(() => {
                    // A pushed companion update, reported by the phone itself.
                    // Filled when someone has to do something on the handset.
                    const update = serverStateByDevice.get(device.id)?.update;
                    const info = describeInstallStage(update?.status);
                    if (!update || !info) return null;
                    const palette = { success: '#059669', warning: '#d97706', error: '#dc2626', info: '#0284c7', default: '#64748b' }[info.tone];
                    return (
                      <Tooltip title={update.message ? `${update.file_name}: ${update.message}` : update.file_name}>
                        <Box
                          component="span"
                          sx={{
                            px: 0.7,
                            py: '1px',
                            borderRadius: 1,
                            fontSize: 10.5,
                            fontWeight: 700,
                            flexShrink: 0,
                            whiteSpace: 'nowrap',
                            color: info.needsYou ? '#fff' : palette,
                            bgcolor: info.needsYou ? palette : alpha(palette, 0.12),
                          }}
                        >
                          {info.label}
                        </Box>
                      </Tooltip>
                    );
                  })()}
                  {(() => {
                    // Only worth space when it needs attention: a phone off the
                    // charger dies mid-run, and its runs fail as "offline".
                    const battery = serverStateByDevice.get(device.id)?.battery;
                    if (battery == null || battery > 20) return null;
                    return (
                      <Tooltip title={`Battery ${battery}% — put this phone on charge`}>
                        <Box
                          component="span"
                          sx={{ px: 0.7, py: '1px', borderRadius: 1, fontSize: 10.5, fontWeight: 700, flexShrink: 0, color: 'error.dark', bgcolor: alpha('#dc2626', 0.12) }}
                        >
                          {battery}%
                        </Box>
                      </Tooltip>
                    );
                  })()}
                  {(() => {
                    // Companion 0.32: a hot phone throttles and drops runs; missions wait for it to cool.
                    const health = serverStateByDevice.get(device.id)?.health;
                    const temp = health?.temperatureC;
                    const lowStorage = typeof health?.freeStorageMb === 'number' && health.freeStorageMb < 500;
                    if ((temp == null || temp < 43) && !health?.lowMemory && !lowStorage) return null;
                    const label = temp != null && temp >= 43 ? `${Math.round(temp)}°C` : lowStorage ? 'Storage' : 'Memory';
                    const why =
                      temp != null && temp >= 43
                        ? `Battery at ${temp.toFixed(1)}°C${health?.charging ? ' while charging' : ''} — missions wait for it to cool below 46°C`
                        : lowStorage
                          ? `Only ${health?.freeStorageMb} MB free — apps and downloads may fail`
                          : 'The phone reports low memory — apps may be killed mid-run';
                    return (
                      <Tooltip title={why}>
                        <Box
                          component="span"
                          sx={{ px: 0.7, py: '1px', borderRadius: 1, fontSize: 10.5, fontWeight: 700, flexShrink: 0, color: 'warning.dark', bgcolor: alpha('#f59e0b', 0.16) }}
                        >
                          {label}
                        </Box>
                      </Tooltip>
                    );
                  })()}
                  <Box sx={{ flexGrow: 1 }} />
                  {(() => {
                    const laneId = proxyIdFor(device);
                    const lane = laneId ? proxyById.get(laneId) : undefined;
                    if (!lane) return null;
                    return (
                      <Tooltip title={`Proxy: ${lane.name}`}>
                        <Chip
                          size="small"
                          label={proxyShortName(lane.name)}
                          sx={{
                            height: 20,
                            fontSize: '0.68rem',
                            fontWeight: 700,
                            color: '#fff',
                            bgcolor: proxyColor(laneId),
                          }}
                        />
                      </Tooltip>
                    );
                  })()}
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
                  {isAdmin && (
                    <Tooltip title="Capture this screen for the landing page">
                      <span>
                        <IconButton size="small" disabled={!isOnline || capturingLanding} onClick={() => void captureForLanding([device.id])}>
                          <PhotoCameraIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  )}
                  <Tooltip title="Send a file to this device">
                    <span>
                      <IconButton size="small" onClick={() => setFileDeviceId(device.id)}>
                        <AttachFileIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Open a settings screen on this phone">
                    <span>
                      <IconButton
                        size="small"
                        disabled={device.status !== 'ONLINE'}
                        onClick={(event) => setSettingsMenu({ anchor: event.currentTarget, deviceId: device.id })}
                      >
                        <TuneIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                </Stack>

                <DeviceEmailRow deviceId={device.id} value={serverStateByDevice.get(device.id)?.emails} />
                <DeviceNetworkRow deviceId={device.id} name={device.device_name} online={isOnline} value={serverStateByDevice.get(device.id)?.network} />

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
                <Box sx={{ position: 'relative' }}>
                {/* Running: a slow prism halo behind the handset, so live work is
                    visible from across the page. Only running phones pay for it. */}
                {state.isRunning && (
                  <Box
                    aria-hidden
                    sx={{
                      position: 'absolute',
                      left: '50%',
                      top: 12,
                      bottom: 12,
                      width: 286,
                      transform: 'translateX(-50%)',
                      borderRadius: '56px',
                      background: `linear-gradient(120deg, ${PRISM_ACCENT}, ${PRISM_PINK}, #22d3ee, ${PRISM_ACCENT})`,
                      backgroundSize: '300% 300%',
                      filter: 'blur(18px)',
                      opacity: 0.55,
                      animation: `${haloShift} 5s linear infinite`,
                      pointerEvents: 'none',
                      '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
                    }}
                  />
                )}
                <PhoneFrame3D
                  width={248}
                  // 9:19, matching the Android Agent page's mockup, so the two
                  // views show a phone of the same shape.
                  //
                  // Taller while driving: turning control on makes
                  // InteractiveDeviceScreen add a Back/Home/Recents row and a
                  // 2px outline inside this same box, and at the fixed height
                  // those squeezed the frame and spilled past its edges. The
                  // extra room lets the row sit along the bottom of the glass,
                  // where a real phone keeps its nav bar anyway.
                  height={controlDeviceId === device.id ? 580 : 524}
                  tilt={controlDeviceId !== device.id}
                  active={state.isRunning}
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
                </PhoneFrame3D>
                </Box>

                <Divider sx={{ borderColor: 'rgba(20,26,46,.06)' }} />

                {/* Status — the visual priority of the card. Rendered from
                    reusable status components so every state looks consistent. */}
                <CardContent sx={{ py: 1.25, flexGrow: 1, '&:last-child': { pb: 1.25 } }}>
                  {(() => {
                    const status = deviceStatusOf(device);
                    // Anything that ended without finishing can be retried.
                    const failed = status === 'failed' || status === 'interrupted' || status === 'cancelled';
                    const server = serverStateByDevice.get(device.id);
                    const detail = state.startError
                      || (state.isRunning ? state.lastThought || state.prompt || 'Working…' : '')
                      || (state.finishedAt ? state.finishedMessage ?? '' : '')
                      // After a reload the live runtime is empty, so fall back to
                      // what the server recorded for the last run.
                      || (server?.task && server.state !== 'idle'
                        ? reasonLabel(server.task.reason_code) || server.task.message || ''
                        : '');

                    return (
                      <Stack gap={0.75}>
                        <DeviceStatusBadge
                          status={status}
                          labelSuffix={status === 'running' ? `· step ${state.stepIndex}` : undefined}
                          trailing={
                            state.isRunning ? (
                              <Tooltip title="Stop this task">
                                <IconButton size="small" sx={{ color: 'inherit', p: 0.25 }} onClick={() => handleStopDevice(device.id)}>
                                  <StopCircleIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            ) : failed && (state.prompt || server?.task?.prompt) ? (
                              <Tooltip title="Retry this task">
                                <IconButton
                                  size="small"
                                  sx={{ color: 'inherit', p: 0.25 }}
                                  onClick={() => void dispatchTo([device.id], (state.prompt ?? server?.task?.prompt) as string)}
                                >
                                  <ReplayIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                            ) : undefined
                          }
                        />

                        {state.isRunning && (
                          <TaskProgress
                            step={state.stepIndex}
                            budget={maxSteps}
                            startedAt={state.startedAt}
                            action={state.lastAction}
                          />
                        )}

                        {detail && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', px: 0.25 }}
                          >
                            {detail}
                          </Typography>
                        )}

                        {failed && (state.prompt || server?.task?.prompt) && (
                          <RetryButton onClick={() => void dispatchTo([device.id], (state.prompt ?? server?.task?.prompt) as string)} />
                        )}
                      </Stack>
                    );
                  })()}
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

                {/* Waiting for its lane. Shown above the proxy picker so the
                    reason a phone is idle is next to what it is waiting on. */}
                {queuedByDevice.has(device.id) && (
                  <Box sx={{ px: 1, pb: 0.5 }}>
                    <Stack
                      direction="row"
                      alignItems="center"
                      gap={1}
                      sx={{
                        px: 1.25,
                        py: 0.75,
                        borderRadius: 1.5,
                        border: '1px dashed',
                        borderColor: 'divider',
                        bgcolor: 'action.hover',
                        color: 'text.secondary',
                      }}
                    >
                      <HourglassEmptyIcon fontSize="small" />
                      <Typography variant="caption" sx={{ fontWeight: 700, flexGrow: 1 }} noWrap>
                        Waiting for the proxy lane
                      </Typography>
                      <Button
                        size="small"
                        color="inherit"
                        onClick={async () => {
                          const entry = queuedByDevice.get(device.id);
                          if (!entry) return;
                          try {
                            await cancelQueued(entry.id).unwrap();
                            refetchQueue();
                            toast.success('Removed from the queue');
                          } catch {
                            toast.error('Could not cancel');
                          }
                        }}
                      >
                        Cancel
                      </Button>
                    </Stack>
                  </Box>
                )}

                {/* Which proxy lane this phone sits on. Memoized so background
                    frame/heartbeat re-renders don't collapse the open menu. */}
                {proxies.length > 0 && (
                  <DeviceProxySelect
                    deviceId={device.id}
                    value={proxyIdFor(device)}
                    proxies={proxies}
                    onChange={handleProxyChange}
                  />
                )}

                {/* One-tap controls for this phone alone. */}
                <Stack direction="row" justifyContent="center" sx={{ px: 1, pb: 0.5 }}>
                  <DeviceControls
                    deviceIds={[device.id]}
                    disabled={!isOnline}
                    onFrame={(deviceId, base64) => patchRuntime(deviceId, { screenshot: base64 })}
                  />
                </Stack>

              </Card>
            );
  };


  /** The card grid, used once per lane and once for the flat view. */
  // What a single card depends on. Values that are rebuilt every render (the
  // proxy map, per-device task arrays) are reduced to stable values here so the
  // memo only breaks when the card's real content changes.
  const cardDeps = (device: AndroidDevice): unknown[] => {
    const laneId = proxyIdFor(device);
    return [
      device,
      runtime[device.id],
      serverStateByDevice.get(device.id),
      selectedIds.includes(device.id),
      queuedByDevice.get(device.id),
      (tasksByDevice[device.id] ?? []).length,
      laneId,
      laneId ? proxyById.get(laneId) : undefined,
      proxies,
      controlDeviceId,
      maxSteps,
      deviceConfigIds[device.id],
      broadcastConfigId,
      aiConfigs,
      activeAiConfig?.id,
      isAdmin,
      capturingLanding,
    ];
  };

  // A plain render function, NOT a component. Declared as a component inside
  // the page, it got a new identity on every render, so React unmounted and
  // remounted the entire grid — every card, image and control — on each frame
  // or poll. That was the root of the fleet page's sluggishness.
  const renderDeviceGrid = (list: AndroidDevice[]) => {
    const shown = list.filter(matchesFilter);
    if (shown.length === 0) {
      return (
        <Typography variant="caption" color="text.secondary" sx={{ px: 1, py: 2, display: 'block' }}>
          No devices match this filter.
        </Typography>
      );
    }
    return (
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            // auto-fill rather than a fixed count: two devices on a wide screen
            // stay card-sized instead of stretching into two huge panels.
            gridTemplateColumns: 'repeat(auto-fill, minmax(470px, 1fr))',
            alignItems: 'start',
          }}
        >
          {shown.map((device) => (
            <MemoCard key={device.id} render={() => renderDeviceCard(device)} deps={cardDeps(device)} />
          ))}
        </Box>
    );
  };

  /**
   * One proxy lane as a glass shelf: its name and exit IP, what is running and
   * waiting on it, and a Retry for the phones on it that failed.
   *
   * No backdrop blur on the shelf: it holds live screens and sits over the
   * animated prism, so a blur would be recomputed across the whole shelf on
   * every frame.
   */
  const renderLane = ({
    key,
    name,
    color,
    ip,
    laneDevices,
    note,
    emptyText,
  }: {
    key: number | string;
    name: string;
    color: string;
    ip?: string | null;
    laneDevices: AndroidDevice[];
    note: string;
    emptyText?: string;
  }) => {
    const running = laneDevices.filter((device) => runtime[device.id]?.isRunning).length;
    const waiting = laneDevices.filter((device) => queuedByDevice.has(device.id)).length;
    const failed = laneDevices.filter(isRetryable).length;
    const initials = name.replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase() || '—';
    return (
      <Box
        key={key}
        component="section"
        sx={{
          borderRadius: { xs: '24px', md: '32px' },
          p: { xs: 1.25, md: 2.25 },
          bgcolor: 'rgba(255,255,255,.46)',
          border: '1px solid rgba(255,255,255,.9)',
          boxShadow: '0 40px 80px -56px rgba(20,26,46,.45)',
        }}
      >
        <Stack direction="row" alignItems="center" gap={1.25} flexWrap="wrap" useFlexGap sx={{ mb: 2, px: { xs: 0.5, md: 0.5 } }}>
          <Box
            sx={{
              width: 42,
              height: 42,
              flexShrink: 0,
              borderRadius: '13px',
              display: 'grid',
              placeItems: 'center',
              color: '#fff',
              fontWeight: 800,
              fontSize: 14,
              background: `linear-gradient(140deg, ${color}, ${alpha(color, 0.72)})`,
              boxShadow: `0 10px 22px -10px ${alpha(color, 0.8)}`,
            }}
          >
            {initials}
          </Box>
          <Box sx={{ minWidth: 0 }}>
            <Typography component="h2" sx={{ m: 0, fontWeight: 800, fontSize: { xs: 18, md: 22 }, letterSpacing: '-0.02em', lineHeight: 1.15 }} noWrap>
              {name}
            </Typography>
            <Typography sx={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12, color: PRISM_MUTED }} noWrap>
              {ip ? `${ip} · ` : ''}
              {laneDevices.length} phone{laneDevices.length === 1 ? '' : 's'}
            </Typography>
          </Box>
          <Box sx={{ flexGrow: 1 }} />
          {failed > 0 && (
            <Button
              size="small"
              startIcon={<ReplayIcon />}
              disabled={isDispatching}
              onClick={() => void retryFailedIn(laneDevices)}
              sx={{ height: 34, px: 1.5, borderRadius: 999, fontWeight: 800, textTransform: 'none', color: '#b91c1c', bgcolor: 'rgba(220,38,38,.1)', '&:hover': { bgcolor: 'rgba(220,38,38,.16)' } }}
            >
              {failed} failed · Retry
            </Button>
          )}
          <Box sx={{ height: 34, px: 1.5, borderRadius: 999, display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'rgba(255,255,255,.82)', fontSize: 13, color: PRISM_INK, whiteSpace: 'nowrap' }}>
            <Box component="span" sx={{ fontWeight: 800, color: running ? PRISM_ACCENT : PRISM_MUTED }}>{running} running</Box>
            <Box component="span" sx={{ color: PRISM_MUTED }}>·</Box>
            <Box component="span" sx={{ fontWeight: 700, color: waiting ? '#b45309' : PRISM_MUTED }}>{waiting} waiting</Box>
          </Box>
          <Typography sx={{ fontSize: 12.5, color: PRISM_MUTED, fontWeight: 600 }}>{note}</Typography>
        </Stack>
        {laneDevices.length === 0 ? (
          <Typography variant="caption" color="text.secondary" sx={{ pl: 1 }}>
            {emptyText}
          </Typography>
        ) : (
          renderDeviceGrid(laneDevices)
        )}
      </Box>
    );
  };


  /**
   * Devices split into their proxy lanes.
   *
   * Which phone is on which proxy is the thing that is impossible to see in a
   * flat grid of twenty-two cards, and it is exactly what decides when each one
   * runs — so it becomes the page's structure rather than a field inside a card.
   * Devices with no proxy collect at the end under their own heading.
   */
  const lanes = useMemo(() => {
    const groups = proxies.map((proxy) => ({
      proxy,
      devices: orderedDevices.filter((device) => proxyIdFor(device) === proxy.id),
    }));
    const unassigned = orderedDevices.filter((device) => !proxyIdFor(device));
    return { groups, unassigned };
  }, [proxies, orderedDevices, proxyOverrides]);

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
    // Flag devices whose accessibility is off — they read connected but can't
    // act, so a task would just fail. Warn once rather than sending into a wall.
    const notReady = deviceIds
      .map((id) => devices.find((device) => device.id === id))
      .filter((device): device is AndroidDevice => Boolean(device) && device!.capabilities?.accessibility === false);
    if (notReady.length > 0) {
      toast.error(
        notReady.length === 1
          ? `${notReady[0].device_name} needs its accessibility service turned back on`
          : `${notReady.length} devices need accessibility turned back on`,
      );
    }
    // The previous run's result is no longer this phone's state the moment a new
    // task is sent, so it goes before anything comes back.
    for (const deviceId of deviceIds) {
      patchRuntime(deviceId, {
        finishedAt: undefined,
        finishedOk: undefined,
        finishedMessage: undefined,
        finishedReason: undefined,
        startError: undefined,
        stepIndex: 0,
        lastThought: undefined,
        lastAction: undefined,
      });
    }

    setIsDispatching(true);
    const outcomes = await Promise.allSettled(
      deviceIds.map((deviceId) =>
        runTask({
          device_id: deviceId,
          prompt: text,
          max_steps: maxSteps,
          ai_config_id: deviceConfigIds[deviceId] || broadcastConfigId || undefined,
          skip_proxy_lane: skipProxyLane || undefined,
        }).unwrap(),
      ),
    );
    setIsDispatching(false);

    const startedIds: number[] = [];
    const queuedIds: number[] = [];
    const failedIds: number[] = [];

    outcomes.forEach((outcome, index) => {
      const deviceId = deviceIds[index];
      if (outcome.status === 'fulfilled') {
        // A phone behind a busy proxy lane is accepted but not started yet, and
        // saying "started" for it would be wrong — nothing is running on it.
        if ((outcome.value as { data?: { queued?: boolean } })?.data?.queued) queuedIds.push(deviceId);
        else startedIds.push(deviceId);
        patchRuntime(deviceId, { startError: undefined });
      } else {
        failedIds.push(deviceId);
        patchRuntime(deviceId, { startError: errorMessage(outcome.reason), isRunning: false });
      }
    });

    setLastDispatch({ prompt: text, startedIds, failedIds });
    // Keep only the failed ones selected so a retry hits exactly those.
    setSelectedIds(failedIds);
    if (queuedIds.length) refetchQueue();

    if (startedIds.length) toast.success(`Started on ${startedIds.length} device${startedIds.length > 1 ? 's' : ''}`);
    if (queuedIds.length) toast.success(`${queuedIds.length} waiting for a free proxy lane`);
    if (failedIds.length) toast.error(`${failedIds.length} device${failedIds.length > 1 ? 's' : ''} could not start`);
  };

  /**
   * Pulls one fresh frame from every online phone.
   *
   * Requests go out in small batches rather than all at once: each frame is a
   * full screenshot travelling up from the handset, and twenty of those firing
   * together saturates the uplink and times half of them out. A device that
   * fails is skipped quietly — its card keeps whatever it had.
   */
  // Auto-pull every screen once the fleet page has online devices, so frames
  // appear on load without the user clicking "Show all screens". Guarded to run
  // a single time per mount: it flips true as soon as one auto-run fires, and
  // resets only when the page is left and re-entered (component remount).
  // Captures a fresh frame from a specific set of devices, in small batches so
  // a big fleet does not fire two dozen captures at once. Returns how many
  // returned a frame. Shared by the manual "Screens" button and the auto-show.
  const captureFrames = async (targets: AndroidDevice[]): Promise<number> => {
    let captured = 0;
    const BATCH = 4;
    for (let start = 0; start < targets.length; start += BATCH) {
      const batch = targets.slice(start, start + BATCH);
      const results = await Promise.allSettled(
        batch.map(async (device) => {
          // Preview frame, not full resolution: the card is ~250px wide, and 22
          // full 1080x2400 frames decoded at once cost the tab 200MB+ of image
          // memory — a large part of why it crashed. Enlarge fetches its own.
          const response = await sendDirectAction({
            device_id: device.id,
            action: { type: 'CaptureScreen', preview: true, awaitStability: false },
          }).unwrap();
          const base64 = response?.data?.screenCapture?.base64Data;
          if (base64) patchRuntime(device.id, { screenshot: base64 });
          return Boolean(base64);
        }),
      );
      captured += results.filter((result) => result.status === 'fulfilled' && result.value).length;
    }
    return captured;
  };

  // Auto-pull screens so the fleet page shows frames without a click. Unlike the
  // one-shot version, this also fills in any device that is still frameless —
  // whether it just came online, or missed the first capture because it was busy
  // or slow. It targets only the phones actually missing a frame, so it is cheap
  // and self-healing rather than a full re-capture on every change.
  const autoShowInFlight = useRef(false);
  useEffect(() => {
    const missing = onlineDevices.filter((device) => !runtime[device.id]?.screenshot);
    if (missing.length === 0) return;
    if (autoShowInFlight.current || isRefreshingFrames) return;

    autoShowInFlight.current = true;
    void (async () => {
      try {
        await captureFrames(missing);
        // A second pass a moment later mops up phones that were mid-task or slow
        // on the first try, so a card does not sit black indefinitely.
        await new Promise((resolve) => setTimeout(resolve, 2500));
        const stillMissing = onlineDevices.filter((device) => !runtime[device.id]?.screenshot);
        if (stillMissing.length > 0) await captureFrames(stillMissing);
      } finally {
        autoShowInFlight.current = false;
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlineDevices.map((device) => device.id).join(','), isRefreshingFrames]);

  const handleRefreshAllFrames = async (silent = false) => {
    const targets = onlineDevices;
    if (targets.length === 0) {
      if (!silent) toast.error('No devices are online');
      return;
    }

    setIsRefreshingFrames(true);
    try {
      const captured = await captureFrames(targets);
      if (!silent) {
        if (captured === 0) toast.error('No phone returned a frame');
        else if (captured < targets.length) toast.success(`Got ${captured} of ${targets.length} screens`);
        else toast.success(`Refreshed ${captured} screens`);
      }
    } finally {
      setIsRefreshingFrames(false);
    }
  };

  /**
   * Sends one picked file to every selected device.
   *
   * The bytes are read once and posted once; the server makes a copy per device
   * so each phone's transfer can succeed or fail on its own.
   */
  const handleSendFile = async (file: File) => {
    if (selectedIds.length === 0) return toast.error('Select at least one device');
    if (file.size > MAX_FILE_BYTES) {
      return toast.error(`That file is ${Math.round(file.size / (1024 * 1024))} MB. The limit is 100 MB.`);
    }

    const mime = file.type || 'application/octet-stream';
    try {
      if (file.size <= INLINE_UPLOAD_LIMIT) {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          // readAsDataURL gives "data:<mime>;base64,<payload>" — only the payload
          // goes to the server.
          reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
          reader.onerror = () => reject(new Error('Could not read the file'));
          reader.readAsDataURL(file);
        });

        await queueFile({
          device_ids: selectedIds,
          file_name: file.name,
          mime_type: mime,
          content_base64: base64,
        }).unwrap();
      } else {
        // Anything larger goes up in raw chunks — the same path the send-file
        // dialog uses. Base64 in one request is what the 12 MB refusal was about,
        // and an APK for a fleet update is well past it.
        const sha256 = await sha256Hex(file);
        const totalChunks = Math.ceil(file.size / UPLOAD_CHUNK_SIZE);
        const init = await initDeviceUpload({
          device_ids: selectedIds,
          file_name: file.name,
          mime_type: mime,
          size_bytes: file.size,
          sha256,
          total_chunks: totalChunks,
        }).unwrap();

        const uploadId = init.data.upload_id;
        const progress = toast.loading(`Uploading ${file.name} — 0%`);
        try {
          for (let index = 0; index < totalChunks; index += 1) {
            const start = index * UPLOAD_CHUNK_SIZE;
            await uploadChunk(uploadId, index, file.slice(start, Math.min(start + UPLOAD_CHUNK_SIZE, file.size)));
            toast.loading(`Uploading ${file.name} — ${Math.round(((index + 1) / totalChunks) * 100)}%`, { id: progress });
          }
          await finishDeviceUpload({ upload_id: uploadId }).unwrap();
        } finally {
          toast.dismiss(progress);
        }
      }

      toast.success(`Sent ${file.name} to ${selectedIds.length} device${selectedIds.length === 1 ? '' : 's'}`);
    } catch (err: any) {
      toast.error(err?.data?.message || err?.message || 'Could not send the file');
    }
  };

  const handleRunOnSelected = async (typed?: string) => {
    // The prompt box keeps its own draft and hands it over on submit, so the
    // typed value wins over the debounced copy the page holds.
    const text = (typed ?? prompt).trim();
    if (!text) return toast.error('Enter a task first');
    if (selectedIds.length === 0) return toast.error('Select at least one device');
    if (!ensureReady()) return;
    await dispatchTo(selectedIds, text);
    // Task is on its way — empty the box so it doesn't look unsent.
    setPrompt('');
    setPromptResetSignal((value) => value + 1);
  };

  /**
   * Re-runs every failed or interrupted phone in `list` with the instruction it
   * last ran. This is what the floating run-activity panel's per-row retry did;
   * it now sits on the status bar (whole fleet) and on each lane's header.
   * Phones that ran different instructions are sent each their own.
   */
  const retryFailedIn = async (list: AndroidDevice[]) => {
    const targets = list.filter(isRetryable);
    if (targets.length === 0) {
      toast('Nothing to retry');
      return;
    }
    if (!ensureReady()) return;
    const byPrompt = new Map<string, number[]>();
    for (const device of targets) {
      const text = lastPromptOf(device.id) as string;
      byPrompt.set(text, [...(byPrompt.get(text) ?? []), device.id]);
    }
    for (const [text, ids] of byPrompt) await dispatchTo(ids, text);
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

  const handleStopDevice = async (deviceId: number) => {
    // Prefer the taskId we hold; fall back to the backend's running task for this
    // device, so a stop works even for a task that started before this page.
    const device = devices.find((d) => d.id === deviceId);
    const taskId =
      runtime[deviceId]?.taskId ??
      (tasksData?.data ?? []).find((task) => task.is_running && task.device_id === deviceId)?.id;
    if (typeof taskId !== 'number') {
      toast('Nothing is running on this device');
      return;
    }
    // Clear immediately so the stop feels instant.
    patchRuntime(deviceId, { isRunning: false });
    try {
      await cancelTask(taskId).unwrap();
      toast.success(device ? `Stopped ${device.device_name}` : 'Stop requested');
    } catch {
      toast.error('Could not stop the task');
      refetchQueue();
    }
  };

  const handleStopAll = async () => {
    // Clear the waiting queue FIRST. Cancelling a running task frees its lane,
    // which immediately drains the queue and starts the next waiting phone — so
    // without this, Stop All stopped the running ones and started the waiting
    // ones. With the queue emptied, a cancelled task has nothing to hand its
    // lane to.
    try {
      await clearAllQueued().unwrap();
    } catch {
      // Non-fatal: still cancel the running tasks below.
    }

    // Collect every task id that is running — from the live runtime map AND from
    // the backend task list. The list is the source of truth (it catches tasks
    // started before this page was open, or on another tab), so a Stop all can
    // never miss a running phone just because our in-memory map lagged.
    const taskIds = new Set<number>();
    for (const state of Object.values(runtime) as DeviceRuntime[]) {
      if (state.isRunning && typeof state.taskId === 'number') taskIds.add(state.taskId);
    }
    for (const task of tasksData?.data ?? []) {
      if (task.is_running && typeof task.id === 'number') taskIds.add(task.id);
    }

    if (taskIds.size === 0) {
      toast('Nothing is running');
      return;
    }

    const ids = Array.from(taskIds);
    // Optimistically clear running state so the UI reacts instantly, before the
    // cancels round-trip — a stop must feel immediate.
    setRuntime((prev) => {
      const next: RuntimeMap = { ...prev };
      for (const key of Object.keys(next) as unknown as number[]) {
        if (next[key]?.isRunning) next[key] = { ...next[key], isRunning: false };
      }
      return next;
    });

    const results = await Promise.allSettled(ids.map((taskId) => cancelTask(taskId).unwrap()));
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed === 0) {
      toast.success(`Stopped ${ids.length} task${ids.length === 1 ? '' : 's'}`);
    } else {
      toast.error(`${failed} of ${ids.length} could not be stopped — retrying may help`);
    }
    // Re-sync from the backend so anything that refused to cancel reappears.
    refetchQueue();
  };

  const historyDevice = devices.find((device) => device.id === historyDeviceId);
  const fileDevice = devices.find((device) => device.id === fileDeviceId);
  const historyTasks = historyDeviceId !== null ? tasksByDevice[historyDeviceId] ?? [] : [];

  // ---- Render ------------------------------------------------------------

  return (
    // Glass Grid: the page sits on the app's prism, like Mission Control and Settings.
    // The negative margins cancel AuthLayout's padding so the prism fills the view.
    <Box
      sx={{
        position: 'relative',
        display: 'flex',
        alignItems: 'flex-start',
        mx: { xs: -1.5, sm: -2, md: -3 },
        mt: { xs: '-12px', md: '-24px' },
        mb: { xs: -10, md: -3 },
        minHeight: 'calc(100vh - 64px)',
        overflow: 'hidden',
        color: PRISM_INK,
      }}
    >
      <PrismBackground />
      <Box sx={{ position: 'relative', zIndex: 1, flexGrow: 1, minWidth: 0, px: { xs: 2, md: 4 }, pt: { xs: 3, md: 4 }, pb: { xs: 12, md: 6 }, maxWidth: 1680, mx: 'auto' }}>
      {/* Prism Orbit: the instruction is the centre of the page and the phones
          sit below it in their lanes. */}
      <Stack alignItems="center" gap={2} sx={{ mb: 3, textAlign: 'center', animation: `${riseIn} .6s cubic-bezier(.2,.8,.2,1) both`, '@media (prefers-reduced-motion: reduce)': { animation: 'none' } }}>
        <Typography sx={{ ...monoLabel, color: '#3730a3' }}>
          Device fleet · {devices.length} phone{devices.length === 1 ? '' : 's'} · {onlineDevices.length} online
        </Typography>
        <Typography
          component="h1"
          sx={{ m: 0, maxWidth: 940, fontSize: { xs: 32, sm: 44, md: 58, xl: 66 }, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.05em', color: PRISM_INK, textWrap: 'balance' }}
        >
          What should{' '}
          <Box component="span" sx={{ background: `linear-gradient(100deg, ${PRISM_ACCENT}, #a855f7 50%, ${PRISM_PINK})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>
            {selectedIds.length > 0
              ? `${selectedIds.length} selected phone${selectedIds.length === 1 ? '' : 's'}`
              : `your ${onlineDevices.length || ''} phone${onlineDevices.length === 1 ? '' : 's'}`.replace('  ', ' ')}
          </Box>{' '}
          do next?
        </Typography>

        {/* The instruction pill. The field keeps its own draft (typing must not
            redraw twenty live cards), the button reads the debounced copy. */}
        <Box
          sx={{
            width: '100%',
            maxWidth: 920,
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            alignItems: { xs: 'stretch', sm: 'center' },
            gap: 1,
            p: 1,
            pl: { sm: 2 },
            borderRadius: { xs: '24px', sm: '999px' },
            bgcolor: 'rgba(255,255,255,.76)',
            backdropFilter: 'blur(18px)',
            WebkitBackdropFilter: 'blur(18px)',
            boxShadow: selectedIds.length > 0
              ? `0 0 0 2px ${alpha(PRISM_ACCENT, 0.35)}, 0 30px 60px -30px rgba(59,76,255,.55)`
              : '0 0 0 1px rgba(255,255,255,.95), 0 30px 60px -30px rgba(59,76,255,.4)',
            transition: 'box-shadow 220ms ease',
            textAlign: 'left',
            '& .MuiOutlinedInput-root': { fontSize: 17, bgcolor: 'transparent', '& fieldset': { border: 0 } },
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <FleetPromptField onDraftChange={setPrompt} onSubmit={(text) => void handleRunOnSelected(text)} resetSignal={promptResetSignal} />
          </Box>
          <Button
            variant="contained"
            disableElevation
            startIcon={isDispatching ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
            disabled={isDispatching || selectedIds.length === 0 || !prompt.trim()}
            onClick={() => void handleRunOnSelected()}
            sx={{
              flexShrink: 0,
              height: 52,
              px: 3,
              borderRadius: '999px',
              fontWeight: 800,
              textTransform: 'none',
              fontSize: 15,
              color: '#fff',
              whiteSpace: 'nowrap',
              background: `linear-gradient(110deg, ${PRISM_ACCENT} 0%, ${PRISM_PINK} 100%)`,
              boxShadow: '0 14px 30px rgba(59, 76, 255, 0.30)',
              '&:hover': { background: 'linear-gradient(110deg, #2f3ee0 0%, #db2777 100%)' },
              '&.Mui-disabled': { background: 'rgba(20,26,46,.08)', color: PRISM_MUTED, boxShadow: 'none' },
            }}
          >
            {isDispatching ? 'Starting…' : selectedIds.length ? `Run on ${selectedIds.length}` : 'Select phones'}
          </Button>
        </Box>

        {/* Run options as quiet glass chips under the pill. */}
        <Stack direction="row" justifyContent="center" alignItems="center" flexWrap="wrap" useFlexGap gap={1}>
          <Box
            component="button"
            type="button"
            onClick={selectAllOnline}
            disabled={onlineDevices.length === 0}
            sx={{ ...glassChip, cursor: 'pointer', fontWeight: 700, color: selectedIds.length ? PRISM_ACCENT : PRISM_INK }}
          >
            {selectedIds.length} / {onlineDevices.length} selected ·{' '}
            {selectedIds.length === onlineDevices.length && onlineDevices.length > 0 ? 'Clear' : 'Select all'}
          </Box>
          <TextField
            select
            size="small"
            aria-label="Model"
            value={broadcastConfigId}
            onChange={(event) => setBroadcastConfigId(Number(event.target.value))}
            sx={{ minWidth: 200, '& .MuiOutlinedInput-root': { ...glassField } }}
          >
            <MenuItem value={0}>Model · {activeAiConfig?.model ?? 'none'}</MenuItem>
            {aiConfigs.map((config) => (
              <MenuItem key={config.id} value={config.id}>
                {config.model}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            type="number"
            aria-label="Steps"
            value={maxSteps}
            onChange={(event) => setMaxSteps(Number(event.target.value))}
            onBlur={() => setMaxSteps((prev) => Math.min(20000, Math.max(1, prev || 200)))}
            inputProps={{ min: 1, max: 20000 }}
            InputProps={{ startAdornment: <Typography component="span" sx={{ fontSize: 13, color: PRISM_MUTED, mr: 0.75 }}>Steps</Typography> }}
            sx={{ width: 132, '& .MuiOutlinedInput-root': { ...glassField, fontWeight: 700 } }}
          />
          <Tooltip title="For work that never opens the internet — settings, in-app steps. These run straight away instead of waiting for the proxy lane, and they neither hold the lane nor rotate its IP.">
            <Box component="label" sx={{ ...glassChip, cursor: 'pointer' }}>
              <Checkbox size="small" checked={skipProxyLane} onChange={(event) => setSkipProxyLane(event.target.checked)} sx={{ p: 0.25, ml: -0.5 }} />
              No internet needed · skip the proxy queue
            </Box>
          </Tooltip>
        </Stack>

        {/* The whole fleet in one bar. Each legend entry filters the lanes below;
            failures carry their own Retry, which is what the old floating run
            activity panel was for. */}
        {fleetCounts.total > 0 && (
          <Stack alignItems="center" gap={1.25} sx={{ width: '100%', maxWidth: 640 }}>
            <Box role="img" aria-label="Fleet status" sx={{ width: '100%', display: 'flex', gap: '3px', height: 10, borderRadius: 999, overflow: 'hidden' }}>
              {statusOrder
                .filter((key) => fleetCounts[key] > 0)
                .map((key) => (
                  <Box
                    key={key}
                    sx={{
                      flexGrow: fleetCounts[key],
                      flexBasis: 0,
                      transition: 'flex-grow 400ms ease',
                      ...(key === 'running'
                        ? { background: `linear-gradient(90deg, ${PRISM_ACCENT}, ${PRISM_PINK}, ${PRISM_ACCENT})`, backgroundSize: '200% 100%', animation: `${barSlide} 2s linear infinite` }
                        : { bgcolor: statusAccent(key) }),
                      opacity: statusFilter && statusFilter !== key ? 0.3 : 1,
                    }}
                  />
                ))}
            </Box>
            <Stack direction="row" justifyContent="center" flexWrap="wrap" useFlexGap gap={0.5}>
              {statusOrder
                .filter((key) => fleetCounts[key] > 0 || statusFilter === key)
                .map((key) => {
                  const active = statusFilter === key;
                  return (
                    <Box
                      key={key}
                      component="button"
                      type="button"
                      onClick={() => setStatusFilter(active ? null : key)}
                      aria-pressed={active}
                      sx={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 0.75,
                        px: 1.25,
                        height: 30,
                        border: 0,
                        borderRadius: 999,
                        cursor: 'pointer',
                        font: 'inherit',
                        fontSize: 13,
                        color: active ? '#fff' : PRISM_INK,
                        bgcolor: active ? statusAccent(key) : 'transparent',
                        '&:hover': { bgcolor: active ? statusAccent(key) : 'rgba(255,255,255,.7)' },
                      }}
                    >
                      <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: active ? '#fff' : statusAccent(key) }} />
                      <b>{fleetCounts[key]}</b> {statusLabel[key]}
                    </Box>
                  );
                })}
              {retryableCount > 0 && (
                <Button
                  size="small"
                  startIcon={<ReplayIcon />}
                  disabled={isDispatching}
                  onClick={() => void retryFailedIn(devices)}
                  sx={{ height: 30, borderRadius: 999, px: 1.5, fontWeight: 800, textTransform: 'none', color: '#b91c1c', bgcolor: 'rgba(220,38,38,.1)', '&:hover': { bgcolor: 'rgba(220,38,38,.16)' } }}
                >
                  Retry {retryableCount} failed
                </Button>
              )}
            </Stack>
          </Stack>
        )}
      </Stack>

      {/* Fleet-wide controls in one glass bar: what goes to the selection, then
          the page's own tools. */}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1,
          p: 1,
          mb: 2,
          mx: 'auto',
          width: 'fit-content',
          maxWidth: '100%',
          borderRadius: '22px',
          bgcolor: 'rgba(255,255,255,.66)',
          border: '1px solid rgba(255,255,255,.95)',
          boxShadow: '0 20px 44px -30px rgba(20,26,46,.35)',
        }}
      >
        <Typography sx={{ ...monoLabel, color: PRISM_MUTED, px: 1 }}>
          {selectedIds.length || 0} selected
        </Typography>
        <DeviceControls
          deviceIds={selectedIds}
          variant="full"
          onFrame={(deviceId, base64) => patchRuntime(deviceId, { screenshot: base64 })}
        />
        <PasteToDevices deviceIds={selectedIds} />
        {proxies.length > 0 && (
          <TextField
            select
            size="small"
            label="Assign selected to"
            value=""
            disabled={selectedIds.length === 0}
            onChange={async (event) => {
              const raw = event.target.value;
              const proxyId = raw === 'none' ? null : Number(raw);
              // Applied locally first, for the same reason as the per-device
              // picker: the list only refreshes on its poll.
              setProxyOverrides((current) => {
                const next = { ...current };
                for (const deviceId of selectedIds) next[deviceId] = proxyId;
                return next;
              });

              try {
                for (const deviceId of selectedIds) {
                  await assignProxy({ device_id: deviceId, proxy_id: proxyId }).unwrap();
                }
                refetchProxies();
                toast.success(`Assigned ${selectedIds.length} device${selectedIds.length === 1 ? '' : 's'}`);
              } catch {
                refetch();
                toast.error('Could not assign all devices');
              }
            }}
            sx={{ minWidth: 190, '& .MuiOutlinedInput-root': { borderRadius: '14px', bgcolor: 'rgba(255,255,255,.8)' } }}
          >
            {proxies.map((proxy) => (
              <MenuItem key={proxy.id} value={proxy.id}>
                <Box
                  component="span"
                  sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: proxyColor(proxy.id), mr: 1, display: 'inline-block' }}
                />
                {proxy.name}
              </MenuItem>
            ))}
            <MenuItem value="none">No proxy</MenuItem>
          </TextField>
        )}

        <Box sx={{ width: '1px', alignSelf: 'stretch', bgcolor: 'rgba(20,26,46,.1)', mx: 0.5, display: { xs: 'none', md: 'block' } }} />

        <Tooltip title={onlineDevices.length ? `Pull a fresh frame from all ${onlineDevices.length} online phones` : 'No devices online'}>
          <span>
            <Button
              size="small"
              startIcon={isRefreshingFrames ? <CircularProgress size={14} color="inherit" /> : <PhotoCameraIcon fontSize="small" />}
              disabled={isRefreshingFrames || onlineDevices.length === 0}
              onClick={() => handleRefreshAllFrames(false)}
              sx={toolButton}
            >
              Screens
            </Button>
          </span>
        </Tooltip>
        <Tooltip title={selectedIds.length ? `Send one file to ${selectedIds.length} selected device${selectedIds.length === 1 ? '' : 's'}` : 'Select devices first'}>
          <span>
            <Button
              size="small"
              startIcon={isSendingFile ? <CircularProgress size={14} color="inherit" /> : <AttachFileIcon fontSize="small" />}
              disabled={isSendingFile || selectedIds.length === 0}
              onClick={() => fileInputRef.current?.click()}
              sx={toolButton}
            >
              Send file
            </Button>
          </span>
        </Tooltip>
        <Button size="small" startIcon={<PublicIcon fontSize="small" />} onClick={() => setProxyDialogOpen(true)} sx={toolButton}>
          Proxies{proxies.length > 0 ? ` (${proxies.length})` : ''}
        </Button>
        {proxies.length > 0 && (
          <Button size="small" onClick={() => setGroupByProxy((value) => !value)} sx={toolButton}>
            {groupByProxy ? 'Ungroup' : 'Group by proxy'}
          </Button>
        )}
        {isAdmin && (
          <Tooltip title={selectedIds.length ? 'Capture the selected phones for the landing page' : 'Capture every online phone for the landing page'}>
            <span>
              <Button
                size="small"
                startIcon={<PhotoCameraIcon fontSize="small" />}
                disabled={capturingLanding || onlineDevices.length === 0}
                onClick={() => void captureForLanding(selectedIds.length ? selectedIds : onlineDevices.map((d) => d.id))}
                sx={toolButton}
              >
                {selectedIds.length ? `Capture ${selectedIds.length}` : 'Capture all'}
              </Button>
            </span>
          </Tooltip>
        )}
        {runningCount > 0 && (
          <Button
            size="small"
            startIcon={<StopCircleIcon />}
            onClick={handleStopAll}
            sx={{ ...toolButton, color: '#b91c1c', bgcolor: 'rgba(220,38,38,.1)', '&:hover': { bgcolor: 'rgba(220,38,38,.16)' } }}
          >
            Stop all
          </Button>
        )}
        <Tooltip title="Refresh devices">
          <IconButton aria-label="Refresh devices" onClick={() => refetch()} sx={{ width: 36, height: 36, borderRadius: '12px', bgcolor: 'rgba(255,255,255,.8)', '&:hover': { bgcolor: '#fff' } }}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <input
          ref={fileInputRef}
          type="file"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Cleared straight away so picking the same file twice still fires.
            event.target.value = '';
            if (file) void handleSendFile(file);
          }}
        />
      </Box>

      {/* What the last Run did: started, waiting or refused. */}
      {lastDispatch && (
        <Stack
          direction="row"
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
          gap={1}
          sx={{ mx: 'auto', mb: 2, px: 1.5, py: 1, width: 'fit-content', maxWidth: '100%', borderRadius: '18px', bgcolor: 'rgba(255,255,255,.72)', border: '1px solid rgba(255,255,255,.95)' }}
        >
          <Typography sx={{ fontSize: 13, color: PRISM_MUTED, maxWidth: 360 }} noWrap>
            “{lastDispatch.prompt}”
          </Typography>
          {lastDispatch.startedIds.length > 0 && (
            <Chip size="small" icon={<CheckCircleIcon />} color="success" variant="outlined" label={`${lastDispatch.startedIds.length} started`} />
          )}
          {lastDispatch.failedIds.length > 0 && (
            <Chip size="small" icon={<ErrorOutlineIcon />} color="error" variant="outlined" label={`${lastDispatch.failedIds.length} failed`} />
          )}
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

      <FleetCoverageStrip devices={devices} />

      {tagSummary.tags.length > 0 && (
        <Stack direction="row" alignItems="center" gap={0.75} flexWrap="wrap" useFlexGap sx={{ mb: 2 }}>
          <Stack direction="row" alignItems="center" gap={0.5} sx={{ color: 'text.secondary', mr: 0.25 }}>
            <LocalOfferIcon sx={{ fontSize: 15 }} />
            <Typography variant="caption" sx={{ fontWeight: 600 }}>
              Tags
            </Typography>
          </Stack>
          {tagSummary.tags.map((tag) => {
            const active = tagFilter === tag.key;
            const color = TAG_COLORS[tag.color];
            return (
              <Box
                key={tag.key}
                component="button"
                type="button"
                onClick={() => setTagFilter(active ? null : tag.key)}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.6,
                  px: 1.25,
                  py: 0.4,
                  borderRadius: 5,
                  cursor: 'pointer',
                  font: 'inherit',
                  fontSize: 12.5,
                  fontWeight: 700,
                  color: active ? '#fff' : color,
                  bgcolor: active ? color : alpha(color, 0.12),
                  border: '1px solid',
                  borderColor: active ? color : 'transparent',
                  transition: 'all 120ms ease',
                  '&:hover': { borderColor: color },
                }}
              >
                {tag.text}
                <Box component="span" sx={{ px: 0.6, borderRadius: 2, fontSize: 11, bgcolor: active ? 'rgba(255,255,255,0.25)' : alpha(color, 0.14) }}>
                  {tag.count}
                </Box>
              </Box>
            );
          })}
          {tagSummary.untagged > 0 && (
            <Box
              component="button"
              type="button"
              onClick={() => setTagFilter(tagFilter === UNTAGGED ? null : UNTAGGED)}
              sx={{
                px: 1.25,
                py: 0.4,
                borderRadius: 5,
                cursor: 'pointer',
                font: 'inherit',
                fontSize: 12.5,
                fontWeight: 600,
                border: '1px dashed',
                borderColor: tagFilter === UNTAGGED ? 'text.primary' : 'divider',
                color: tagFilter === UNTAGGED ? 'text.primary' : 'text.secondary',
                bgcolor: tagFilter === UNTAGGED ? 'action.selected' : 'transparent',
              }}
            >
              Untagged {tagSummary.untagged}
            </Box>
          )}
          {tagFilter !== null && (
            <Button size="small" variant="text" onClick={() => setTagFilter(null)} sx={{ fontWeight: 600, minWidth: 0 }}>
              Clear
            </Button>
          )}
        </Stack>
      )}

      {/* Grid */}
      {isLoading ? (
        <Stack alignItems="center" sx={{ py: 6 }}>
          <CircularProgress />
        </Stack>
      ) : devices.length === 0 ? (
        <Paper elevation={0} sx={{ p: 5, textAlign: 'center', borderRadius: '26px', bgcolor: 'rgba(255,255,255,.8)', border: '1px solid rgba(255,255,255,.95)', backdropFilter: 'blur(20px)' }}>
          <Typography color="text.secondary">No paired devices yet.</Typography>
          <Button sx={{ mt: 2 }} variant="contained" onClick={() => navigate('/android-devices')}>
            Pair a device
          </Button>
        </Paper>
      ) : (
        <Box>
          {groupByProxy && proxies.length > 0 ? (
            <Stack spacing={3}>
              {lanes.groups.map(({ proxy, devices: laneDevices }) =>
                renderLane({
                  key: proxy.id,
                  name: proxy.name,
                  color: proxyColor(proxy.id) ?? '#8b93a7',
                  ip: proxy.last_ip,
                  laneDevices,
                  note: `max ${proxy.concurrency} at once`,
                  emptyText: 'No devices on this proxy yet.',
                }),
              )}
              {lanes.unassigned.length > 0 &&
                renderLane({
                  key: 'none',
                  name: 'No proxy',
                  color: '#8b93a7',
                  laneDevices: lanes.unassigned,
                  note: 'These run straight away, without queueing or rotation',
                })}
            </Stack>
          ) : (
            renderLane({
              key: 'all',
              name: 'All phones',
              color: PRISM_ACCENT,
              laneDevices: orderedDevices,
              note: proxies.length > 0 ? 'Not grouped by proxy' : '',
            })
          )}
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

      {/* One-click settings screens. Direct intents, so they land on the same
          page on Xiaomi, Realme and Pixel alike. */}
      <Menu
        anchorEl={settingsMenu?.anchor ?? null}
        open={Boolean(settingsMenu)}
        onClose={() => setSettingsMenu(null)}
      >
        {SETTINGS_SHORTCUTS.map((shortcut) => (
          <MenuItem
            key={shortcut.screen}
            onClick={() => settingsMenu && openSettingsScreen(settingsMenu.deviceId, shortcut.screen, shortcut.label)}
          >
            {shortcut.label}
          </MenuItem>
        ))}
      </Menu>

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
    
      <ProxyManagerDialog open={proxyDialogOpen} onClose={() => { setProxyDialogOpen(false); refetchProxies(); refetch(); }} />
      </Box>
    </Box>
  );
}
