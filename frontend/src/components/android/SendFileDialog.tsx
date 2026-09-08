import {
  useDeleteDeviceFileMutation,
  useGetDeviceFilesQuery,
  useQueueDeviceFileMutation,
  type DeviceFile,
} from '@/RTKService/androidService/deviceFileService';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  LinearProgress,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useRef, useState } from 'react';
import toast from 'react-hot-toast';

/** Matches MAX_FILE_BYTES in DeviceFileService so the error arrives before the upload does. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;

interface SendFileDialogProps {
  open: boolean;
  deviceId: number | null;
  deviceName?: string;
  isOnline: boolean;
  onClose: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Reads a File into base64 without the data: prefix the API does not want. */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

function statusChip(file: DeviceFile) {
  if (file.status === 'DELIVERED') {
    return <Chip size="small" color="success" variant="outlined" icon={<CheckCircleIcon />} label="On device" />;
  }
  if (file.status === 'FAILED') {
    return <Chip size="small" color="error" variant="outlined" icon={<ErrorOutlineIcon />} label="Failed" />;
  }
  return <Chip size="small" variant="outlined" icon={<HourglassEmptyIcon />} label="Waiting" />;
}

/**
 * Queues a file for one device and shows what has already been sent to it.
 *
 * Delivery is a pull, not a push: the companion app polls for pending files, so
 * a file queued for an offline phone simply waits until that phone comes back.
 */
export default function SendFileDialog({ open, deviceId, deviceName, isOnline, onClose }: SendFileDialogProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, isFetching } = useGetDeviceFilesQuery(deviceId as number, {
    skip: !open || deviceId === null,
    pollingInterval: open ? 5000 : 0,
  });
  const [queueFile] = useQueueDeviceFileMutation();
  const [deleteFile] = useDeleteDeviceFileMutation();

  const files = data?.data ?? [];

  const handlePick = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || deviceId === null) return;

    if (file.size > MAX_FILE_BYTES) {
      toast.error(`That file is ${formatSize(file.size)}. The limit is 10 MB.`);
      return;
    }

    setBusy(true);
    try {
      const content_base64 = await readAsBase64(file);
      await queueFile({
        device_id: deviceId,
        file_name: file.name,
        mime_type: file.type || 'application/octet-stream',
        content_base64,
      }).unwrap();
      toast.success(isOnline ? 'Sent. It should land on the phone shortly.' : 'Queued. It will arrive when the phone is back online.');
    } catch (error: any) {
      toast.error(error?.data?.message || 'Could not send the file');
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteFile(id).unwrap();
    } catch (error: any) {
      toast.error(error?.data?.message || 'Could not remove the file');
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Typography variant="h6" component="div">
          Send a file
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {deviceName || 'This device'} · saved to Downloads/VectorAutomation
        </Typography>
      </DialogTitle>

      {busy && <LinearProgress />}

      <DialogContent>
        {!isOnline && (
          <Alert severity="info" sx={{ mb: 2 }}>
            This phone is offline. The file will be waiting the next time it connects.
          </Alert>
        )}

        <input ref={inputRef} type="file" hidden onChange={handlePick} />

        <Button
          fullWidth
          variant="outlined"
          startIcon={<UploadFileIcon />}
          disabled={busy || deviceId === null}
          onClick={() => inputRef.current?.click()}
          sx={{ py: 2, borderStyle: 'dashed' }}
        >
          {busy ? 'Sending…' : 'Choose a file (up to 10 MB)'}
        </Button>

        <Divider sx={{ my: 2 }} />

        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="subtitle2">Recent</Typography>
          {isFetching && <CircularProgress size={14} />}
        </Stack>

        {files.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
            Nothing sent to this device yet.
          </Typography>
        ) : (
          <Stack gap={1}>
            {files.map((file) => (
              <Box
                key={file.id}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 1.5,
                  py: 1,
                  borderRadius: 1,
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                  <Typography variant="body2" noWrap title={file.file_name}>
                    {file.file_name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatSize(file.size_bytes)}
                    {file.status === 'FAILED' && file.failure_message ? ` · ${file.failure_message}` : ''}
                  </Typography>
                </Box>
                {statusChip(file)}
                <Tooltip title="Remove">
                  <IconButton size="small" onClick={() => handleDelete(file.id)}>
                    <DeleteOutlineIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Box>
            ))}
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}
