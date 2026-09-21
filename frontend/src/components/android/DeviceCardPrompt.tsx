import SendIcon from '@mui/icons-material/Send';
import { IconButton, Stack, TextField } from '@mui/material';
import { memo, useState } from 'react';

interface DeviceCardPromptProps {
  disabled: boolean;
  onSubmit: (text: string) => void;
}

/**
 * The per-card "Task for this device" input.
 *
 * It was the biggest source of fleet-page lag: the draft lived in a page-level
 * map, so every keystroke re-rendered all two-dozen heavy device cards and
 * typing stuttered. Keeping the draft in local state here means a keystroke
 * re-renders only this one input; the page hears nothing until the user submits.
 * memo keeps the parent's re-renders (frames, heartbeats) from redrawing it.
 */
function DeviceCardPromptBase({ disabled, onSubmit }: DeviceCardPromptProps) {
  const [value, setValue] = useState('');

  const submit = () => {
    const text = value.trim();
    if (!text) return;
    onSubmit(text);
    setValue('');
  };

  return (
    <Stack direction="row" gap={0.75} sx={{ px: 1, pb: 1 }}>
      <TextField
        fullWidth
        size="small"
        placeholder="Task for this device…"
        disabled={disabled}
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        sx={{ '& .MuiInputBase-input': { fontSize: 13 } }}
      />
      <IconButton size="small" color="primary" disabled={disabled || !value.trim()} onClick={submit}>
        <SendIcon fontSize="small" />
      </IconButton>
    </Stack>
  );
}

const DeviceCardPrompt = memo(DeviceCardPromptBase);
export default DeviceCardPrompt;
