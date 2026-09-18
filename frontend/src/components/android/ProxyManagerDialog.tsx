import type { DeviceProxy } from '@/RTKService/androidService/proxyService';
import {
  useCreateDeviceProxyMutation,
  useDeleteDeviceProxyMutation,
  useGetDeviceProxiesQuery,
  useRotateDeviceProxyMutation,
  useUpdateDeviceProxyMutation,
} from '@/RTKService/androidService/proxyService';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import RefreshIcon from '@mui/icons-material/Refresh';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  MenuItem,
  Divider,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useState } from 'react';
import { proxyColor } from './proxyColors';
import toast from 'react-hot-toast';

interface ProxyManagerDialogProps {
  open: boolean;
  onClose: () => void;
}

const EMPTY_FORM = { name: '', rotation_url: '', concurrency: 1, settle_seconds: 5, rotate_every_tasks: 1 };

/**
 * Where a user sets up the proxies their phones sit behind.
 *
 * A proxy is a lane shared by several devices, so the settings that matter are
 * how many phones may use it at once and how long to wait after its IP changes.
 * The rotation link is write-only: it is never sent back to the browser, and
 * leaving the field empty on an edit keeps the saved one.
 */
export default function ProxyManagerDialog({ open, onClose }: ProxyManagerDialogProps) {
  const { data, isLoading, refetch } = useGetDeviceProxiesQuery(undefined, { skip: !open });
  const [createProxy, { isLoading: isCreating }] = useCreateDeviceProxyMutation();
  const [updateProxy] = useUpdateDeviceProxyMutation();
  const [deleteProxy] = useDeleteDeviceProxyMutation();
  const [rotateProxy] = useRotateDeviceProxyMutation();

  const [form, setForm] = useState(EMPTY_FORM);
  const [rotatingId, setRotatingId] = useState<number | null>(null);

  const proxies = data?.data ?? [];

  const handleAdd = async () => {
    if (!form.name.trim() || !form.rotation_url.trim()) return toast.error('Name and rotation URL are required');
    try {
      await createProxy(form).unwrap();
      setForm(EMPTY_FORM);
      refetch();
      toast.success('Proxy added');
    } catch (err: any) {
      toast.error(err?.data?.message || 'Could not add the proxy');
    }
  };

  const handleRotate = async (proxy: DeviceProxy) => {
    setRotatingId(proxy.id);
    try {
      const response = await rotateProxy(proxy.id).unwrap();
      refetch();
      if (response.data?.ok) toast.success(response.message);
      else toast.error(response.message);
    } catch (err: any) {
      toast.error(err?.data?.message || 'Rotation failed');
    } finally {
      setRotatingId(null);
    }
  };

  const handleDelete = async (proxy: DeviceProxy) => {
    if (!confirm(`Remove "${proxy.name}"? The ${proxy.device_count} device(s) on it will run without a proxy.`)) return;
    try {
      await deleteProxy(proxy.id).unwrap();
      refetch();
      toast.success('Proxy removed');
    } catch (err: any) {
      toast.error(err?.data?.message || 'Could not remove the proxy');
    }
  };

  const handleNumberChange = async (proxy: DeviceProxy, field: 'concurrency' | 'settle_seconds' | 'rotate_every_tasks', value: number) => {
    try {
      await updateProxy({ id: proxy.id, [field]: value }).unwrap();
      refetch();
    } catch (err: any) {
      toast.error(err?.data?.message || 'Could not save');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle sx={{ fontWeight: 700 }}>Proxy rotation</DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2.5 }}>
          <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
            This does not set up proxies on your phones.
          </Typography>
          <Typography variant="body2">
            Put the proxy into each phone's own proxy app yourself, once. What you add here is the rotation link for
            that proxy: Vector Brain calls it to get a fresh IP after a run, and keeps the phones sharing one proxy
            from running at the same time. Group a phone under the proxy you actually configured on it, or the wrong
            lane gets rotated.
          </Typography>
        </Alert>

        {isLoading ? (
          <CircularProgress size={24} />
        ) : (
          <Stack spacing={2}>
            {proxies.map((proxy) => (
              <Box key={proxy.id} sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap" useFlexGap>
                  {/* Same colour the fleet cards use for this lane. */}
                  <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: proxyColor(proxy.id), flexShrink: 0 }} />
                  <Typography sx={{ fontWeight: 700 }}>{proxy.name}</Typography>
                  <Chip size="small" label={`${proxy.device_count} device${proxy.device_count === 1 ? '' : 's'}`} />
                  {proxy.last_ip && <Chip size="small" variant="outlined" label={proxy.last_ip} />}
                  <Box sx={{ flexGrow: 1 }} />
                  <Tooltip title="Rotate now and check the link works">
                    <span>
                      <IconButton size="small" disabled={rotatingId === proxy.id} onClick={() => void handleRotate(proxy)}>
                        {rotatingId === proxy.id ? <CircularProgress size={16} /> : <RefreshIcon fontSize="small" />}
                      </IconButton>
                    </span>
                  </Tooltip>
                  <Tooltip title="Remove proxy">
                    <IconButton size="small" color="error" onClick={() => void handleDelete(proxy)}>
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>

                <Stack direction="row" gap={1.5} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
                  <TextField
                    label="Phones at once"
                    type="number"
                    size="small"
                    defaultValue={proxy.concurrency}
                    onBlur={(event) => void handleNumberChange(proxy, 'concurrency', Number(event.target.value))}
                    sx={{ width: 150 }}
                  />
                  <TextField
                    label="Settle seconds"
                    type="number"
                    size="small"
                    defaultValue={proxy.settle_seconds}
                    onBlur={(event) => void handleNumberChange(proxy, 'settle_seconds', Number(event.target.value))}
                    helperText="Wait after each rotation"
                    sx={{ width: 170 }}
                  />
                  <TextField
                    select
                    label="Rotate the IP"
                    size="small"
                    value={proxy.rotate_every_tasks}
                    onChange={(event) => void handleNumberChange(proxy, 'rotate_every_tasks', Number(event.target.value))}
                    helperText="When a task on this proxy finishes"
                    sx={{ width: 210 }}
                  >
                    <MenuItem value={0}>Never</MenuItem>
                    <MenuItem value={1}>After every task</MenuItem>
                    <MenuItem value={2}>After every 2 tasks</MenuItem>
                    <MenuItem value={3}>After every 3 tasks</MenuItem>
                    <MenuItem value={5}>After every 5 tasks</MenuItem>
                    <MenuItem value={10}>After every 10 tasks</MenuItem>
                  </TextField>
                </Stack>

                {proxy.last_rotation_status && (
                  <Typography
                    variant="caption"
                    sx={{ display: 'block', mt: 1 }}
                    color={proxy.last_rotation_status.toLowerCase().startsWith('rotated') ? 'text.secondary' : 'error.main'}
                  >
                    {proxy.last_rotation_status}
                    {proxy.last_rotated_at ? ` · ${new Date(proxy.last_rotated_at).toLocaleString()}` : ''}
                  </Typography>
                )}
              </Box>
            ))}

            <Divider>Add a proxy</Divider>

            <Stack direction="row" gap={1.5} flexWrap="wrap" useFlexGap>
              <TextField
                label="Name"
                size="small"
                placeholder="UK mobile 1"
                value={form.name}
                onChange={(event) => setForm({ ...form, name: event.target.value })}
                sx={{ width: 190 }}
              />
              <TextField
                label="Rotation URL"
                size="small"
                placeholder="https://provider.example/rotate?token=…"
                value={form.rotation_url}
                onChange={(event) => setForm({ ...form, rotation_url: event.target.value })}
                sx={{ flexGrow: 1, minWidth: 260 }}
              />
              <Button variant="contained" disableElevation disabled={isCreating} onClick={() => void handleAdd()}>
                Add
              </Button>
            </Stack>
          </Stack>
        )}
      </DialogContent>
    </Dialog>
  );
}
