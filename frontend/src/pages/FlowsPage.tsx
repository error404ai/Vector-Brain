import { useGetAndroidDevicesQuery } from '@/RTKService/androidService/androidService';
import type { SavedFlow } from '@/RTKService/flowService/flowService';
import {
  useDeleteFlowMutation,
  useGetFlowsQuery,
  useRenameFlowMutation,
  useRunFlowMutation,
  useSetFlowEnabledMutation,
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
  Switch,
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
  const [setEnabled] = useSetFlowEnabledMutation();

  const handleEnabled = async (flow: SavedFlow, enabled: boolean) => {
    try {
      await setEnabled({ id: flow.id, enabled }).unwrap();
      toast.success(enabled ? 'Flow on — used for matching tasks' : 'Flow off — only replayed by hand');
    } catch (err) {
      toast.error((err as { data?: { message?: string } })?.data?.message || 'Could not change the flow');
    }
  };

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
        subtitle="Runs you have saved. A flow replays on the phone with no AI; each step checks it is on the right screen first."
      />
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 1000 }}>
        Saving tasks automatically, using flows before the AI, and AI fixes for broken steps are switched on in{' '}
        <Box component="a" href="/settings#saved-flows" sx={{ color: 'primary.main', fontWeight: 700 }}>
          Settings → Saved flows
        </Box>
        .
      </Typography>

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
              const checkable = flow.format === 2;
              const fragile = flow.coordinate_step_count > 0;
              const stats = flow.stats;
              const enabled = flow.enabled !== false;

              return (
                <Card key={flow.id} variant="outlined" sx={{ borderRadius: 2.5, opacity: enabled ? 1 : 0.7 }}>
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
                          {checkable ? (
                            <Tooltip title="Each step checks the phone is on the screen it was recorded on, finds the button by its label, and checks the result.">
                              <Chip label="Checks each step" size="small" variant="outlined" color="primary" sx={{ height: 20, fontSize: '0.6rem', fontWeight: 700 }} />
                            </Tooltip>
                          ) : (
                            <Tooltip title="Saved before flows checked their steps: it repeats the recorded taps at the same positions. Save the task again for a checkable flow.">
                              <Chip label="Old recording" size="small" variant="outlined" sx={{ height: 20, fontSize: '0.6rem', fontWeight: 700 }} />
                            </Tooltip>
                          )}
                          {checkable && flow.checked && (
                            <Tooltip title="Recorded from a run the system checked on the phone, not only the agent's word.">
                              <Chip label="Checked on phone" size="small" variant="outlined" color="success" sx={{ height: 20, fontSize: '0.6rem', fontWeight: 700 }} />
                            </Tooltip>
                          )}
                          {flow.auto && <Chip label="Saved automatically" size="small" variant="outlined" sx={{ height: 20, fontSize: '0.6rem', fontWeight: 700 }} />}
                          {flow.has_params && (
                            <Tooltip title={`Also fits the same task with other values: ${flow.template ?? ''}`}>
                              <Chip label="Works with other values" size="small" variant="outlined" color="info" sx={{ height: 20, fontSize: '0.6rem', fontWeight: 700 }} />
                            </Tooltip>
                          )}
                          {(flow.ai_steps ?? 0) > 0 && (
                            <Tooltip title="Text that was typed but is not in the task's wording is never stored, so the AI types it each run.">
                              <Chip label={`AI types ${flow.ai_steps} step${flow.ai_steps === 1 ? '' : 's'}`} size="small" variant="outlined" color="warning" sx={{ height: 20, fontSize: '0.6rem', fontWeight: 700 }} />
                            </Tooltip>
                          )}
                          {(flow.version ?? 1) > 1 && (
                            <Tooltip title="A step fix was added to the flow (or a bad one rolled back) since it was saved.">
                              <Chip label={`v${flow.version}`} size="small" variant="outlined" sx={{ height: 20, fontSize: '0.6rem', fontWeight: 700 }} />
                            </Tooltip>
                          )}
                          {!stats?.runs && flow.run_count > 0 && (
                            <Typography variant="caption" color="text.secondary">
                              Replayed {flow.run_count}×
                            </Typography>
                          )}
                          {checkable && fragile && (
                            <Tooltip title="One or more steps tap an unlabelled spot. It is only tapped when the rest of the screen matches, but it is the step most likely to break.">
                              <Chip
                                icon={<WarningAmberIcon sx={{ fontSize: 12 }} />}
                                label="unlabelled taps"
                                size="small"
                                color="warning"
                                variant="outlined"
                                sx={{ height: 20, fontSize: '0.6rem', fontWeight: 700 }}
                              />
                            </Tooltip>
                          )}
                          {!checkable && fragile && (
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
                        {stats && stats.runs > 0 && (
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75, fontVariantNumeric: 'tabular-nums' }}>
                            {stats.runs} run{stats.runs === 1 ? '' : 's'} · {stats.replay_only} by the flow alone · {stats.repaired} after a step fix · {stats.fell_back} finished by the AI · {stats.failed} failed
                            {Object.keys(stats.models).length > 1 ? ` · ${Object.keys(stats.models).length} phone models` : ''}
                            {flow.last_verified_at ? ` · last checked ${new Date(flow.last_verified_at).toLocaleDateString()}` : ''}
                          </Typography>
                        )}
                      </Box>

                      <Stack direction="row" spacing={1} alignItems="center" alignSelf={{ xs: 'flex-end', md: 'center' }} flexWrap="wrap" useFlexGap>
                        {checkable && (
                          <Tooltip title={enabled ? 'On: used for tasks that match it. Turn off to only replay it by hand.' : 'Off: only replayed by hand.'}>
                            <Switch size="small" checked={enabled} onChange={(_, value) => void handleEnabled(flow, value)} inputProps={{ 'aria-label': `Use ${flow.name} automatically` }} />
                          </Tooltip>
                        )}
                        {onlineDevices.length > 0 && (
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
