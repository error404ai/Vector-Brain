import type { AgentTask } from '@/RTKService/agentTaskService/agentTaskService';
import { Badge, Box, Code, Group, Modal, ScrollArea, Stack, Text } from '@mantine/core';

interface AgentTaskDetailModalProps {
  task: AgentTask | undefined;
  opened: boolean;
  onClose: () => void;
}

export function AgentTaskDetailModal({ task, opened, onClose }: AgentTaskDetailModalProps) {
  if (!task) return null;

  return (
    <Modal opened={opened} onClose={onClose} title="Agent Task Details" size="lg">
      <Stack gap="md">
        <Group justify="space-between">
          <Text size="sm" c="dimmed">
            Task ID
          </Text>
          <Badge variant="light" color="blue">
            #{task.id}
          </Badge>
        </Group>

        <Box>
          <Text size="sm" c="dimmed" mb="xs">
            Prompt
          </Text>
          <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {task.prompt}
          </Code>
        </Box>

        {task.steps && (
          <Box>
            <Text size="sm" c="dimmed" mb="xs">
              Steps
            </Text>
            <ScrollArea h={150}>
              <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {task.steps}
              </Code>
            </ScrollArea>
          </Box>
        )}

        {task.logs && (
          <Box>
            <Text size="sm" c="dimmed" mb="xs">
              Logs
            </Text>
            <ScrollArea h={200}>
              <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {task.logs}
              </Code>
            </ScrollArea>
          </Box>
        )}

        {task.provider && (
          <Box>
            <Text size="sm" c="dimmed" mb="xs">
              Provider
            </Text>
            <Text size="sm">{task.provider}</Text>
          </Box>
        )}

        {task.model && (
          <Box>
            <Text size="sm" c="dimmed" mb="xs">
              Model
            </Text>
            <Text size="sm">{task.model}</Text>
          </Box>
        )}

        <Box>
          <Text size="sm" c="dimmed" mb="xs">
            Success
          </Text>
          <Badge color={task.success ? 'green' : 'red'}>{task.success ? 'Yes' : 'No'}</Badge>
        </Box>

        {task.message && (
          <Box>
            <Text size="sm" c="dimmed" mb="xs">
              Message
            </Text>
            <Text size="sm">{task.message}</Text>
          </Box>
        )}

        <Box>
          <Text size="sm" c="dimmed" mb="xs">
            Total Steps
          </Text>
          <Text size="sm">{task.total_steps}</Text>
        </Box>

        <Box>
          <Text size="sm" c="dimmed" mb="xs">
            Total Duration (seconds)
          </Text>
          <Text size="sm">{task.total_duration_seconds.toFixed(2)}</Text>
        </Box>

        {task.urls_visited && (
          <Box>
            <Text size="sm" c="dimmed" mb="xs">
              URLs Visited
            </Text>
            <ScrollArea h={100}>
              <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {task.urls_visited}
              </Code>
            </ScrollArea>
          </Box>
        )}

        {task.model_actions && (
          <Box>
            <Text size="sm" c="dimmed" mb="xs">
              Model Actions
            </Text>
            <ScrollArea h={150}>
              <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {task.model_actions}
              </Code>
            </ScrollArea>
          </Box>
        )}

        {task.errors && (
          <Box>
            <Text size="sm" c="dimmed" mb="xs">
              Errors
            </Text>
            <ScrollArea h={150}>
              <Code block style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {task.errors}
              </Code>
            </ScrollArea>
          </Box>
        )}

        <Group justify="space-between">
          <Box>
            <Text size="xs" c="dimmed">
              Created
            </Text>
            <Text size="sm">{new Date(task.created_at).toLocaleString()}</Text>
          </Box>
          <Box>
            <Text size="xs" c="dimmed">
              Updated
            </Text>
            <Text size="sm">{new Date(task.updated_at).toLocaleString()}</Text>
          </Box>
        </Group>
      </Stack>
    </Modal>
  );
}
