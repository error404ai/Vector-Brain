import { useQueueDeviceFileMutation } from '@/RTKService/androidService/deviceFileService';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import { Button, CircularProgress, Tooltip } from '@mui/material';
import { useRef } from 'react';
import toast from 'react-hot-toast';

interface SendFileButtonProps {
  /** Devices the file goes to. One from the agent page, many from the fleet. */
  deviceIds: number[];
  disabled?: boolean;
  label?: string;
  size?: 'small' | 'medium';
}

/**
 * Pushes a file from the browser to one or more phones.
 *
 * The same control serves a single device and a selection, because the only
 * difference is the length of the id list — the upload, the encoding and the
 * error handling are identical, and keeping one copy means a fix to any of them
 * reaches both pages.
 */
export default function SendFileButton({ deviceIds, disabled, label = 'Send file', size = 'small' }: SendFileButtonProps) {
  const [queueFile, { isLoading }] = useQueueDeviceFileMutation();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const send = async (file: File) => {
    if (deviceIds.length === 0) return toast.error('No device selected');

    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        // readAsDataURL gives "data:<mime>;base64,<payload>" — only the payload
        // goes to the server.
        reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
        reader.onerror = () => reject(new Error('Could not read the file'));
        reader.readAsDataURL(file);
      });

      const response = await queueFile({
        device_ids: deviceIds,
        file_name: file.name,
        mime_type: file.type || 'application/octet-stream',
        content_base64: base64,
      }).unwrap();

      toast.success(response.message || `Sent ${file.name}`);
    } catch (err: any) {
      toast.error(err?.data?.message || 'Could not send the file');
    }
  };

  return (
    <>
      <Tooltip title="Send a file to this device's Downloads folder">
        <span>
          <Button
            size={size}
            startIcon={isLoading ? <CircularProgress size={14} /> : <AttachFileIcon fontSize="small" />}
            disabled={disabled || isLoading || deviceIds.length === 0}
            onClick={() => inputRef.current?.click()}
            sx={{ whiteSpace: 'nowrap' }}
          >
            {label}
          </Button>
        </span>
      </Tooltip>

      <input
        ref={inputRef}
        type="file"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Cleared so picking the same file twice in a row still fires.
          event.target.value = '';
          if (file) void send(file);
        }}
      />
    </>
  );
}
