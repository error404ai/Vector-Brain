import { Box } from '@mui/material';
import type { ReactNode } from 'react';

interface PhoneFrame3DProps {
  children: ReactNode;
  /** Screen width in px. The frame sizes itself around this. */
  width: number;
  /** Screen height in px. */
  height: number;
  /**
   * Tilts the phone in perspective and lifts it on hover.
   *
   * Must be false while tap-to-control is on: the screen maps a click back to
   * device coordinates from getBoundingClientRect, and a rotated element
   * reports a bounding box that no longer matches what the user sees, so every
   * tap would land in the wrong place.
   */
  tilt?: boolean;
  /** Adds a soft glow under the frame — used to mark a device that is running. */
  active?: boolean;
  onClick?: () => void;
}

/**
 * A phone-shaped shell around the live screen.
 *
 * Done in CSS rather than WebGL on purpose: three.js is not in the lockfile and
 * the Docker build installs with --frozen-lockfile, and a canvas per card would
 * cost far more than this is worth on a fleet board.
 */
export default function PhoneFrame3D({ children, width, height, tilt = true, active = false, onClick }: PhoneFrame3DProps) {
  const bezel = Math.max(6, Math.round(width * 0.045));
  const bodyRadius = Math.round(width * 0.14);
  const screenRadius = Math.max(6, bodyRadius - bezel);

  return (
    <Box
      sx={{
        perspective: '1400px',
        display: 'flex',
        justifyContent: 'center',
        py: 1,
      }}
    >
      <Box
        onClick={onClick}
        sx={{
          position: 'relative',
          width: width + bezel * 2,
          height: height + bezel * 2,
          borderRadius: `${bodyRadius}px`,
          padding: `${bezel}px`,
          cursor: onClick ? 'pointer' : 'default',
          transformStyle: 'preserve-3d',
          transform: tilt ? 'rotateY(-14deg) rotateX(5deg)' : 'none',
          transition: 'transform 420ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 420ms ease',

          // The metal edge: a light top-left rim fading to a dark bottom-right one.
          background: 'linear-gradient(150deg, #4a4f57 0%, #23272d 32%, #15181c 62%, #34393f 100%)',

          boxShadow: active
            ? '0 26px 48px -20px rgba(0,0,0,0.62), 0 0 0 1px rgba(255,255,255,0.06), 0 0 30px -4px rgba(25,118,210,0.45)'
            : '0 22px 40px -22px rgba(0,0,0,0.58), 0 0 0 1px rgba(255,255,255,0.05)',

          '&:hover': tilt
            ? {
                transform: 'rotateY(-4deg) rotateX(2deg) translateY(-6px)',
                boxShadow: '0 34px 56px -22px rgba(0,0,0,0.66), 0 0 0 1px rgba(255,255,255,0.09)',
              }
            : undefined,

          '@media (prefers-reduced-motion: reduce)': {
            transform: 'none',
            transition: 'none',
            '&:hover': { transform: 'none' },
          },
        }}
      >
        {/* Screen well */}
        <Box
          sx={{
            position: 'relative',
            width: '100%',
            height: '100%',
            borderRadius: `${screenRadius}px`,
            overflow: 'hidden',
            bgcolor: '#000',
            boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.9), inset 0 2px 6px rgba(0,0,0,0.7)',
          }}
        >
          {children}

          {/* Punch-hole camera. Sits above the frame, never eats a tap. */}
          <Box
            sx={{
              position: 'absolute',
              top: Math.round(height * 0.022),
              left: '50%',
              transform: 'translateX(-50%)',
              width: Math.max(5, Math.round(width * 0.045)),
              height: Math.max(5, Math.round(width * 0.045)),
              borderRadius: '50%',
              background: 'radial-gradient(circle at 35% 30%, #2c3138 0%, #05070a 70%)',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.08)',
              pointerEvents: 'none',
              zIndex: 2,
            }}
          />

          {/* Glass sheen — a diagonal highlight so the screen reads as glass, not paint. */}
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              zIndex: 1,
              background:
                'linear-gradient(118deg, rgba(255,255,255,0.14) 0%, rgba(255,255,255,0.04) 22%, rgba(255,255,255,0) 46%)',
            }}
          />
        </Box>

        {/* Power button, right edge */}
        <Box
          sx={{
            position: 'absolute',
            right: -2,
            top: '27%',
            width: 3,
            height: Math.round(height * 0.09),
            borderRadius: '0 3px 3px 0',
            background: 'linear-gradient(180deg, #52585f, #24282d)',
            pointerEvents: 'none',
          }}
        />

        {/* Volume rocker, right edge */}
        <Box
          sx={{
            position: 'absolute',
            right: -2,
            top: '42%',
            width: 3,
            height: Math.round(height * 0.14),
            borderRadius: '0 3px 3px 0',
            background: 'linear-gradient(180deg, #52585f, #24282d)',
            pointerEvents: 'none',
          }}
        />
      </Box>
    </Box>
  );
}
