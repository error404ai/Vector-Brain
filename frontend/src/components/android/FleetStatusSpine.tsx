import { Box } from '@mui/material';

export type FleetDeviceState = 'running' | 'failed' | 'completed' | 'interrupted' | 'cancelled' | 'idle' | 'offline';

interface FleetStatusSpineProps {
  state: FleetDeviceState;
}

/**
 * The coloured edge down the left of each device card.
 *
 * A spine keeps the card's content at full strength and puts the state where
 * the eye can scan a whole column at once — the way a board of machines is read.
 *
 * Idle is a quiet grey, not green: green used to mean both "ready" and "just
 * finished", so a completed run was indistinguishable from an untouched phone.
 * Now green belongs only to completion, and completion alone gets a colour that
 * moves — a multi-hue sweep that plays a few times then settles into solid
 * green — so a finished task is unmistakable across a grid of still edges.
 */
export default function FleetStatusSpine({ state }: FleetStatusSpineProps) {
  const base = {
    running: 'primary.main',
    failed: 'error.main',
    completed: '#059669',
    interrupted: '#7c3aed',
    cancelled: 'grey.500',
    idle: 'grey.400',
    offline: 'grey.300',
  }[state];

  return (
    <Box
      aria-hidden="true"
      sx={{
        position: 'absolute',
        left: 0,
        top: 0,
        bottom: 0,
        width: 5,
        bgcolor: base,
        overflow: 'hidden',

        '@keyframes fleetSpine': {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },

        // A white highlight travels down a running spine forever.
        ...(state === 'running' && {
          '&::after': {
            content: '""',
            position: 'absolute',
            inset: 0,
            background: 'linear-gradient(180deg, transparent 0%, #ffffff 50%, transparent 100%)',
            opacity: 0.85,
            animation: 'fleetSpine 1.8s linear infinite',
          },
        }),

        // Completed: a multi-colour band sweeps the spine a few times, then the
        // spine is left solid green. Celebration that ends, not a card that
        // animates forever.
        ...(state === 'completed' && {
          '@keyframes fleetSpineParty': {
            '0%': { backgroundPosition: '0% 0%' },
            '100%': { backgroundPosition: '0% 300%' },
          },
          '&::after': {
            content: '""',
            position: 'absolute',
            inset: 0,
            backgroundImage: 'linear-gradient(180deg, #059669 0%, #10b981 20%, #06b6d4 40%, #6366f1 60%, #10b981 80%, #059669 100%)',
            backgroundSize: '100% 300%',
            animation: 'fleetSpineParty 1.4s ease-in-out 3',
            // After the 3 runs the gradient stops on its last frame; fade its
            // opacity so the solid green base shows through and it looks settled.
            opacity: 0.9,
          },
        }),

        '@media (prefers-reduced-motion: reduce)': {
          '&::after': { animation: 'none', opacity: 0.35 },
        },
      }}
    />
  );
}
