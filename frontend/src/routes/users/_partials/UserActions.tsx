import type { User } from '@/RTKService/userService/userService';
import { Button, Group } from '@mantine/core';
import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconEdit, IconTrash, IconX } from '@tabler/icons-react';

interface UserActionsProps {
  user: User;
  onEdit: (user: User) => void;
  onDelete: (userId: number) => Promise<unknown>;
  isDeleting?: boolean;
}

/**
 * UserActions component
 * Renders edit and delete action buttons for a user row
 */
export function UserActions({ user, onEdit, onDelete, isDeleting = false }: UserActionsProps) {
  const handleDelete = () => {
    modals.openConfirmModal({
      title: 'Delete User',
      children: `Are you sure you want to delete "${user.name}"? This action cannot be undone.`,
      labels: { confirm: 'Delete', cancel: 'Cancel' },
      confirmProps: { color: 'red' },
      onConfirm: async () => {
        try {
          await onDelete(user.id);
          notifications.show({
            title: 'Success',
            message: 'User deleted successfully',
            color: 'green',
            icon: <IconCheck size="1rem" />,
          });
        } catch (error) {
          notifications.show({
            title: 'Error',
            message: error instanceof Error ? error.message : 'Failed to delete user',
            color: 'red',
            icon: <IconX size="1rem" />,
          });
        }
      },
    });
  };

  return (
    <Group gap="xs" justify="center">
      <Button size="xs" variant="light" color="yellow" leftSection={<IconEdit size={12} />} onClick={() => onEdit(user)}>
        Edit
      </Button>
      <Button size="xs" variant="light" color="red" leftSection={<IconTrash size={12} />} onClick={handleDelete} loading={isDeleting}>
        Delete
      </Button>
    </Group>
  );
}
