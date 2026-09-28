import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { Box, Paper, Typography } from '@mui/material';
import { keyframes } from '@mui/material/styles';
import { splitMentions, type MentionOption, type MentionVocab } from './mentions';

const PHONE = { ink: '#1D4ED8', bg: 'rgba(47,107,255,.13)', ring: 'rgba(47,107,255,.35)' };
const TAG = { ink: '#6D28D9', bg: 'rgba(124,92,255,.14)', ring: 'rgba(124,92,255,.38)' };

const glint = keyframes`
  0% { background-position: 160% 0; }
  100% { background-position: -60% 0; }
`;
const pop = keyframes`
  0% { opacity: 0; transform: translateY(4px) scale(.9); }
  60% { opacity: 1; transform: translateY(0) scale(1.06); }
  100% { transform: none; }
`;
const rise = keyframes`from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; }`;
const reduced = { '@media (prefers-reduced-motion: reduce)': { '&, & *': { animation: 'none !important' } } };

/** Copied from the textarea so the coloured layer lines up with it glyph for glyph. */
const MIRRORED = [
  'fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'wordSpacing', 'textIndent', 'textTransform',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'tabSize',
] as const;

/**
 * Colours the @phones and #tags inside the composer while you type. The
 * textarea's own text is made transparent and a layer underneath draws the
 * same text, with mentions as tinted pills that glint once when they appear.
 * The caret, selection and editing stay the textarea's, so typing is native.
 */
export function MentionHighlighter({
  inputRef,
  value,
  vocab,
}: {
  inputRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
  vocab: MentionVocab;
}) {
  const layerRef = useRef<HTMLDivElement | null>(null);
  const segments = useMemo(() => splitMentions(value, vocab), [value, vocab]);

  useLayoutEffect(() => {
    const area = inputRef.current;
    const layer = layerRef.current;
    if (!area || !layer) return;
    const host = layer.offsetParent as HTMLElement | null;
    const place = () => {
      const cs = getComputedStyle(area);
      for (const prop of MIRRORED) layer.style[prop] = cs[prop];
      const a = area.getBoundingClientRect();
      const h = host?.getBoundingClientRect() ?? { left: 0, top: 0 };
      layer.style.left = `${a.left - h.left + area.clientLeft}px`;
      layer.style.top = `${a.top - h.top + area.clientTop}px`;
      layer.style.width = `${area.clientWidth}px`;
      layer.style.height = `${area.clientHeight}px`;
      layer.scrollTop = area.scrollTop;
    };
    place();
    const onScroll = () => {
      layer.scrollTop = area.scrollTop;
    };
    const ro = new ResizeObserver(place);
    ro.observe(area);
    if (host) ro.observe(host);
    area.addEventListener('scroll', onScroll);
    // Only now hide the real text: the layer is in place to show it.
    area.style.color = 'transparent';
    area.style.caretColor = '#0E1630';
    layer.style.visibility = 'visible';
    return () => {
      ro.disconnect();
      area.removeEventListener('scroll', onScroll);
      area.style.color = '';
      area.style.caretColor = '';
    };
  }, [inputRef]);

  // Keep the layer scrolled with the textarea as lines are added.
  useEffect(() => {
    const area = inputRef.current;
    if (area && layerRef.current) layerRef.current.scrollTop = area.scrollTop;
  }, [value, inputRef]);

  return (
    <Box
      ref={layerRef}
      aria-hidden
      sx={{
        position: 'absolute',
        pointerEvents: 'none',
        overflow: 'hidden',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word',
        wordBreak: 'break-word',
        boxSizing: 'border-box',
        color: 'text.primary',
        visibility: 'hidden',
        '& .m': {
          borderRadius: '6px',
          // Spread, not padding, so the pill never shifts the text.
          boxShadow: '0 0 0 2px var(--bg), inset 0 0 0 999px var(--bg)',
          color: 'var(--ink)',
          backgroundImage: 'linear-gradient(100deg, transparent 30%, rgba(255,255,255,.85) 50%, transparent 70%)',
          backgroundSize: '220% 100%',
          backgroundRepeat: 'no-repeat',
          animation: `${glint} 900ms cubic-bezier(.2,.8,.2,1) 1`,
        },
        ...reduced,
      }}
    >
      {segments.map((s) =>
        s.kind === 'plain' ? (
          <span key={`p${s.key}`}>{s.text}</span>
        ) : (
          <span
            key={`${s.kind}${s.key}${s.text}`}
            className="m"
            style={{ ['--bg' as string]: s.kind === 'phone' ? PHONE.bg : TAG.bg, ['--ink' as string]: s.kind === 'phone' ? PHONE.ink : TAG.ink }}
          >
            {s.text}
          </span>
        ),
      )}
      {/* A trailing newline needs a character to take up its line. */}
      {value.endsWith('\n') ? ' ' : null}
    </Box>
  );
}

/** A sent message with its @phones and #tags as pills (on the blue user bubble). */
export function MentionText({ text, vocab }: { text: string; vocab: MentionVocab }) {
  const segments = useMemo(() => splitMentions(text, vocab), [text, vocab]);
  let n = 0;
  return (
    <>
      {segments.map((s) =>
        s.kind === 'plain' ? (
          <span key={`p${s.key}`}>{s.text}</span>
        ) : (
          <Box
            component="span"
            key={`m${s.key}`}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              px: 0.9,
              py: 0.1,
              mx: 0.15,
              borderRadius: 99,
              fontWeight: 700,
              bgcolor: 'rgba(255,255,255,.2)',
              boxShadow: 'inset 0 0 0 1px rgba(255,255,255,.35)',
              animation: `${pop} 420ms cubic-bezier(.2,.9,.3,1.3) ${120 + n++ * 70}ms both`,
              ...reduced,
            }}
          >
            <Box component="span" sx={{ opacity: 0.8, fontSize: '0.85em' }}>
              {s.kind === 'phone' ? '📱' : '#'}
            </Box>
            {s.text.slice(1)}
          </Box>
        ),
      )}
    </>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const i = query ? text.toLowerCase().indexOf(query.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <Box component="mark" sx={{ bgcolor: 'rgba(245,158,11,.28)', color: 'inherit', borderRadius: '3px', px: '1px' }}>
        {text.slice(i, i + query.length)}
      </Box>
      {text.slice(i + query.length)}
    </>
  );
}

/**
 * The @ / # menu: every matching phone or tag (scrollable), each with what
 * tells them apart — online state and tag for a phone, phone count for a tag.
 */
export function MentionMenu({
  trigger,
  query,
  options,
  active,
  onPick,
  onHover,
}: {
  trigger: '@' | '#';
  query: string;
  options: MentionOption[];
  active: number;
  onPick: (name: string) => void;
  onHover: (index: number) => void;
}) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const tone = trigger === '@' ? PHONE : TAG;

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-i="${active}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <Paper
      elevation={8}
      sx={{
        mb: 0.75,
        borderRadius: 3,
        overflow: 'hidden',
        alignSelf: 'flex-start',
        width: { xs: '100%', sm: 360 },
        maxWidth: '100%',
        border: `1px solid ${tone.ring}`,
        animation: `${rise} 180ms cubic-bezier(.2,.8,.2,1)`,
        ...reduced,
      }}
    >
      <Box sx={{ px: 1.5, py: 1, display: 'flex', alignItems: 'center', gap: 1, borderBottom: '1px solid', borderColor: 'divider', background: `linear-gradient(90deg, ${tone.bg}, transparent)` }}>
        <Typography sx={{ fontWeight: 800, fontSize: 13, color: tone.ink }}>{trigger === '@' ? 'Phones' : 'Tags'}</Typography>
        <Typography variant="caption" color="text.secondary">
          {options.length} · ↑↓ to pick, Enter to insert
        </Typography>
      </Box>
      <Box ref={listRef} role="listbox" sx={{ maxHeight: 300, overflowY: 'auto', py: 0.5, overscrollBehavior: 'contain' }}>
        {options.map((o, i) => (
          <Box
            key={o.name}
            data-i={i}
            role="option"
            aria-selected={i === active}
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(o.name);
            }}
            onMouseEnter={() => onHover(i)}
            sx={{
              mx: 0.5,
              px: 1,
              py: 0.75,
              borderRadius: 2,
              display: 'flex',
              alignItems: 'center',
              gap: 1.25,
              cursor: 'pointer',
              bgcolor: i === active ? tone.bg : 'transparent',
              transition: 'background-color 120ms',
              animation: i < 12 ? `${rise} 220ms cubic-bezier(.2,.8,.2,1) ${i * 18}ms both` : 'none',
              ...reduced,
            }}
          >
            <Box
              sx={{
                flex: 'none',
                width: 28,
                height: 28,
                borderRadius: '9px',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 800,
                fontSize: 13,
                color: tone.ink,
                bgcolor: tone.bg,
                position: 'relative',
              }}
            >
              {trigger === '@' ? '📱' : '#'}
              {trigger === '@' && (
                <Box
                  sx={{
                    position: 'absolute',
                    right: -2,
                    bottom: -2,
                    width: 9,
                    height: 9,
                    borderRadius: '50%',
                    border: '2px solid #fff',
                    bgcolor: o.online > 0 ? '#12C79A' : '#B5BFD4',
                  }}
                />
              )}
            </Box>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography noWrap sx={{ fontSize: 14, fontWeight: 600 }}>
                <Highlight text={o.name} query={query} />
              </Typography>
              <Typography noWrap variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.3 }}>
                {trigger === '@'
                  ? `${o.online > 0 ? 'Online' : 'Offline'}${o.tag ? ` · #${o.tag}` : ''}${o.count > 1 ? ` · ${o.count} phones share this name` : ''}`
                  : `${o.count} phone${o.count === 1 ? '' : 's'} · ${o.online} online`}
              </Typography>
            </Box>
          </Box>
        ))}
      </Box>
    </Paper>
  );
}
