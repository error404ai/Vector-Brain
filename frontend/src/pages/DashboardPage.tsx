import { useGetDashboardSummaryQuery, type RecentActivity } from '@/RTKService/dashboardService/dashboardService';
import { useAppSelector } from '@/store/hooks';
import type { RootState } from '@/store';
import { Badge, Card, Grid, Group, Paper, Progress, RingProgress, SimpleGrid, Skeleton, Stack, Text, ThemeIcon, Title } from '@/components/mui/core';
import { IconArrowDownRight, IconArrowUpRight, IconBrain, IconRobot, IconUser, IconUsers } from '@/components/mui/icons';

import { Helmet } from 'react-helmet-async';

export default function Dashboard() {
  const { data: summaryResponse, isLoading } = useGetDashboardSummaryQuery();
  const user = useAppSelector((state: RootState) => state.auth.user);
  const isAdmin = user?.role === 'admin';
  const summary = summaryResponse?.data;
  const stats = summary?.stats;
  const recentActivity = summary?.recentActivity ?? [];

  const allStatCards = [
    {
      title: 'Total Users',
      value: stats?.totalUsers ?? 0,
      diff: 12,
      icon: IconUsers,
      color: 'vector',
      adminOnly: true,
    },
    {
      title: 'Active Users',
      value: stats?.activeUsers ?? 0,
      diff: 5,
      icon: IconUser,
      color: 'cyan',
      adminOnly: true,
    },
    {
      title: 'Total Agent Tasks',
      value: stats?.totalAgentTasks ?? 0,
      diff: 28,
      icon: IconRobot,
      color: 'teal',
      adminOnly: false,
    },
    {
      title: 'Total AI Rules',
      value: stats?.totalAiRules ?? 0,
      diff: 10,
      icon: IconBrain,
      color: 'orange',
      adminOnly: false,
    },
  ];

  // Filter stat cards based on user role
  const statCards = isAdmin ? allStatCards : allStatCards.filter((card) => !card.adminOnly);

  const getActivityIcon = (type: RecentActivity['type']) => {
    switch (type) {
      case 'user':
        return IconUser;
      case 'agent_task':
        return IconRobot;
      default:
        return IconBrain;
    }
  };

  const getActivityColor = (type: RecentActivity['type']) => {
    switch (type) {
      case 'user':
        return 'vector';
      case 'agent_task':
        return 'teal';
      default:
        return 'gray';
    }
  };

  const formatTimeAgo = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)} minutes ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)} hours ago`;
    if (diffInSeconds < 604800) return `${Math.floor(diffInSeconds / 86400)} days ago`;
    return date.toLocaleDateString();
  };

  const renderStatCards = statCards.map((stat) => {
    const DiffIcon = stat.diff > 0 ? IconArrowUpRight : IconArrowDownRight;

    return (
      <Paper
        key={stat.title}
        p="md"
        radius="md"
        style={{
          backgroundColor: '#ffffff',
          border: '1px solid rgba(0,0,0,0.1)',
        }}
      >
        <Group justify="space-between">
          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
            {stat.title}
          </Text>
          <ThemeIcon color={stat.color} variant="light" size={38} radius="md">
            <stat.icon size="1.5rem" stroke={1.5} />
          </ThemeIcon>
        </Group>

        <Group align="flex-end" gap="xs" mt={25}>
          {isLoading ? (
            <Skeleton height={28} width={60} />
          ) : (
            <Text fw={700} fz="xl">
              {stat.value.toLocaleString()}
            </Text>
          )}
          <Text c={stat.diff > 0 ? 'teal' : 'red'} fz="sm" fw={500} style={{ display: 'flex', alignItems: 'center' }}>
            <span>{stat.diff}%</span>
            <DiffIcon size="1rem" stroke={1.5} />
          </Text>
        </Group>

        <Text fz="xs" c="dimmed" mt={7}>
          Compared to previous month
        </Text>
      </Paper>
    );
  });

  return (
    <>
      <Helmet>
        <title>Dashboard - Vector Brain</title>
      </Helmet>
      <Stack gap="lg">
        {/* Page Header */}
        <Group justify="space-between" align="center">
          <div>
            <Title order={2}>Dashboard</Title>
            <Text c="dimmed" size="sm">
              Welcome back! Here&apos;s what&apos;s happening with your projects.
            </Text>
          </div>
          <Badge color="vector" variant="light" size="lg">
            Vector Brain v1.0
          </Badge>
        </Group>

        {/* Stats Grid */}
        <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }}>{renderStatCards}</SimpleGrid>

        {/* Activity and Progress */}
        <Grid>
          <Grid.Col span={{ base: 12, md: 8 }}>
            <Card
              padding="lg"
              radius="md"
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid rgba(0,0,0,0.1)',
              }}
            >
              <Title order={4} mb="md">
                Recent Activity
              </Title>
              <Stack gap="md">
                {isLoading ? (
                  // Loading skeletons
                  Array.from({ length: 4 }).map((_, index) => (
                    <Group key={index} justify="space-between">
                      <Group gap="sm">
                        <Skeleton height={24} width={24} radius="sm" />
                        <Skeleton height={16} width={200} />
                      </Group>
                      <Skeleton height={12} width={80} />
                    </Group>
                  ))
                ) : recentActivity.length > 0 ? (
                  recentActivity.map((activity) => {
                    const ActivityIcon = getActivityIcon(activity.type);
                    return (
                      <Group key={`${activity.type}-${activity.id}`} justify="space-between">
                        <Group gap="sm">
                          <ThemeIcon color={getActivityColor(activity.type)} variant="light" size="sm">
                            <ActivityIcon size="0.8rem" />
                          </ThemeIcon>
                          <div>
                            <Text size="sm">{activity.title}</Text>
                            <Text size="xs" c="dimmed">
                              {activity.description}
                            </Text>
                          </div>
                        </Group>
                        <Text size="xs" c="dimmed">
                          {formatTimeAgo(activity.createdAt)}
                        </Text>
                      </Group>
                    );
                  })
                ) : (
                  <Text size="sm" c="dimmed" ta="center">
                    No recent activity
                  </Text>
                )}
              </Stack>
            </Card>
          </Grid.Col>

          <Grid.Col span={{ base: 12, md: 4 }}>
            <Card
              padding="lg"
              radius="md"
              style={{
                backgroundColor: '#ffffff',
                border: '1px solid rgba(0,0,0,0.1)',
              }}
            >
              <Title order={4} mb="md">
                Overview
              </Title>
              <Stack align="center" gap="md">
                <RingProgress
                  size={150}
                  roundCaps
                  thickness={12}
                  sections={[
                    { value: stats ? (stats.activeUsers / Math.max(stats.totalUsers, 1)) * 100 : 0, color: '#0B69C6' },
                    { value: stats ? (stats.recentAgentTasks / Math.max(stats.totalAgentTasks, 1)) * 100 : 0, color: '#22D3EE' },
                  ]}
                  label={
                    isLoading ? (
                      <Skeleton height={28} width={40} mx="auto" />
                    ) : (
                      <Text fw={700} ta="center" size="xl">
                        {stats?.totalAgentTasks ?? 0}
                      </Text>
                    )
                  }
                />
                <Stack gap="xs" w="100%">
                  {isAdmin && (
                    <>
                      <Group justify="space-between">
                        <Text size="sm" c="dimmed">
                          Active Users
                        </Text>
                        {isLoading ? <Skeleton height={16} width={40} /> : <Text size="sm">{stats?.activeUsers ?? 0}</Text>}
                      </Group>
                      <Progress value={stats ? (stats.activeUsers / Math.max(stats.totalUsers, 1)) * 100 : 0} color="vector" size="sm" />
                    </>
                  )}

                  <Group justify="space-between" mt={isAdmin ? 'xs' : undefined}>
                    <Text size="sm" c="dimmed">
                      Recent Tasks
                    </Text>
                    {isLoading ? <Skeleton height={16} width={40} /> : <Text size="sm">{stats?.recentAgentTasks ?? 0}</Text>}
                  </Group>
                  <Progress value={stats ? (stats.recentAgentTasks / Math.max(stats.totalAgentTasks, 1)) * 100 : 0} color="cyan" size="sm" />

                  <Group justify="space-between" mt="xs">
                    <Text size="sm" c="dimmed">
                      {isAdmin ? 'Total Tasks' : 'My Total Tasks'}
                    </Text>
                    {isLoading ? <Skeleton height={16} width={40} /> : <Text size="sm">{stats?.totalAgentTasks ?? 0}</Text>}
                  </Group>
                  <Progress value={100} color="grape" size="sm" />
                </Stack>
              </Stack>
            </Card>
          </Grid.Col>
        </Grid>
      </Stack>
    </>
  );
}
