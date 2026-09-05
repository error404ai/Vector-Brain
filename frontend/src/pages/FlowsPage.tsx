import { useGetAndroidDevicesQuery } from '@/RTKService/androidService/androidService';
import type { SavedFlow } from '@/RTKService/flowService/flowService';
import {
  useDeleteFlowMutation,
  useGetFlowsQuery,
  useRenameFlowMutation,
  useRunFlowMutation,
} from '@/RTKService/flowService/flowService';
import PageHeader from '@/components/ui/PageHeader';
import BoltIcon from '@mui/icons-material/Bolt';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
  Alert,
  alpha,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

export default function FlowsPage() {
  const theme = useTheme();
  const navigate = useNavigate();

  const { data: flowsData, isLoading } = useGetFlowsQuery();
  const flows = flowsData?.data ?? [];

  const { data: devicesData } = useGetAndroidDevicesQuery();
  const devices = devicesData?.data ?? [];
  const onlineDevices = devices.filter((device) => device.status === 'ONLINE');

  const [runFlow, { isLoading: isRunning }] = useRunFlowMutation();
  const [renameFlow] = useRenameFlowMutation();
  const [deleteFlow] = useDeleteFlowMutation();

  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const [deviceForFlow, setDeviceForFlow] = useState<Record<number, number>>({});

  const chosenDevice = (flowId: number) => deviceForFlow[flowId] ?? onlineDevices[0]?.id ?? 0;

  const handleRun = async (flow: SavedFlow) => {
    const deviceId = chosenDevice(flow.id);
    if (!deviceId) {
      toast.error('No device is online');
      return;
    }
    try {
      await runFlow({ id: flow.id, device_id: deviceId }).unwrap();
      toast.success(`Replaying "${flow.name}"`);
      navigate(`/android-agent?deviceId=${deviceId}`);
    } catch (err: any) {
      toast.error(err?.data?.message || 'Could not start the flow');
    }
  };

  const handleRename = async () => {
    if (!renaming?.name.trim()) return;
    try {
      await renameFlow({ id: renaming.id, name: renaming.name.trim() }).unwrap();
      toast.success('Flow renamed');
      setRenaming(null);
    } catch (err: any) {
      toast.error(err?.data?.message || 'Could not rename the flow');
    }
  };

  const handleDelete = async (flow: SavedFlow) => {
    if (!confirm(`Delete the flow "${flow.name}"?`)) return;
    try {
      await deleteFlow(flow.id).unwrap();
      toast.success('Flow deleted');
    } catch (err: any) {
      toast.error(err?.data?.message || 'Could not delete the flow');
    }
  };

  return (
    <>
      <PageHeader
        title="Flows"
        subtitle="Runs you have saved. Replaying one sends the recorded actions straight to the phone — no AI, no cost."
      />

      <Stack spacing={2.5} sx={{ maxWidth: 1000 }}>
        {isLoading ? (
          <Stack alignItems="center" sx={{ py: 6 }}>
            <CircularProgress size={28} />
          </Stack>
        ) : flows.length === 0 ? (
          <Card variant="outlined" sx={{ borderRadius: 3 }}>
            <CardContent sx={{ textAlign: 'center', py: 5 }}>
              <BoltIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
              <Typography variant="subtitle1" fontWeight={700}>
                No saved flows yet
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 460, mx: 'auto' }}>
                Run a task on the Android Agent page, then use <b>Save as flow</b> on the result. After that it can be
                replayed any time without calling a model.
              </Typography>
              <Button variant="contained" onClick={() => navigate('/android-agent')} sx={{ mt: 2, borderRadius: 2 }}>
                Open agent
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Stack spacing={1.5}>
            {flows.map((flow) => {
              const fragile = flow.coordinate_step_count > 0;

              return (
                <Card key={flow.id} variant="outlined" sx={{ borderRadius: 2.5 }}>
                  <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                    <Stack
                      direction={{ xs: 'column', md: 'row' }}
                      justifyContent="space-between"
                      alignItems={{ xs: 'flex-start', md: 'center' }}
                      gap={1.5}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 800, wordBreak: 'break-word' }}>
                          {flow.name}
                        </Typography>

                        <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap sx={{ mt: 0.75 }}>
                          <Chip
                            label={`${flow.step_count} steps`}
                            size="small"
                            sx={{
                              height: 20,
                              fontSize: '0.65rem',
                              fontWeight: 700,
                              bgcolor: alpha(theme.palette.primary.main, 0.12),
                              color: 'primary.main',
                            }}
                          />
                          <Chip
                            label="No AI cost"
                            size="small"
                            sx={{
                              height: 20,
                              fontSize: '0.65rem',
                              fontWeight: 700,
                              bgcolor: alpha(theme.palette.success.main, 0.14),
                              color: 'success.dark',
                            }}
                          />
                          {flow.run_count > 0 && (
                            <Typography variant="caption" color="text.secondary">
                              Replayed {flow.run_count}×
                            </Typography>
                          )}
                          {fragile && (
                            <Tooltip title="This flow taps fixed screen positions. If the app's layout changes, replay can land in the wrong place.">
                              <Chip
                                icon={<WarningAmberIcon sx={{ fontSize: 12 }} />}
                                label="position-dependent"
                                size="small"
                                color="warning"
                                variant="outlined"
                                sx={{ height: 20, fontSize: '0.6rem', fontWeight: 700 }}
                              />
                            </Tooltip>
                          )}
                        </Stack>
                      </Box>

                      <Stack direction="row" spacing={1} alignItems="center" alignSelf={{ xs: 'flex-end', md: 'center' }}>
                        {onlineDevices.length > 1 && (
                          <Select
                            size="small"
                            value={String(chosenDevice(flow.id))}
                            onChange={(e) =>
                              setDeviceForFlow((prev) => ({ ...prev, [flow.id]: Number(e.target.value) }))
                            }
                            sx={{ minWidth: 150, height: 34, fontSize: 13 }}
                          >
                            {onlineDevices.map((device) => (
                              <MenuItem key={device.id} value={String(device.id)}>
                                {device.device_name}
                              </MenuItem>
                            ))}
                          </Select>
                        )}

                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<PlayArrowIcon />}
                          onClick={() => handleRun(flow)}
                          disabled={isRunning || onlineDevices.length === 0}
                          sx={{ borderRadius: 2, fontWeight: 700 }}
                        >
                          Replay
                        </Button>

                        <Tooltip title="Rename">
                          <Button
                            size="small"
                            onClick={() => setRenaming({ id: flow.id, name: flow.name })}
                            sx={{ minWidth: 36, borderRadius: 2 }}
                          >
                            <EditOutlinedIcon fontSize="small" />
                          </Button>
                        </Tooltip>

                        <Tooltip title="Delete">
                          <Button
                            size="small"
                            color="error"
                            onClick={() => handleDelete(flow)}
                            sx={{ minWidth: 36, borderRadius: 2 }}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </Button>
                        </Tooltip>
                      </Stack>
                    </Stack>
                  </CardContent>
                </Card>
              );
            })}
          </Stack>
        )}

        {onlineDevices.length === 0 && flows.length > 0 && (
          <Alert severity="info" variant="outlined">
            No device is online — bring one up to replay a flow.
          </Alert>
        )}
      </Stack>

      <Dialog open={Boolean(renaming)} onClose={() => setRenaming(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>Rename flow</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Name"
            value={renaming?.name ?? ''}
            onChange={(e) => setRenaming((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename();
            }}
            sx={{ mt: 1 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenaming(null)}>Cancel</Button>
          <Button variant="contained" onClick={handleRename} disabled={!renaming?.name.trim()}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
