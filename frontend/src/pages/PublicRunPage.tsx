import { useGetPublicRunQuery } from '@/RTKService/runShareService/runShareService';
import AgentMarkdown from '@/components/android/AgentMarkdown';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import ReplayIcon from '@mui/icons-material/Replay';
import {
  alpha,
  Box,
  Button,
  Chip,
  CircularProgress,
  Slider,
  Stack,
  Typography,
  useTheme,
} from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useParams } from 'react-router-dom';

/** How long each frame stays on screen while playing. */
const FRAME_MS = 1200;

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

/**
 * Captions come from the agent's raw thought, which can run for a paragraph and
 * sometimes contains planner chatter. A viewer only needs the gist, so keep the
 * first sentence and cap the length.
 */
function shortCaption(caption: string | null): string {
  if (!caption) return 'Working…';
  const firstSentence = caption.split(/(?<=[.!?])\s/)[0] ?? caption;
  const text = firstSentence.trim();
  if (text.length <= 150) return text;
  return `${text.slice(0, 150).trimEnd()}…`;
}

function imageSrc(base64: string): string {
  return base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`;
}

export default function PublicRunPage() {
  const theme = useTheme();
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, isError } = useGetPublicRunQuery(token ?? '', { skip: !token });

  const run = data?.data;
  const frames = run?.frames ?? [];

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!playing || frames.length <= 1) return;
    timerRef.current = setInterval(() => {
      setIndex((prev) => {
        if (prev >= frames.length - 1) {
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, FRAME_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [playing, frames.length]);

  if (isLoading) {
    return (
      <Stack alignItems="center" justifyContent="center" sx={{ minHeight: '60vh' }}>
        <CircularProgress />
      </Stack>
    );
  }

  if (isError || !run) {
    return (
      <Stack alignItems="center" justifyContent="center" spacing={2} sx={{ minHeight: '60vh', px: 2 }}>
        <Typography variant="h6" fontWeight={800}>
          This run is not available
        </Typography>
        <Typography variant="body2" color="text.secondary" textAlign="center">
          The link may have been revoked, or it never existed.
        </Typography>
        <Button component={Link} to="/" variant="contained" sx={{ borderRadius: 2 }}>
          Go to Vector Brain
        </Button>
      </Stack>
    );
  }

  const currentFrame = frames[index];
  const atEnd = frames.length > 0 && index >= frames.length - 1;

  return (
    <>
      <Helmet>
        <title>{`${run.prompt} — Vector Brain`}</title>
        <meta name="description" content="Watch an AI agent operate a real Android phone, step by step." />
      </Helmet>

      <Box sx={{ maxWidth: 960, mx: 'auto', px: 2, py: { xs: 3, md: 5 } }}>
        {/* What was asked */}
        <Stack spacing={1} alignItems="center" sx={{ textAlign: 'center', mb: 3 }}>
          <Typography variant="overline" sx={{ fontWeight: 800, letterSpacing: 1.4, color: 'primary.main' }}>
            One instruction. A real phone did the rest.
          </Typography>
          <Typography variant="h5" sx={{ fontWeight: 900, wordBreak: 'break-word' }}>
            “{run.prompt}”
          </Typography>

          <Stack direction="row" spacing={0.75} flexWrap="wrap" justifyContent="center" useFlexGap sx={{ mt: 1 }}>
            <Chip
              icon={run.success ? <CheckCircleIcon sx={{ fontSize: 15 }} /> : undefined}
              label={run.success ? 'Completed' : 'Did not finish'}
              size="small"
              color={run.success ? 'success' : 'default'}
              sx={{ fontWeight: 800, height: 24 }}
            />
            <Chip label={`${run.total_steps} steps`} size="small" variant="outlined" sx={{ height: 24 }} />
            <Chip label={formatDuration(run.total_duration_seconds)} size="small" variant="outlined" sx={{ height: 24 }} />
            {run.model && (
              <Chip label={run.model} size="small" variant="outlined" sx={{ height: 24, maxWidth: 260 }} />
            )}
          </Stack>
        </Stack>

        {frames.length === 0 ? (
          <Typography variant="body2" color="text.secondary" textAlign="center" sx={{ py: 4 }}>
            No screens were captured for this run.
          </Typography>
        ) : (
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} alignItems={{ xs: 'stretch', md: 'flex-start' }}>
            {/* Phone */}
            <Box sx={{ mx: 'auto' }}>
              <Box
                sx={{
                  width: 300,
                  borderRadius: 5,
                  border: '10px solid #111827',
                  overflow: 'hidden',
                  bgcolor: '#111827',
                  boxShadow: `0 20px 50px ${alpha('#000', 0.28)}`,
                }}
              >
                <Box
                  component="img"
                  src={imageSrc(currentFrame.image_base64)}
                  alt={`Step ${currentFrame.step_index}`}
                  sx={{ width: '100%', display: 'block' }}
                />
              </Box>

              <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1.5 }}>
                <Button
                  size="small"
                  variant="contained"
                  onClick={() => {
                    if (atEnd) setIndex(0);
                    setPlaying((prev) => (atEnd ? true : !prev));
                  }}
                  startIcon={atEnd ? <ReplayIcon /> : playing ? <PauseIcon /> : <PlayArrowIcon />}
                  sx={{ borderRadius: 2, fontWeight: 700 }}
                >
                  {atEnd ? 'Replay' : playing ? 'Pause' : 'Play'}
                </Button>
                <Slider
                  size="small"
                  min={0}
                  max={Math.max(0, frames.length - 1)}
                  value={index}
                  onChange={(_, value) => {
                    setPlaying(false);
                    setIndex(Number(value));
                  }}
                  sx={{ flexGrow: 1 }}
                />
                <Typography variant="caption" color="text.secondary" sx={{ minWidth: 44, textAlign: 'right' }}>
                  {index + 1}/{frames.length}
                </Typography>
              </Stack>
            </Box>

            {/* What the agent was thinking, in step with the frame */}
            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
              <Typography variant="overline" sx={{ fontWeight: 800, letterSpacing: 1, color: 'text.secondary' }}>
                Step {currentFrame.step_index}
              </Typography>
              <Typography variant="body1" sx={{ mt: 0.5, lineHeight: 1.6, minHeight: 72 }}>
                {shortCaption(currentFrame.caption)}
              </Typography>

              {run.summary && (
                <Box
                  sx={{
                    mt: 2,
                    p: 1.75,
                    borderRadius: 2,
                    bgcolor: alpha(theme.palette.success.main, 0.07),
                    border: `1px solid ${alpha(theme.palette.success.main, 0.25)}`,
                  }}
                >
                  <Typography variant="caption" sx={{ fontWeight: 800, color: 'success.dark', display: 'block', mb: 0.5 }}>
                    Result
                  </Typography>
                  <AgentMarkdown text={run.summary} />
                </Box>
              )}
            </Box>
          </Stack>
        )}

        {/* Footer / attribution */}
        <Stack alignItems="center" spacing={1} sx={{ mt: 5, pt: 3, borderTop: '1px solid', borderColor: 'divider' }}>
          <Typography variant="body2" color="text.secondary">
            Automated with Vector Brain — AI that operates real Android phones.
          </Typography>
          <Button component={Link} to="/" variant="outlined" sx={{ borderRadius: 2, fontWeight: 700 }}>
            Try it yourself
          </Button>
        </Stack>
      </Box>
    </>
  );
}
