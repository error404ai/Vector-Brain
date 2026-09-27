import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import { Box, ButtonBase, keyframes, useMediaQuery } from '@mui/material';
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { EMAIL, EMPTY, OF, parse, type Block, type Item } from './chatText';

/**
 * "Mission Board": Vector's list replies (fleet status, saved emails, results)
 * drawn as a dark control-room panel instead of raw text.
 *
 * The fleet chat prompt keeps the model to plain text, **bold** and "- "
 * bullets (VectorAgentService), which chatText.parse turns into a title,
 * sections (lanes) and rows. Here that becomes:
 *   - a big count that ticks up, from "Title (22 of 23)"
 *   - one light per phone that switches on in sequence
 *   - lanes as tabs with a sliding indicator
 *   - rows with a status light, the phone and its value (emails tap to copy)
 *
 * Animation runs only when `animate` is set (the newest reply), so scrolling
 * back through history does not replay it, and never under reduced motion.
 * Memoised on the text: the chat re-renders on every live frame.
 */

type Tone = 'ok' | 'bad' | 'warn' | 'none' | 'email' | 'text';

const INK = '#0B1220';
const TONE_COLOR: Record<'ok' | 'bad' | 'warn', string> = { ok: '#10B981', bad: '#EF4444', warn: '#F59E0B' };
const MONO = '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
const MAX_CELLS = 120;
const PREVIEW = 8;

function toneOf(value?: string): Tone {
  if (!value) return 'text';
  const v = value.replace(/\.$/, '').trim();
  if (v.match(EMAIL)) return 'email';
  if (EMPTY.test(v)) return 'none';
  if (/^(online|ready|done|ok|passed|success(ful)?|connected|idle)$/i.test(v)) return 'ok';
  if (/^(offline|failed|error|disconnected|blocked)$/i.test(v)) return 'bad';
  if (/^(needs setup|busy|queued|pending|low battery|stopped|running|in progress)$/i.test(v)) return 'warn';
  return 'text';
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function inline(text: string): ReactNode {
  if (!/\*\*|`/.test(text)) return text;
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <b key={i}>{part.slice(2, -2)}</b>;
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2)
      return (
        <Box key={i} component="code" sx={{ fontFamily: MONO, fontSize: '0.9em', px: 0.5, borderRadius: 0.5, bgcolor: 'rgba(255,255,255,.08)' }}>
          {part.slice(1, -1)}
        </Box>
      );
    return part;
  });
}

const rise = keyframes`from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}`;
const panelIn = keyframes`from{opacity:0;transform:translateY(10px) scale(.985)}to{opacity:1;transform:none}`;
const pulse = keyframes`0%{box-shadow:0 0 0 0 rgba(16,185,129,.6)}100%{box-shadow:0 0 0 7px rgba(16,185,129,0)}`;
const lightUp = (c: string) => keyframes`from{background:#1E293B;border-color:#334155;box-shadow:none}to{background:${c};border-color:${c};box-shadow:0 0 12px ${c}B3}`;
const LIGHT = { ok: lightUp('#10B981'), bad: lightUp('#EF4444'), warn: lightUp('#F59E0B') };

function Dot({ tone, animate }: { tone: Tone; animate: boolean }) {
  const c = tone === 'bad' ? TONE_COLOR.bad : tone === 'warn' ? TONE_COLOR.warn : TONE_COLOR.ok;
  return (
    <Box
      component="span"
      aria-hidden
      sx={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        bgcolor: c,
        flexShrink: 0,
        animation: animate && tone !== 'bad' && tone !== 'warn' ? `${pulse} 1.8s ease-out infinite` : undefined,
      }}
    />
  );
}

function CountUp({ to, animate }: { to: number; animate: boolean }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!animate) return;
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / 900);
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, animate]);
  return <>{animate ? n : to}</>;
}

function CopyValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <ButtonBase
      aria-label={`Copy ${value}`}
      onClick={() => {
        navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            toast.success('Copied', { id: 'board-copy', duration: 1200 });
            window.setTimeout(() => setCopied(false), 1200);
          },
          () => toast.error('Could not copy', { id: 'board-copy' }),
        );
      }}
      sx={{
        justifyContent: 'flex-start',
        gap: 0.75,
        maxWidth: '100%',
        minWidth: 0,
        borderRadius: 1,
        fontFamily: MONO,
        fontSize: 12.5,
        color: '#67E8F9',
        '&:hover': { color: '#A5F3FC' },
        '&:focus-visible': { outline: '2px solid #67E8F9', outlineOffset: 2 },
      }}
    >
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
        {value}
      </Box>
      {copied ? <CheckRoundedIcon sx={{ fontSize: 14, color: '#6EE7B7' }} /> : <ContentCopyRoundedIcon sx={{ fontSize: 13, opacity: 0.6 }} />}
    </ButtonBase>
  );
}

function Value({ value }: { value: string }) {
  const clean = value.replace(/\.$/, '').trim();
  const emails = clean.match(EMAIL);
  if (emails && emails.length) {
    return (
      <Box sx={{ display: 'grid', gap: 0.25, minWidth: 0 }}>
        {emails.map((e) => (
          <CopyValue key={e} value={e} />
        ))}
      </Box>
    );
  }
  const tone = toneOf(clean);
  const color = tone === 'none' ? '#94A3B8' : tone === 'bad' ? '#FCA5A5' : tone === 'warn' ? '#FCD34D' : tone === 'ok' ? '#6EE7B7' : '#CBD5E1';
  return (
    <Box component="span" sx={{ fontFamily: tone === 'text' ? undefined : MONO, fontSize: tone === 'text' ? 13.5 : 12.5, fontWeight: tone === 'text' ? 400 : 600, color, overflowWrap: 'anywhere' }}>
      {tone === 'none' ? 'No email saved' : tone === 'text' ? inline(clean) : cap(clean)}
    </Box>
  );
}

function Rows({ items, animate }: { items: Item[]; animate: boolean }) {
  const [open, setOpen] = useState(items.length <= PREVIEW + 2);
  const shown = open ? items : items.slice(0, PREVIEW);
  return (
    <Box>
      {shown.map((it, i) => {
        const tone = toneOf(it.right);
        return (
          <Box
            key={`${it.left}-${i}`}
            sx={{
              display: 'grid',
              gridTemplateColumns: '10px minmax(0, 1fr)',
              columnGap: 1.25,
              rowGap: 0.25,
              alignItems: 'center',
              py: 1.1,
              px: 0.5,
              borderBottom: '1px solid rgba(148,163,184,.14)',
              animation: animate ? `${rise} 380ms cubic-bezier(.2,.8,.2,1) ${Math.min(i, 12) * 50}ms both` : undefined,
            }}
          >
            {it.n ? (
              <Box component="span" sx={{ gridRow: it.right !== undefined ? 'span 2' : 'auto', fontFamily: MONO, fontSize: 11, color: '#93C5FD' }}>
                {it.n}
              </Box>
            ) : (
              <Box sx={{ gridRow: it.right !== undefined ? 'span 2' : 'auto', display: 'grid', placeItems: 'center' }}>
                <Dot tone={tone} animate={animate} />
              </Box>
            )}
            <Box component="span" sx={{ fontWeight: 600, fontSize: 14, color: '#F1F5F9', overflowWrap: 'anywhere', lineHeight: 1.35 }}>
              {inline(it.left)}
            </Box>
            {it.right !== undefined && <Value value={it.right} />}
          </Box>
        );
      })}
      {!open && (
        <ButtonBase
          onClick={() => setOpen(true)}
          sx={{ width: '100%', py: 1.1, fontSize: 13, fontWeight: 700, color: '#BFDBFE', borderRadius: 1.5, '&:hover': { bgcolor: 'rgba(255,255,255,.05)' } }}
        >
          Show all {items.length}
        </ButtonBase>
      )}
    </Box>
  );
}

function Tabs({ sections, active, onPick }: { sections: Extract<Block, { type: 'section' }>[]; active: number; onPick: (i: number) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  // Measured straight onto the indicator: tab widths depend on the lane names.
  useLayoutEffect(() => {
    const el = wrap.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[active];
    if (!el || !bar.current) return;
    bar.current.style.width = `${el.offsetWidth}px`;
    bar.current.style.transform = `translateX(${el.offsetLeft}px)`;
    bar.current.style.opacity = '1';
  }, [active, sections.length]);
  return (
    <Box
      ref={wrap}
      role="tablist"
      sx={{ position: 'relative', display: 'flex', gap: 0.5, p: 0.5, borderRadius: 2, bgcolor: 'rgba(255,255,255,.06)', overflowX: 'auto', scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}
    >
      <Box
        ref={bar}
        component="span"
        aria-hidden
        sx={{ position: 'absolute', top: 4, bottom: 4, left: 0, opacity: 0, bgcolor: '#E2E8F0', borderRadius: 1.5, transition: 'transform 350ms cubic-bezier(.2,.8,.2,1), width 350ms cubic-bezier(.2,.8,.2,1)' }}
      />
      {sections.map((s, i) => (
        <ButtonBase
          key={`${s.title}-${i}`}
          role="tab"
          aria-selected={i === active}
          onClick={() => onPick(i)}
          sx={{
            position: 'relative',
            flex: '1 0 auto',
            px: 1.5,
            py: 1,
            borderRadius: 1.5,
            fontSize: 13,
            fontWeight: 700,
            whiteSpace: 'nowrap',
            color: i === active ? INK : '#94A3B8',
            transition: 'color 200ms',
            '&:focus-visible': { outline: '2px solid #93C5FD', outlineOffset: 1 },
          }}
        >
          {s.title ?? `List ${i + 1}`} · {s.items.length}
        </ButtonBase>
      ))}
    </Box>
  );
}

export default memo(function MissionBoardReply({ text, animate = false }: { text: string; animate?: boolean }) {
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const motion = animate && !reduced;
  const blocks = useMemo(() => parse(text ?? ''), [text]);
  const [active, setActive] = useState(0);

  const { sections, of, heading, sectionOf, before, after, cells } = useMemo(() => {
    const sections = blocks.filter((b): b is Extract<Block, { type: 'section' }> => b.type === 'section');
    const titleBlock = blocks.find((b): b is Extract<Block, { type: 'title' }> => b.type === 'title');
    // "Online phones (22 of 23):" straight above a single list is that list's title.
    const sectionOf = !titleBlock && sections[0]?.title ? OF.exec(sections[0].title) : null;
    const of = titleBlock?.of ?? (sectionOf ? ([Number(sectionOf[1]), Number(sectionOf[2])] as [number, number]) : undefined);
    const heading = (titleBlock?.text ?? (sectionOf ? sections[0].title : undefined) ?? 'Report').replace(OF, '').trim();
    const firstSection = blocks.findIndex((b) => b.type === 'section');
    const paras = (pick: (i: number) => boolean) =>
      blocks.filter((b, i): b is Extract<Block, { type: 'p' }> => b.type === 'p' && pick(i));
    const before = paras((i) => i < firstSection);
    const after = paras((i) => i > firstSection);

    // One light per phone: from "x of y" when given, otherwise from each row's status.
    let cells: ('ok' | 'bad' | 'warn')[] = [];
    if (of && of[1] > 0) {
      const total = Math.min(of[1], MAX_CELLS);
      const on = Math.round((of[0] / of[1]) * total);
      cells = Array.from({ length: total }, (_, i) => (i < on ? 'ok' : 'bad'));
    } else {
      const tones = sections.flatMap((s) => s.items.map((it) => toneOf(it.right)));
      const status = tones.filter((t): t is 'ok' | 'bad' | 'warn' => t === 'ok' || t === 'bad' || t === 'warn');
      if (status.length >= 2 && status.length >= tones.length / 2) cells = status.slice(0, MAX_CELLS);
    }
    return { sections, of, heading, sectionOf, before, after, cells };
  }, [blocks]);

  const current = sections[Math.min(active, sections.length - 1)];
  const cellStep = cells.length > 40 ? 18 : 70;

  return (
    <Box
      sx={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: '22px 22px 22px 6px',
        p: 2,
        display: 'grid',
        gap: 1.75,
        color: '#E2E8F0',
        background: `radial-gradient(120% 80% at 0% 0%, #1E3A8A 0%, ${INK} 55%)`,
        boxShadow: '0 24px 48px -24px rgba(11,18,32,.8)',
        animation: motion ? `${panelIn} 420ms cubic-bezier(.2,.8,.2,1) both` : undefined,
        '&::after': {
          content: '""',
          position: 'absolute',
          inset: 0,
          pointerEvents: 'none',
          background: 'repeating-linear-gradient(0deg, rgba(255,255,255,.025) 0 1px, transparent 1px 4px)',
        },
        '& > *': { position: 'relative', zIndex: 1 },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, fontFamily: MONO, fontSize: 10.5, letterSpacing: '.16em', textTransform: 'uppercase', color: '#93C5FD' }}>
        <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {heading}
        </Box>
        {of && (
          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, color: '#6EE7B7', flexShrink: 0 }}>
            <Dot tone="ok" animate={motion} />
            Live
          </Box>
        )}
      </Box>

      {before.map((p, i) => (
        <Box key={`b${i}`} sx={{ fontSize: 14, color: '#CBD5E1', whiteSpace: 'pre-wrap' }}>
          {inline(p.text)}
        </Box>
      ))}

      {of && (
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
          <Box
            component="span"
            sx={{
              fontWeight: 800,
              fontSize: 56,
              lineHeight: 0.9,
              letterSpacing: '-0.03em',
              fontVariantNumeric: 'tabular-nums',
              background: 'linear-gradient(180deg, #FFFFFF, #93C5FD)',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            <CountUp to={of[0]} animate={motion} />
          </Box>
          <Box component="span" sx={{ color: '#94A3B8', fontSize: 15 }}>
            / {of[1]} {heading.toLowerCase().includes('online') ? 'phones online' : ''}
          </Box>
        </Box>
      )}

      {cells.length > 0 && (
        <Box aria-hidden sx={{ display: 'grid', gridTemplateColumns: `repeat(${cells.length > 48 ? 20 : 12}, minmax(0, 1fr))`, gap: '5px' }}>
          {cells.map((c, i) => (
            <Box
              key={i}
              sx={{
                aspectRatio: cells.length > 48 ? '1' : '.55',
                borderRadius: '4px',
                border: '1px solid',
                borderColor: TONE_COLOR[c],
                bgcolor: TONE_COLOR[c],
                boxShadow: `0 0 12px ${TONE_COLOR[c]}B3`,
                animation: motion ? `${LIGHT[c]} 300ms ease ${250 + i * cellStep}ms both` : undefined,
              }}
            />
          ))}
        </Box>
      )}

      {sections.length > 1 && <Tabs sections={sections} active={Math.min(active, sections.length - 1)} onPick={setActive} />}
      {sections.length === 1 && sections[0].title && !sectionOf && (
        <Box sx={{ fontWeight: 700, fontSize: 15, color: '#F8FAFC' }}>
          {inline(sections[0].title)} <Box component="span" sx={{ color: '#94A3B8', fontWeight: 600, fontSize: 13 }}>· {sections[0].items.length}</Box>
        </Box>
      )}

      {current && <Rows key={active} items={current.items} animate={motion} />}

      {after.map((p, i) => (
        <Box key={`a${i}`} sx={{ fontSize: 14, lineHeight: 1.55, color: '#CBD5E1', whiteSpace: 'pre-wrap' }}>
          {inline(p.text)}
        </Box>
      ))}
    </Box>
  );
});
