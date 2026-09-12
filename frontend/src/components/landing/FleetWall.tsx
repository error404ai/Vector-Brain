import { Box, Stack, Typography } from '@mui/material';
import { useEffect, useMemo, useRef, useState } from 'react';

/** Clips dropped in frontend/public/fleet/. Missing files fall back silently. */
const CLIPS = ['/fleet/run-1.mp4', '/fleet/run-2.mp4', '/fleet/run-3.mp4', '/fleet/run-4.mp4', '/fleet/run-5.mp4', '/fleet/run-6.mp4'];

const MODELS = [
  'Pixel 8', 'Galaxy S23', 'Redmi Note 12', 'realme 11', 'Pixel 6a', 'Galaxy A54',
  'OnePlus 11', 'Moto G84', 'Pixel 7', 'Redmi 13C', 'Galaxy M34', 'Nothing 2a',
  'Pixel 8a', 'Vivo Y28', 'Poco X6', 'Galaxy S21', 'iQOO Z9', 'Redmi Note 13',
  'Pixel 5', 'realme C67', 'Galaxy A15', 'Moto Edge 50', 'OnePlus Nord', 'Poco M6',
];

/** Steps a real run produces, cycled per tile so no two tiles are in sync. */
const ACTIVITY = [
  'open_app', 'read_ui_tree', 'tap_coordinate', 'type_text',
  'scroll_element', 'wait_for_element', 'open_url', 'click_node',
];

interface Tile {
  model: string;
  clip: string;
  offset: number;
}

/**
 * The wall of devices behind the hero.
 *
 * The point of this section is scale: one instruction going out to a fleet, with
 * every phone visibly doing its own thing. Tiles are staggered rather than
 * synchronised, because a grid that ticks in unison reads as an animation, and a
 * grid that drifts reads as a room full of working phones.
 *
 * Clips are optional. If the files are not there the tiles keep their status
 * feed and lose only the footage, so the page never ships broken.
 */
export default function FleetWall({ count = 24 }: { count?: number }) {
  const [tick, setTick] = useState(0);
  const [brokenClips, setBrokenClips] = useState<string[]>([]);
  const reduceMotion = useRef(false);

  const tiles = useMemo<Tile[]>(
    () =>
      Array.from({ length: count }, (_, index) => ({
        model: MODELS[index % MODELS.length],
        clip: CLIPS[index % CLIPS.length],
        offset: index * 3,
      })),
    [count],
  );

  useEffect(() => {
    reduceMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion.current) return;
    const timer = window.setInterval(() => setTick((value) => value + 1), 1800);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <Box
      sx={{
        display: 'grid',
        gap: 1.25,
        gridTemplateColumns: { xs: 'repeat(3, 1fr)', sm: 'repeat(4, 1fr)', md: 'repeat(6, 1fr)' },
      }}
    >
      {tiles.map((tile, index) => {
        const step = ACTIVITY[(tick + tile.offset) % ACTIVITY.length];
        const showVideo = !brokenClips.includes(tile.clip);

        return (
          <Box
            key={`${tile.model}-${index}`}
            sx={{
              position: 'relative',
              borderRadius: 2,
              overflow: 'hidden',
              aspectRatio: '9 / 17',
              border: '1px solid rgba(148,163,184,0.18)',
              bgcolor: '#0b1020',
            }}
          >
            {showVideo ? (
              <Box
                component="video"
                src={tile.clip}
                autoPlay
                muted
                loop
                playsInline
                preload="metadata"
                onError={() => setBrokenClips((current) => (current.includes(tile.clip) ? current : [...current, tile.clip]))}
                sx={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.85 }}
              />
            ) : (
              // No clip: a stand-in phone screen, so the grid keeps its rhythm.
              <Stack spacing={0.5} sx={{ p: 0.75, pt: 2 }}>
                {[0, 1, 2, 3, 4].map((row) => (
                  <Box
                    key={row}
                    sx={{
                      height: row === 1 ? 26 : 8,
                      borderRadius: 0.75,
                      bgcolor: row === 1 ? 'rgba(37,99,235,0.35)' : 'rgba(148,163,184,0.12)',
                    }}
                  />
                ))}
              </Stack>
            )}

            {/* Status strip */}
            <Box
              sx={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 0,
                px: 0.75,
                py: 0.6,
                background: 'linear-gradient(180deg, rgba(2,6,23,0) 0%, rgba(2,6,23,0.92) 55%)',
              }}
            >
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: '#22c55e', flexShrink: 0 }} />
                <Typography sx={{ fontSize: 9.5, color: 'rgba(226,232,240,0.9)', fontWeight: 700 }} noWrap>
                  {tile.model}
                </Typography>
              </Stack>
              <Typography
                sx={{
                  fontSize: 9,
                  color: '#7dd3fc',
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                }}
                noWrap
              >
                {step}
              </Typography>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
