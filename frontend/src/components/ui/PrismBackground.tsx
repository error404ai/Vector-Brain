import { reducedMotion } from '@/components/mission/motion';
import { Box } from '@mui/material';
import { keyframes } from '@mui/material/styles';

const prismSpin = keyframes`to { transform: rotate(360deg); }`;
const prismSweep = keyframes`
  0%   { transform: translateX(0) rotate(24deg); }
  100% { transform: translateX(260vw) rotate(24deg); }
`;

/**
 * Prism: a colour wheel turning very slowly behind frosted glass, with a soft
 * sweep of light. CSS only (two transforms), so it costs nothing on the main
 * thread. Shared by Mission Control and Settings; the parent is position: relative.
 */
export default function PrismBackground() {
  return (
    <Box aria-hidden sx={{ position: 'absolute', inset: 0, zIndex: 0, overflow: 'hidden', pointerEvents: 'none', bgcolor: '#f4f5fb' }}>
      <Box
        sx={{
          position: 'absolute',
          left: '22%',
          top: '-28%',
          width: '80vmax',
          height: '80vmax',
          borderRadius: '50%',
          background: 'conic-gradient(from 0deg, #6aa8ff, #a78bfa, #f472b6, #fbbf24, #34d399, #6aa8ff)',
          filter: 'blur(90px)',
          opacity: 0.42,
          willChange: 'transform',
          animation: `${prismSpin} 40s linear infinite`,
          ...reducedMotion,
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          left: '-30vw',
          top: '-20%',
          width: 260,
          height: '140%',
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.7), transparent)',
          transform: 'rotate(24deg)',
          willChange: 'transform',
          animation: `${prismSweep} 9s cubic-bezier(.5,0,.5,1) infinite`,
          ...reducedMotion,
          '@media (prefers-reduced-motion: reduce)': { display: 'none' },
        }}
      />
      <Box sx={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(255,255,255,.35), rgba(255,255,255,.05))' }} />
    </Box>
  );
}
