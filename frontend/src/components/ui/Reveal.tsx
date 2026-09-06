import { Box } from '@mui/material';
import type { ReactNode } from 'react';

interface RevealProps {
  children: ReactNode;
  /** Position in the group. Each step adds a small delay so items arrive in order. */
  index?: number;
  /** Milliseconds between consecutive items. */
  stagger?: number;
}

/**
 * Entrance motion for a list or a stack of panels.
 *
 * The delay is derived from the item's position rather than an observer, because
 * these panels are all above the fold on load — the sequence exists to give the
 * eye an order to read in, not to react to scrolling.
 *
 * Only opacity and transform are animated, and the element is left with no
 * lingering transform once the animation finishes, so nothing here creates a
 * containing block that would break a sticky or fixed child later.
 */
export default function Reveal({ children, index = 0, stagger = 70 }: RevealProps) {
  return (
    <Box
      sx={{
        '@keyframes vbReveal': {
          from: { opacity: 0, transform: 'translateY(10px)' },
          to: { opacity: 1, transform: 'none' },
        },
        opacity: 0,
        animation: 'vbReveal 420ms cubic-bezier(0.22, 1, 0.36, 1) forwards',
        animationDelay: `${index * stagger}ms`,

        '@media (prefers-reduced-motion: reduce)': {
          animation: 'none',
          opacity: 1,
        },
      }}
    >
      {children}
    </Box>
  );
}
