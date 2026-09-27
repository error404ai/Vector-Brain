/**
 * What the agent is doing, step by step, readable at a glance: the action in
 * bold ("Opened bbc.co.uk/weather", "Typed “London”") and, under it, the AI's
 * reason for it. Used live beside the phone while a run goes, and as the full
 * list of steps once it has finished.
 */
import { ease, reducedMotion, typingDot } from '@/components/mission/motion';
import type { FeedStep, StepKind } from './steps';
import AppsRoundedIcon from '@mui/icons-material/AppsRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import HourglassEmptyRoundedIcon from '@mui/icons-material/HourglassEmptyRounded';
import KeyboardAltOutlinedIcon from '@mui/icons-material/KeyboardAltOutlined';
import LanguageRoundedIcon from '@mui/icons-material/LanguageRounded';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import SwapVertRoundedIcon from '@mui/icons-material/SwapVertRounded';
import TouchAppRoundedIcon from '@mui/icons-material/TouchAppRounded';
import UndoRoundedIcon from '@mui/icons-material/UndoRounded';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import { Box, Button, Typography } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import { useState } from 'react';

const stepIn = keyframes`
  0%   { opacity: 0; transform: translateY(-10px) scale(0.985); }
  100% { opacity: 1; transform: none; }
`;
const newGlow = keyframes`
  0%   { box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.3); }
  100% { box-shadow: 0 0 0 9px rgba(37, 99, 235, 0); }
`;

const TONE: Record<StepKind, { bg: string; fg: string }> = {
  app: { bg: '#ede9fe', fg: '#6d28d9' },
  url: { bg: '#dbeafe', fg: '#1d4ed8' },
  tap: { bg: '#e0f2fe', fg: '#0369a1' },
  type: { bg: '#fef3c7', fg: '#b45309' },
  scroll: { bg: '#f1f5f9', fg: '#475569' },
  nav: { bg: '#f1f5f9', fg: '#475569' },
  wait: { bg: '#f8fafc', fg: '#64748b' },
  look: { bg: '#f8fafc', fg: '#64748b' },
  settings: { bg: '#f1f5f9', fg: '#334155' },
  done: { bg: '#dcfce7', fg: '#15803d' },
  other: { bg: '#f1f5f9', fg: '#475569' },
};

function StepIcon({ kind }: { kind: StepKind }) {
  const sx = { fontSize: 19 };
  switch (kind) {
    case 'app':
      return <AppsRoundedIcon sx={sx} />;
    case 'url':
      return <LanguageRoundedIcon sx={sx} />;
    case 'tap':
      return <TouchAppRoundedIcon sx={sx} />;
    case 'type':
      return <KeyboardAltOutlinedIcon sx={sx} />;
    case 'scroll':
      return <SwapVertRoundedIcon sx={sx} />;
    case 'nav':
      return <UndoRoundedIcon sx={sx} />;
    case 'wait':
      return <HourglassEmptyRoundedIcon sx={sx} />;
    case 'settings':
      return <SettingsRoundedIcon sx={sx} />;
    case 'done':
      return <CheckRoundedIcon sx={sx} />;
    default:
      return <VisibilityOutlinedIcon sx={sx} />;
  }
}

function clock(at: number | null): string {
  if (!at) return '';
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const SHOWN = 60;

/**
 * The list itself. `order="live"` puts the newest on top and animates each
 * one in; `order="story"` reads top to bottom, as a finished run's record.
 */
export function StepFeed({
  steps,
  order,
  working = false,
  maxHeight,
  compact = false,
}: {
  steps: FeedStep[];
  order: 'live' | 'story';
  working?: boolean;
  maxHeight?: number | string | Record<string, number | string>;
  compact?: boolean;
}) {
  const [showOlder, setShowOlder] = useState(false);
  const newestFirst = order === 'live';
  const ordered = newestFirst ? [...steps].reverse() : steps;
  const hidden = showOlder ? 0 : Math.max(0, ordered.length - SHOWN);
  const visible = newestFirst ? ordered.slice(0, ordered.length - hidden) : ordered.slice(hidden);
  const newestKey = steps[steps.length - 1]?.key;

  const olderButton = hidden > 0 && (
    <Button size="small" onClick={() => setShowOlder(true)} sx={{ alignSelf: 'center', textTransform: 'none' }}>
      Show {hidden} earlier {hidden === 1 ? 'step' : 'steps'}
    </Button>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, overflowY: maxHeight ? 'auto' : 'visible', maxHeight, pr: maxHeight ? 0.5 : 0 }}>
      {!newestFirst && olderButton}
      {working && newestFirst && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: 1, borderRadius: 2.5, border: '1px dashed', borderColor: 'divider', bgcolor: 'action.hover' }}>
          <Box sx={{ width: 32, height: 32, borderRadius: 2, bgcolor: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '3px', flexShrink: 0 }}>
            {[0, 1, 2].map((i) => (
              <Box key={i} component="span" sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: '#4f46e5', animation: `${typingDot} 1.2s ${i * 0.15}s infinite`, ...reducedMotion }} />
            ))}
          </Box>
          <Typography sx={{ fontSize: 14.5, fontWeight: 600, color: '#4338ca' }}>Working on the next step…</Typography>
        </Box>
      )}
      {visible.map((step) => {
        const tone = step.failed ? { bg: '#fee2e2', fg: '#b91c1c' } : TONE[step.kind];
        const isNewest = newestFirst && step.key === newestKey && working;
        return (
          <Box
            key={step.key}
            sx={{
              display: 'flex',
              gap: 1.25,
              alignItems: 'flex-start',
              px: compact ? 1.25 : 1.5,
              py: compact ? 1 : 1.25,
              borderRadius: 2.5,
              border: '1px solid',
              borderColor: step.failed ? '#fecaca' : isNewest ? '#93c5fd' : 'divider',
              bgcolor: 'background.paper',
              boxShadow: isNewest ? '0 6px 18px rgba(37,99,235,.10)' : 'none',
              animation: newestFirst ? `${stepIn} 420ms ${ease}` : 'none',
              ...reducedMotion,
            }}
          >
            <Box
              sx={{
                width: compact ? 30 : 34,
                height: compact ? 30 : 34,
                borderRadius: 2,
                bgcolor: tone.bg,
                color: tone.fg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                animation: isNewest ? `${newGlow} 1.2s ease-out 2` : 'none',
                ...reducedMotion,
              }}
            >
              <StepIcon kind={step.kind} />
            </Box>
            <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 0.6 }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, minWidth: 0 }}>
                <Typography component="span" sx={{ fontSize: compact ? 14 : 15, fontWeight: 600, color: step.failed ? '#b91c1c' : 'text.secondary', whiteSpace: 'nowrap' }}>
                  {step.verb}
                </Typography>
                <Typography component="span" sx={{ fontSize: compact ? 14 : 15, fontWeight: 800, color: step.failed ? '#b91c1c' : 'text.primary', minWidth: 0, overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {step.target}
                </Typography>
                {step.failed && (
                  <Typography component="span" sx={{ fontSize: 11.5, fontWeight: 700, color: '#b91c1c', bgcolor: '#fee2e2', px: 1, py: 0.25, borderRadius: 99, whiteSpace: 'nowrap' }}>
                    Failed
                  </Typography>
                )}
                <Box sx={{ flex: 1 }} />
                <Typography component="span" sx={{ fontSize: 12, color: 'text.disabled', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  #{step.n}
                  {step.at ? (
                    <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                      {` · ${clock(step.at)}`}
                    </Box>
                  ) : null}
                </Typography>
              </Box>
              {(step.thought || step.error) && (
                <Box sx={{ fontSize: compact ? 13 : 14, lineHeight: 1.5, color: '#334155', bgcolor: isNewest ? '#eef2ff' : '#f5f7ff', borderRadius: 1.5, px: 1.25, py: 0.75, overflowWrap: 'anywhere' }}>
                  <Box component="span" sx={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '.06em', color: '#6366f1', mr: 0.75 }}>
                    WHY
                  </Box>
                  {step.thought || '—'}
                  {step.failed && step.error && (
                    <Box component="span" sx={{ display: 'block', mt: 0.5, color: '#b91c1c' }}>
                      {step.error}
                    </Box>
                  )}
                </Box>
              )}
            </Box>
          </Box>
        );
      })}
      {newestFirst && olderButton}
    </Box>
  );
}
