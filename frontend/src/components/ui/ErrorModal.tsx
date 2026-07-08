import { clearError } from '@/store/authSlice';
import type { RootState } from '@/store/store';
import { Button, Code, Modal, ScrollArea, Stack, Text } from '@/components/mui/core';
import { IconAlertCircle } from '@/components/mui/icons';
import { useDispatch, useSelector } from 'react-redux';

export function ErrorModal() {
  const dispatch = useDispatch();
  const error = useSelector((state: RootState) => state.auth.error);

  const handleClose = () => {
    dispatch(clearError());
  };

  return (
    <Modal
      opened={error.isError}
      onClose={handleClose}
      title={
        <Text c="red" fw={600} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <IconAlertCircle size={20} />
          Error
        </Text>
      }
      size="lg"
      centered
    >
      <Stack gap="md">
        <Text>{error.message || 'An unexpected error occurred'}</Text>
        {error.trace && (
          <ScrollArea h={200}>
            <Code block>{error.trace}</Code>
          </ScrollArea>
        )}
        <Button onClick={handleClose} color="red" variant="light" fullWidth>
          Close
        </Button>
      </Stack>
    </Modal>
  );
}

export default ErrorModal;
