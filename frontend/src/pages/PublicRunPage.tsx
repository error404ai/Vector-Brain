import type { SharedRunFrame } from '@/RTKService/runShareService/runShareService';
import { useGetPublicRunQuery } from '@/RTKService/runShareService/runShareService';
import AgentMarkdown from '@/components/android/AgentMarkdown';
import CheckIcon from '@mui/icons-material/Check';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { alpha, Box, Button, CircularProgress, LinearProgress, Stack, Typography } from '@mui/material';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link, useParams } from 'react-router-dom';

/** Time each frame holds. Short enough to feel like video, long enough to read. */
const FRAME_MS = 1100;
const PHONE_W = 300;
/** Typical phone resolution, used to place the tap ripple as a percentage. */
const REF_W = 1080;
const REF_H = 2400;

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '—';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function imageSrc(base64: string): string {
  return base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`;
}

function prettyPackage(pkg?: string): string {
  if (!pkg) return 'an app';
  const known: Record<string, string> = {
    'com.android.chrome': 'Chrome',
    'com.google.android.youtube': 'YouTube',
    'com.android.settings': 'Settings',
    'com.google.android.apps.maps': 'Maps',
    'com.whatsapp': 'WhatsApp',
    'com.google.android.deskclock': 'Clock',
  };
  if (known[pkg]) return known[pkg];
  const last = pkg.split('.').pop() ?? pkg;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

function prettyUrl(url?: string): string {
  if (!url) return 'a page';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url.slice(0, 40);
  }
}

/**
 * A short, readable line for each step.
 *
 * The agent's own thought reads like an internal monologue ("The address bar is
 * now focused."), which nobody can follow at a glance. The action says the same
 * thing in three words, so the label is built from that; the raw thought is only
 * a fallback for tools we do not recognise.
 */
function stepLabel(frame: SharedRunFrame): { verb: string; detail: string } {
  const payload = (frame.action_payload ?? {}) as Record<string, any>;

  switch (frame.action_type) {
    case 'open_app':
      return { verb: 'Opened', detail: prettyPackage(payload.packageName) };
    case 'open_url':
      return { verb: 'Opened', detail: prettyUrl(payload.url) };
    case 'tap_coordinate':
    case 'click_node':
      return { verb: 'Tapped', detail: 'the screen' };
    case 'type_text':
      return { verb: 'Typed', detail: payload.text ? `“${payload.text}”` : 'text' };
    case 'swipe':
      return { verb: 'Scrolled', detail: String(payload.direction || '').toUpperCase() === 'UP' ? 'up' : 'down' };
    case 'wait':
      return {
        verb: 'Waited',
        detail: payload.durationMillis ? `${Math.round(Number(payload.durationMillis) / 1000)}s` : 'a moment',
      };
    case 'global_action':
      return { verb: 'Pressed', detail: String(payload.action || 'back').toLowerCase() };
    case 'capture_screen':
      return { verb: 'Looked', detail: 'at the screen' };
    default: {
      const fallback = (frame.caption || '').split(/(?<=[.!?])\s/)[0] ?? '';
      return { verb: 'Step', detail: fallback.slice(0, 60) || 'in progress' };
    }
  }
}

export default function PublicRunPage() {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, isError } = useGetPublicRunQuery(token ?? '', { skip: !token });

  const run = data?.data;
  const frames = useMemo(() => run?.frames ?? [], [run]);

  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const railRef = useRef<HTMLDivElement | null>(null);

  // Loop the replay so a visitor always lands on something moving.
  useEffect(() => {
    if (!playing || frames.length <= 1) return;
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % frames.length);
    }, FRAME_MS);
    return () => clearInterval(timer);
  }, [playing, frames.length]);

  // Keep the active step centred in the rail without scrolling the page.
  useEffect(() => {
    const rail = railRef.current;
    const active = rail?.querySelector<HTMLElement>(`[data-step="${index}"]`);
    if (rail && active) {
      rail.scrollTo({
        top: active.offsetTop - rail.clientHeight / 2 + active.clientHeight / 2,
        behavior: 'smooth',
      });
    }
  }, [index]);

  if (isLoading) {
    return (
      <Stack alignItems="center" justifyContent="center" sx={{ minHeight: '100vh', bgcolor: '#0b1020' }}>
        <CircularProgress sx={{ color: '#8b5cf6' }} />
      </Stack>
    );
  }

  if (isError || !run) {
    return (
      <Stack alignItems="center" justifyContent="center" spacing={2} sx={{ minHeight: '100vh', bgcolor: '#0b1020', px: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 800, color: 'white' }}>
          This run is not available
        </Typography>
        <Typography variant="body2" sx={{ color: alpha('#fff', 0.6), textAlign: 'center' }}>
          The link may have been revoked, or it never existed.
        </Typography>
        <Button component={Link} to="/" variant="contained" sx={{ borderRadius: 2 }}>
          Go to Vector Brain
        </Button>
      </Stack>
    );
  }

  const currentFrame = frames[index];
  const payload = (currentFrame?.action_payload ?? {}) as Record<string, any>;
  const showTap =
    (currentFrame?.action_type === 'tap_coordinate' || currentFrame?.action_type === 'click_node') &&
    typeof payload.x === 'number' &&
    typeof payload.y === 'number';

  return (
    <>
      <Helmet>
        <title>{`${run.prompt} — done by an AI on a real phone`}</title>
        <meta name="description" content="Watch an AI agent operate a real Android phone, step by step." />
      </Helmet>

      <Box sx={{ minHeight: '100vh', bgcolor: '#0b1020', color: 'white', pb: 8 }}>
        {/* Hero — the whole story before anyone scrolls */}
        <Box
          sx={{
            background: 'radial-gradient(900px 380px at 50% -8%, rgba(139,92,246,0.35), transparent 70%)',
            pt: { xs: 4, md: 6 },
            pb: 3,
            px: 2,
            textAlign: 'center',
          }}
        >
          <Typography
            variant="overline"
            sx={{ fontWeight: 800, letterSpacing: 2, color: '#a78bfa', display: 'block', mb: 1.5 }}
          >
            A human typed one line
          </Typography>

          <Box
            sx={{
              display: 'inline-block',
              maxWidth: 720,
              px: 2.5,
              py: 1.5,
              borderRadius: 3,
              bgcolor: '#7c3aed',
              boxShadow: '0 12px 40px rgba(124,58,237,0.45)',
            }}
          >
            <Typography sx={{ fontWeight: 800, fontSize: { xs: 18, md: 24 }, wordBreak: 'break-word' }}>
              {run.prompt}
            </Typography>
          </Box>

          <Typography sx={{ mt: 2.5, fontWeight: 700, fontSize: { xs: 15, md: 17 }, color: alpha('#fff', 0.75) }}>
            An AI agent then did this on a real Android phone
          </Typography>

          <Stack direction="row" spacing={3} justifyContent="center" sx={{ mt: 2 }}>
            {[
              { value: String(run.total_steps), label: 'steps' },
              { value: formatDuration(run.total_duration_seconds), label: 'total time' },
              { value: run.success ? 'Yes' : 'No', label: 'completed' },
            ].map((stat) => (
              <Box key={stat.label}>
                <Typography sx={{ fontWeight: 900, fontSize: { xs: 20, md: 26 }, lineHeight: 1.1 }}>
                  {stat.value}
                </Typography>
                <Typography variant="caption" sx={{ color: alpha('#fff', 0.5), letterSpacing: 0.6 }}>
                  {stat.label}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Box>

        {frames.length === 0 ? (
          <Typography sx={{ textAlign: 'center', color: alpha('#fff', 0.6), py: 6 }}>
            No screens were captured for this run.
          </Typography>
        ) : (
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={{ xs: 4, md: 6 }}
            justifyContent="center"
            alignItems={{ xs: 'center', md: 'flex-start' }}
            sx={{ mt: 2, px: 2 }}
          >
            {/* Phone */}
            <Box>
              <Box
                sx={{
                  position: 'relative',
                  width: PHONE_W,
                  borderRadius: 6,
                  border: '10px solid #1f2937',
                  overflow: 'hidden',
                  bgcolor: '#000',
                  boxShadow: '0 30px 80px rgba(0,0,0,0.6)',
                }}
              >
                {/* Frames are stacked and cross-faded so screens dissolve instead of snapping */}
                {frames.map((frame, frameIndex) => (
                  <Box
                    key={frame.step_index}
                    component="img"
                    src={imageSrc(frame.image_base64)}
                    alt=""
                    sx={{
                      width: '100%',
                      display: 'block',
                      position: frameIndex === 0 ? 'relative' : 'absolute',
                      inset: frameIndex === 0 ? undefined : 0,
                      opacity: frameIndex === index ? 1 : 0,
                      transform: frameIndex === index ? 'scale(1)' : 'scale(1.015)',
                      transition: 'opacity 420ms ease, transform 900ms ease',
                    }}
                  />
                ))}

                {/* Where the agent actually touched the screen */}
                {showTap && (
                  <Box
                    key={`tap-${index}`}
                    sx={{
                      position: 'absolute',
                      left: `${(Number(payload.x) / REF_W) * 100}%`,
                      top: `${(Number(payload.y) / REF_H) * 100}%`,
                      width: 34,
                      height: 34,
                      ml: '-17px',
                      mt: '-17px',
                      borderRadius: '50%',
                      border: '2px solid rgba(167,139,250,0.95)',
                      bgcolor: 'rgba(167,139,250,0.25)',
                      animation: 'vbTap 900ms ease-out infinite',
                      '@keyframes vbTap': {
                        '0%': { transform: 'scale(0.5)', opacity: 0.9 },
                        '70%': { transform: 'scale(1.5)', opacity: 0.15 },
                        '100%': { transform: 'scale(1.6)', opacity: 0 },
                      },
                    }}
                  />
                )}
              </Box>

              <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mt: 2, width: PHONE_W }}>
                <Button
                  size="small"
                  onClick={() => setPlaying((prev) => !prev)}
                  startIcon={playing ? <PauseIcon /> : <PlayArrowIcon />}
                  sx={{
                    borderRadius: 2,
                    fontWeight: 800,
                    color: 'white',
                    bgcolor: alpha('#fff', 0.1),
                    '&:hover': { bgcolor: alpha('#fff', 0.18) },
                  }}
                >
                  {playing ? 'Pause' : 'Play'}
                </Button>
                <LinearProgress
                  variant="determinate"
                  value={((index + 1) / frames.length) * 100}
                  sx={{
                    flexGrow: 1,
                    height: 6,
                    borderRadius: 3,
                    bgcolor: alpha('#fff', 0.12),
                    '& .MuiLinearProgress-bar': { bgcolor: '#a78bfa' },
                  }}
                />
                <Typography variant="caption" sx={{ color: alpha('#fff', 0.6), minWidth: 42, textAlign: 'right' }}>
                  {index + 1}/{frames.length}
                </Typography>
              </Stack>
            </Box>

            {/* Step rail — subtitles running beside the phone */}
            <Box sx={{ width: { xs: '100%', md: 380 }, maxWidth: 420 }}>
              <Box
                ref={railRef}
                sx={{
                  maxHeight: 480,
                  overflowY: 'auto',
                  pr: 1,
                  '&::-webkit-scrollbar': { width: 4 },
                  '&::-webkit-scrollbar-thumb': { bgcolor: alpha('#fff', 0.15), borderRadius: 2 },
                }}
              >
                <Stack spacing={1}>
                  {frames.map((frame, frameIndex) => {
                    const label = stepLabel(frame);
                    const isActive = frameIndex === index;
                    const isDone = frameIndex < index;

                    return (
                      <Stack
                        key={frame.step_index}
                        data-step={frameIndex}
                        direction="row"
                        spacing={1.25}
                        alignItems="center"
                        onClick={() => {
                          setPlaying(false);
                          setIndex(frameIndex);
                        }}
                        sx={{
                          px: 1.5,
                          py: isActive ? 1.5 : 1,
                          borderRadius: 2,
                          cursor: 'pointer',
                          bgcolor: isActive ? alpha('#8b5cf6', 0.22) : 'transparent',
                          border: '1px solid',
                          borderColor: isActive ? alpha('#a78bfa', 0.5) : 'transparent',
                          opacity: isActive ? 1 : isDone ? 0.45 : 0.62,
                          transition: 'all 260ms ease',
                        }}
                      >
                        <Box
                          sx={{
                            width: 22,
                            height: 22,
                            flexShrink: 0,
                            borderRadius: '50%',
                            display: 'grid',
                            placeItems: 'center',
                            bgcolor: isDone ? alpha('#22c55e', 0.25) : alpha('#fff', 0.12),
                            color: isDone ? '#4ade80' : alpha('#fff', 0.8),
                            fontSize: 11,
                            fontWeight: 800,
                          }}
                        >
                          {isDone ? <CheckIcon sx={{ fontSize: 13 }} /> : frameIndex + 1}
                        </Box>

                        <Typography
                          sx={{
                            fontSize: isActive ? 17 : 14,
                            fontWeight: isActive ? 800 : 600,
                            transition: 'font-size 260ms ease',
                            wordBreak: 'break-word',
                          }}
                        >
                          {label.verb}{' '}
                          <Box
                            component="span"
                            sx={{ color: isActive ? '#c4b5fd' : alpha('#fff', 0.7), fontWeight: 700 }}
                          >
                            {label.detail}
                          </Box>
                        </Typography>
                      </Stack>
                    );
                  })}
                </Stack>
              </Box>
            </Box>
          </Stack>
        )}

        {/* Outcome sits below the demo so it never competes with it */}
        {run.summary && (
          <Box
            sx={{
              maxWidth: 760,
              mx: 'auto',
              mt: 6,
              px: 2.5,
              py: 2,
              borderRadius: 3,
              bgcolor: alpha('#fff', 0.04),
              border: `1px solid ${alpha('#fff', 0.08)}`,
              color: alpha('#fff', 0.85),
            }}
          >
            <Typography variant="overline" sx={{ fontWeight: 800, letterSpacing: 1, color: '#a78bfa' }}>
              What the agent reported
            </Typography>
            <AgentMarkdown text={run.summary} />
          </Box>
        )}

        <Stack alignItems="center" spacing={1.5} sx={{ mt: 7, px: 2, textAlign: 'center' }}>
          <Typography sx={{ fontWeight: 800, fontSize: { xs: 20, md: 24 } }}>Your phone can do this too.</Typography>
          <Typography variant="body2" sx={{ color: alpha('#fff', 0.6), maxWidth: 460 }}>
            Vector Brain runs AI agents on real Android devices — from a browser, with your own API key.
          </Typography>
          <Button
            component={Link}
            to="/"
            variant="contained"
            size="large"
            sx={{
              mt: 1,
              borderRadius: 999,
              px: 4,
              fontWeight: 800,
              bgcolor: '#7c3aed',
              '&:hover': { bgcolor: '#6d28d9' },
            }}
          >
            Try it free
          </Button>
        </Stack>
      </Box>
    </>
  );
}
