import authManager from '@/_helpers/authManager';
import Global from '@/_helpers/global';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import FolderZipRoundedIcon from '@mui/icons-material/FolderZipRounded';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import InsertDriveFileRoundedIcon from '@mui/icons-material/InsertDriveFileRounded';
import { Box, Card, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { alpha, keyframes } from '@mui/material/styles';
import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';

interface PhoneFile {
  id: number;
  device_id: number;
  device_name: string | null;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
}

const rise = keyframes`from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; }`;
const size = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const token = authManager.getAccessToken();
  return fetch(`${Global.BASE_API_PATH}${path}`, { credentials: 'include', ...init, headers: { ...(init.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
}

/**
 * Files the phones sent up (companion 0.32): a download the agent fetched, or a
 * full-size screenshot. Kept for a week. Hidden until there is something to show.
 */
export default function PhoneFilesPanel() {
  const [files, setFiles] = useState<PhoneFile[]>([]);

  const load = useCallback(async () => {
    try {
      const res = await call('/android/uploads');
      if (res.ok) setFiles(((await res.json()) as { data: PhoneFile[] }).data ?? []);
    } catch {
      // Quiet: the panel just stays hidden.
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const download = async (file: PhoneFile) => {
    try {
      const res = await call(`/android/uploads/${file.id}/content`);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = file.file_name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const remove = async (file: PhoneFile) => {
    const res = await call(`/android/uploads/${file.id}`, { method: 'DELETE' });
    if (res.ok) setFiles((list) => list.filter((f) => f.id !== file.id));
    else toast.error('Could not delete it');
  };

  if (!files.length) return null;
  return (
    <Card variant="outlined" sx={{ p: 2, mb: 3, borderRadius: 3, position: 'relative', overflow: 'hidden' }}>
      <Box aria-hidden sx={(t) => ({ position: 'absolute', inset: 0, pointerEvents: 'none', background: `radial-gradient(90% 70% at 100% 0%, ${alpha(t.palette.info.main, 0.1)}, transparent 60%)` })} />
      <Stack direction="row" alignItems="baseline" spacing={1} sx={{ position: 'relative', mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
          Files from phones
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Sent by the agent (downloads, screenshots) · kept 7 days
        </Typography>
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 1, position: 'relative' }}>
        {files.map((f, i) => {
          const Icon = f.mime_type.startsWith('image/') ? ImageRoundedIcon : /zip|tar|gzip|rar/.test(f.mime_type) ? FolderZipRoundedIcon : InsertDriveFileRoundedIcon;
          return (
            <Stack
              key={f.id}
              direction="row"
              alignItems="center"
              spacing={1.25}
              sx={(t) => ({
                p: 1.25,
                borderRadius: 2,
                border: `1px solid ${t.palette.divider}`,
                bgcolor: alpha(t.palette.background.paper, 0.85),
                animation: `${rise} 260ms ease ${Math.min(i, 8) * 30}ms both`,
                transition: 'border-color 160ms ease, transform 160ms ease',
                '&:hover': { borderColor: t.palette.info.light, transform: 'translateY(-1px)' },
              })}
            >
              <Box sx={(t) => ({ width: 36, height: 36, borderRadius: 1.5, display: 'grid', placeItems: 'center', bgcolor: alpha(t.palette.info.main, 0.12), color: t.palette.info.main, flexShrink: 0 })}>
                <Icon fontSize="small" />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.file_name}>
                  {f.file_name}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {f.device_name ?? `Phone ${f.device_id}`} · {size(f.size_bytes)} · {when(f.created_at)}
                </Typography>
              </Box>
              <Tooltip title="Download">
                <IconButton size="small" onClick={() => void download(f)}>
                  <DownloadRoundedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Delete">
                <IconButton size="small" onClick={() => void remove(f)}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Stack>
          );
        })}
      </Box>
    </Card>
  );
}
