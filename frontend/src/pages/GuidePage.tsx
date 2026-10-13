import { useEffect, useMemo, useRef, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Box, InputBase, Paper, Stack, Typography, alpha } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import { Block } from '@/docs/DocsContent';
import { docs } from '@/docs/docsData';
import type { DocBlock } from '@/docs/parseDocs';
import PrismBackground from '@/components/ui/PrismBackground';
import Reveal from '@/components/ui/Reveal';
import { glassSection, monoLabel, PRISM_ACCENT, PRISM_INK, PRISM_MUTED, sectionTitle } from '@/components/settings/settingsStyle';
import '@/docs/guide.css';

/** Everything readable in a section, flattened once, so search can match body text, not just titles. */
const flatten = (blocks: DocBlock[]): string =>
  blocks
    .map((b) => {
      if (b.t === 'p' || b.t === 'h3' || b.t === 'code') return b.text;
      if (b.t === 'ul' || b.t === 'ol') return b.items.join(' ');
      if (b.t === 'table') return [...b.head, ...b.rows.flat()].join(' ');
      return '';
    })
    .join(' ');

const SEARCH_TEXT = docs.sections.map((s) => `${s.title} ${flatten(s.blocks)}`.toLowerCase());

export default function GuidePage() {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(docs.sections[0]?.id ?? '');
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () => docs.sections.filter((_, i) => !needle || SEARCH_TEXT[i].includes(needle)),
    [needle],
  );
  const visibleIds = visible.map((s) => s.id).join(',');

  // Highlight the section the reader is in. Re-runs when the filtered set changes.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return;
    const ids = visibleIds ? visibleIds.split(',') : [];
    const observer = new IntersectionObserver(
      (entries) => {
        const seen = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (seen?.target.id) setActive(seen.target.id);
      },
      { rootMargin: '-100px 0px -62% 0px' },
    );
    for (const id of ids) {
      const el = sectionRefs.current[id];
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [visibleIds]);

  const activeIndex = Math.max(0, visible.findIndex((s) => s.id === active));
  const fill = visible.length > 1 ? activeIndex / (visible.length - 1) : 0;

  return (
    <>
      <Helmet>
        <title>Guide — Vector Brain</title>
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@600&display=swap" />
      </Helmet>

      <Box
        sx={{
          position: 'relative',
          mx: { xs: -1.5, sm: -2, md: -3 },
          mt: { xs: '-12px', md: '-24px' },
          mb: { xs: -10, md: -3 },
          minHeight: 'calc(100vh - 64px)',
          overflow: 'hidden',
          color: PRISM_INK,
        }}
      >
        <PrismBackground />
        <Box sx={{ position: 'relative', zIndex: 1, maxWidth: 1376, mx: 'auto', px: { xs: 2, md: 4 }, pt: { xs: 3, md: 4 }, pb: { xs: 12, md: 6 } }}>
          <Stack direction="row" alignItems="flex-end" flexWrap="wrap" gap={3} sx={{ mb: 3.5 }}>
            <Box sx={{ flex: 1, minWidth: 260 }}>
              <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
                <Box
                  sx={{
                    width: 46, height: 46, borderRadius: '14px', display: 'grid', placeItems: 'center',
                    bgcolor: alpha(PRISM_ACCENT, 0.12), color: PRISM_ACCENT,
                  }}
                >
                  <MenuBookIcon />
                </Box>
                <Typography component="h1" sx={{ m: 0, fontSize: { xs: 40, md: 54 }, lineHeight: 1, fontWeight: 800, letterSpacing: '-0.045em', color: PRISM_INK }}>
                  Guide
                </Typography>
              </Stack>
              <Typography sx={{ mt: 0.5, fontSize: 15, color: PRISM_MUTED, maxWidth: 580, lineHeight: 1.55 }}>
                Every page, button and setting in FLEET — what it does and when to use it. Search below, or jump to a section.
              </Typography>
            </Box>
          </Stack>

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3.5, alignItems: 'flex-start' }}>
            {/* Left rail: search + sections with scroll-spy */}
            <Box
              component="nav"
              aria-label="Guide sections"
              sx={{
                display: { xs: 'none', md: 'flex' },
                flex: '0 0 236px',
                flexDirection: 'column',
                position: 'sticky',
                top: 88,
                maxHeight: 'calc(100vh - 112px)',
                p: 1.5,
                borderRadius: '22px',
                bgcolor: 'rgba(255,255,255,.62)',
                border: '1px solid rgba(255,255,255,.9)',
                backdropFilter: 'blur(18px)',
                boxShadow: '0 20px 50px rgba(30,40,90,.08)',
              }}
            >
              <Box
                sx={{
                  display: 'flex', alignItems: 'center', gap: 1, px: 1.25, mb: 1,
                  minHeight: 42, borderRadius: '12px', bgcolor: '#fff',
                  border: '1px solid rgba(20,26,46,.08)',
                }}
              >
                <SearchIcon sx={{ fontSize: 18, color: PRISM_MUTED }} />
                <InputBase
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search the guide…"
                  sx={{ fontSize: 13.5, flex: 1, color: PRISM_INK }}
                  inputProps={{ 'aria-label': 'Search the guide' }}
                />
              </Box>

              <Box
                sx={{
                  position: 'relative', overflowY: 'auto', pr: 0.5, ml: 0.5,
                  '&::before': {
                    content: '""', position: 'absolute', left: 3, top: 6, bottom: 6, width: 2,
                    borderRadius: 2, background: 'rgba(20,26,46,.08)',
                  },
                  '&::after': {
                    content: '""', position: 'absolute', left: 3, top: 6, width: 2,
                    height: `calc((100% - 12px) * ${fill})`,
                    borderRadius: 2, background: `linear-gradient(${PRISM_ACCENT}, #7c3aed)`,
                    transition: 'height 280ms cubic-bezier(.22,1,.36,1)',
                  },
                }}
              >
                {visible.length === 0 ? (
                  <Typography sx={{ px: 1.5, py: 1.5, fontSize: 13, color: PRISM_MUTED }}>No section matches “{query}”.</Typography>
                ) : (
                  visible.map((s) => {
                    const current = s.id === active;
                    return (
                      <Box
                        key={s.id}
                        component="a"
                        href={`#${s.id}`}
                        aria-current={current ? 'location' : undefined}
                        sx={{
                          display: 'flex', alignItems: 'center', gap: 1.25, minHeight: 40,
                          pl: 2, pr: 1.25, borderRadius: '10px', textDecoration: 'none',
                          fontSize: 13.5, fontWeight: current ? 700 : 500,
                          color: current ? PRISM_INK : '#3b4063',
                          bgcolor: current ? '#fff' : 'transparent',
                          boxShadow: current ? '0 6px 16px rgba(30,40,90,.08)' : 'none',
                          transition: 'background 180ms ease, box-shadow 180ms ease, color 180ms ease',
                          '&:hover': { bgcolor: current ? '#fff' : 'rgba(255,255,255,.6)', color: PRISM_INK },
                        }}
                      >
                        {s.title}
                      </Box>
                    );
                  })
                )}
              </Box>
            </Box>

            {/* Content */}
            <Box component="main" sx={{ flex: '999 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2.75 }}>
              {visible.length === 0 ? (
                <Paper elevation={0} sx={{ ...glassSection, textAlign: 'center', py: 8 }}>
                  <Typography sx={{ fontSize: 16, fontWeight: 700, color: PRISM_INK }}>Nothing found for “{query}”</Typography>
                  <Typography sx={{ mt: 1, fontSize: 14, color: PRISM_MUTED }}>Try a shorter word, or clear the search.</Typography>
                </Paper>
              ) : (
                visible.map((s, i) => (
                  <Reveal key={s.id} index={Math.min(i, 5)}>
                    <Paper
                      id={s.id}
                      elevation={0}
                      ref={(el: HTMLDivElement | null) => {
                        sectionRefs.current[s.id] = el;
                      }}
                      sx={{ ...glassSection, scrollMarginTop: 92 }}
                    >
                      <Typography sx={monoLabel}>Section</Typography>
                      <Typography component="h2" sx={{ ...sectionTitle, mt: 0.25, mb: 2 }}>
                        {s.title}
                      </Typography>
                      <Box className="gx">
                        {s.blocks.map((b, j) => (
                          <Block key={j} block={b} />
                        ))}
                      </Box>
                    </Paper>
                  </Reveal>
                ))
              )}

              <Typography sx={{ fontSize: 12.5, color: PRISM_MUTED, px: 1 }}>
                Can’t find something? The same guide is at{' '}
                <Box component="a" href="/docs" target="_blank" rel="noreferrer" sx={{ color: PRISM_ACCENT, fontWeight: 600 }}>
                  app.vectoragent.in/docs
                </Box>
                .
              </Typography>
            </Box>
          </Box>
        </Box>
      </Box>
    </>
  );
}
