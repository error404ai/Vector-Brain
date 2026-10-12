import {
  useGetAndroidDevicesQuery,
  useGetAndroidTasksQuery,
  type AndroidAgentTask,
  type AndroidDevice,
} from '@/RTKService/androidService/androidService';
import { useGetAiConfigsQuery } from '@/RTKService/aiConfigService/aiConfigService';
import OnboardingChecklist from '@/components/dashboard/OnboardingChecklist';
import { monoLabel, PRISM_ACCENT, PRISM_INK, PRISM_MUTED, PRISM_PINK } from '@/components/settings/settingsStyle';
import PrismBackground from '@/components/ui/PrismBackground';
import { ease, reducedMotion, riseIn } from '@/components/mission/motion';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import PriorityHighRoundedIcon from '@mui/icons-material/PriorityHighRounded';
import { alpha, Box, ButtonBase, Skeleton, Stack, Typography } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import { useMemo, type ReactNode } from 'react';
import { Helmet } from 'react-helmet-async';
import { useNavigate } from 'react-router-dom';

/** Human-friendly "2 minutes ago" style label. */
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

function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${mins}m ${rest}s`;
}

const indeterminate = keyframes`0% { transform: translateX(-100%); } 100% { transform: translateX(250%); }`;
const livePulse = keyframes`0% { box-shadow: 0 0 0 0 rgba(59,76,255,.5); } 100% { box-shadow: 0 0 0 9px rgba(59,76,255,0); }`;
const growIn = keyframes`from { flex-grow: 0; }`;

const MONO = '"JetBrains Mono", ui-monospace, monospace';

const glass = {
  borderRadius: '24px',
  bgcolor: 'rgba(255,255,255,.78)',
  border: '1px solid rgba(255,255,255,.95)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  boxShadow: '0 24px 56px rgba(30,40,90,.08)',
} as const;

/** A section's title row: heading on the left, a link-style action on the right. */
function SectionHead({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <Stack direction="row" alignItems="center" sx={{ mb: 1.5 }}>
      <Typography component="h2" sx={{ m: 0, fontSize: 19, fontWeight: 800, letterSpacing: '-0.02em', color: PRISM_INK }}>
        {title}
      </Typography>
      <Box sx={{ flexGrow: 1 }} />
      {action && (
        <ButtonBase
          onClick={onAction}
          sx={{ gap: 0.5, px: 1.25, minHeight: 36, borderRadius: '10px', fontWeight: 700, fontSize: 13, color: PRISM_ACCENT, '&:hover': { bgcolor: alpha(PRISM_ACCENT, 0.08) } }}
        >
          {action}
          <ArrowForwardIcon sx={{ fontSize: 15 }} />
        </ButtonBase>
      )}
    </Stack>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();

  const { data: devicesResponse, isLoading: devicesLoading } = useGetAndroidDevicesQuery(undefined, {
    pollingInterval: 15_000,
  });
  const { data: tasksResponse, isLoading: tasksLoading } = useGetAndroidTasksQuery(
    { limit: 50 },
    { pollingInterval: 15_000 },
  );
  const { data: aiConfigsResponse } = useGetAiConfigsQuery();

  const devices = useMemo<AndroidDevice[]>(() => devicesResponse?.data ?? [], [devicesResponse]);
  const tasks = useMemo<AndroidAgentTask[]>(() => tasksResponse?.data ?? [], [tasksResponse]);
  const activeAiConfig = aiConfigsResponse?.data?.find((config) => config.is_active);

  const isLoading = devicesLoading || tasksLoading;

  /**
   * Brand-new account: no runs yet. The dashboard's live widgets are all
   * empty noise at this point, so show a single focused setup card instead.
   */
  const setupMode = !isLoading && tasks.length === 0;

  const metrics = useMemo(() => {
    const onlineDevices = devices.filter((device) => device.status === 'ONLINE').length;
    const readyDevices = devices.filter(
      (device) =>
        device.status === 'ONLINE' &&
        device.capabilities?.accessibility === true &&
        device.capabilities?.screenCapture === true,
    ).length;

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todaysTasks = tasks.filter((task) => new Date(task.created_at).getTime() >= startOfToday.getTime());

    const finished = tasks.filter((task) => !task.is_running);
    const succeeded = finished.filter((task) => task.success).length;
    const successRate = finished.length ? Math.round((succeeded / finished.length) * 100) : 0;

    const runningNow = tasks.filter((task) => task.is_running);

    const durations = finished.map((task) => task.total_duration_seconds).filter((value) => value > 0);
    const avgDuration = durations.length
      ? durations.reduce((sum, value) => sum + value, 0) / durations.length
      : 0;

    const steps = finished.map((task) => task.total_steps).filter((value) => value > 0);
    const avgSteps = steps.length ? Math.round(steps.reduce((sum, value) => sum + value, 0) / steps.length) : 0;

    return {
      onlineDevices,
      readyDevices,
      todaysTasks: todaysTasks.length,
      successRate,
      finishedCount: finished.length,
      runningNow,
      avgDuration,
      avgSteps,
    };
  }, [devices, tasks]);

  /** Every phone in exactly one state, for the bar under the stats. */
  const phoneStates = useMemo(() => {
    const running = new Set(metrics.runningNow.map((task) => task.device_id).filter((id): id is number => id != null));
    let run = 0;
    let ready = 0;
    let setup = 0;
    let offline = 0;
    for (const device of devices) {
      if (running.has(device.id)) run += 1;
      else if (device.status !== 'ONLINE') offline += 1;
      else if (device.capabilities?.accessibility === true && device.capabilities?.screenCapture === true) ready += 1;
      else setup += 1;
    }
    return [
      { key: 'running', label: 'Running', n: run, color: PRISM_ACCENT },
      { key: 'ready', label: 'Ready', n: ready, color: '#16a34a' },
      { key: 'setup', label: 'Needs setup', n: setup, color: '#d97706' },
      { key: 'offline', label: 'Offline', n: offline, color: '#9095a8' },
    ];
  }, [devices, metrics.runningNow]);

  const tiles: { label: string; value: ReactNode; note: string; tone: string; path: string; hero?: boolean }[] = [
    {
      label: 'Phones online',
      value: (
        <>
          {metrics.onlineDevices}
          <Box component="span" sx={{ fontSize: 22, color: PRISM_MUTED }}> / {devices.length}</Box>
        </>
      ),
      note: `${metrics.readyDevices} fully ready for automation`,
      tone: '#15803d',
      path: '/android-fleet',
    },
    {
      label: 'Running now',
      value: metrics.runningNow.length,
      note: metrics.runningNow.length ? 'Tasks executing on phones' : 'No task in progress',
      tone: '#fff',
      path: '/android-fleet',
      hero: metrics.runningNow.length > 0,
    },
    {
      label: 'Tasks today',
      value: metrics.todaysTasks,
      note: `${tasks.length} in recent history`,
      tone: '#3730a3',
      path: '/mission-control',
    },
    {
      label: 'Success rate',
      value: metrics.finishedCount ? `${metrics.successRate}%` : '—',
      note: `Across ${metrics.finishedCount} finished task${metrics.finishedCount === 1 ? '' : 's'}`,
      tone: '#3730a3',
      path: '/mission-control',
    },
  ];

  const recentTasks = tasks.slice(0, 8);
  const headline =
    metrics.runningNow.length > 0
      ? `${metrics.runningNow.length} phone${metrics.runningNow.length === 1 ? ' is' : 's are'} working right now.`
      : devices.length > 0
        ? `${metrics.onlineDevices} of ${devices.length} phones online.`
        : 'Dashboard';

  return (
    <>
      <Helmet>
        <title>Dashboard - Vector Brain</title>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@600&display=swap" />
      </Helmet>

      {/* Glass Grid: the page sits on the app's prism, like Mission Control, Settings and the fleet.
          The negative margins cancel AuthLayout's padding so the prism fills the view. */}
      <Box
        sx={{
          position: 'relative',
          mx: { xs: -1.5, sm: -2, md: -3 },
          mt: { xs: '-12px', md: '-24px' },
          mb: { xs: -10, md: -3 },
          minHeight: 'calc(100vh - 64px)',
          overflow: 'hidden',
          color: PRISM_INK,
        }}
      >
        <PrismBackground />
        <Box sx={{ position: 'relative', zIndex: 1, maxWidth: 1376, mx: 'auto', px: { xs: 2, md: 4 }, pt: { xs: 3, md: 4 }, pb: { xs: 12, md: 6 } }}>
          <Box sx={{ mb: 3 }}>
            <Typography sx={{ ...monoLabel, color: '#3730a3' }}>Dashboard</Typography>
            <Typography component="h1" sx={{ m: 0, mt: 0.75, fontSize: { xs: 32, md: 46 }, fontWeight: 800, lineHeight: 1.05, letterSpacing: '-0.045em', textWrap: 'balance' }}>
              {isLoading ? 'Dashboard' : headline}
            </Typography>
          </Box>

          <Stack spacing={2.5}>
            {/* Setup journey. In setup mode it is the whole page; afterwards it only
                reappears if a required piece (device / key / model) goes missing. */}
            {setupMode ? (
              <Box sx={{ maxWidth: 720, mx: 'auto', width: '100%', pt: { xs: 1, md: 2 } }}>
                <OnboardingChecklist devices={devices} aiConfigs={aiConfigsResponse?.data ?? []} tasks={tasks} loading={isLoading} hero />
              </Box>
            ) : (
              <OnboardingChecklist devices={devices} aiConfigs={aiConfigsResponse?.data ?? []} tasks={tasks} loading={isLoading} />
            )}

            {!setupMode && (
              <>
                {/* Stat tiles */}
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' }, gap: 2 }}>
                  {tiles.map((tile, index) => (
                    <ButtonBase
                      key={tile.label}
                      onClick={() => navigate(tile.path)}
                      sx={{
                        ...glass,
                        ...(tile.hero && {
                          background: `linear-gradient(135deg, ${PRISM_ACCENT}, #8b5cf6 60%, ${PRISM_PINK})`,
                          border: 0,
                          boxShadow: '0 24px 50px rgba(59,76,255,.3)',
                          color: '#fff',
                        }),
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: 1,
                        p: { xs: 2, md: 2.5 },
                        minWidth: 0,
                        textAlign: 'left',
                        animation: `${riseIn} 550ms ${ease} ${index * 60}ms both`,
                        transition: 'transform 250ms ease, box-shadow 250ms ease',
                        '&:hover': { transform: 'translateY(-3px)' },
                        ...reducedMotion,
                      }}
                    >
                      <Typography sx={{ ...monoLabel, color: tile.hero ? 'rgba(255,255,255,.85)' : tile.tone }}>{tile.label}</Typography>
                      {isLoading ? (
                        <Skeleton width={90} height={52} />
                      ) : (
                        <Typography sx={{ fontSize: { xs: 34, md: 44 }, fontWeight: 800, lineHeight: 1, letterSpacing: '-0.05em', fontVariantNumeric: 'tabular-nums', color: tile.hero ? '#fff' : PRISM_INK }}>
                          {tile.value}
                        </Typography>
                      )}
                      <Typography sx={{ fontSize: 13, color: tile.hero ? 'rgba(255,255,255,.9)' : PRISM_MUTED }}>{tile.note}</Typography>
                    </ButtonBase>
                  ))}
                </Box>

                {/* Where every phone is: one bar, each phone counted once. */}
                {devices.length > 0 && (
                  <Box sx={{ ...glass, p: 2.5 }}>
                    <SectionHead title="Where every phone is" action="Fleet" onAction={() => navigate('/android-fleet')} />
                    <Box sx={{ display: 'flex', height: 46, borderRadius: '14px', overflow: 'hidden', gap: '3px' }}>
                      {phoneStates
                        .filter((state) => state.n > 0)
                        .map((state) => (
                          <ButtonBase
                            key={state.key}
                            onClick={() => navigate('/android-fleet')}
                            aria-label={`${state.n} ${state.label}`}
                            sx={{
                              flex: `${state.n} 1 0`,
                              minWidth: 0,
                              gap: 0.75,
                              bgcolor: state.color,
                              color: '#fff',
                              fontWeight: 800,
                              fontSize: 14,
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              animation: `${growIn} 1.1s ${ease} both`,
                              ...reducedMotion,
                            }}
                          >
                            {state.n}
                            <Box component="span" sx={{ fontWeight: 600, fontSize: 12, opacity: 0.92 }}>
                              {state.label}
                            </Box>
                          </ButtonBase>
                        ))}
                    </Box>
                  </Box>
                )}

                {/* Running now + phones */}
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1.4fr) minmax(0, 1fr)' }, gap: 2 }}>
                  <Box sx={{ ...glass, p: 2.5 }}>
                    <SectionHead title="Running now" action="Open fleet" onAction={() => navigate('/android-fleet')} />
                    {isLoading ? (
                      <Stack spacing={1}>
                        <Skeleton height={54} />
                        <Skeleton height={54} />
                      </Stack>
                    ) : metrics.runningNow.length === 0 ? (
                      <Typography sx={{ py: 3, textAlign: 'center', fontSize: 14, color: PRISM_MUTED }}>Nothing running right now.</Typography>
                    ) : (
                      <Stack spacing={0.5}>
                        {metrics.runningNow.map((task) => {
                          const device = devices.find((item) => item.id === task.device_id);
                          return (
                            <Box key={task.id} sx={{ px: 1.25, py: 1.25, borderRadius: '14px', '&:hover': { bgcolor: alpha(PRISM_ACCENT, 0.05) } }}>
                              <Stack direction="row" alignItems="center" gap={1.25}>
                                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: PRISM_ACCENT, flexShrink: 0, animation: `${livePulse} 1.6s ease-out infinite`, ...reducedMotion }} />
                                <Typography sx={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, color: PRISM_ACCENT, flexShrink: 0 }}>
                                  {device?.device_name ?? `Device ${task.device_id ?? '?'}`}
                                </Typography>
                                <Typography noWrap sx={{ flexGrow: 1, minWidth: 0, fontSize: 14, fontWeight: 700 }}>
                                  {task.prompt}
                                </Typography>
                                <Typography sx={{ fontFamily: MONO, fontSize: 11.5, color: PRISM_MUTED, flexShrink: 0 }}>step {task.total_steps}</Typography>
                              </Stack>
                              <Box sx={{ position: 'relative', mt: 1, height: 4, borderRadius: 99, bgcolor: '#e8eaf4', overflow: 'hidden' }}>
                                <Box
                                  sx={{
                                    position: 'absolute',
                                    top: 0,
                                    bottom: 0,
                                    width: '40%',
                                    borderRadius: 99,
                                    background: `linear-gradient(90deg, transparent, ${PRISM_ACCENT}, ${PRISM_PINK}, transparent)`,
                                    animation: `${indeterminate} 1.4s ease-in-out infinite`,
                                    ...reducedMotion,
                                  }}
                                />
                              </Box>
                            </Box>
                          );
                        })}
                      </Stack>
                    )}
                  </Box>

                  <Box sx={{ ...glass, p: 2.5 }}>
                    <SectionHead title="Phones" action="Manage" onAction={() => navigate('/android-devices')} />
                    {isLoading ? (
                      <Stack spacing={1}>
                        <Skeleton height={40} />
                        <Skeleton height={40} />
                      </Stack>
                    ) : devices.length === 0 ? (
                      <Typography sx={{ py: 3, textAlign: 'center', fontSize: 14, color: PRISM_MUTED }}>No devices paired.</Typography>
                    ) : (
                      <Stack spacing={0.25}>
                        {devices.slice(0, 6).map((device) => {
                          const online = device.status === 'ONLINE';
                          const ready = online && device.capabilities?.accessibility === true && device.capabilities?.screenCapture === true;
                          const tag = ready
                            ? { text: 'Ready', fg: '#15803d', bg: 'rgba(22,163,74,.12)' }
                            : online
                              ? { text: 'Setup', fg: '#b45309', bg: 'rgba(245,158,11,.14)' }
                              : { text: 'Offline', fg: '#5b6280', bg: '#eef0f8' };
                          return (
                            <Stack key={device.id} direction="row" alignItems="center" gap={1.25} sx={{ px: 1.25, py: 1, borderRadius: '12px', '&:hover': { bgcolor: alpha(PRISM_ACCENT, 0.05) } }}>
                              <Box sx={{ width: 9, height: 9, borderRadius: '50%', bgcolor: ready ? '#16a34a' : online ? '#f59e0b' : '#b6bbcd', flexShrink: 0 }} />
                              <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                                <Typography noWrap sx={{ fontSize: 14, fontWeight: 700 }}>{device.device_name}</Typography>
                                <Typography noWrap sx={{ fontSize: 12, color: PRISM_MUTED }}>
                                  {device.android_version ? `Android ${device.android_version}` : device.device_id}
                                </Typography>
                              </Box>
                              <Box component="span" sx={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, px: 1, py: 0.4, borderRadius: 99, color: tag.fg, bgcolor: tag.bg, textTransform: 'uppercase' }}>
                                {tag.text}
                              </Box>
                            </Stack>
                          );
                        })}
                      </Stack>
                    )}
                  </Box>
                </Box>

                {/* Recent runs */}
                <Box sx={{ ...glass, p: 2.5 }}>
                  <Stack direction="row" alignItems="center" gap={1.25} flexWrap="wrap" sx={{ mb: 1.5 }}>
                    <Typography component="h2" sx={{ m: 0, fontSize: 19, fontWeight: 800, letterSpacing: '-0.02em' }}>
                      Recent runs
                    </Typography>
                    <Box component="span" sx={{ fontFamily: MONO, fontSize: 11.5, fontWeight: 600, px: 1.25, py: 0.5, borderRadius: 99, bgcolor: '#eef0f8', color: '#3a4060', maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {activeAiConfig?.model ?? 'No model'}
                    </Box>
                    <Box sx={{ flexGrow: 1 }} />
                    {metrics.avgSteps > 0 && (
                      <Typography sx={{ fontFamily: MONO, fontSize: 12, color: PRISM_MUTED }}>
                        avg {metrics.avgSteps} steps · {formatDuration(metrics.avgDuration)}
                      </Typography>
                    )}
                  </Stack>

                  {isLoading ? (
                    <Stack spacing={1}>
                      <Skeleton height={48} />
                      <Skeleton height={48} />
                      <Skeleton height={48} />
                    </Stack>
                  ) : recentTasks.length === 0 ? (
                    <Typography sx={{ py: 4, textAlign: 'center', fontSize: 14, color: PRISM_MUTED }}>
                      No automation runs yet. Start one from Mission Control.
                    </Typography>
                  ) : (
                    <Stack spacing={0.25}>
                      {recentTasks.map((task) => {
                        const device = devices.find((item) => item.id === task.device_id);
                        const icon = task.is_running
                          ? { bg: alpha(PRISM_ACCENT, 0.12), fg: PRISM_ACCENT, el: <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: PRISM_ACCENT }} /> }
                          : task.success
                            ? { bg: 'rgba(22,163,74,.12)', fg: '#15803d', el: <CheckRoundedIcon sx={{ fontSize: 16 }} /> }
                            : { bg: 'rgba(220,38,38,.1)', fg: '#b91c1c', el: <PriorityHighRoundedIcon sx={{ fontSize: 16 }} /> };
                        return (
                          <ButtonBase
                            key={task.id}
                            onClick={() => navigate(task.device_id ? `/android-agent?deviceId=${task.device_id}` : '/mission-control')}
                            sx={{ justifyContent: 'flex-start', gap: 1.5, px: 1.25, py: 1.1, borderRadius: '14px', textAlign: 'left', '&:hover': { bgcolor: alpha(PRISM_ACCENT, 0.05) } }}
                          >
                            <Box sx={{ width: 28, height: 28, flexShrink: 0, borderRadius: '9px', display: 'grid', placeItems: 'center', bgcolor: icon.bg, color: icon.fg }}>{icon.el}</Box>
                            <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                              <Typography noWrap sx={{ fontSize: 14, fontWeight: 700 }}>{task.prompt}</Typography>
                              <Typography noWrap sx={{ fontFamily: MONO, fontSize: 11.5, color: PRISM_MUTED }}>
                                {device?.device_name ?? 'Unknown device'} · {task.total_steps} steps · {formatDuration(task.total_duration_seconds)}
                              </Typography>
                            </Box>
                            <Typography sx={{ fontFamily: MONO, fontSize: 11.5, color: PRISM_MUTED, flexShrink: 0 }}>{timeAgo(task.created_at)}</Typography>
                          </ButtonBase>
                        );
                      })}
                    </Stack>
                  )}
                </Box>
              </>
            )}
          </Stack>
        </Box>
      </Box>
    </>
  );
}
