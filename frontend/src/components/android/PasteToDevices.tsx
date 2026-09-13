import { useSendDirectActionMutation } from '@/RTKService/androidService/androidService';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import { Button, CircularProgress, Stack, TextField, Tooltip } from '@mui/material';
import { useState } from 'react';
import toast from 'react-hot-toast';

interface PasteToDevicesProps {
  deviceIds: number[];
  disabled?: boolean;
}

/**
 * Types one piece of text onto every selected phone.
 *
 * Two actions per device, in order: the text goes to that phone's clipboard,
 * then a paste fires. A paste on its own could only ever repeat whatever was
 * already on the clipboard, which is why the two are never offered separately.
 *
 * The paste lands in whatever field currently has focus, so a text box has to
 * be open and tapped on the phone first — usually by sending the fleet to the
 * right screen and tapping the field, either by hand or with a task.
 */
export default function PasteToDevices({ deviceIds, disabled }: PasteToDevicesProps) {
  const [sendDirectAction] = useSendDirectActionMutation();
  const [text, setText] = useState('');
  const [isPasting, setIsPasting] = useState(false);

  const paste = async () => {
    const value = text.trim();
    if (!value) return toast.error('Type something to paste');
    if (deviceIds.length === 0) return toast.error('Select at least one device');

    setIsPasting(true);
    let ok = 0;

    try {
      const BATCH = 4;
      for (let start = 0; start < deviceIds.length; start += BATCH) {
        const batch = deviceIds.slice(start, start + BATCH);
        const results = await Promise.allSettled(
          batch.map(async (deviceId) => {
            await sendDirectAction({ device_id: deviceId, action: { type: 'SetClipboard', text: value } }).unwrap();
            await sendDirectAction({ device_id: deviceId, action: { type: 'Paste' } }).unwrap();
            return true;
          }),
        );
        ok += results.filter((result) => result.status === 'fulfilled').length;
      }

      if (ok === 0) toast.error('Nothing was pasted — is a text field focused on the phone?');
      else if (ok < deviceIds.length) toast.success(`Pasted on ${ok} of ${deviceIds.length}`);
      else toast.success(`Pasted on ${ok} device${ok === 1 ? '' : 's'}`);
    } finally {
      setIsPasting(false);
    }
  };

  return (
    <Stack direction="row" gap={1} alignItems="center" sx={{ flexGrow: 1, minWidth: 260 }}>
      <TextField
        fullWidth
        size="small"
        placeholder="Text to paste into the focused field…"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            void paste();
          }
        }}
      />
      <Tooltip title="Copies the text to each phone, then pastes it where the cursor is">
        <span>
          <Button
            size="small"
            variant="outlined"
            startIcon={isPasting ? <CircularProgress size={14} color="inherit" /> : <ContentPasteIcon fontSize="small" />}
            disabled={disabled || isPasting || deviceIds.length === 0 || !text.trim()}
            onClick={() => void paste()}
            sx={{ whiteSpace: 'nowrap' }}
          >
            Paste on {deviceIds.length || 0}
          </Button>
        </span>
      </Tooltip>
    </Stack>
  );
}
