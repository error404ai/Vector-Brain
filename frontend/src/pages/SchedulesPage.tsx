import { useGetAiConfigsQuery } from '@/RTKService/aiConfigService/aiConfigService';
import { useGetAndroidDevicesQuery } from '@/RTKService/androidService/androidService';
import type { ScheduledTask } from '@/RTKService/scheduleService/scheduleService';
import {
  useCreateScheduleMutation,
  useDeleteScheduleMutation,
  useGetSchedulesQuery,
  useRunScheduleNowMutation,
  useUpdateScheduleMutation,
} from '@/RTKService/scheduleService/scheduleService';
import PageHeader from '@/components/ui/PageHeader';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ScheduleIcon from '@mui/icons-material/Schedule';
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

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface ScheduleForm {
  id?: number;
  device_id: number | '';
  prompt: string;
  run_at: string;
  days: number[];
  max_steps: number;
  ai_config_id: number | '';
}

const EMPTY_FORM: ScheduleForm = {
  device_id: '',
  prompt: '',
  run_at: '09:00',
  days: [],
  max_steps: 40,
  ai_config_id: '',
};

/** "0,1,2" → [0,1,2]; empty string means every day. */
function parseDays(value: string): number[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map(Number);
}

function describeDays(days: number[]): string {
  if (days.length === 0 || days.length === 7) return 'Every day';
  if (days.length === 5 && [1, 2, 3, 4, 5].every((day) => days.includes(day))) return 'Weekdays';
  if (days.length === 2 && days.includes(0) && days.includes(6)) return 'Weekends';
  return days
    .slice()
    .sort((a, b) => a - b)
    .map((day) => DAY_LABELS[day])
    .join(', ');
}

export default function SchedulesPage() {
  const theme = useTheme();

  const { data: schedulesData, isLoading } = useGetSchedulesQuery();
  const schedules = schedulesData?.data ?? [];

  const { data: devicesData } = useGetAndroidDevicesQuery();
  const devices = devicesData?.data ?? [];

  const { data: aiConfigsData } = useGetAiConfigsQuery();
  const aiConfigs = aiConfigsData?.data ?? [];

  const [createSchedule, { isLoading: isCreating }] = useCreateScheduleMutation();
  const [updateSchedule] = useUpdateScheduleMutation();
  const [deleteSchedule] = useDeleteScheduleMutation();
  const [runNow, { isLoading: isRunningNow }] = useRunScheduleNowMutation();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<ScheduleForm>(EMPTY_FORM);

  const deviceName = (id: number) => devices.find((device) => device.id === id)?.device_name ?? `Device #${id}`;

  const openCreate = () => {
    setForm({ ...EMPTY_FORM, device_id: devices[0]?.id ?? '' });
    setDialogOpen(true);
  };

  const openEdit = (schedule: ScheduledTask) => {
    setForm({
      id: schedule.id,
      device_id: schedule.device_id,
      prompt: schedule.prompt,
      run_at: schedule.run_at,
      days: parseDays(schedule.days_of_week),
      max_steps: schedule.max_steps,
      ai_config_id: schedule.ai_config_id ?? '',
    });
    setDialogOpen(true);
  };

  const toggleDay = (day: number) => {
    setForm((prev) => ({
      ...prev,
      days: prev.days.includes(day) ? prev.days.filter((value) => value !== day) : [...prev.days, day],
    }));
  };

  const handleSave = async () => {
    if (!form.device_id || !form.prompt.trim()) return;
    const payload = {
      device_id: Number(form.device_id),
      prompt: form.prompt.trim(),
      run_at: form.run_at,
      days_of_week: form.days,
      max_steps: form.max_steps,
      ai_config_id: form.ai_config_id === '' ? null : Number(form.ai_config_id),
      // The browser's zone is the one the user picked the time in.
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Kolkata',
    };

    try {
      if (form.id) {
        await updateSchedule({ id: form.id, ...payload }).unwrap();
        toast.success('Schedule updated');
      } else {
        await createSchedule(payload).unwrap();
        toast.success('Schedule created');
      }
      setDialogOpen(false);
    } catch (err: any) {
      toast.error(err?.data?.message || 'Failed to save schedule');
    }
  };

  const handleToggleEnabled = async (schedule: ScheduledTask) => {
    try {
      await updateSchedule({ id: schedule.id, enabled: !schedule.enabled }).unwrap();
    } catch (err: any) {
      toast.error(err?.data?.message || 'Failed to update schedule');
    }
  };

  const handleDelete = async (schedule: ScheduledTask) => {
    if (!confirm(`Delete the schedule "${schedule.prompt.slice(0, 60)}"?`)) return;
    try {
      await deleteSchedule(schedule.id).unwrap();
      toast.success('Schedule deleted');
    } catch (err: any) {
      toast.error(err?.data?.message || 'Failed to delete schedule');
    }
  };

  const handleRunNow = async (schedule: ScheduledTask) => {
    try {
      await runNow(schedule.id).unwrap();
      toast.success('Schedule triggered');
    } catch (err: any) {
      toast.error(err?.data?.message || 'Failed to trigger schedule');
    }
  };

  return (
    <>
      <PageHeader
        title="Schedules"
        subtitle="Run a task automatically at a set time — daily, on weekdays, or on the days you pick."
      />

      <Stack spacing={2.5} sx={{ maxWidth: 1000 }}>
        <Stack direction="row" justifyContent="flex-end">
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={openCreate}
            disabled={devices.length === 0}
            sx={{ borderRadius: 2 }}
          >
            New schedule
          </Button>
        </Stack>

        {devices.length === 0 && (
          <Alert severity="info" variant="outlined">
            Pair an Android device first — a schedule needs a phone to run on.
          </Alert>
        )}

        {isLoading ? (
          <Stack alignItems="center" sx={{ py: 6 }}>
            <CircularProgress size={28} />
          </Stack>
        ) : schedules.length === 0 ? (
          <Card variant="outlined" sx={{ borderRadius: 3 }}>
            <CardContent sx={{ textAlign: 'center', py: 5 }}>
              <ScheduleIcon sx={{ fontSize: 40, color: 'text.disabled', mb: 1 }} />
              <Typography variant="subtitle1" fontWeight={700}>
                No schedules yet
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Create one to have a task run on its own — for example a morning check every weekday.
              </Typography>
            </CardContent>
          </Card>
        ) : (
          <Stack spacing={1.5}>
            {schedules.map((schedule) => (
              <Card
                key={schedule.id}
                variant="outlined"
                sx={{ borderRadius: 2.5, opacity: schedule.enabled ? 1 : 0.6 }}
              >
                <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                  <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    justifyContent="space-between"
                    alignItems={{ xs: 'flex-start', sm: 'center' }}
                    gap={1.5}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                        <Chip
                          icon={<ScheduleIcon sx={{ fontSize: 14 }} />}
                          label={schedule.run_at}
                          size="small"
                          sx={{
                            fontWeight: 800,
                            bgcolor: alpha(theme.palette.primary.main, 0.12),
                            color: 'primary.main',
                            height: 24,
                          }}
                        />
                        <Chip
                          label={describeDays(parseDays(schedule.days_of_week))}
                          size="small"
                          variant="outlined"
                          sx={{ height: 24, fontSize: '0.7rem' }}
                        />
                        <Chip
                          label={deviceName(schedule.device_id)}
                          size="small"
                          variant="outlined"
                          sx={{ height: 24, fontSize: '0.7rem' }}
                        />
                      </Stack>

                      <Typography variant="body2" sx={{ mt: 1, fontWeight: 600, wordBreak: 'break-word' }}>
                        {schedule.prompt}
                      </Typography>

                      {schedule.last_run_at && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                          Last run {new Date(schedule.last_run_at).toLocaleString()}
                          {schedule.last_result ? ` — ${schedule.last_result}` : ''}
                        </Typography>
                      )}
                    </Box>

                    <Stack direction="row" spacing={0.5} alignItems="center" alignSelf={{ xs: 'flex-end', sm: 'center' }}>
                      <Tooltip title={schedule.enabled ? 'Disable' : 'Enable'}>
                        <Switch
                          size="small"
                          checked={schedule.enabled}
                          onChange={() => handleToggleEnabled(schedule)}
                        />
                      </Tooltip>
                      <Tooltip title="Run now">
                        <span>
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<PlayArrowIcon />}
                            onClick={() => handleRunNow(schedule)}
                            disabled={isRunningNow}
                            sx={{ borderRadius: 2 }}
                          >
                            Run
                          </Button>
                        </span>
                      </Tooltip>
                      <Tooltip title="Edit">
                        <Button size="small" onClick={() => openEdit(schedule)} sx={{ minWidth: 36, borderRadius: 2 }}>
                          <EditOutlinedIcon fontSize="small" />
                        </Button>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <Button
                          size="small"
                          color="error"
                          onClick={() => handleDelete(schedule)}
                          sx={{ minWidth: 36, borderRadius: 2 }}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </Button>
                      </Tooltip>
                    </Stack>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Stack>
        )}

        <Alert severity="info" variant="outlined">
          A schedule is skipped if its phone is offline at that moment — it is not queued for later.
        </Alert>
      </Stack>

      {/* Create / edit */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ fontWeight: 800 }}>{form.id ? 'Edit schedule' : 'New schedule'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.25} sx={{ mt: 1 }}>
            <TextField
              label="Task"
              placeholder="e.g. Open YouTube and play Lo-Fi Beats"
              value={form.prompt}
              onChange={(e) => setForm((prev) => ({ ...prev, prompt: e.target.value }))}
              multiline
              minRows={2}
              fullWidth
              size="small"
            />

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Time"
                type="time"
                value={form.run_at}
                onChange={(e) => setForm((prev) => ({ ...prev, run_at: e.target.value }))}
                size="small"
                fullWidth
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                label="Max steps"
                type="number"
                value={form.max_steps}
                onChange={(e) => setForm((prev) => ({ ...prev, max_steps: Number(e.target.value) }))}
                size="small"
                fullWidth
                slotProps={{ htmlInput: { min: 1, max: 200 } }}
              />
            </Stack>

            <Box>
              <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
                Days — leave all off to run every day
              </Typography>
              <Stack direction="row" spacing={0.75} sx={{ mt: 0.75, flexWrap: 'wrap', gap: 0.75 }}>
                {DAY_LABELS.map((label, day) => (
                  <Chip
                    key={label}
                    label={label}
                    size="small"
                    color={form.days.includes(day) ? 'primary' : 'default'}
                    variant={form.days.includes(day) ? 'filled' : 'outlined'}
                    onClick={() => toggleDay(day)}
                    sx={{ cursor: 'pointer', fontWeight: 700 }}
                  />
                ))}
              </Stack>
            </Box>

            <Box>
              <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', display: 'block', mb: 0.5 }}>
                Device
              </Typography>
              <Select
                size="small"
                fullWidth
                value={form.device_id}
                onChange={(e) => setForm((prev) => ({ ...prev, device_id: Number(e.target.value) }))}
              >
                {devices.map((device) => (
                  <MenuItem key={device.id} value={device.id}>
                    {device.device_name}
                  </MenuItem>
                ))}
              </Select>
            </Box>

            <Box>
              <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', display: 'block', mb: 0.5 }}>
                Model
              </Typography>
              <Select
                size="small"
                fullWidth
                value={form.ai_config_id}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, ai_config_id: e.target.value === '' ? '' : Number(e.target.value) }))
                }
                displayEmpty
              >
                <MenuItem value="">Use the active provider</MenuItem>
                {aiConfigs.map((config) => (
                  <MenuItem key={config.id} value={config.id}>
                    {config.model}
                  </MenuItem>
                ))}
              </Select>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={isCreating || !form.device_id || !form.prompt.trim()}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
