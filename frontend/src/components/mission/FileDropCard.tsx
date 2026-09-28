import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Box, ButtonBase, Typography } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import { useGetFleetStateQuery } from '@/RTKService/androidService/androidService';
import type { FileTransferStatus } from '@/RTKService/androidService/deviceFileService';
import { describeInstallStage } from '@/components/android/installStage';
import { dropInfo, fileBadge, formatSize, getDropState, retryFailed, subscribeDrop, type DropState } from './fileDrop';

/** Up to this many phones get a flip tile each; beyond it, the dot matrix. */
const TILE_LIMIT = 24;
/** Failed phones shown as tiles in the large view before "+N more". */
const ATTENTION_LIMIT = 12;

const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const INK = '#0E1630';
const MUTED = '#5D6785';
const LINE = '#E2E7F3';
const TONE = {
  saved: '#12C79A',
  failed: '#F0445A',
  queued: '#2F6BFF',
  receiving: '#7C5CFF',
  waiting: '#B5BFD4',
  sending: '#D6DDEC',
  expired: '#94A0BA',
} as const;

type PhoneState = keyof typeof TONE;

const LABEL: Record<PhoneState, string> = {
  saved: 'Saved',
  failed: 'Failed',
  queued: 'Queued',
  receiving: 'Receiving',
  waiting: 'Offline',
  sending: 'Sending',
  expired: 'Expired',
};

interface PhoneRow {
  id: number;
  name: string;
  state: PhoneState;
  detail: string | null;
  at: string | null;
}

const drift = keyframes`to { transform: translate(40px, 26px) scale(1.12); }`;
const slide = keyframes`from { transform: translateX(-100%); } to { transform: translateX(260%); }`;
const rise = keyframes`from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; }`;
const snooze = keyframes`50% { transform: translate(3px, -3px); opacity: .35; }`;

const reduced = { '@media (prefers-reduced-motion: reduce)': { '&, & *': { animation: 'none !important', transition: 'none !important' } } };

function phoneState(
  deviceId: number,
  state: DropState,
  online: Map<number, boolean>,
): { state: PhoneState; detail: string | null; at: string | null; row: FileTransferStatus | null } {
  const rowId = state.rowOf[deviceId];
  if (!rowId) return { state: 'sending', detail: null, at: null, row: null };
  if (state.gone[rowId]) return { state: 'expired', detail: 'No longer on the server', at: null, row: null };
  const row = state.status[rowId] ?? null;
  if (row?.status === 'DELIVERED') {
    const install = describeInstallStage(row.install_status);
    return { state: 'saved', detail: install ? install.label : null, at: row.delivered_at, row };
  }
  if (row?.status === 'FAILED') return { state: 'failed', detail: row.failure_message, at: null, row };
  if (row && row.download_attempts > 0) return { state: 'receiving', detail: null, at: null, row };
  return { state: online.get(deviceId) === false ? 'waiting' : 'queued', detail: null, at: null, row };
}

function sinceSend(at: string | null, sentAt: number): string {
  if (!at) return '';
  const secs = Math.max(0, (new Date(at).getTime() - sentAt) / 1000);
  return secs < 60 ? `${secs.toFixed(secs < 10 ? 1 : 0)}s` : `${Math.round(secs / 60)}m`;
}

/**
 * The chat card for a file sent from Mission Control. Upload % is the real
 * chunked upload; every phone's state comes from its transfer row (receipt,
 * failure message, download started) and the fleet's online flag. Up to 24
 * phones get a flip tile each; a bigger fleet is a dot matrix plus the phones
 * that need attention, so 500 phones stay one screen tall and light to render.
 */
function FileDropCard({ dropId, sentAt }: { dropId: string; sentAt: number }) {
  const state = useSyncExternalStore(
    (listener) => subscribeDrop(dropId, listener),
    () => getDropState(dropId),
  );
  const info = dropInfo(dropId);
  const { data: fleet } = useGetFleetStateQuery(undefined, { pollingInterval: state?.phase === 'queued' ? 15_000 : 0 });

  const online = useMemo(() => new Map((fleet?.data?.devices ?? []).map((d) => [d.id, d.online])), [fleet]);
  const phones: PhoneRow[] = useMemo(() => {
    if (!state || !info) return [];
    return info.targets.map((t) => {
      const s = phoneState(t.id, state, online);
      return { id: t.id, name: t.name, state: s.state, detail: s.detail, at: s.at };
    });
  }, [state, info, online]);

  const [showAll, setShowAll] = useState(false);

  if (!state || !info) {
    return (
      <Typography variant="body2" color="text.secondary">
        This file was sent from another tab or before a reload, so its live status is not available here.
      </Typography>
    );
  }

  const { file } = info;
  // Delivery times count from when the server had the file, not from the upload start.
  const since = state.queuedAt ?? sentAt;
  const badge = fileBadge(file);
  const counts = phones.reduce<Record<PhoneState, number>>(
    (acc, p) => ({ ...acc, [p.state]: acc[p.state] + 1 }),
    { saved: 0, failed: 0, queued: 0, receiving: 0, waiting: 0, sending: 0, expired: 0 },
  );
  const total = phones.length;
  const uploading = state.phase === 'hashing' || state.phase === 'uploading';
  const settledOnline = counts.saved + counts.failed;
  const reachable = total - counts.waiting - counts.expired;
  const small = total <= TILE_LIMIT;
  const allDone = !uploading && counts.queued + counts.receiving + counts.sending === 0;

  const title =
    state.phase === 'error'
      ? 'The file was not sent'
      : state.phase === 'hashing'
        ? 'Preparing the file'
        : uploading
          ? 'Uploading to your server'
          : allDone
            ? `Saved on ${counts.saved} of ${total} phone${total === 1 ? '' : 's'}`
            : `Sending to ${total} phone${total === 1 ? '' : 's'}`;

  const ringValue = uploading ? state.progress : reachable > 0 ? settledOnline / reachable : 0;
  const ringColor = uploading ? '#2F6BFF' : counts.failed > 0 && counts.saved === 0 ? TONE.failed : TONE.saved;
  const failedList = phones.filter((p) => p.state === 'failed');
  const firstFailure = failedList.find((p) => p.detail);

  return (
    <Box
      sx={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: '22px',
        p: { xs: 1.75, sm: 2.25 },
        color: INK,
        background: 'linear-gradient(135deg, rgba(255,255,255,.97), rgba(255,255,255,.86))',
        border: '1px solid #fff',
        boxShadow: '0 30px 60px -34px rgba(47,70,160,.45), inset 0 1px 0 #fff',
        animation: `${rise} 420ms cubic-bezier(.2,.8,.2,1)`,
        ...reduced,
      }}
    >
      {/* Colour behind the glass: animated only for a small fleet, still for a large one. */}
      {[
        { c: '#9DB8FF', s: 240, sx: { top: -90, right: -60 } },
        { c: '#FFC2D8', s: 210, sx: { bottom: -100, left: -60 } },
        { c: '#C8F3E4', s: 170, sx: { bottom: -70, right: '32%' } },
      ].map((b, i) => (
        <Box
          key={b.c}
          aria-hidden
          sx={{
            position: 'absolute',
            width: b.s,
            height: b.s,
            borderRadius: '50%',
            background: b.c,
            filter: 'blur(40px)',
            opacity: 0.5,
            pointerEvents: 'none',
            animation: small ? `${drift} ${12 + i * 3}s ease-in-out ${-i * 4}s infinite alternate` : 'none',
            ...b.sx,
          }}
        />
      ))}

      <Box sx={{ position: 'relative', display: 'flex', gap: 1.5, alignItems: 'center', mb: 2 }}>
        <Box
          sx={{
            flex: 'none',
            width: 44,
            height: 44,
            borderRadius: '13px',
            display: 'grid',
            placeItems: 'center',
            color: '#fff',
            font: `700 11px ${MONO}`,
            background: `linear-gradient(135deg, ${badge.from}, ${badge.to})`,
            boxShadow: `0 10px 20px -10px ${badge.from}`,
          }}
        >
          {badge.label}
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontWeight: 800, fontSize: 18, letterSpacing: '-0.02em', lineHeight: 1.2 }} noWrap>
            {title}
          </Typography>
          <Typography sx={{ font: `500 11.5px ${MONO}`, color: MUTED }} noWrap title={file.name}>
            {file.name} · {formatSize(file.size)} → Downloads/VectorAutomation
          </Typography>
        </Box>
      </Box>

      <Box sx={{ position: 'relative', display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'auto 1fr' }, gap: 2, alignItems: 'center', mb: 2 }}>
        <Box
          role="img"
          aria-label={uploading ? `Upload ${Math.round(state.progress * 100)} percent` : `${counts.saved} of ${total} saved`}
          sx={{
            width: 100,
            height: 100,
            borderRadius: '50%',
            justifySelf: { xs: 'center', sm: 'start' },
            display: 'grid',
            placeItems: 'center',
            position: 'relative',
            background: `conic-gradient(${ringColor} ${ringValue * 360}deg, #E9EDF7 0)`,
            transition: 'background 300ms',
            boxShadow: `0 14px 30px -16px ${ringColor}`,
            '&::before': { content: '""', position: 'absolute', inset: '9px', borderRadius: '50%', background: '#fff' },
          }}
        >
          <Box sx={{ position: 'relative', textAlign: 'center', fontWeight: 800, fontSize: 22, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
            {uploading ? `${Math.round(state.progress * 100)}%` : `${counts.saved}/${total}`}
            <Box sx={{ display: 'block', font: `600 9.5px ${MONO}`, letterSpacing: '.1em', color: MUTED, mt: 0.5 }}>
              {state.phase === 'hashing' ? 'CHECKING' : uploading ? 'UPLOAD' : 'SAVED'}
            </Box>
          </Box>
        </Box>
        <Box sx={{ display: 'grid', gap: 1 }}>
          <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
            {(['saved', 'receiving', 'queued', 'waiting', 'failed'] as PhoneState[])
              .filter((k) => k === 'saved' || k === 'failed' || counts[k] > 0)
              .map((k) => (
                <Box
                  key={k}
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.75,
                    font: `700 11.5px ${MONO}`,
                    px: 1.25,
                    py: 0.5,
                    borderRadius: 99,
                    bgcolor: '#fff',
                    border: `1px solid ${LINE}`,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  <Box component="span" sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: TONE[k] }} />
                  {counts[k]} {LABEL[k].toLowerCase()}
                </Box>
              ))}
          </Box>
          <Typography sx={{ font: `500 11.5px ${MONO}`, color: MUTED }}>
            {total} × {formatSize(file.size)} = {formatSize(file.size * total)} leaves your server as phones download it
          </Typography>
        </Box>
      </Box>

      {small ? (
        <Tiles phones={phones} sentAt={since} />
      ) : (
        <>
          <DotMatrix phones={phones} />
          {failedList.length > 0 && (
            <Box sx={{ mt: 1.5 }}>
              <Typography sx={{ font: `700 10.5px ${MONO}`, letterSpacing: '.12em', color: MUTED, mb: 1 }}>NEEDS ATTENTION</Typography>
              <Tiles phones={failedList.slice(0, ATTENTION_LIMIT)} sentAt={since} />
              {failedList.length > ATTENTION_LIMIT && (
                <Typography sx={{ font: `600 11.5px ${MONO}`, color: MUTED, mt: 1 }}>+{failedList.length - ATTENTION_LIMIT} more failed</Typography>
              )}
            </Box>
          )}
          <ButtonBase
            onClick={() => setShowAll((v) => !v)}
            sx={{ mt: 1.5, font: `700 12px ${MONO}`, color: '#2F6BFF', borderRadius: 1, '&:focus-visible': { outline: '2px solid #2F6BFF' } }}
          >
            {showAll ? 'Hide the list' : `Show all ${total} phones`}
          </ButtonBase>
          {showAll && <PhoneList phones={phones} sentAt={since} />}
        </>
      )}

      {state.phase === 'error' && state.error && <Notice>{state.error}</Notice>}
      {firstFailure && (
        <Notice>
          <b>{firstFailure.name}:</b> {firstFailure.detail}
          {failedList.length > 1 ? ` (and ${failedList.length - 1} more)` : ''}
        </Notice>
      )}

      <Box sx={{ position: 'relative', mt: 1.75, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography sx={{ font: `500 11.5px ${MONO}`, color: MUTED }}>
          {uploading
            ? state.phase === 'hashing'
              ? 'Checking the file before upload'
              : `Uploading ${formatSize(file.size * state.progress)} of ${formatSize(file.size)}`
            : state.phase === 'error'
              ? 'Nothing was queued'
              : counts.waiting > 0
                ? 'Offline phones get it when they reconnect · kept 7 days'
                : allDone
                  ? 'Done'
                  : 'On the server · waiting for the phones'}
        </Typography>
        {counts.failed > 0 && !uploading && (
          <ButtonBase
            onClick={() => retryFailed(dropId)}
            sx={{
              font: '700 12px inherit',
              px: 1.5,
              py: 0.75,
              borderRadius: '10px',
              bgcolor: INK,
              color: '#fff',
              transition: 'transform 160ms',
              '&:hover': { transform: 'translateY(-1px)' },
              '&:focus-visible': { outline: '2px solid #2F6BFF', outlineOffset: 2 },
            }}
          >
            Retry {counts.failed} failed
          </ButtonBase>
        )}
      </Box>
    </Box>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        position: 'relative',
        mt: 1.5,
        px: 1.5,
        py: 1.25,
        borderRadius: '12px',
        bgcolor: '#FFF0F3',
        border: '1px solid #FFD0D9',
        color: '#A3182E',
        fontSize: 13,
        animation: `${rise} 400ms cubic-bezier(.2,.8,.2,1)`,
        '& b': { color: '#7A0F20' },
      }}
    >
      {children}
    </Box>
  );
}

const CHECK = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </svg>
);
const CROSS = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" aria-hidden>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

/** One glass tile per phone that flips over in 3D when its file lands or fails. */
function Tiles({ phones, sentAt }: { phones: PhoneRow[]; sentAt: number }) {
  return (
    <Box sx={{ position: 'relative', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))', gap: 1.25, perspective: '900px' }}>
      {phones.map((p) => {
        const flipped = p.state === 'saved' || p.state === 'failed';
        const busy = p.state === 'queued' || p.state === 'receiving' || p.state === 'sending';
        return (
          <Box
            key={p.id}
            title={p.detail ? `${p.name}: ${p.detail}` : p.name}
            sx={{
              height: 78,
              position: 'relative',
              transformStyle: 'preserve-3d',
              transition: 'transform 800ms cubic-bezier(.3,1.4,.4,1)',
              transform: flipped ? 'rotateY(180deg)' : 'none',
              '& > div': {
                position: 'absolute',
                inset: 0,
                borderRadius: '16px',
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                p: '10px 11px',
                display: 'grid',
                alignContent: 'space-between',
              },
            }}
          >
            <Box
              sx={{
                background:
                  p.state === 'waiting' || p.state === 'expired'
                    ? 'repeating-linear-gradient(135deg, rgba(255,255,255,.85) 0 8px, rgba(238,241,248,.85) 8px 16px)'
                    : 'rgba(255,255,255,.9)',
                border: `1px ${p.state === 'waiting' || p.state === 'expired' ? 'dashed' : 'solid'} ${busy ? '#C7D6FF' : LINE}`,
                boxShadow: busy ? '0 0 0 3px rgba(47,107,255,.08), 0 8px 18px -12px rgba(47,107,255,.6)' : '0 8px 18px -14px rgba(14,22,48,.4)',
              }}
            >
              <Typography sx={{ fontWeight: 700, fontSize: 12.5 }} noWrap>
                {p.name}
              </Typography>
              <Box sx={{ height: 4, borderRadius: 4, bgcolor: '#EEF1F8', overflow: 'hidden', position: 'relative' }}>
                {busy && (
                  <Box
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      width: '40%',
                      background: `linear-gradient(90deg, transparent, ${TONE[p.state]}, transparent)`,
                      animation: `${slide} 1.1s ease-in-out infinite`,
                    }}
                  />
                )}
              </Box>
              <Box sx={{ font: `700 10px ${MONO}`, letterSpacing: '.06em', color: busy ? TONE[p.state] : '#94A0BA', display: 'flex', gap: 0.75 }}>
                {LABEL[p.state].toUpperCase()}
                {p.state === 'waiting' && (
                  <Box component="span" sx={{ fontSize: 9, animation: `${snooze} 2s ease-in-out infinite` }}>
                    z z
                  </Box>
                )}
              </Box>
            </Box>
            <Box
              sx={{
                transform: 'rotateY(180deg)',
                color: '#fff',
                background:
                  p.state === 'failed'
                    ? 'linear-gradient(135deg, #FF6B81, #F0445A 60%, #C2185B)'
                    : 'linear-gradient(135deg, #12C79A, #0EA5A0 60%, #2F6BFF)',
                boxShadow: `0 14px 28px -14px ${p.state === 'failed' ? TONE.failed : TONE.saved}`,
              }}
            >
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontWeight: 800, fontSize: 17, lineHeight: 1 }}>
                {p.state === 'failed' ? CROSS : CHECK}
                {p.state === 'failed' ? 'Failed' : p.detail ?? 'Saved'}
                {p.state === 'saved' && p.at && (
                  <Box component="span" sx={{ font: `600 10.5px ${MONO}`, opacity: 0.85 }}>
                    {sinceSend(p.at, sentAt)}
                  </Box>
                )}
              </Box>
              <Typography sx={{ fontWeight: 700, fontSize: 12.5, opacity: 0.9 }} noWrap>
                {p.name}
              </Typography>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * Every phone as one square on a single canvas: 500 phones cost one element,
 * not 500. Squares that are still moving breathe; the loop stops when nothing
 * is moving or the card is off screen.
 */
function DotMatrix({ phones }: { phones: PhoneRow[] }) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number; p: PhoneRow } | null>(null);
  const phonesRef = useRef(phones);
  const layoutRef = useRef({ cols: 1, cell: 14, gap: 4 });

  useEffect(() => {
    phonesRef.current = phones;
  }, [phones]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let raf = 0;
    let visible = true;

    const draw = (now: number) => {
      const list = phonesRef.current;
      const width = wrap.clientWidth;
      const cell = list.length > 300 ? 11 : 14;
      const gap = list.length > 300 ? 3 : 4;
      const cols = Math.max(1, Math.floor((width + gap) / (cell + gap)));
      const rows = Math.ceil(list.length / cols);
      const height = rows * (cell + gap) - gap;
      layoutRef.current = { cols, cell, gap };
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.style.height = `${height}px`;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      let moving = false;
      list.forEach((p, i) => {
        const x = (i % cols) * (cell + gap);
        const y = Math.floor(i / cols) * (cell + gap);
        const busy = p.state === 'queued' || p.state === 'receiving' || p.state === 'sending';
        moving ||= busy;
        ctx.globalAlpha = busy && !still ? 0.55 + 0.45 * Math.abs(Math.sin(now / 520 + i * 0.37)) : 1;
        ctx.fillStyle = TONE[p.state];
        ctx.beginPath();
        ctx.roundRect(x, y, cell, cell, 3);
        ctx.fill();
        if (p.state === 'waiting' || p.state === 'expired') {
          ctx.globalAlpha = 1;
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.roundRect(x + 3, y + 3, cell - 6, cell - 6, 2);
          ctx.fill();
        }
      });
      ctx.globalAlpha = 1;
      raf = moving && visible && !still ? requestAnimationFrame(draw) : 0;
    };

    const kick = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) kick();
    });
    io.observe(wrap);
    const ro = new ResizeObserver(kick);
    ro.observe(wrap);
    kick();
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
    };
  }, [phones]);

  const onMove = (event: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const { cols, cell, gap } = layoutRef.current;
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const col = Math.floor(x / (cell + gap));
    const row = Math.floor(y / (cell + gap));
    const index = row * cols + col;
    const p = col < cols ? phonesRef.current[index] : undefined;
    setHover(p ? { x, y, p } : null);
  };

  return (
    <Box ref={wrapRef} sx={{ position: 'relative' }}>
      <canvas
        ref={canvasRef}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        role="img"
        aria-label={`${phones.length} phones, one square each, coloured by status`}
        style={{ width: '100%', display: 'block' }}
      />
      {hover && (
        <Box
          sx={{
            position: 'absolute',
            left: Math.min(hover.x + 12, (wrapRef.current?.clientWidth ?? 300) - 200),
            top: hover.y + 14,
            zIndex: 3,
            pointerEvents: 'none',
            bgcolor: INK,
            color: '#fff',
            px: 1.25,
            py: 0.75,
            borderRadius: '10px',
            fontSize: 12,
            maxWidth: 240,
            boxShadow: '0 10px 24px -10px rgba(14,22,48,.6)',
          }}
        >
          <b>{hover.p.name}</b> · {LABEL[hover.p.state]}
          {hover.p.detail ? <Box sx={{ opacity: 0.8, mt: 0.25 }}>{hover.p.detail}</Box> : null}
        </Box>
      )}
      <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mt: 1, font: `600 10.5px ${MONO}`, color: MUTED }}>
        {(['saved', 'receiving', 'queued', 'waiting', 'failed'] as PhoneState[]).map((k) => (
          <Box key={k} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
            <Box component="span" sx={{ width: 9, height: 9, borderRadius: '3px', bgcolor: TONE[k] }} />
            {LABEL[k]}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/** Plain list, rendered only when opened; off-screen rows are skipped by the browser. */
function PhoneList({ phones, sentAt }: { phones: PhoneRow[]; sentAt: number }) {
  return (
    <Box sx={{ mt: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', columnGap: 2, maxHeight: 360, overflowY: 'auto', pr: 0.5 }}>
      {phones.map((p) => (
        <Box
          key={p.id}
          title={p.detail ?? undefined}
          sx={{ display: 'grid', gridTemplateColumns: '10px 1fr auto', gap: 1, alignItems: 'center', py: 0.5, fontSize: 12.5, contentVisibility: 'auto', containIntrinsicSize: '0 26px' }}
        >
          <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: TONE[p.state] }} />
          <Typography sx={{ fontSize: 12.5, fontWeight: 600 }} noWrap>
            {p.name}
          </Typography>
          <Box sx={{ font: `600 10.5px ${MONO}`, color: p.state === 'failed' ? TONE.failed : p.state === 'saved' ? '#0B9A77' : MUTED }}>
            {p.state === 'saved' && p.at ? `✓ ${sinceSend(p.at, sentAt)}` : LABEL[p.state].toLowerCase()}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

export default memo(FileDropCard);
