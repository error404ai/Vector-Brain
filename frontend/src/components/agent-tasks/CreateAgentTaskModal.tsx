import type { CreateAgentTaskPayload } from '@/RTKService/agentTaskService/agentTaskService';
import { Button, Group, Modal, Stack, Textarea } from '@/components/mui/core';
import { useForm } from '@/components/mui/form';

interface CreateAgentTaskModalProps {
  opened: boolean;
  onClose: () => void;
  onSubmit: (data: CreateAgentTaskPayload) => Promise<void>;
  isLoading: boolean;
}

export function CreateAgentTaskModal({ opened, onClose, onSubmit, isLoading }: CreateAgentTaskModalProps) {
  const form = useForm<CreateAgentTaskPayload>({
    initialValues: {
      prompt: '',
      logs: '',
      steps: '',
    },
    validate: {
      prompt: (value) => (!value?.trim() ? 'Prompt is required' : null),
    },
  });

  const handleSubmit = async (values: CreateAgentTaskPayload) => {
    try {
      await onSubmit({
        prompt: values.prompt,
        ...(values.logs?.trim() && { logs: values.logs }),
        ...(values.steps?.trim() && { steps: values.steps }),
      });
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
    <Modal opened={opened} onClose={handleClose} title="Create New Agent Task" size="lg">
      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="md">
          <Textarea label="Prompt" placeholder="Enter the task prompt..." required minRows={3} maxRows={6} autosize {...form.getInputProps('prompt')} />

          <Textarea label="Steps (Optional)" placeholder="Enter the task steps..." minRows={2} maxRows={4} autosize {...form.getInputProps('steps')} />

          <Textarea label="Logs (Optional)" placeholder="Enter any logs..." minRows={2} maxRows={4} autosize {...form.getInputProps('logs')} />

          <Group justify="flex-end" mt="md">
            <Button variant="light" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" loading={isLoading}>
              Create Task
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
