import { Box } from '@mui/material';
import type { ReactNode } from 'react';

interface PhoneFrame3DProps {
  children: ReactNode;
  /** Screen width in px. The body is drawn around this. */
  width: number;
  /** Screen height in px. */
  height: number;
  /**
   * Allows the hover tilt.
   *
   * Must be false while tap-to-control is on: the screen turns a click back
   * into device coordinates using getBoundingClientRect, and a rotated element
   * reports a box that no longer matches what is on screen, so taps would land
   * in the wrong place.
   */
  tilt?: boolean;
  /** Marks a device that is running — a faint glow under the body. */
  active?: boolean;
  onClick?: () => void;
}

/**
 * A phone-shaped shell around the live screen.
 *
 * CSS rather than WebGL: three.js is not in the lockfile and the Docker build
 * installs with --frozen-lockfile, and a canvas per card would cost far more
 * than a fleet board is worth.
 *
 * The bodies sit upright at rest. An earlier version tilted every phone all the
 * time, which made a grid of them look like a row of falling dominoes; the
 * rotation now only happens under the cursor, where it reads as a response.
 */
export default function PhoneFrame3D({ children, width, height, tilt = true, active = false, onClick }: PhoneFrame3DProps) {
  // Proportions from a real handset rather than picked by eye: the side rail is
  // just under 4% of screen width, the corner radius around 13%.
  const rail = Math.max(7, Math.round(width * 0.038));
  const bodyRadius = Math.round(width * 0.13) + rail;
  const screenRadius = Math.round(width * 0.13);
  const buttonInset = -Math.round(rail * 0.45);

  return (
    <Box sx={{ perspective: '1500px', display: 'flex', justifyContent: 'center', py: 1.5 }}>
      <Box
        onClick={onClick}
        sx={{
          position: 'relative',
          width: width + rail * 2,
          height: height + rail * 2,
          borderRadius: `${bodyRadius}px`,
          padding: `${rail}px`,
          cursor: onClick ? 'pointer' : 'default',
          transformStyle: 'preserve-3d',
          transition: 'transform 500ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 500ms ease',

          // Brushed metal rail. The stops are deliberately uneven — an even
          // gradient reads as painted plastic.
          background:
            'linear-gradient(145deg, #6b7079 0%, #3a3f47 18%, #1c1f24 46%, #14171a 68%, #43484f 88%, #6b7079 100%)',

          boxShadow: [
            '0 6px 12px -6px rgba(0,0,0,0.75)',
            '0 26px 44px -22px rgba(0,0,0,0.55)',
            'inset 0 1px 0 rgba(255,255,255,0.22)',
            'inset 0 -1px 0 rgba(0,0,0,0.55)',
            active ? '0 0 34px -6px rgba(25,118,210,0.5)' : '0 0 0 0 rgba(0,0,0,0)',
          ].join(', '),

          '&:hover': tilt
            ? {
                transform: 'rotateY(-13deg) rotateX(6deg) translateY(-8px)',
                boxShadow: [
                  '0 10px 18px -8px rgba(0,0,0,0.7)',
                  '0 40px 60px -24px rgba(0,0,0,0.6)',
                  'inset 0 1px 0 rgba(255,255,255,0.28)',
                  'inset 0 -1px 0 rgba(0,0,0,0.55)',
                ].join(', '),
              }
            : undefined,

          '@media (prefers-reduced-motion: reduce)': {
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
            bgcolor: '#05070a',
            // The dark ring is the gap between glass and rail; without it the
            // screen looks printed onto the body.
            boxShadow: 'inset 0 0 0 1.5px #000, inset 0 3px 8px rgba(0,0,0,0.85)',
          }}
        >
          {children}

          {/* Punch-hole camera */}
          <Box
            sx={{
              position: 'absolute',
              top: Math.round(height * 0.021),
              left: '50%',
              transform: 'translateX(-50%)',
              width: Math.max(6, Math.round(width * 0.042)),
              height: Math.max(6, Math.round(width * 0.042)),
              borderRadius: '50%',
              background: 'radial-gradient(circle at 34% 28%, #39404a 0%, #10141a 55%, #020406 100%)',
              boxShadow: '0 0 0 1px rgba(255,255,255,0.1), inset 0 0 2px rgba(120,170,255,0.35)',
              pointerEvents: 'none',
              zIndex: 3,
            }}
          />

          {/* Glass sheen. Two bands, so it reads as a reflection not a wash. */}
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              zIndex: 2,
              background:
                'linear-gradient(116deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.05) 16%, rgba(255,255,255,0) 34%), ' +
                'linear-gradient(116deg, rgba(255,255,255,0) 52%, rgba(255,255,255,0.05) 60%, rgba(255,255,255,0) 70%)',
            }}
          />

          {/* Curved-edge falloff where the glass meets the rail */}
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              zIndex: 1,
              background:
                'linear-gradient(90deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 5%, rgba(0,0,0,0) 95%, rgba(0,0,0,0.35) 100%)',
            }}
          />
        </Box>

        {/* Power button */}
        <Box
          sx={{
            position: 'absolute',
            right: buttonInset,
            top: '26%',
            width: Math.max(3, Math.round(rail * 0.4)),
            height: Math.round(height * 0.085),
            borderRadius: '0 4px 4px 0',
            background: 'linear-gradient(180deg, #7a808a 0%, #464c54 40%, #22262b 100%)',
            boxShadow: '1px 0 2px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
          }}
        />

        {/* Volume rocker */}
        <Box
          sx={{
            position: 'absolute',
            right: buttonInset,
            top: '40%',
            width: Math.max(3, Math.round(rail * 0.4)),
            height: Math.round(height * 0.135),
            borderRadius: '0 4px 4px 0',
            background: 'linear-gradient(180deg, #7a808a 0%, #464c54 40%, #22262b 100%)',
            boxShadow: '1px 0 2px rgba(0,0,0,0.5)',
            pointerEvents: 'none',
          }}
        />

        {/* Antenna band on the left rail. Small, but its absence is what makes a
            CSS phone look like a plain rounded rectangle. */}
        <Box
          sx={{
            position: 'absolute',
            left: 0,
            top: '18%',
            width: Math.max(2, Math.round(rail * 0.3)),
            height: 2,
            background: 'rgba(255,255,255,0.18)',
            pointerEvents: 'none',
          }}
        />
      </Box>
    </Box>
  );
}
