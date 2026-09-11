import { alpha, Box, Stack, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';

interface Step {
  tool: string;
  detail: string;
}

const STEPS: Step[] = [
  { tool: 'open_url', detail: 'Opened youtube.com/results' },
  { tool: 'read_ui_tree', detail: 'Read 42 elements on screen' },
  { tool: 'tap_coordinate', detail: 'Tapped the first video' },
  { tool: 'wait_for_element', detail: 'Player is on screen' },
];

/** How long each step stays before the next appears. */
const STEP_INTERVAL_MS = 1400;
/** Degrees of tilt at the far edge of the viewport. */
const MAX_TILT = 9;

/**
 * The hero's centrepiece: a phone rendered with CSS 3D transforms, tilting
 * towards the pointer, with the agent's steps arriving beside it.
 *
 * Everything here is transform and opacity only, so the browser can keep it on
 * the compositor and never re-lays out the page while it moves.
 */
export default function PhoneScene() {
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [visibleSteps, setVisibleSteps] = useState(1);

  // Pointer parallax. Skipped on touch devices, where there is no pointer to
  // follow and the listener would fire during every scroll.
  useEffect(() => {
    const finePointer = window.matchMedia('(pointer: fine)').matches;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!finePointer || reduceMotion) return;

    let frame = 0;
    const onMove = (event: PointerEvent) => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const x = (event.clientX / window.innerWidth - 0.5) * 2;
        const y = (event.clientY / window.innerHeight - 0.5) * 2;
        setTilt({ x: -y * MAX_TILT, y: x * MAX_TILT });
      });
    };

    window.addEventListener('pointermove', onMove);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  // Steps appear one by one, then the run restarts.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setVisibleSteps(STEPS.length);
      return;
    }
    const timer = window.setInterval(() => {
      setVisibleSteps((current) => (current >= STEPS.length ? 1 : current + 1));
    }, STEP_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <Box
      ref={sceneRef}
      sx={{
        position: 'relative',
        perspective: '1400px',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: { xs: 460, md: 560 },
      }}
    >
      {/* Glow pool behind the device */}
      <Box
        aria-hidden
        sx={{
          position: 'absolute',
          width: 460,
          height: 460,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(37,99,235,0.42) 0%, rgba(37,99,235,0) 68%)',
          filter: 'blur(28px)',
        }}
      />

      <Box
        sx={{
          position: 'relative',
          transformStyle: 'preserve-3d',
          transform: `rotateX(${tilt.x}deg) rotateY(${tilt.y}deg)`,
          transition: 'transform 420ms cubic-bezier(0.22, 1, 0.36, 1)',
        }}
      >
        {/* Handset */}
        <Box
          sx={{
            width: { xs: 236, md: 272 },
            height: { xs: 470, md: 540 },
            borderRadius: 7,
            p: 1,
            background: 'linear-gradient(160deg, #2b3445 0%, #0d1220 55%, #05070d 100%)',
            border: '1px solid rgba(148, 163, 184, 0.28)',
            boxShadow: '0 50px 90px rgba(2, 6, 23, 0.72), inset 0 1px 0 rgba(255,255,255,0.12)',
            transform: 'translateZ(38px)',
          }}
        >
          <Box
            sx={{
              position: 'relative',
              height: '100%',
              borderRadius: 6,
              overflow: 'hidden',
              background: 'linear-gradient(180deg, #0b1120 0%, #111c33 100%)',
            }}
          >
            {/* Camera pill */}
            <Box
              sx={{
                position: 'absolute',
                top: 10,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 72,
                height: 18,
                borderRadius: 999,
                bgcolor: 'rgba(2,6,23,0.9)',
              }}
            />

            <Stack spacing={1.25} sx={{ pt: 5, px: 1.75 }}>
              <Typography sx={{ color: 'rgba(148,163,184,0.85)', fontSize: 11, letterSpacing: 1.2, fontWeight: 700 }}>
                AGENT RUNNING
              </Typography>

              {/* Screen rows standing in for the phone's UI */}
              {[0, 1, 2, 3, 4, 5].map((row) => (
                <Box
                  key={row}
                  sx={{
                    height: row === 1 ? 92 : 34,
                    borderRadius: 2,
                    border: '1px solid',
                    borderColor: row === 1 ? 'rgba(96,165,250,0.55)' : 'rgba(148,163,184,0.16)',
                    bgcolor: row === 1 ? 'rgba(37,99,235,0.22)' : 'rgba(148,163,184,0.07)',
                    boxShadow: row === 1 ? '0 0 26px rgba(59,130,246,0.35)' : 'none',
                  }}
                />
              ))}
            </Stack>

            {/* Tap ripple on the highlighted row */}
            <Box
              aria-hidden
              sx={{
                position: 'absolute',
                top: 148,
                left: '52%',
                width: 30,
                height: 30,
                borderRadius: '50%',
                border: '2px solid rgba(125,211,252,0.9)',
                animation: 'vbTap 2.4s ease-out infinite',
                '@keyframes vbTap': {
                  '0%': { transform: 'scale(0.4)', opacity: 0 },
                  '25%': { opacity: 1 },
                  '70%': { transform: 'scale(2.1)', opacity: 0 },
                  '100%': { opacity: 0 },
                },
                '@media (prefers-reduced-motion: reduce)': { animation: 'none', opacity: 0.5 },
              }}
            />
          </Box>
        </Box>

        {/* Floating step feed */}
        <Box
          sx={{
            position: 'absolute',
            top: { xs: 10, md: 40 },
            right: { xs: -24, md: -168 },
            width: { xs: 210, md: 268 },
            transform: 'translateZ(96px)',
            display: { xs: 'none', sm: 'block' },
          }}
        >
          <Stack spacing={1}>
            {STEPS.slice(0, visibleSteps).map((step, index) => (
              <Box
                key={step.tool}
                sx={{
                  p: 1.5,
                  borderRadius: 2.5,
                  border: '1px solid rgba(148,163,184,0.22)',
                  bgcolor: 'rgba(15, 23, 42, 0.72)',
                  backdropFilter: 'blur(10px)',
                  boxShadow: '0 18px 40px rgba(2,6,23,0.5)',
                  animation: 'vbStepIn 420ms cubic-bezier(0.22, 1, 0.36, 1)',
                  '@keyframes vbStepIn': {
                    from: { opacity: 0, transform: 'translateY(10px)' },
                    to: { opacity: 1, transform: 'translateY(0)' },
                  },
                }}
              >
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                  <Box
                    sx={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      bgcolor: index === visibleSteps - 1 ? '#38bdf8' : '#22c55e',
                    }}
                  />
                  <Typography sx={{ color: '#93c5fd', fontSize: 12, fontWeight: 800, fontFamily: 'monospace' }}>
                    {step.tool}
                  </Typography>
                </Stack>
                <Typography sx={{ color: 'rgba(226,232,240,0.82)', fontSize: 12.5, lineHeight: 1.4 }}>
                  {step.detail}
                </Typography>
              </Box>
            ))}
          </Stack>
        </Box>

        {/* Prompt chip on the other side */}
        <Box
          sx={{
            position: 'absolute',
            bottom: { xs: 22, md: 58 },
            left: { xs: -18, md: -142 },
            transform: 'translateZ(74px)',
            p: 1.5,
            borderRadius: 2.5,
            maxWidth: 230,
            border: '1px solid rgba(96,165,250,0.4)',
            bgcolor: (theme) => alpha(theme.palette.primary.main, 0.16),
            backdropFilter: 'blur(10px)',
            display: { xs: 'none', sm: 'block' },
          }}
        >
          <Typography sx={{ color: 'rgba(226,232,240,0.7)', fontSize: 11, fontWeight: 700, letterSpacing: 0.8 }}>
            YOU TYPED
          </Typography>
          <Typography sx={{ color: '#f8fafc', fontSize: 13.5, lineHeight: 1.45 }}>
            open YouTube and play lofi study music
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
