import { Box } from '@mui/material';

export type FleetDeviceState = 'running' | 'failed' | 'idle' | 'offline';

interface FleetStatusSpineProps {
  state: FleetDeviceState;
}

/**
 * The coloured edge down the left of each device card.
 *
 * State used to be carried by dimming the whole offline card to 65% opacity,
 * which makes the card's real content harder to read in exchange for one bit of
 * information. A spine keeps the content at full strength and puts the state
 * somewhere the eye can scan down a whole column at once — the way a board of
 * machines is actually read.
 *
 * Only the running state moves. If every card animated, none of them would mean
 * anything; one travelling highlight in a grid of still edges is unmissable.
 */
export default function FleetStatusSpine({ state }: FleetStatusSpineProps) {
  const base = {
    running: 'primary.main',
    failed: 'error.main',
    idle: 'success.main',
    offline: 'grey.400',
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

        '@media (prefers-reduced-motion: reduce)': {
          '&::after': { animation: 'none', opacity: 0.35 },
        },
      }}
    />
  );
}
