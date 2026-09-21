import {
  useCancelAndroidTaskMutation,
  useGetAndroidDevicesQuery,
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
  FleetStatusSummary,
  RetryButton,
  TaskProgress,
  type FleetCounts,
  type FleetStatus,
} from '@/components/android/FleetStatusUI';
import FleetStatusSpine from '@/components/android/FleetStatusSpine';
import PhoneFrame3D from '@/components/android/PhoneFrame3D';
import SendFileDialog from '@/components/android/SendFileDialog';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloseIcon from '@mui/icons-material/Close';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HistoryIcon from '@mui/icons-material/History';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import PublicIcon from '@mui/icons-material/Public';
import LocalOfferIcon from '@mui/icons-material/LocalOffer';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import TuneIcon from '@mui/icons-material/Tune';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import RefreshIcon from '@mui/icons-material/Refresh';
import ReplayIcon from '@mui/icons-material/Replay';
import SendIcon from '@mui/icons-material/Send';
import SmartToyIcon from '@mui/icons-material/SmartToy';
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { useQueueDeviceFileMutation } from '@/RTKService/androidService/deviceFileService';
import DeviceControls from '@/components/android/DeviceControls';
import PasteToDevices from '@/components/android/PasteToDevices';
import FleetPromptField from '@/components/android/FleetPromptField';
import DeviceProxySelect from '@/components/android/DeviceProxySelect';
import FleetActivityPanel from '@/components/android/FleetActivityPanel';
import ProxyManagerDialog from '@/components/android/ProxyManagerDialog';
import FleetChatPanel from '@/components/android/FleetChatPanel';
import { proxyColor, proxyShortName } from '@/components/android/proxyColors';
import {
  useAssignDeviceProxyMutation,
  useCancelQueuedTaskMutation,
  useGetDeviceProxiesQuery,
  useGetTaskQueueQuery,
  useClearAllQueuedMutation,
} from '@/RTKService/androidService/proxyService';
import { useNavigate } from 'react-router-dom';

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

  const { data: devicesData, isLoading, refetch } = useGetAndroidDevicesQuery(undefined, {
    pollingInterval: 20_000,
  });
  const { data: tasksData } = useGetAndroidTasksQuery({ limit: 100 }, { pollingInterval: 8_000 });
  const { data: aiConfigsData } = useGetAiConfigsQuery();

  const [runTask] = useRunAndroidTaskMutation();
  const [cancelTask] = useCancelAndroidTaskMutation();

  const devices = useMemo<AndroidDevice[]>(() => devicesData?.data ?? [], [devicesData]);
  const tasks = useMemo<AndroidAgentTask[]>(() => tasksData?.data ?? [], [tasksData]);
  const aiConfigs = useMemo(() => aiConfigsData?.data ?? [], [aiConfigsData]);
  const activeAiConfig = aiConfigs.find((config) => config.is_active);

  const [runtime, setRuntime] = useState<RuntimeMap>({});
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [queueFile, { isLoading: isSendingFile }] = useQueueDeviceFileMutation();
  const [isRefreshingFrames, setIsRefreshingFrames] = useState(false);
  const [proxyDialogOpen, setProxyDialogOpen] = useState(false);
  const { data: proxyData, refetch: refetchProxies } = useGetDeviceProxiesQuery();
  // Polled: entries leave the queue on the server when a lane frees up, with no
  // socket event of their own.
  const { data: queueData, refetch: refetchQueue } = useGetTaskQueueQuery(undefined, { pollingInterval: 10000 });
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
  const [chatOpen, setChatOpen] = useState(false);
  const [editingTagFor, setEditingTagFor] = useState<number | null>(null);
  const [setDeviceTag] = useSetDeviceTagMutation();

  const saveTag = async (deviceId: number, value: string) => {
    setEditingTagFor(null);
    try {
      await setDeviceTag({ id: deviceId, tag: value.trim() }).unwrap();
      refetch();
    } catch {
      toast.error('Could not save the note');
    }
  };
  const [prompt, setPrompt] = useState('');
  const [maxSteps, setMaxSteps] = useState(200);
  const [statusFilter, setStatusFilter] = useState<FleetStatus | null>(null);
  const [promptResetSignal, setPromptResetSignal] = useState(0);
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
  // Single source of truth for a device's status, mapped only from data that
  // exists — used by both the card badge and the fleet summary so they never
  // disagree.
  const deviceStatusOf = (device: AndroidDevice): FleetStatus => {
    if (device.status !== 'ONLINE') return 'offline';
    const state = runtime[device.id];
    if (state?.startError) return 'failed';
    if (state?.isRunning) return 'running';
    if (state?.finishedAt) return state.finishedOk ? 'completed' : 'failed';
    if (queuedByDevice.has(device.id)) return 'waiting';
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
    { total: 0, running: 0, waiting: 0, failed: 0, completed: 0, idle: 0, needs_setup: 0, offline: 0 } as FleetCounts,
  );

  // When a status filter is active, a device is shown only if it matches.
  const matchesFilter = (device: AndroidDevice) =>
    statusFilter === null || deviceStatusOf(device) === statusFilter;

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
                  borderRadius: 2,
                  overflow: 'hidden',
                  borderWidth: isSelected || state.startError || state.isRunning ? 2 : 1,
                  borderColor: state.startError
                    ? 'error.main'
                    : state.isRunning
                      ? 'primary.main'
                      : isSelected
                        ? 'primary.main'
                        : undefined,
                  // A running card lifts off the grid; the rest stay flat.
                  boxShadow: state.isRunning ? 6 : undefined,
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
                      : state.startError || (state.finishedAt && !state.finishedOk)
                        ? 'failed'
                        : state.finishedAt && state.finishedOk
                          ? 'completed'
                          : isOnline
                            ? 'idle'
                            : 'offline'
                  }
                />
                {/* The lane's colour, inset beside the status spine, so which
                    proxy a phone is on is readable without opening anything. */}
                {proxyIdFor(device) && (
                  <Box
                    sx={{
                      position: 'absolute',
                      left: '5px',
                      top: 0,
                      bottom: 0,
                      width: '4px',
                      bgcolor: proxyColor(proxyIdFor(device)),
                    }}
                  />
                )}
                {/* Header */}
                <Stack direction="row" alignItems="center" gap={0.5} sx={{ px: 1, pt: 1 }}>
                  <Checkbox size="small" checked={isSelected} disabled={!isOnline} onChange={() => toggleDevice(device.id)} />
                  <Typography
                    variant="body2"
                    noWrap
                    sx={{ fontWeight: 800, fontSize: 14.5, flexGrow: 1, minWidth: 0, letterSpacing: '-0.01em' }}
                  >
                    {device.device_name}
                  </Typography>
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

                <Divider />

                {/* Status — the visual priority of the card. Rendered from
                    reusable status components so every state looks consistent. */}
                <CardContent sx={{ py: 1.25, flexGrow: 1, '&:last-child': { pb: 1.25 } }}>
                  {(() => {
                    const status = deviceStatusOf(device);
                    const failed = status === 'failed';
                    const detail = state.startError
                      || (state.isRunning ? state.lastThought || state.prompt || 'Working…' : '')
                      || (state.finishedAt ? state.finishedMessage ?? '' : '');

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
                            ) : failed && state.prompt ? (
                              <Tooltip title="Retry this task">
                                <IconButton size="small" sx={{ color: 'inherit', p: 0.25 }} onClick={() => void dispatchTo([device.id], state.prompt as string)}>
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

                        {failed && state.prompt && (
                          <RetryButton onClick={() => void dispatchTo([device.id], state.prompt as string)} />
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

                {/* The user's own note on this phone. */}
                <Box sx={{ px: 1, pb: 0.5 }}>
                  {editingTagFor === device.id ? (
                    <TextField
                      autoFocus
                      fullWidth
                      size="small"
                      placeholder="Note for this phone…"
                      defaultValue={device.tag ?? ''}
                      onBlur={(event) => void saveTag(device.id, event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                        if (event.key === 'Escape') setEditingTagFor(null);
                      }}
                      inputProps={{ maxLength: 40 }}
                    />
                  ) : device.tag ? (
                    <Chip
                      size="small"
                      icon={<LocalOfferIcon fontSize="small" />}
                      label={device.tag}
                      onClick={() => setEditingTagFor(device.id)}
                      sx={{ fontWeight: 700, maxWidth: '100%' }}
                    />
                  ) : (
                    <Button
                      size="small"
                      startIcon={<LocalOfferIcon fontSize="small" />}
                      onClick={() => setEditingTagFor(device.id)}
                      sx={{ color: 'text.disabled', fontSize: 12, px: 0.5 }}
                    >
                      Add a note
                    </Button>
                  )}
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
  };


  /** The card grid, used once per lane and once for the flat view. */
  const DeviceGrid = ({ list }: { list: AndroidDevice[] }) => {
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
          {shown.map((device) => renderDeviceCard(device))}
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
          const response = await sendDirectAction({
            device_id: device.id,
            action: { type: 'CaptureScreen' },
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

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        // readAsDataURL gives "data:<mime>;base64,<payload>" — only the payload
        // goes to the server.
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(new Error('Could not read the file'));
        reader.readAsDataURL(file);
      });

      const response = await queueFile({
        device_ids: selectedIds,
        file_name: file.name,
        mime_type: file.type || 'application/octet-stream',
        content_base64: base64,
      }).unwrap();

      toast.success(response.message || `Sent ${file.name} to ${selectedIds.length} devices`);
    } catch (err: any) {
      toast.error(err?.data?.message || 'Could not send the file');
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
  /** What the chat panel needs about each selected device. */
  const chatDevices = selectedIds
    .map((deviceId) => devices.find((device) => device.id === deviceId))
    .filter((device): device is AndroidDevice => Boolean(device))
    .map((device) => {
      const state = runtime[device.id] ?? emptyRuntime;
      const laneId = proxyIdFor(device);
      const proxy = laneId ? proxyById.get(laneId) : undefined;
      return {
        id: device.id,
        name: device.device_name,
        isOnline: device.status === 'ONLINE',
        isRunning: state.isRunning,
        isQueued: queuedByDevice.has(device.id),
        prompt: state.prompt,
        stepIndex: state.stepIndex,
        steps: state.steps,
        finishedOk: state.finishedOk,
        finishedMessage: state.finishedMessage,
        startError: state.startError,
        proxyName: proxy?.name,
        proxyColor: proxyColor(laneId),
        tag: device.tag ?? null,
      };
    });

  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start' }}>
      <Box sx={{ flexGrow: 1, minWidth: 0, p: { xs: 2, md: 3 }, maxWidth: 1680, mx: 'auto' }}>
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

      <FleetStatusSummary counts={fleetCounts} activeFilter={statusFilter} onFilter={setStatusFilter} />

      {/* Broadcast bar — the primary control on the page, so it is raised out of
          the flat outlined-paper treatment the rest of the page uses. */}
      <Paper
        elevation={0}
        sx={{
          position: 'relative',
          overflow: 'hidden',
          p: 2.5,
          mb: 3,
          borderRadius: 3,
          border: '1px solid',
          borderColor: selectedIds.length > 0 ? alpha('#2563eb', 0.45) : 'divider',
          bgcolor: 'background.paper',
          boxShadow: selectedIds.length > 0
            ? '0 8px 30px rgba(37, 99, 235, 0.10)'
            : '0 1px 2px rgba(16, 24, 40, 0.04)',
          transition: 'border-color 220ms ease, box-shadow 220ms ease',
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0, left: 0, right: 0,
            height: 3,
            background: 'linear-gradient(90deg, #2563eb 0%, #0f766e 100%)',
            opacity: selectedIds.length > 0 ? 1 : 0.35,
            transition: 'opacity 220ms ease',
          },
        }}
      >
        {/* Header row: title on the left, live selection count + select-all on
            the right. Utilities moved to their own toolbar below so this row
            stays clean and the count is always visible. */}
        <Stack direction="row" alignItems="center" gap={1.25} sx={{ mb: 2 }}>
          <Box
            sx={{
              display: 'grid',
              placeItems: 'center',
              width: 34, height: 34,
              borderRadius: 2,
              color: '#fff',
              background: 'linear-gradient(135deg, #2563eb 0%, #0f766e 100%)',
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.30)',
            }}
          >
            <SmartToyIcon sx={{ fontSize: 20 }} />
          </Box>
          <Box>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              Run one task on many devices
            </Typography>
            <Typography variant="caption" color="text.secondary">
              One instruction, every selected phone at once
            </Typography>
          </Box>
          <Box sx={{ flexGrow: 1 }} />
          <Box
            sx={{
              px: 1.25, py: 0.5,
              borderRadius: 5,
              fontSize: 12,
              fontWeight: 700,
              color: selectedIds.length > 0 ? 'primary.dark' : 'text.secondary',
              bgcolor: selectedIds.length > 0 ? alpha('#2563eb', 0.10) : 'action.hover',
              whiteSpace: 'nowrap',
            }}
          >
            {selectedIds.length} / {onlineDevices.length} selected
          </Box>
          <Button size="small" variant="text" onClick={selectAllOnline} disabled={onlineDevices.length === 0} sx={{ fontWeight: 600 }}>
            {selectedIds.length === onlineDevices.length && onlineDevices.length > 0 ? 'Clear' : 'Select all'}
          </Button>
        </Stack>

        {/* Utility toolbar: fleet-wide tools grouped and right-aligned, visually
            separated from the run form. A subtle surface + border sets it apart
            from the prompt row without competing with the primary Run button. */}
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 0.5,
            mb: 1.5,
            p: 0.5,
            borderRadius: 2,
            bgcolor: 'background.default',
            border: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Tooltip title={onlineDevices.length ? `Pull a fresh frame from all ${onlineDevices.length} online phones` : 'No devices online'}>
            <span>
              <Button
                size="small"
                startIcon={isRefreshingFrames ? <CircularProgress size={14} color="inherit" /> : <PhotoCameraIcon fontSize="small" />}
                disabled={isRefreshingFrames || onlineDevices.length === 0}
                onClick={() => handleRefreshAllFrames(false)}
                sx={{ whiteSpace: 'nowrap' }}
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
                sx={{ whiteSpace: 'nowrap' }}
              >
                Send file
              </Button>
            </span>
          </Tooltip>

          <Button size="small" startIcon={<PublicIcon fontSize="small" />} onClick={() => setProxyDialogOpen(true)} sx={{ whiteSpace: 'nowrap' }}>
            Proxies{proxies.length > 0 ? ` (${proxies.length})` : ''}
          </Button>

          {proxies.length > 0 && (
            <Button size="small" onClick={() => setGroupByProxy((value) => !value)} sx={{ whiteSpace: 'nowrap' }}>
              {groupByProxy ? 'Ungroup' : 'Group by proxy'}
            </Button>
          )}

          <Box sx={{ flexGrow: 1 }} />

          <Button size="small" onClick={() => setChatOpen((value) => !value)} sx={{ whiteSpace: 'nowrap' }}>
            {chatOpen ? 'Hide chat' : 'Chat'}
          </Button>

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

        <Stack direction={{ xs: 'column', md: 'row' }} gap={1.25} alignItems="stretch">
          <FleetPromptField onDraftChange={setPrompt} onSubmit={(text) => void handleRunOnSelected(text)} resetSignal={promptResetSignal} />
          <TextField
            select
            size="small"
            label="Model"
            value={broadcastConfigId}
            onChange={(event) => setBroadcastConfigId(Number(event.target.value))}
            sx={{
              minWidth: 210,
              '& .MuiOutlinedInput-root': {
                borderRadius: 2,
                bgcolor: 'background.default',
                '& fieldset': { borderColor: 'divider' },
                '&:hover fieldset': { borderColor: alpha('#2563eb', 0.5) },
              },
            }}
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
            onBlur={() => setMaxSteps((prev) => Math.min(20000, Math.max(1, prev || 200)))}
            inputProps={{ min: 1, max: 20000 }}
            sx={{
              width: 96,
              '& .MuiOutlinedInput-root': {
                borderRadius: 2,
                bgcolor: 'background.default',
                fontWeight: 700,
                '& fieldset': { borderColor: 'divider' },
                '&:hover fieldset': { borderColor: alpha('#2563eb', 0.5) },
              },
            }}
          />
          <Button
            variant="contained"
            disableElevation
            startIcon={isDispatching ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
            disabled={isDispatching || selectedIds.length === 0 || !prompt.trim()}
            onClick={() => void handleRunOnSelected()}
            sx={{
              whiteSpace: 'nowrap',
              minWidth: 168,
              px: 2.5,
              borderRadius: 2,
              fontWeight: 700,
              textTransform: 'none',
              fontSize: 15,
              color: '#fff',
              background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%)',
              boxShadow: '0 6px 18px rgba(37, 99, 235, 0.32)',
              '&:hover': {
                background: 'linear-gradient(135deg, #1d4ed8 0%, #1e40af 100%)',
                boxShadow: '0 8px 24px rgba(37, 99, 235, 0.44)',
              },
              '&.Mui-disabled': { background: '#e5e7eb', color: '#9ca3af', boxShadow: 'none' },
            }}
          >
            {isDispatching ? 'Starting…' : `Run on ${selectedIds.length || 0}`}
          </Button>
        </Stack>

        {/* Same controls as each card, aimed at the selection. Setting up a
            fleet means sending Home or Back to every phone far more often than
            to any one of them. */}
        <Stack direction="row" alignItems="center" gap={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
            Controls for {selectedIds.length || 0} selected
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
              sx={{ minWidth: 190 }}
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
        <Box>
          {groupByProxy && proxies.length > 0 ? (
            <Stack spacing={3}>
              {lanes.groups.map(({ proxy, devices: laneDevices }) => (
                <Box key={proxy.id}>
                  <Stack
                    direction="row"
                    alignItems="center"
                    gap={1}
                    flexWrap="wrap"
                    useFlexGap
                    sx={{
                      mb: 1.5,
                      px: 1.5,
                      py: 1,
                      borderRadius: 2,
                      // The lane's own colour, faint enough to sit behind text.
                      bgcolor: alpha(proxyColor(proxy.id) ?? '#888', 0.12),
                      borderLeft: '5px solid',
                      borderColor: proxyColor(proxy.id),
                    }}
                  >
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: proxyColor(proxy.id) }} />
                    <Typography sx={{ fontWeight: 800, fontSize: 15 }}>{proxy.name}</Typography>
                    <Chip
                      size="small"
                      label={`${laneDevices.length} device${laneDevices.length === 1 ? '' : 's'}`}
                      sx={{ fontWeight: 700, bgcolor: 'background.paper' }}
                    />
                    {proxy.last_ip && (
                      <Chip size="small" variant="outlined" label={proxy.last_ip} sx={{ fontFamily: 'monospace', bgcolor: 'background.paper' }} />
                    )}
                    <Box sx={{ flexGrow: 1 }} />
                    <Chip
                      size="small"
                      color="primary"
                      label={`${laneDevices.filter((device) => runtime[device.id]?.isRunning).length} running`}
                      sx={{ fontWeight: 800 }}
                    />
                    <Chip
                      size="small"
                      variant="outlined"
                      label={`${laneDevices.filter((device) => queuedByDevice.has(device.id)).length} waiting`}
                      sx={{ fontWeight: 700, color: 'text.secondary', borderStyle: 'dashed', bgcolor: 'transparent' }}
                    />
                    <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                      max {proxy.concurrency} at once
                    </Typography>
                  </Stack>

                  {laneDevices.length === 0 ? (
                    <Typography variant="caption" color="text.secondary" sx={{ pl: 1.5 }}>
                      No devices on this proxy yet.
                    </Typography>
                  ) : (
                    <DeviceGrid list={laneDevices} />
                  )}
                </Box>
              ))}

              {lanes.unassigned.length > 0 && (
                <Box>
                  <Stack
                    direction="row"
                    alignItems="center"
                    gap={1}
                    flexWrap="wrap"
                    useFlexGap
                    sx={{
                      mb: 1.5,
                      px: 1.5,
                      py: 1,
                      borderRadius: 2,
                      bgcolor: 'action.hover',
                      borderLeft: '5px solid',
                      borderColor: 'divider',
                    }}
                  >
                    <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'text.disabled' }} />
                    <Typography sx={{ fontWeight: 800, fontSize: 15 }}>No proxy</Typography>
                    <Chip
                      size="small"
                      label={`${lanes.unassigned.length} device${lanes.unassigned.length === 1 ? '' : 's'}`}
                      sx={{ fontWeight: 700, bgcolor: 'background.paper' }}
                    />
                    <Typography variant="caption" color="text.secondary">
                      These run straight away, without queueing or rotation
                    </Typography>
                  </Stack>
                  <DeviceGrid list={lanes.unassigned} />
                </Box>
              )}
            </Stack>
          ) : (
            <DeviceGrid list={orderedDevices} />
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

      {chatOpen && (
        <FleetChatPanel
          devices={chatDevices}
          onClose={() => setChatOpen(false)}
          onFollowUp={(deviceId, text) => dispatchTo([deviceId], text)}
          onBroadcast={(text) => dispatchTo(selectedIds, text)}
          onStop={(deviceId) => handleStopDevice(deviceId)}
          onOpenFull={(deviceId) => navigate(`/android-agent?deviceId=${deviceId}`)}
        />
      )}

      {/* Live run activity, docked to the side so it stays visible while you
          scroll the phone grid — and off the top, which the grid needs. Sticky
          so it follows down a long fleet; hidden on narrow screens where the
          grid already fills the width. */}
      <Box
        component="aside"
        sx={{
          display: { xs: 'none', lg: 'block' },
          width: 320,
          flexShrink: 0,
          position: 'sticky',
          top: 16,
          alignSelf: 'flex-start',
          p: 2,
          pl: 0,
        }}
      >
        <FleetActivityPanel
          tasks={tasksData?.data ?? []}
          devices={devices}
          onRetry={(deviceId, prompt) => void dispatchTo([deviceId], prompt)}
        />
      </Box>
    </Box>
  );
}
