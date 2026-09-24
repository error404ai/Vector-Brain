import { keyframes } from '@mui/material/styles';

/**
 * Motion for the Mission Control chat. Every animation answers something that
 * just happened (a message arrived, a phone started, finished or failed) and is
 * short; people who ask their OS for reduced motion get none of it.
 */

export const riseIn = keyframes`
  from { opacity: 0; transform: translateY(10px) scale(0.98); }
  to   { opacity: 1; transform: none; }
`;

export const popIn = keyframes`
  0%   { opacity: 0; transform: scale(0.6); }
  60%  { opacity: 1; transform: scale(1.12); }
  100% { transform: scale(1); }
`;

export const shake = keyframes`
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-4px); }
  40% { transform: translateX(4px); }
  60% { transform: translateX(-3px); }
  80% { transform: translateX(2px); }
`;

export const pulseDot = keyframes`
  0%   { box-shadow: 0 0 0 0 rgba(2, 136, 209, 0.55); }
  70%  { box-shadow: 0 0 0 7px rgba(2, 136, 209, 0); }
  100% { box-shadow: 0 0 0 0 rgba(2, 136, 209, 0); }
`;

export const shimmer = keyframes`
  from { transform: translateX(-100%); }
  to   { transform: translateX(100%); }
`;

export const glowSuccess = keyframes`
  0%   { box-shadow: 0 0 0 0 rgba(22, 163, 74, 0.45); }
  100% { box-shadow: 0 0 0 14px rgba(22, 163, 74, 0); }
`;

export const glowError = keyframes`
  0%   { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.4); }
  100% { box-shadow: 0 0 0 14px rgba(220, 38, 38, 0); }
`;

export const typingDot = keyframes`
  0%, 80%, 100% { transform: translateY(0); opacity: 0.35; }
  40% { transform: translateY(-4px); opacity: 1; }
`;

export const screenFade = keyframes`
  from { opacity: 0; transform: scale(1.02); }
  to   { opacity: 1; transform: none; }
`;

export const slideStep = keyframes`
  from { opacity: 0; transform: translateX(-6px); }
  to   { opacity: 1; transform: none; }
`;

/**
 * "Pick up" bounce for the phone zoom: the device lifts off its thumbnail,
 * overshoots, then settles — like picking a phone up off a table.
 */
export const zoomBounce = keyframes`
  0%   { opacity: 0; transform: scale(0.32) translateY(34px); }
  55%  { opacity: 1; transform: scale(1.06) translateY(-8px); }
  74%  { transform: scale(0.98) translateY(3px); }
  88%  { transform: scale(1.012) translateY(-1px); }
  100% { transform: scale(1) translateY(0); }
`;

export const zoomBackdrop = keyframes`
  from { opacity: 0; }
  to   { opacity: 1; }
`;

/** Spread into any sx that animates, so reduced-motion users get a still UI. */
export const reducedMotion = {
  '@media (prefers-reduced-motion: reduce)': { animation: 'none !important', transition: 'none !important' },
} as const;

export const ease = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
