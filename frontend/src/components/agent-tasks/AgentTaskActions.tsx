import type { AgentTask } from '@/RTKService/agentTaskService/agentTaskService';
import { ActionIcon, Group, Tooltip } from '@/components/mui/core';
import { modals } from '@/components/mui/modals';
import { notifications } from '@/components/mui/notifications';
import { IconCheck, IconEye, IconTrash, IconX } from '@/components/mui/icons';

interface AgentTaskActionsProps {
  task: AgentTask;
  onView: (task: AgentTask) => void;
  onDelete: (id: number) => Promise<{ message: string }>;
  isDeleting: boolean;
}

export function AgentTaskActions({ task, onView, onDelete, isDeleting }: AgentTaskActionsProps) {
  const handleDelete = () => {
    modals.openConfirmModal({
      title: 'Delete Agent Task',
      children: 'Are you sure you want to delete this agent task? This action cannot be undone.',
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await onDelete(task.id);
          notifications.show({
            title: 'Success',
            message: 'Agent task deleted successfully',
            color: 'green',
            icon: <IconCheck size="1rem" />,
          });
        } catch (error) {
          notifications.show({
            title: 'Error',
            message: error instanceof Error ? error.message : 'Failed to delete agent task',
            color: 'red',
            icon: <IconX size="1rem" />,
          });
        }
      },
    });
  };

  return (
    <Group gap="xs" justify="center">
      <Tooltip label="View Details">
        <ActionIcon variant="light" color="blue" onClick={() => onView(task)}>
          <IconEye size="1rem" />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Delete">
        <ActionIcon variant="light" color="red" onClick={handleDelete} loading={isDeleting}>
          <IconTrash size="1rem" />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}
