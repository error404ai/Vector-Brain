import type { SxProps, Theme } from '@mui/material';

/**
 * Prism Control Room (Settings): frosted glass over the prism background.
 * The section's own Card/Paper loses its border and fill so the glass is the
 * only surface.
 */
export const PRISM_ACCENT = '#3b4cff';
export const PRISM_PINK = '#ec4899';
export const PRISM_INK = '#141a2e';
/** Secondary text: dark enough to read at a glance on the glass (≈10:1 on white). */
export const PRISM_MUTED = '#3c435e';

export const glassSection: SxProps<Theme> = {
  position: 'relative',
  p: { xs: 2, md: 3 },
  borderRadius: '24px',
  bgcolor: 'rgba(255,255,255,0.74)',
  border: '1px solid rgba(255,255,255,0.95)',
  backdropFilter: 'blur(20px)',
  WebkitBackdropFilter: 'blur(20px)',
  boxShadow: '0 24px 60px rgba(30,40,90,0.09)',
  scrollMarginTop: 88,
  '& > .MuiCard-root, & > .MuiPaper-root': { bgcolor: 'transparent', border: 0, boxShadow: 'none', borderRadius: 0, overflow: 'visible' },
  '& > .MuiCard-root > .MuiCardContent-root': { p: 0, '&:last-child': { pb: 0 } },
};

/** The gradient switch from the design: blue → pink when on. */
export const prismSwitch: SxProps<Theme> = {
  width: 58,
  height: 38,
  p: '4px',
  '& .MuiSwitch-switchBase': {
    p: '7px',
    transition: 'transform 350ms cubic-bezier(.3,1.4,.5,1)',
    '&.Mui-checked': {
      transform: 'translateX(20px)',
      color: '#fff',
      '& + .MuiSwitch-track': { opacity: 1, background: `linear-gradient(90deg, ${PRISM_ACCENT}, ${PRISM_PINK})` },
    },
    '&.Mui-disabled + .MuiSwitch-track': { opacity: 0.6 },
  },
  '& .MuiSwitch-thumb': { width: 24, height: 24, boxShadow: '0 2px 6px rgba(0,0,0,.2)', bgcolor: '#fff' },
  '& .MuiSwitch-track': { borderRadius: 999, opacity: 1, bgcolor: '#d7dae8' },
  '@media (prefers-reduced-motion: reduce)': { '& .MuiSwitch-switchBase': { transition: 'none' } },
};

export const sectionTitle: SxProps<Theme> = { fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', color: PRISM_INK };
export const monoLabel: SxProps<Theme> = { fontFamily: '"JetBrains Mono", ui-monospace, monospace', fontSize: 11.5, fontWeight: 700, letterSpacing: '0.1em', color: '#3730a3', textTransform: 'uppercase' };

/** A chosen option: filled with the accent, white text, so the choice reads at a glance. */
export const chosenOption = {
  border: '1.5px solid transparent',
  background: `linear-gradient(135deg, ${PRISM_ACCENT}, #6d28d9)`,
  color: '#fff',
  boxShadow: '0 8px 20px -8px rgba(59,76,255,.65)',
} as const;

/** An option that is not chosen: a clear border and dark text, accent on hover. */
export const plainOption = {
  border: '1.5px solid #c3c8de',
  background: '#fff',
  color: '#262c48',
  '&:hover:not(:disabled)': { borderColor: PRISM_ACCENT, color: PRISM_ACCENT },
} as const;

/**
 * Text on the Settings page: captions and helper text a size up and dark,
 * labels dark, so nothing reads as greyed out unless it really is disabled.
 */
export const readableScope: SxProps<Theme> = {
  '& .MuiTypography-caption': { fontSize: 13, lineHeight: 1.55 },
  '& .MuiFormHelperText-root': { color: PRISM_MUTED, fontSize: 12.5, lineHeight: 1.5 },
  '& .MuiInputLabel-root:not(.Mui-focused)': { color: '#262c48' },
  '& .MuiOutlinedInput-notchedOutline': { borderColor: '#b9bfd6' },
  '& .MuiFormControlLabel-label .MuiTypography-body2': { fontWeight: 600, color: PRISM_INK },
};
