import { Badge, Card, Grid, Group, Paper, Progress, RingProgress, SimpleGrid, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconArrowDownRight, IconArrowUpRight, IconBrain, IconDatabase, IconFolder, IconUsers } from '@tabler/icons-react';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/dashboard')({
  component: Dashboard,
});

const stats = [
  {
    title: 'Total Users',
    value: '1,234',
    diff: 12,
    icon: IconUsers,
    color: 'vector',
  },
  {
    title: 'Active Projects',
    value: '56',
    diff: -3,
    icon: IconFolder,
    color: 'cyan',
  },
  {
    title: 'Knowledge Items',
    value: '8,432',
    diff: 28,
    icon: IconBrain,
    color: 'teal',
  },
  {
    title: 'Database Size',
    value: '2.4 GB',
    diff: 5,
    icon: IconDatabase,
    color: 'grape',
  },
];

function Dashboard() {
  const statCards = stats.map((stat) => {
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
          <Text fw={700} fz="xl">
            {stat.value}
          </Text>
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
      <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }}>{statCards}</SimpleGrid>

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
              {[
                {
                  title: 'New knowledge item added',
                  time: '2 hours ago',
                  color: 'teal',
                },
                {
                  title: "Project 'AI Assistant' updated",
                  time: '5 hours ago',
                  color: 'vector',
                },
                {
                  title: 'Database backup completed',
                  time: '1 day ago',
                  color: 'cyan',
                },
                {
                  title: 'New user registered',
                  time: '2 days ago',
                  color: 'grape',
                },
              ].map((activity, index) => (
                <Group key={index} justify="space-between">
                  <Group gap="sm">
                    <ThemeIcon color={activity.color} variant="light" size="sm">
                      <IconBrain size="0.8rem" />
                    </ThemeIcon>
                    <Text size="sm">{activity.title}</Text>
                  </Group>
                  <Text size="xs" c="dimmed">
                    {activity.time}
                  </Text>
                </Group>
              ))}
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
              Storage Usage
            </Title>
            <Stack align="center" gap="md">
              <RingProgress
                size={150}
                roundCaps
                thickness={12}
                sections={[
                  { value: 40, color: '#0B69C6' },
                  { value: 15, color: '#22D3EE' },
                  { value: 15, color: '#8B5CF6' },
                ]}
                label={
                  <Text fw={700} ta="center" size="xl">
                    70%
                  </Text>
                }
              />
              <Stack gap="xs" w="100%">
                <Group justify="space-between">
                  <Text size="sm" c="dimmed">
                    Documents
                  </Text>
                  <Text size="sm">1.0 GB</Text>
                </Group>
                <Progress value={40} color="vector" size="sm" />

                <Group justify="space-between" mt="xs">
                  <Text size="sm" c="dimmed">
                    Media
                  </Text>
                  <Text size="sm">0.4 GB</Text>
                </Group>
                <Progress value={15} color="cyan" size="sm" />

                <Group justify="space-between" mt="xs">
                  <Text size="sm" c="dimmed">
                    Other
                  </Text>
                  <Text size="sm">0.4 GB</Text>
                </Group>
                <Progress value={15} color="grape" size="sm" />
              </Stack>
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  );
}
