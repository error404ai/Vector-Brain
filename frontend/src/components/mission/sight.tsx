/**
 * Whether the AI saw the phone's screen as an image — per step, per run and
 * before a run starts. The server decides (screenSight.ts); this file only
 * shows it, so neither the owner nor the user has to guess.
 */
import BlockRoundedIcon from '@mui/icons-material/BlockRounded';
import ImageSearchRoundedIcon from '@mui/icons-material/ImageSearchRounded';
import PhotoCameraRoundedIcon from '@mui/icons-material/PhotoCameraRounded';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import { Box, Tooltip, Typography } from '@mui/material';
import type { AgentSightStatus } from '@/RTKService/androidService/engineService';

export type SightSeen = 'ai' | 'helper' | 'none';
export type SightWhy = 'model_text_only' | 'setting_off' | 'setting_stuck' | 'no_frame' | 'not_needed' | 'failed';
export interface StepSight {
  seen: SightSeen;
  why?: SightWhy | null;
}
export interface RunSight {
  ai: number;
  helper: number;
  none: number;
  why: SightWhy | null;
  model: string | null;
  model_sees: boolean;
  helper_model: string | null;
}

export const WHY_TEXT: Record<SightWhy, string> = {
  model_text_only: 'The AI model is text-only and no vision helper is set',
  setting_off: 'Screenshots are off in Settings',
  setting_stuck: 'Settings send screenshots only when the AI is stuck',
  no_frame: 'The phone is not sharing its screen',
  not_needed: 'The element list described this screen',
  failed: 'The action failed before a new screen was read',
};

const shortModel = (m: string | null | undefined) => (m ?? 'this model').split('/').pop() ?? 'this model';

/** The small mark on each step: 📷 AI saw it, 🔍 helper read it, ⊘ no image (hover says why). */
export function StepSightMark({ sight }: { sight?: StepSight | null }) {
  if (!sight) return null;
  const tone =
    sight.seen === 'ai'
      ? { fg: '#15803d', bg: '#dcfce7', icon: <PhotoCameraRoundedIcon sx={{ fontSize: 13 }} />, title: 'AI saw this screen as an image' }
      : sight.seen === 'helper'
        ? { fg: '#b45309', bg: '#fef3c7', icon: <ImageSearchRoundedIcon sx={{ fontSize: 13 }} />, title: 'The vision helper read this screen for the AI' }
        : {
            fg: sight.why === 'model_text_only' || sight.why === 'no_frame' ? '#b91c1c' : '#94a3b8',
            bg: sight.why === 'model_text_only' || sight.why === 'no_frame' ? '#fee2e2' : '#f1f5f9',
            icon: <BlockRoundedIcon sx={{ fontSize: 13 }} />,
            title: `No image went to the AI — ${(sight.why ? WHY_TEXT[sight.why] : 'no reason recorded').toLowerCase()}`,
          };
  return (
    <Tooltip title={tone.title}>
      <Box
        component="span"
        aria-label={tone.title}
        sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 20, height: 20, borderRadius: '50%', color: tone.fg, bgcolor: tone.bg, flexShrink: 0, alignSelf: 'center' }}
      >
        {tone.icon}
      </Box>
    </Tooltip>
  );
}

/** "Screens seen by AI: 6" — or plainly why none are being seen. Live while a run goes. */
export function SightCounter({ run, finished = false }: { run?: RunSight | null; finished?: boolean }) {
  if (!run) return null;
  const seen = run.ai + run.helper;
  const blind = !run.model_sees && !run.helper_model;
  const state =
    seen > 0
      ? { tone: 'ok' as const, text: run.helper && !run.ai ? `Screens read by helper: ${run.helper}` : `Screens seen by AI: ${seen}` }
      : blind
        ? { tone: 'bad' as const, text: `AI can't see screens — ${shortModel(run.model)} is text-only` }
        : run.why === 'no_frame'
          ? { tone: 'bad' as const, text: 'Screens: phone not sharing' }
          : run.why === 'setting_off'
            ? { tone: 'muted' as const, text: 'Screens: off in Settings' }
            : { tone: 'muted' as const, text: finished ? 'Screens seen by AI: 0' : 'Screens seen by AI: 0 so far' };
  const color = state.tone === 'ok' ? '#15803d' : state.tone === 'bad' ? '#b91c1c' : '#64748b';
  const bg = state.tone === 'ok' ? '#f0fdf4' : state.tone === 'bad' ? '#fef2f2' : '#f8fafc';
  const tip = blind
    ? 'No screenshot reaches the AI on this run: the model reads only the element list. Add a vision helper (Settings → Agent engine) or pick a model that sees screenshots.'
    : run.why === 'no_frame'
      ? 'The phone is not sending its screen, so there is nothing to show the AI. Turn screen sharing on in the Vector app.'
      : 'How many times the AI looked at the phone screen as an image in this run.';
  return (
    <Tooltip title={tip}>
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.6, px: 1, py: 0.35, borderRadius: 99, bgcolor: bg, border: '1px solid', borderColor: `${color}33` }}>
        {state.tone === 'bad' ? <VisibilityOffRoundedIcon sx={{ fontSize: 15, color }} /> : <VisibilityRoundedIcon sx={{ fontSize: 15, color }} />}
        <Typography component="span" sx={{ fontSize: 12.5, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>
          {state.text}
        </Typography>
      </Box>
    </Tooltip>
  );
}

/** Adds up several runs (a mission's phones) into one counter. */
export function sumSight(runs: (RunSight | null | undefined)[]): RunSight | null {
  const list = runs.filter((r): r is RunSight => Boolean(r));
  if (!list.length) return null;
  const total: RunSight = { ai: 0, helper: 0, none: 0, why: null, model: list[0].model, model_sees: list.some((r) => r.model_sees), helper_model: list.find((r) => r.helper_model)?.helper_model ?? null };
  const whys = new Map<SightWhy, number>();
  for (const r of list) {
    total.ai += r.ai;
    total.helper += r.helper;
    total.none += r.none;
    if (r.why) whys.set(r.why, (whys.get(r.why) ?? 0) + r.none);
  }
  total.why = [...whys.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  return total;
}

/**
 * Next to the composer: can the AI see the phone's screen on the next run?
 * 🟢 the model sees screenshots · 🟡 text-only, a vision helper reads them ·
 * 🔴 text-only, screenshots won't be seen (with a way to fix it).
 */
export function AgentSightChip({ status, onFix }: { status?: AgentSightStatus | null; onFix: () => void }) {
  if (!status) return null;
  const model = shortModel(status.model);
  const tone =
    status.capability === 'sees'
      ? { dot: '#16a34a', fg: '#15803d', bg: '#f0fdf4', label: 'Sees screens', tip: `${model} reads screenshots of the phone.` }
      : status.capability === 'helper'
        ? { dot: '#d97706', fg: '#b45309', bg: '#fffbeb', label: 'Text only + vision helper', tip: `${model} is text-only; ${shortModel(status.helper_model)} reads the screenshots for it.` }
        : { dot: '#dc2626', fg: '#b91c1c', bg: '#fef2f2', label: "Text only — screenshots won't be seen", tip: `${model} can't read images and no vision helper is set, so screenshots never reach the AI. On screens the element list can't describe (ChatGPT, games, web views) it taps blind.` };
  const off = status.screenshots === 'off';
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
      <Tooltip title={`${tone.tip}${off ? ' Screenshots are off in Settings.' : ''}`}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, height: 24, px: 1, borderRadius: 99, bgcolor: tone.bg, border: '1px solid', borderColor: `${tone.dot}40` }}>
          <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: tone.dot, boxShadow: `0 0 0 3px ${tone.dot}22` }} />
          <Typography component="span" sx={{ fontSize: 12, fontWeight: 700, color: tone.fg, whiteSpace: 'nowrap' }}>
            {tone.label}
            {off ? ' · off' : ''}
          </Typography>
        </Box>
      </Tooltip>
      {status.capability === 'blind' && (
        <Box component="button" type="button" onClick={onFix} sx={{ all: 'unset', cursor: 'pointer', fontSize: 12, fontWeight: 700, color: 'primary.main', px: 0.5, borderRadius: 1, '&:hover': { textDecoration: 'underline' }, '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' } }}>
          Add vision helper
        </Box>
      )}
    </Box>
  );
}
