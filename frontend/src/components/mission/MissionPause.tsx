import { Box, ButtonBase, CircularProgress } from '@mui/material';
import { keyframes } from '@mui/material/styles';

const AMBER = '#F59E0B';
const AMBER_DEEP = '#B45309';

const breathe = keyframes`
  0%, 100% { transform: scaleY(1); opacity: 1; }
  50% { transform: scaleY(.62); opacity: .7; }
`;
const ring = keyframes`
  0% { box-shadow: 0 0 0 0 rgba(245, 158, 11, .45); }
  100% { box-shadow: 0 0 0 10px rgba(245, 158, 11, 0); }
`;
const sweep = keyframes`
  from { transform: translateX(-120%) skewX(-18deg); }
  to { transform: translateX(260%) skewX(-18deg); }
`;
const reduced = { '@media (prefers-reduced-motion: reduce)': { '&, & *, &::after': { animation: 'none !important' } } };

/** Two bars that breathe: the header icon of a paused mission. */
export function PausedGlyph() {
  return (
    <Box
      aria-hidden
      sx={{
        width: 22,
        height: 22,
        borderRadius: '50%',
        bgcolor: 'rgba(245,158,11,.14)',
        display: 'grid',
        gridAutoFlow: 'column',
        placeContent: 'center',
        gap: '3px',
        animation: `${ring} 1.8s ease-out infinite`,
        '& i': { width: 3.5, height: 10, borderRadius: 2, bgcolor: AMBER_DEEP, animation: `${breathe} 1.8s ease-in-out infinite` },
        '& i:last-of-type': { animationDelay: '.25s' },
        ...reduced,
      }}
    >
      <i />
      <i />
    </Box>
  );
}

/** Pause, beside Stop while a mission runs. */
export function PauseButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <ButtonBase
      onClick={onClick}
      disabled={busy}
      aria-label="Pause mission"
      sx={{
        gap: 0.75,
        px: 1.5,
        height: 30,
        borderRadius: 99,
        border: `1px solid rgba(245,158,11,.55)`,
        color: AMBER_DEEP,
        font: '700 13px inherit',
        bgcolor: 'rgba(245,158,11,.06)',
        transition: 'background-color 160ms, transform 160ms, box-shadow 160ms',
        '&:hover': { bgcolor: 'rgba(245,158,11,.14)', transform: 'translateY(-1px)', boxShadow: '0 8px 18px -10px rgba(180,83,9,.6)' },
        '&:hover .bars i': { height: 8 },
        '&:focus-visible': { outline: `2px solid ${AMBER}`, outlineOffset: 2 },
        '&.Mui-disabled': { opacity: 0.6 },
      }}
    >
      {busy ? (
        <CircularProgress size={12} thickness={6} sx={{ color: AMBER_DEEP }} />
      ) : (
        <Box className="bars" sx={{ display: 'flex', gap: '3px', '& i': { width: 3, height: 11, borderRadius: 2, bgcolor: AMBER_DEEP, transition: 'height 160ms' } }}>
          <i />
          <i />
        </Box>
      )}
      Pause
    </ButtonBase>
  );
}

/** Resume: the one thing to do on a paused mission, so it gets the colour and a slow shine. */
export function ResumeButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <ButtonBase
      onClick={onClick}
      disabled={busy}
      aria-label="Resume mission"
      sx={{
        position: 'relative',
        overflow: 'hidden',
        gap: 0.75,
        px: 1.75,
        height: 32,
        borderRadius: 99,
        color: '#fff',
        font: '800 13px inherit',
        background: `linear-gradient(135deg, ${AMBER}, #F97316)`,
        boxShadow: '0 10px 22px -12px rgba(249,115,22,.9)',
        transition: 'transform 160ms, box-shadow 160ms',
        '&:hover': { transform: 'translateY(-1px)', boxShadow: '0 14px 26px -12px rgba(249,115,22,1)' },
        '&:focus-visible': { outline: `2px solid ${AMBER}`, outlineOffset: 2 },
        '&::after': {
          content: '""',
          position: 'absolute',
          top: 0,
          bottom: 0,
          width: '40%',
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.45), transparent)',
          animation: `${sweep} 2.6s ease-in-out infinite`,
        },
        ...reduced,
      }}
    >
      {busy ? (
        <CircularProgress size={12} thickness={6} sx={{ color: '#fff' }} />
      ) : (
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
          <path d="M3 1.8v8.4a.6.6 0 0 0 .9.5l6.7-4.2a.6.6 0 0 0 0-1L3.9 1.3a.6.6 0 0 0-.9.5z" fill="currentColor" />
        </svg>
      )}
      Resume
    </ButtonBase>
  );
}

/** A paused bar: amber stripes that do not move, at the progress already made. */
export function PausedProgress({ percent }: { percent: number }) {
  return (
    <Box sx={{ height: 6, borderRadius: 1, bgcolor: 'rgba(245,158,11,.14)', overflow: 'hidden' }}>
      <Box
        sx={{
          height: '100%',
          width: `${Math.max(3, percent)}%`,
          borderRadius: 1,
          background: `repeating-linear-gradient(135deg, ${AMBER} 0 8px, #FBBF24 8px 16px)`,
          transition: 'width 600ms cubic-bezier(.2,.8,.2,1)',
        }}
      />
    </Box>
  );
}
