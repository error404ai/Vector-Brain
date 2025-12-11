import type { AiRule, CreateAiRulePayload, UpdateAiRulePayload } from '@/RTKService/aiRuleService/aiRuleService';
import { Button, Checkbox, Group, Modal, Stack, Textarea, TextInput } from '@mantine/core';
import { useForm } from '@mantine/form';
import { useEffect } from 'react';

interface AiRuleFormModalProps {
  rule?: AiRule;
  opened: boolean;
  onClose: () => void;
  onSubmit: (data: CreateAiRulePayload | UpdateAiRulePayload) => Promise<void>;
  loading: boolean;
}

export function AiRuleFormModal({ rule, opened, onClose, onSubmit, loading }: AiRuleFormModalProps) {
  const form = useForm({
    initialValues: {
      name: rule?.name || '',
      description: rule?.description || '',
      conditions: rule?.conditions ? (typeof rule.conditions === 'string' ? rule.conditions : JSON.stringify(rule.conditions, null, 2)) : '',
      is_active: rule?.is_active ?? true,
    },
    validate: {
      name: (value: string) => (value.length < 1 ? 'Name is required' : null),
      conditions: (value: string) => {
        if (value.trim()) {
          try {
            JSON.parse(value);
          } catch {
            return 'Conditions must be valid JSON';
          }
        }
        return null;
      },
    },
  });

  // Reset form when rule changes or modal opens
  useEffect(() => {
    if (opened) {
      form.setValues({
        name: rule?.name || '',
        description: rule?.description || '',
        conditions: rule?.conditions ? (typeof rule.conditions === 'string' ? rule.conditions : JSON.stringify(rule.conditions, null, 2)) : '',
        is_active: rule?.is_active ?? true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rule, opened]);

  const handleSubmit = async (values: typeof form.values) => {
    try {
      const payload: CreateAiRulePayload | UpdateAiRulePayload = {
        name: values.name,
        ...(values.description.trim() && { description: values.description }),
        ...(values.conditions.trim() && { conditions: JSON.parse(values.conditions) }),
        is_active: values.is_active,
      };

      await onSubmit(payload);
      form.reset();
      onClose();
    } catch {
      // Error handling is done in parent
    }
  };

  const handleClose = () => {
    form.reset();
    onClose();
  };

  return (
    <Modal opened={opened} onClose={handleClose} title={rule ? 'Edit AI Rule' : 'Create AI Rule'} size="lg">
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="md">
          <TextInput label="Name" placeholder="Enter rule name" required {...form.getInputProps('name')} />

          <Textarea label="Description" placeholder="Enter rule description (optional)" minRows={2} maxRows={4} autosize {...form.getInputProps('description')} />

          <Textarea label="Conditions (JSON)" placeholder='Enter conditions as JSON (e.g., {"key": "value"})' minRows={3} maxRows={6} autosize {...form.getInputProps('conditions')} />

          <Checkbox label="Active" {...form.getInputProps('is_active', { type: 'checkbox' })} />

          <Group justify="flex-end" mt="md">
            <Button variant="light" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" loading={loading}>
              {rule ? 'Update' : 'Create'}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
