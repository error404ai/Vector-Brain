import { Box, useMediaQuery } from '@mui/material';
import { memo, useEffect, useRef, useState } from 'react';
import type { BotHandle, BotMood } from './vectorBotScene';

/** Still of the robot, shown until the 3D scene is up, or instead of it. */
const STILL = '/brand/vector-bot.png';

function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * Vector, the 3D mascot. The three.js scene is its own chunk, fetched only
 * when this component mounts, and fully disposed on unmount. With reduced
 * motion or no WebGL it shows the still image instead.
 */
export default memo(function VectorBot({
  mood,
  compact = false,
  size,
  label = 'Vector, your phone assistant',
}: {
  mood: BotMood;
  compact?: boolean;
  /** CSS size of the square; the scene fills it. */
  size: number | string;
  label?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const botRef = useRef<BotHandle | null>(null);
  const moodRef = useRef(mood);
  const [ready, setReady] = useState(false);
  const reduce = useMediaQuery('(prefers-reduced-motion: reduce)');
  const [canRender] = useState(webglAvailable);
  const live = canRender && !reduce;

  useEffect(() => {
    if (!live || !canvasRef.current) return;
    let alive = true;
    const canvas = canvasRef.current;
    import('./vectorBotScene')
      .then(({ startVectorBot }) => {
        if (!alive) return;
        botRef.current = startVectorBot(canvas, { compact, onReady: () => alive && setReady(true) });
        botRef.current.setMood(moodRef.current);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      botRef.current?.dispose();
      botRef.current = null;
    };
  }, [live, compact]);

  useEffect(() => {
    const prev = moodRef.current;
    moodRef.current = mood;
    const bot = botRef.current;
    if (!bot) return;
    bot.setMood(mood);
    if (mood === 'done' && prev !== 'done') bot.hop();
  }, [mood]);

  return (
    <Box
      role="img"
      aria-label={label}
      onClick={() => botRef.current?.wave()}
      sx={{ position: 'relative', width: size, height: size, flexShrink: 0, cursor: live ? 'pointer' : 'default' }}
    >
      <Box
        component="img"
        src={STILL}
        alt=""
        aria-hidden
        sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'contain', opacity: ready ? 0 : 1, transition: 'opacity 400ms ease' }}
      />
      {live && (
        <Box
          component="canvas"
          ref={canvasRef}
          aria-hidden
          sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', display: 'block', opacity: ready ? 1 : 0, transition: 'opacity 400ms ease' }}
        />
      )}
    </Box>
  );
});
