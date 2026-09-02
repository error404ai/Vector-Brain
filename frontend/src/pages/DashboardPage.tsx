import {
  useGetAndroidDevicesQuery,
  useGetAndroidTasksQuery,
  type AndroidAgentTask,
  type AndroidDevice,
} from '@/RTKService/androidService/androidService';
import { useGetAiConfigsQuery } from '@/RTKService/aiConfigService/aiConfigService';
import PageHeader from '@/components/ui/PageHeader';
import StatCard from '@/components/ui/StatCard';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import BoltIcon from '@mui/icons-material/Bolt';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import PlayCircleIcon from '@mui/icons-material/PlayCircle';
import SettingsSuggestIcon from '@mui/icons-material/SettingsSuggest';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import {
  alpha,
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  LinearProgress,
  Paper,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import { useMemo } from 'react';
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

  const statCards = [
    {
      title: 'Devices online',
      value: `${metrics.onlineDevices} / ${devices.length}`,
      icon: <PhoneAndroidIcon />,
      color: '#10b981',
      helperText: `${metrics.readyDevices} fully ready for automation`,
      path: '/android-fleet',
    },
    {
      title: 'Running now',
      value: metrics.runningNow.length,
      icon: <PlayCircleIcon />,
      color: '#f59e0b',
      helperText: metrics.runningNow.length ? 'Tasks executing on devices' : 'No task in progress',
      path: '/android-fleet',
    },
    {
      title: 'Tasks today',
      value: metrics.todaysTasks,
      icon: <BoltIcon />,
      color: '#6366f1',
      helperText: `${tasks.length} in recent history`,
      path: '/agent-tasks',
    },
    {
      title: 'Success rate',
      value: metrics.finishedCount ? `${metrics.successRate}%` : '—',
      icon: <TrendingUpIcon />,
      color: '#2563eb',
      helperText: `Across ${metrics.finishedCount} finished task${metrics.finishedCount === 1 ? '' : 's'}`,
      path: '/agent-tasks',
    },
  ];

  const recentTasks = tasks.slice(0, 8);

  return (
    <>
      <Helmet>
        <title>Dashboard - Vector Brain</title>
      </Helmet>

      <PageHeader
        title="Dashboard"
        subtitle="Live overview of your devices, automation runs, and agent health."
        action={<Chip icon={<AutoAwesomeIcon />} label="Vector Brain v1.0" color="primary" variant="outlined" />}
      />

      <Stack spacing={3}>
        {/* Setup warnings */}
        {!activeAiConfig && (
          <Alert
            severity="warning"
            action={
              <Button size="small" color="inherit" onClick={() => navigate('/settings')}>
                Configure
              </Button>
            }
          >
            No AI provider is active. Add your API key in Settings before running tasks.
          </Alert>
        )}
        {!devicesLoading && devices.length === 0 && (
          <Alert
            severity="info"
            action={
              <Button size="small" color="inherit" onClick={() => navigate('/android-devices')}>
                Pair device
              </Button>
            }
          >
            No Android device paired yet. Pair one to start automating.
          </Alert>
        )}

        {/* Stat cards */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' },
            gap: 2,
          }}
        >
          {statCards.map((card) => (
            <StatCard
              key={card.title}
              title={card.title}
              value={isLoading ? null : card.value}
              icon={card.icon}
              color={card.color}
              helperText={card.helperText}
              path={card.path}
            />
          ))}
        </Box>

        {/* Two-column: live runs + device health */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.4fr) minmax(0, 1fr)' },
            gap: 2,
          }}
        >
          {/* Currently running */}
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
            <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 2 }}>
              <PlayCircleIcon fontSize="small" color="warning" />
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Currently running
              </Typography>
              <Box sx={{ flexGrow: 1 }} />
              <Button size="small" endIcon={<OpenInNewIcon />} onClick={() => navigate('/android-fleet')}>
                Fleet view
              </Button>
            </Stack>

            {isLoading ? (
              <Stack spacing={1}>
                <Skeleton height={54} />
                <Skeleton height={54} />
              </Stack>
            ) : metrics.runningNow.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                Nothing running right now.
              </Typography>
            ) : (
              <Stack spacing={1.5}>
                {metrics.runningNow.map((task) => {
                  const device = devices.find((item) => item.id === task.device_id);
                  return (
                    <Box key={task.id}>
                      <Stack direction="row" alignItems="center" gap={1}>
                        <Chip
                          size="small"
                          label={device?.device_name ?? `Device ${task.device_id ?? '?'}`}
                          sx={{ height: 20, fontSize: 10, fontWeight: 700 }}
                        />
                        <Typography variant="body2" noWrap sx={{ flexGrow: 1, minWidth: 0 }}>
                          {task.prompt}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {task.total_steps} steps
                        </Typography>
                      </Stack>
                      <LinearProgress sx={{ mt: 0.75, borderRadius: 1 }} />
                    </Box>
                  );
                })}
              </Stack>
            )}
          </Paper>

          {/* Device health */}
          <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
            <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 2 }}>
              <PhoneAndroidIcon fontSize="small" color="success" />
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Devices
              </Typography>
              <Box sx={{ flexGrow: 1 }} />
              <Button size="small" endIcon={<OpenInNewIcon />} onClick={() => navigate('/android-devices')}>
                Manage
              </Button>
            </Stack>

            {isLoading ? (
              <Stack spacing={1}>
                <Skeleton height={40} />
                <Skeleton height={40} />
              </Stack>
            ) : devices.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                No devices paired.
              </Typography>
            ) : (
              <Stack divider={<Divider flexItem />} spacing={1}>
                {devices.slice(0, 6).map((device) => {
                  const online = device.status === 'ONLINE';
                  const ready =
                    online &&
                    device.capabilities?.accessibility === true &&
                    device.capabilities?.screenCapture === true;
                  return (
                    <Stack key={device.id} direction="row" alignItems="center" gap={1} sx={{ py: 0.5 }}>
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          bgcolor: online ? 'success.main' : 'grey.400',
                          flexShrink: 0,
                        }}
                      />
                      <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                        <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                          {device.device_name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {device.android_version ? `Android ${device.android_version}` : device.device_id}
                        </Typography>
                      </Box>
                      {online && !ready && (
                        <Chip
                          size="small"
                          label="Setup"
                          color="warning"
                          variant="outlined"
                          sx={{ height: 20, fontSize: 10 }}
                        />
                      )}
                      {ready && <CheckCircleIcon fontSize="small" color="success" />}
                    </Stack>
                  );
                })}
              </Stack>
            )}
          </Paper>
        </Box>

        {/* Recent tasks */}
        <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2 }}>
          <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 2 }}>
            <SmartToyIcon fontSize="small" color="primary" />
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Recent automation runs
            </Typography>
            <Box sx={{ flexGrow: 1 }} />
            <Chip
              size="small"
              icon={<SettingsSuggestIcon />}
              label={activeAiConfig?.model ?? 'No model'}
              variant="outlined"
              sx={{ maxWidth: 280 }}
            />
          </Stack>

          {isLoading ? (
            <Stack spacing={1}>
              <Skeleton height={48} />
              <Skeleton height={48} />
              <Skeleton height={48} />
            </Stack>
          ) : recentTasks.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
              No automation runs yet. Start one from the Android Agent page.
            </Typography>
          ) : (
            <Stack divider={<Divider flexItem />}>
              {recentTasks.map((task) => {
                const device = devices.find((item) => item.id === task.device_id);
                return (
                  <Stack
                    key={task.id}
                    direction="row"
                    alignItems="center"
                    gap={1.5}
                    sx={{
                      py: 1.25,
                      cursor: 'pointer',
                      borderRadius: 1,
                      px: 1,
                      transition: 'background-color .15s ease',
                      '&:hover': { bgcolor: (theme) => alpha(theme.palette.primary.main, 0.06) },
                    }}
                    onClick={() =>
                      navigate(task.device_id ? `/android-agent?deviceId=${task.device_id}` : '/agent-tasks')
                    }
                  >
                    {task.is_running ? (
                      <PlayCircleIcon fontSize="small" color="warning" />
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
                        {device?.device_name ?? 'Unknown device'} · {task.total_steps} steps ·{' '}
                        {formatDuration(task.total_duration_seconds)}
                      </Typography>
                    </Box>

                    <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                      {timeAgo(task.created_at)}
                    </Typography>
                  </Stack>
                );
              })}
            </Stack>
          )}

          {metrics.avgSteps > 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
              Average run: {metrics.avgSteps} steps · {formatDuration(metrics.avgDuration)}
            </Typography>
          )}
        </Paper>
      </Stack>
    </>
  );
}
