import type { CreateUserPayload, UpdateUserPayload, User } from '@/RTKService/userService/userService';
import { Button, Checkbox, Group, Modal, Stack, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconX } from '@tabler/icons-react';
import { useEffect, useState } from 'react';

interface UserFormModalProps {
  user?: User;
  opened: boolean;
  onClose: () => void;
  onSubmit: (data: CreateUserPayload | UpdateUserPayload) => Promise<void>;
  isLoading: boolean;
  title: string;
}

/**
 * UserFormModal component
 * Renders a modal form for creating or editing users
 */
export function UserFormModal({ user, opened, onClose, onSubmit, isLoading, title }: UserFormModalProps) {
  const form = useForm({
    initialValues: {
      name: user?.name || '',
      email: user?.email || '',
      password: '',
      phone: user?.phone || '',
      isActive: user?.isActive ?? true,
    },
    validate: {
      name: (value: string) => (value.length < 1 ? 'Name is required' : null),
      email: (value: string) => (/^\S+@\S+$/.test(value) ? null : 'Invalid email'),
      password: (value: string) => {
        // For new users, password is required
        if (!user && (!value || value.length < 6)) {
          return 'Password must be at least 6 characters';
        }
        // For existing users with password change, validate length
        if (user && changePassword && value.length > 0 && value.length < 6) {
          return 'Password must be at least 6 characters';
        }
        return null;
      },
    },
  });

  const [changePassword, setChangePassword] = useState(false);

  // Reset form when user changes or modal opens
  useEffect(() => {
    if (opened) {
      form.setValues({
        name: user?.name || '',
        email: user?.email || '',
        password: '',
        phone: user?.phone || '',
        isActive: user?.isActive ?? true,
      });
      setChangePassword(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, opened]);

  const handleSubmit = async (values: typeof form.values) => {
    // Additional password validation for new users
    if (!user && (!values.password || values.password.length < 6)) {
      notifications.show({
        title: 'Error',
        message: 'Password must be at least 6 characters',
        color: 'red',
      });
      return;
    }

    // Password validation for editing with change password enabled
    if (user && changePassword && (!values.password || values.password.length < 6)) {
      notifications.show({
        title: 'Error',
        message: 'Password must be at least 6 characters',
        color: 'red',
      });
      return;
    }

    try {
      const payload: CreateUserPayload | UpdateUserPayload = {
        name: values.name,
        email: values.email,
        ...(values.phone && { phone: values.phone }),
        ...(user && { isActive: values.isActive }),
      };

      // Add password for new users or when changing password
      if (!user || changePassword) {
        if (values.password) {
          (payload as CreateUserPayload).password = values.password;
        }
      }

      await onSubmit(payload);

      notifications.show({
        title: 'Success',
        message: user ? 'User updated successfully' : 'User created successfully',
        color: 'green',
        icon: <IconCheck size="1rem" />,
      });

      form.reset();
      onClose();
    } catch (error) {
      notifications.show({
        title: 'Error',
        message: error instanceof Error ? error.message : 'An error occurred',
        color: 'red',
        icon: <IconX size="1rem" />,
      });
    }
  };

  return (
    <Modal opened={opened} onClose={onClose} title={title} centered>
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack>
          <TextInput label="Name" placeholder="Enter user name" required {...form.getInputProps('name')} />

          <TextInput label="Email" placeholder="Enter email address" required {...form.getInputProps('email')} />

          <TextInput label="Phone" placeholder="Enter phone number (optional)" {...form.getInputProps('phone')} />

          {/* For editing: show checkbox to enable password change */}
          {user && <Checkbox label="Change password" checked={changePassword} onChange={(e) => setChangePassword(e.currentTarget.checked)} />}

          {/* Show password field for new users or when change password is checked */}
          {(!user || changePassword) && <TextInput label="Password" type="password" placeholder="Enter password" required={!user} {...form.getInputProps('password')} />}

          {/* Show active status toggle for editing */}
          {user && <Checkbox label="Active" {...form.getInputProps('isActive', { type: 'checkbox' })} />}

          <Group justify="flex-end">
            <Button variant="subtle" onClick={onClose} disabled={isLoading}>
              Cancel
            </Button>
            <Button type="submit" loading={isLoading}>
              {user ? 'Update' : 'Create'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
