import type { AiRule, CreateAiRulePayload, UpdateAiRulePayload } from '@/RTKService/aiRuleService/aiRuleService';
import { Button, Checkbox, Group, Modal, Stack, Textarea, TextInput } from '@/components/mui/core';
import { useForm } from '@/components/mui/form';
import { useEffect } from 'react';

interface MyRuleFormModalProps {
  rule?: AiRule;
  opened: boolean;
  onClose: () => void;
  onSubmit: (data: CreateAiRulePayload | UpdateAiRulePayload) => Promise<void>;
  loading: boolean;
}

export function MyRuleFormModal({ rule, opened, onClose, onSubmit, loading }: MyRuleFormModalProps) {
  const form = useForm({
    initialValues: {
      name: rule?.name || '',
      rule: rule?.rule || '',
      intent: rule?.intent || '',
      website: rule?.website || '',
      is_active: rule?.is_active ?? true,
    },
    validate: {
      name: (value: string) => (value.length < 1 ? 'Name is required' : null),
      rule: (value: string) => (value.length < 1 ? 'Rule is required' : null),
      intent: (value: string) => (value.length < 1 ? 'Intent is required' : null),
      website: (value: string) => {
        if (!value.trim()) return null;
        try {
          new URL(value);
          return null;
        } catch {
          return 'Invalid URL. Please enter a valid URL, e.g., https://example.com';
        }
      },
    },
  });

  // Reset form when rule changes or modal opens
  useEffect(() => {
    if (opened) {
      form.setValues({
        name: rule?.name || '',
        rule: rule?.rule || '',
        intent: rule?.intent || '',
        website: rule?.website || '',
        is_active: rule?.is_active ?? true,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rule, opened]);

  const handleSubmit = async (values: typeof form.values) => {
    try {
      const payload: CreateAiRulePayload | UpdateAiRulePayload = {
        name: values.name,
        rule: values.rule,
        intent: values.intent,
        ...(values.website.trim() && { website: values.website }),
        is_active: values.is_active,
        // User rules are never global
        ...(rule ? {} : { is_global: false }),
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
    <Modal opened={opened} onClose={handleClose} title={rule ? 'Edit Rule' : 'Create Rule'} size="lg">
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="md">
          <TextInput label="Name" placeholder="Enter rule name" required {...form.getInputProps('name')} />

          <Textarea label="Intent" placeholder="Describe when and how this rule should be applied (e.g., 'Handle customer refund requests for online purchases')" description="This helps match the rule to relevant prompts" required minRows={2} maxRows={4} autosize {...form.getInputProps('intent')} />

          <Textarea label="Rule" placeholder="Enter the rule text" required minRows={3} maxRows={6} autosize {...form.getInputProps('rule')} />

          <TextInput label="Website" placeholder="e.g., https://twitter.com (optional)" {...form.getInputProps('website')} />

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
