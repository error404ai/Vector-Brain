import {
  INLINE_UPLOAD_LIMIT,
  UPLOAD_CHUNK_SIZE,
  sha256Hex,
  uploadChunk,
  useFinishDeviceUploadMutation,
  useInitDeviceUploadMutation,
  useQueueDeviceFileMutation,
} from '@/RTKService/androidService/deviceFileService';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import { Button, CircularProgress, Tooltip } from '@mui/material';
import { useRef, useState } from 'react';
import toast from 'react-hot-toast';

interface SendFileButtonProps {
  /** Devices the file goes to. One from the agent page, many from the fleet. */
  deviceIds: number[];
  disabled?: boolean;
  label?: string;
  size?: 'small' | 'medium';
}

/** At or below this the file rides base64 in one JSON body; above it, chunked. */
const MAX_FILE_BYTES = 100 * 1024 * 1024;

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Reads a File to base64 without the data: prefix the API does not want. */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Pushes a file from the browser to one or more phones.
 *
 * Small files (<= 12 MB) go base64 in one JSON body; anything larger — an APK
 * for auto-update — streams as raw chunks so it never trips the 12 MB inline
 * limit or the 50 MB JSON ceiling. Serves both the single-device agent page and
 * the multi-device fleet selection; only the id-list length differs.
 */
export default function SendFileButton({ deviceIds, disabled, label = 'Send file', size = 'small' }: SendFileButtonProps) {
  const [queueFile] = useQueueDeviceFileMutation();
  const [initUpload] = useInitDeviceUploadMutation();
  const [finishUpload] = useFinishDeviceUploadMutation();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const send = async (file: File) => {
    if (deviceIds.length === 0) {
      toast.error('No device selected');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      toast.error(`That file is ${formatSize(file.size)}. The limit is 100 MB.`);
      return;
    }

    setBusy(true);
    setProgress(null);
    try {
      if (file.size <= INLINE_UPLOAD_LIMIT) {
        const base64 = await readAsBase64(file);
        const response = await queueFile({
          device_ids: deviceIds,
          file_name: file.name,
          mime_type: file.type || 'application/octet-stream',
          content_base64: base64,
        }).unwrap();
        toast.success(response.message || `Sent ${file.name}`);
      } else {
        await sendChunked(file);
        toast.success(`Sent ${file.name}`);
      }
    } catch (err: any) {
      toast.error(err?.data?.message || err?.message || 'Could not send the file');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  /** Hash, open an upload, stream each raw chunk, then finish. */
  const sendChunked = async (file: File) => {
    const sha256 = await sha256Hex(file);
    const totalChunks = Math.ceil(file.size / UPLOAD_CHUNK_SIZE);
    const init = await initUpload({
      device_ids: deviceIds,
      file_name: file.name,
      mime_type: file.type || 'application/octet-stream',
      size_bytes: file.size,
      sha256,
      total_chunks: totalChunks,
    }).unwrap();

    const uploadId = init.data.upload_id;
    for (let index = 0; index < totalChunks; index += 1) {
      const start = index * UPLOAD_CHUNK_SIZE;
      const slice = file.slice(start, Math.min(start + UPLOAD_CHUNK_SIZE, file.size));
      await uploadChunk(uploadId, index, slice);
      setProgress(Math.round(((index + 1) / totalChunks) * 100));
    }

    await finishUpload({ upload_id: uploadId }).unwrap();
  };

  const buttonLabel = busy ? (progress !== null ? `Uploading… ${progress}%` : 'Sending…') : label;

  return (
    <>
      <Tooltip title="Send a file to this device's Downloads folder">
        <span>
          <Button
            size={size}
            startIcon={busy ? <CircularProgress size={14} /> : <AttachFileIcon fontSize="small" />}
            disabled={disabled || busy || deviceIds.length === 0}
            onClick={() => inputRef.current?.click()}
            sx={{ whiteSpace: 'nowrap' }}
          >
            {buttonLabel}
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
