import type { AgentTask } from '@/RTKService/agentTaskService/agentTaskService';
import type { AndroidTaskLog } from '@/RTKService/androidService/androidService';
import { useGetAndroidTaskLogsQuery } from '@/RTKService/androidService/androidService';
import {
  useGetShareStatusQuery,
  useShareRunMutation,
  useUnshareRunMutation,
} from '@/RTKService/runShareService/runShareService';
import { explainError } from '@/utils/errorExplain';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CloseIcon from '@mui/icons-material/Close';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import ReplayIcon from '@mui/icons-material/Replay';
import ShareIcon from '@mui/icons-material/Share';
import StopCircleIcon from '@mui/icons-material/StopCircle';
import {
  alpha,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  IconButton,
  Stack,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { useState } from 'react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';

interface AgentTaskDetailModalProps {
  task: AgentTask | undefined;
  opened: boolean;
  onClose: () => void;
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const mins = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${mins}m ${rest}s`;
}

function screenshotSrc(base64: string): string {
  return base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
}

/** One step row in the run report timeline. */
function ReportStep({ log, isLast, onOpenShot }: { log: AndroidTaskLog; isLast: boolean; onOpenShot: (src: string) => void }) {
  const theme = useTheme();
  const failed = log.status === 'FAILED';
  const dotColor = failed ? theme.palette.error.main : log.status === 'CANCELLED' ? theme.palette.warning.main : theme.palette.success.main;
  const rawError = log.error_message || (failed ? log.result_message : undefined);
  const explanation = failed ? explainError(rawError) : null;

  // The raw result often carries a huge UI-tree dump — only the first line is useful here.
  const resultFirstLine = (log.result_message ?? '').split(/\r?\n/)[0]?.slice(0, 220) ?? '';

  return (
    <Box sx={{ display: 'flex', gap: 1.25 }}>
      {/* Timeline rail */}
      <Box sx={{ width: 18, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', pt: 0.5 }}>
        <Box
          sx={{
            width: 9,
            height: 9,
            borderRadius: '50%',
            bgcolor: dotColor,
            boxShadow: `0 0 0 3px ${alpha(dotColor, 0.18)}`,
            flexShrink: 0,
          }}
        />
        {!isLast && <Box sx={{ width: 2, flexGrow: 1, mt: 0.5, bgcolor: 'divider', borderRadius: 1 }} />}
      </Box>

      {/* Step body */}
      <Box sx={{ flexGrow: 1, minWidth: 0, pb: isLast ? 0 : 2 }}>
        <Stack direction="row" alignItems="center" gap={0.75} flexWrap="wrap">
          <Typography variant="caption" sx={{ fontWeight: 800, color: 'text.secondary', fontSize: 10.5 }}>
            STEP {log.step_index}
          </Typography>
          <Typography
            variant="caption"
            sx={{
              fontFamily: 'monospace',
              fontSize: 10.5,
              px: 0.75,
              py: 0.125,
              borderRadius: 0.75,
              bgcolor: alpha(theme.palette.primary.main, 0.08),
              color: 'primary.main',
              fontWeight: 700,
            }}
          >
            {log.action_type}
          </Typography>
          {log.duration_ms > 0 && (
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: 10 }}>
              {(log.duration_ms / 1000).toFixed(1)}s
            </Typography>
          )}
          {failed && <Chip label="FAILED" size="small" color="error" variant="outlined" sx={{ height: 18, fontSize: 9, fontWeight: 800 }} />}
        </Stack>

        {log.thought_reasoning && (
          <Typography variant="body2" sx={{ mt: 0.5, lineHeight: 1.5, fontSize: 13 }}>
            {log.thought_reasoning.length > 400 ? `${log.thought_reasoning.slice(0, 400)}…` : log.thought_reasoning}
          </Typography>
        )}

        {!failed && resultFirstLine && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            {resultFirstLine}
          </Typography>
        )}

        {failed && (
          <Box
            sx={{
              mt: 0.75,
              p: 1.25,
              borderRadius: 1.5,
              bgcolor: alpha(theme.palette.error.main, 0.06),
              border: `1px solid ${alpha(theme.palette.error.main, 0.25)}`,
            }}
          >
            {explanation ? (
              <>
                <Typography variant="caption" sx={{ fontWeight: 800, color: 'error.main', display: 'block' }}>
                  {explanation.title}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                  {explanation.cause} {explanation.suggestion}
                </Typography>
              </>
            ) : (
              <Typography variant="caption" color="error.main" sx={{ display: 'block', wordBreak: 'break-word' }}>
                {rawError || 'Step failed'}
              </Typography>
            )}
          </Box>
        )}

        {log.screenshot_base64 && (
          <Box
            component="img"
            src={screenshotSrc(log.screenshot_base64)}
            alt={`Step ${log.step_index} screenshot`}
            onClick={() => onOpenShot(screenshotSrc(log.screenshot_base64 as string))}
            sx={{
              mt: 1,
              height: 96,
              borderRadius: 1.5,
              border: '1px solid',
              borderColor: 'divider',
              cursor: 'zoom-in',
              display: 'block',
            }}
          />
        )}
      </Box>
    </Box>
  );
}

export function AgentTaskDetailModal({ task, opened, onClose }: AgentTaskDetailModalProps) {
  const theme = useTheme();
  const navigate = useNavigate();
  const [enlargedShot, setEnlargedShot] = useState<string | null>(null);

  const { data: logsData, isFetching } = useGetAndroidTaskLogsQuery(task?.id ?? 0, {
    skip: !opened || !task,
  });

  const { data: shareData } = useGetShareStatusQuery(task?.id ?? 0, { skip: !opened || !task });
  const [shareRun, { isLoading: isSharing }] = useShareRunMutation();
  const [unshareRun] = useUnshareRunMutation();
  const shareToken = shareData?.data?.token ?? null;
  const shareUrl = shareToken ? `${window.location.origin}/r/${shareToken}` : null;

  if (!task) return null;

  const logs = logsData?.data ?? [];
  const failedSteps = logs.filter((log) => log.status === 'FAILED').length;

  const handleShare = async () => {
    if (!task) return;
    try {
      const res = await shareRun({ id: task.id }).unwrap();
      const url = `${window.location.origin}/r/${res.data.token}`;
      await navigator.clipboard.writeText(url).catch(() => undefined);
      toast.success(`Public link copied · ${res.data.frames} screens`);
    } catch (err: any) {
      toast.error(err?.data?.message || 'Failed to create share link');
    }
  };

  const handleUnshare = async () => {
    if (!task) return;
    try {
      await unshareRun(task.id).unwrap();
      toast.success('Share link revoked');
    } catch (err: any) {
      toast.error(err?.data?.message || 'Failed to revoke link');
    }
  };

  const handleRerun = () => {
    const params = new URLSearchParams();
    if (task.device_id) params.set('deviceId', String(task.device_id));
    params.set('prompt', task.prompt);
    onClose();
    navigate(`/android-agent?${params.toString()}`);
  };

  return (
    <Dialog
      open={opened}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      slotProps={{ paper: { sx: { borderRadius: 3, maxHeight: '90vh' } } }}
    >
      {/* Header */}
      <Box sx={{ px: 2.5, py: 1.75, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
          {task.success ? (
            <CheckCircleIcon color="success" sx={{ fontSize: 20 }} />
          ) : (
            <StopCircleIcon color="error" sx={{ fontSize: 20 }} />
          )}
          <Typography variant="subtitle1" sx={{ fontWeight: 800, flexGrow: 1, minWidth: 0 }} noWrap>
            Run report — Task #{task.id}
          </Typography>
          {shareToken ? (
            <Tooltip title="Stop sharing this run publicly">
              <Button
                size="small"
                variant="outlined"
                color="warning"
                startIcon={<LinkOffIcon />}
                onClick={handleUnshare}
                sx={{ borderRadius: 2, fontWeight: 700 }}
              >
                Unshare
              </Button>
            </Tooltip>
          ) : (
            <Tooltip title="Create a public link anyone can open">
              <Button
                size="small"
                variant="outlined"
                startIcon={<ShareIcon />}
                onClick={handleShare}
                disabled={isSharing}
                sx={{ borderRadius: 2, fontWeight: 700 }}
              >
                Share
              </Button>
            </Tooltip>
          )}
          <Button size="small" variant="contained" startIcon={<ReplayIcon />} onClick={handleRerun} sx={{ borderRadius: 2, fontWeight: 700 }}>
            Re-run
          </Button>
          <IconButton size="small" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>

        <Stack direction="row" gap={0.75} flexWrap="wrap" sx={{ mt: 1 }}>
          <Chip
            label={task.success ? 'Succeeded' : 'Failed'}
            size="small"
            color={task.success ? 'success' : 'error'}
            sx={{ height: 22, fontWeight: 800, fontSize: '0.7rem' }}
          />
          <Chip label={`${task.total_steps} steps`} size="small" variant="outlined" sx={{ height: 22, fontSize: '0.7rem' }} />
          <Chip
            label={formatDuration(task.total_duration_seconds)}
            size="small"
            variant="outlined"
            sx={{ height: 22, fontSize: '0.7rem' }}
          />
          {failedSteps > 0 && (
            <Chip
              label={`${failedSteps} failed step${failedSteps > 1 ? 's' : ''}`}
              size="small"
              color="warning"
              variant="outlined"
              sx={{ height: 22, fontWeight: 700, fontSize: '0.7rem' }}
            />
          )}
          {task.model && <Chip label={task.model} size="small" variant="outlined" sx={{ height: 22, fontSize: '0.7rem', maxWidth: 260 }} />}
          {task.device_id && (
            <Chip label={`Device #${task.device_id}`} size="small" variant="outlined" sx={{ height: 22, fontSize: '0.7rem' }} />
          )}
          <Chip
            label={new Date(task.created_at).toLocaleString()}
            size="small"
            variant="outlined"
            sx={{ height: 22, fontSize: '0.7rem' }}
          />
        </Stack>

        {shareUrl && (
          <Stack direction="row" alignItems="center" gap={1} sx={{ mt: 1 }}>
            <Typography variant="caption" sx={{ fontWeight: 800, color: 'success.dark' }}>
              Public link
            </Typography>
            <Typography
              component="a"
              href={shareUrl}
              target="_blank"
              rel="noreferrer"
              variant="caption"
              sx={{ color: 'primary.main', wordBreak: 'break-all' }}
            >
              {shareUrl}
            </Typography>
            <Button
              size="small"
              onClick={() => {
                void navigator.clipboard.writeText(shareUrl);
                toast.success('Link copied');
              }}
              sx={{ minWidth: 0, fontWeight: 700 }}
            >
              Copy
            </Button>
          </Stack>
        )}
      </Box>

      <DialogContent sx={{ p: 2.5 }}>
        <Stack spacing={2.25}>
          {/* Prompt */}
          <Box>
            <Typography variant="overline" sx={{ fontWeight: 800, letterSpacing: 1, color: 'text.secondary' }}>
              Prompt
            </Typography>
            <Box sx={{ mt: 0.5, p: 1.5, borderRadius: 2, bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontWeight: 600 }}>
                {task.prompt}
              </Typography>
            </Box>
          </Box>

          {/* Outcome message */}
          {task.message && (
            <Box>
              <Typography variant="overline" sx={{ fontWeight: 800, letterSpacing: 1, color: 'text.secondary' }}>
                Outcome
              </Typography>
              <Box
                sx={{
                  mt: 0.5,
                  p: 1.5,
                  borderRadius: 2,
                  border: '1px solid',
                  borderColor: task.success ? alpha(theme.palette.success.main, 0.3) : alpha(theme.palette.error.main, 0.3),
                  bgcolor: task.success ? alpha(theme.palette.success.main, 0.05) : alpha(theme.palette.error.main, 0.05),
                }}
              >
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                  {task.message}
                </Typography>
              </Box>
            </Box>
          )}

          {/* Step timeline */}
          <Box>
            <Stack direction="row" alignItems="center" gap={1}>
              <Typography variant="overline" sx={{ fontWeight: 800, letterSpacing: 1, color: 'text.secondary' }}>
                Steps
              </Typography>
              {isFetching && <CircularProgress size={13} />}
            </Stack>

            {!isFetching && logs.length === 0 ? (
              <Stack direction="row" alignItems="center" gap={0.75} sx={{ mt: 0.5 }}>
                <ErrorOutlineIcon sx={{ fontSize: 16, color: 'text.disabled' }} />
                <Typography variant="caption" color="text.secondary">
                  No step logs were recorded for this run.
                </Typography>
              </Stack>
            ) : (
              <Stack sx={{ mt: 1 }}>
                {logs.map((log, index) => (
                  <ReportStep key={log.id} log={log} isLast={index === logs.length - 1} onOpenShot={setEnlargedShot} />
                ))}
              </Stack>
            )}
          </Box>

          {/* Raw task errors, if the backend stored any */}
          {task.errors && (
            <Box>
              <Typography variant="overline" sx={{ fontWeight: 800, letterSpacing: 1, color: 'text.secondary' }}>
                Recorded errors
              </Typography>
              <Box
                sx={{
                  mt: 0.5,
                  p: 1.5,
                  borderRadius: 2,
                  bgcolor: 'action.hover',
                  fontFamily: 'monospace',
                  fontSize: 11,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 180,
                  overflow: 'auto',
                }}
              >
                {task.errors}
              </Box>
            </Box>
          )}
        </Stack>
      </DialogContent>

      {/* Screenshot lightbox */}
      <Dialog open={Boolean(enlargedShot)} onClose={() => setEnlargedShot(null)} maxWidth={false}>
        <Box sx={{ position: 'relative', bgcolor: 'grey.900', p: 1 }}>
          <Tooltip title="Close">
            <IconButton
              size="small"
              onClick={() => setEnlargedShot(null)}
              sx={{ position: 'absolute', top: 6, right: 6, bgcolor: 'rgba(0,0,0,0.5)', color: 'white', zIndex: 1 }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          {enlargedShot && (
            <Box component="img" src={enlargedShot} alt="Step screenshot" sx={{ maxHeight: '86vh', maxWidth: '90vw', display: 'block', borderRadius: 1 }} />
          )}
        </Box>
      </Dialog>
    </Dialog>
  );
}
