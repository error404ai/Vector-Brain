import { useGetDashboardSummaryQuery, type RecentActivity } from '@/RTKService/dashboardService/dashboardService';
import PageHeader from '@/components/ui/PageHeader';
import StatCard from '@/components/ui/StatCard';
import { useAppSelector } from '@/store/hooks';
import type { RootState } from '@/store';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import GroupIcon from '@mui/icons-material/Group';
import PersonIcon from '@mui/icons-material/Person';
import PsychologyIcon from '@mui/icons-material/Psychology';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import { alpha, Box, Chip, Divider, LinearProgress, Paper, Skeleton, Stack, Typography } from '@mui/material';
import { Helmet } from 'react-helmet-async';

export default function Dashboard() {
  const { data: summaryResponse, isLoading } = useGetDashboardSummaryQuery();
  const user = useAppSelector((state: RootState) => state.auth.user);
  const isAdmin = user?.role === 'admin';
  const summary = summaryResponse?.data;
  const stats = summary?.stats;
  const recentActivity = summary?.recentActivity ?? [];

  const statCards = [
    { title: 'Total Users', value: stats?.totalUsers ?? 0, icon: <GroupIcon />, color: '#2563eb', path: '/users', adminOnly: true },
    { title: 'Active Users', value: stats?.activeUsers ?? 0, icon: <PersonIcon />, color: '#0f766e', path: '/users', adminOnly: true },
    { title: 'Agent Tasks', value: stats?.totalAgentTasks ?? 0, icon: <SmartToyIcon />, color: '#d97706', path: '/agent-tasks', adminOnly: false },
    { title: 'AI Rules', value: stats?.totalAiRules ?? 0, icon: <PsychologyIcon />, color: '#7c3aed', path: isAdmin ? '/ai-rules' : '/my-rules', adminOnly: false },
  ].filter((card) => isAdmin || !card.adminOnly);

  const totalTasks = stats?.totalAgentTasks ?? 0;
  const recentTasks = stats?.recentAgentTasks ?? 0;
  const activeUsers = stats?.activeUsers ?? 0;
  const totalUsers = stats?.totalUsers ?? 0;
  const recentTaskPercent = totalTasks ? Math.min((recentTasks / totalTasks) * 100, 100) : 0;
  const activeUserPercent = totalUsers ? Math.min((activeUsers / totalUsers) * 100, 100) : 0;

  return (
    <>
      <Helmet>
        <title>Dashboard - Vector Brain</title>
      </Helmet>

      <PageHeader
        title="Dashboard"
        subtitle="Operational overview for tasks, rules, and recent AI activity."
        action={<Chip icon={<AutoAwesomeIcon />} label="Vector Brain v1.0" color="primary" variant="outlined" />}
      />

      <Stack spacing={3}>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', xl: `repeat(${statCards.length}, minmax(0, 1fr))` },
            gap: 2,
          }}
        >
          {statCards.map((card) => (
            <StatCard key={card.title} title={card.title} value={isLoading ? null : card.value.toLocaleString()} icon={card.icon} color={card.color} path={card.path} helperText="Current workspace total" />
          ))}
        </Box>

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 360px' }, gap: 3, alignItems: 'start' }}>
          <Paper sx={{ p: { xs: 2, md: 2.5 } }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Recent Activity
            </Typography>
            <Stack divider={<Divider flexItem />} spacing={0}>
              {isLoading
                ? Array.from({ length: 5 }).map((_, index) => (
                    <Stack key={index} direction="row" spacing={1.5} alignItems="center" sx={{ py: 1.4 }}>
                      <Skeleton variant="rounded" width={38} height={38} />
                      <Box sx={{ flex: 1 }}>
                        <Skeleton width="42%" height={20} />
                        <Skeleton width="72%" height={18} />
                      </Box>
                      <Skeleton width={72} />
                    </Stack>
                  ))
                : recentActivity.length > 0
                  ? recentActivity.map((activity) => <ActivityRow key={`${activity.type}-${activity.id}`} activity={activity} />)
                  : (
                    <Box sx={{ py: 6, textAlign: 'center' }}>
                      <Typography variant="body2" color="text.secondary">
                        No recent activity yet.
                      </Typography>
                    </Box>
                  )}
            </Stack>
          </Paper>

          <Paper sx={{ p: { xs: 2, md: 2.5 } }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              Overview
            </Typography>
            <Stack spacing={2.25} alignItems="stretch">
              <Box sx={{ display: 'grid', placeItems: 'center', py: 1 }}>
                <Box
                  sx={{
                    width: 150,
                    height: 150,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    background: `conic-gradient(#2563eb ${Math.max(recentTaskPercent, activeUserPercent)}%, #e5e7eb 0)`,
                  }}
                >
                  <Box sx={{ width: 92, height: 92, borderRadius: '50%', bgcolor: 'background.paper', display: 'grid', placeItems: 'center' }}>
                    {isLoading ? <Skeleton width={42} height={32} /> : <Typography variant="h5">{totalTasks}</Typography>}
                  </Box>
                </Box>
              </Box>

              {isAdmin ? <MetricRow label="Active Users" value={activeUsers} percent={activeUserPercent} loading={isLoading} color="#2563eb" /> : null}
              <MetricRow label="Recent Tasks" value={recentTasks} percent={recentTaskPercent} loading={isLoading} color="#0ea5e9" />
              <MetricRow label={isAdmin ? 'Total Tasks' : 'My Total Tasks'} value={totalTasks} percent={100} loading={isLoading} color="#7c3aed" />
            </Stack>
          </Paper>
        </Box>
      </Stack>
    </>
  );
}

function ActivityRow({ activity }: { activity: RecentActivity }) {
  const config = getActivityConfig(activity.type);

  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ py: 1.35 }}>
      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ width: 38, height: 38, borderRadius: 2, display: 'grid', placeItems: 'center', flexShrink: 0, bgcolor: alpha(config.color, 0.1), color: config.color }}>{config.icon}</Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 750 }} noWrap>
            {activity.title}
          </Typography>
          <Typography variant="body2" color="text.secondary" noWrap>
            {activity.description}
          </Typography>
        </Box>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
        {formatTimeAgo(activity.createdAt)}
      </Typography>
    </Stack>
  );
}

function MetricRow({ label, value, percent, loading, color }: { label: string; value: number; percent: number; loading: boolean; color: string }) {
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" spacing={2} sx={{ mb: 0.75 }}>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        {loading ? <Skeleton width={40} /> : <Typography variant="body2">{value.toLocaleString()}</Typography>}
      </Stack>
      <LinearProgress variant="determinate" value={percent} sx={{ height: 6, borderRadius: 99, bgcolor: alpha(color, 0.12), '& .MuiLinearProgress-bar': { bgcolor: color } }} />
    </Box>
  );
}

function getActivityConfig(type: RecentActivity['type']) {
  switch (type) {
    case 'user':
      return { icon: <PersonIcon fontSize="small" />, color: '#2563eb' };
    case 'agent_task':
      return { icon: <SmartToyIcon fontSize="small" />, color: '#0f766e' };
    default:
      return { icon: <PsychologyIcon fontSize="small" />, color: '#7c3aed' };
  }
}

function formatTimeAgo(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 60) return 'Just now';
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
  if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)}d ago`;
  return date.toLocaleDateString();
}
