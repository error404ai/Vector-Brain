import { Box } from '@mui/material';

interface VectorMarkProps {
  /** Rendered width and height in pixels. */
  size?: number;
  /**
   * Runs the observe-then-plan loop. Off by default so the same mark can sit in
   * the header and favicon without moving.
   */
  animated?: boolean;
  /** Line colour. Defaults to the surrounding text colour. */
  color?: string;
  /** Sweep and node colour. */
  accent?: string;
}

/**
 * The Vector Brain mark: a phone outline with a three-point path inside it.
 *
 * The shape is the product described literally — a route plotted through a real
 * device screen. Animated, it replays what the agent is actually doing in the
 * seconds it is shown: a line sweeps down the screen (reading the UI tree), the
 * three points light up in order, and the path draws itself between them (the
 * plan). Observe, then plan.
 *
 * Only opacity, transform and stroke-dashoffset are animated. The page is
 * receiving device frames over a WebSocket while this runs, so anything that
 * forces layout or paint work would compete with the live view.
 */
export default function VectorMark({ size = 40, animated = false, color, accent }: VectorMarkProps) {
  const stroke = color ?? 'currentColor';
  const glow = accent ?? '#22d3ee';

  return (
    <Box
      component="svg"
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      sx={{
        display: 'block',
        flexShrink: 0,
        color: stroke,

        '@keyframes vbSweep': {
          '0%': { transform: 'translateY(0px)', opacity: 0 },
          '12%': { opacity: 1 },
          '78%': { opacity: 1 },
          '100%': { transform: 'translateY(31px)', opacity: 0 },
        },
        '@keyframes vbNode': {
          '0%, 18%': { opacity: 0.15 },
          '32%, 100%': { opacity: 1 },
        },
        '@keyframes vbDraw': {
          '0%, 30%': { strokeDashoffset: 34 },
          '68%, 100%': { strokeDashoffset: 0 },
        },

        ...(animated && {
          '& .vb-sweep': { animation: 'vbSweep 2.6s cubic-bezier(0.4, 0, 0.2, 1) infinite' },
          '& .vb-path': {
            strokeDasharray: 34,
            animation: 'vbDraw 2.6s cubic-bezier(0.4, 0, 0.2, 1) infinite',
          },
          '& .vb-node-1': { animation: 'vbNode 2.6s ease-out infinite' },
          '& .vb-node-2': { animation: 'vbNode 2.6s ease-out infinite', animationDelay: '0.22s' },
          '& .vb-node-3': { animation: 'vbNode 2.6s ease-out infinite', animationDelay: '0.44s' },
        }),

        // Anyone who has asked their system to stop moving things gets the mark
        // in its finished state rather than a frozen half-drawn path.
        '@media (prefers-reduced-motion: reduce)': {
          '& .vb-sweep': { animation: 'none', opacity: 0 },
          '& .vb-path': { animation: 'none', strokeDasharray: 'none' },
          '& [class^="vb-node"]': { animation: 'none', opacity: 1 },
        },
      }}
    >
      {/* Device */}
      <rect
        x="13.5"
        y="4.5"
        width="21"
        height="39"
        rx="5"
        stroke="currentColor"
        strokeWidth="2.5"
        opacity="0.9"
      />
      {/* Earpiece slot, so the outline reads as a phone and not a card */}
      <line x1="21" y1="9" x2="27" y2="9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" opacity="0.45" />

      {/* The plan: a route through the screen */}
      <path
        className="vb-path"
        d="M20 17 L28.5 25 L20 34"
        stroke={glow}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle className="vb-node-1" cx="20" cy="17" r="2.75" fill={glow} />
      <circle className="vb-node-2" cx="28.5" cy="25" r="2.75" fill={glow} />
      <circle className="vb-node-3" cx="20" cy="34" r="2.75" fill={glow} />

      {/* The read: a line passing down the screen */}
      <line
        className="vb-sweep"
        x1="16"
        y1="12"
        x2="32"
        y2="12"
        stroke={glow}
        strokeWidth="1.75"
        strokeLinecap="round"
        opacity="0"
      />
    </Box>
  );
}
