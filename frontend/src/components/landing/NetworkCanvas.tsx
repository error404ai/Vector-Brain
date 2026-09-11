import { Box } from '@mui/material';
import { useEffect, useRef } from 'react';

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Connect two nodes only when they are closer than this, in CSS pixels. */
const LINK_DISTANCE = 130;
/** One node per this many square pixels, so density survives any viewport. */
const AREA_PER_NODE = 14000;
const MAX_NODES = 110;

/**
 * Slow drifting node network behind the hero.
 *
 * Canvas rather than DOM elements: a hundred animated divs force layout work on
 * every frame, while this is one composited surface. It stops entirely when the
 * tab is hidden, when the section scrolls out of view, and when the visitor has
 * asked for reduced motion — a landing page must never be the reason a laptop
 * fan spins up.
 */
export default function NetworkCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext('2d');
    if (!context) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    let nodes: Node[] = [];
    let frame = 0;
    let visible = true;

    const resize = () => {
      const parent = canvas.parentElement;
      width = parent?.clientWidth ?? window.innerWidth;
      height = parent?.clientHeight ?? window.innerHeight;

      // Cap the backing store at 2x: beyond that the extra pixels cost real
      // frame time on phones and are invisible.
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);

      const count = Math.min(MAX_NODES, Math.round((width * height) / AREA_PER_NODE));
      nodes = Array.from({ length: count }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.22,
        vy: (Math.random() - 0.5) * 0.22,
      }));
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);

      for (const node of nodes) {
        if (!reduceMotion) {
          node.x += node.vx;
          node.y += node.vy;
          if (node.x < 0 || node.x > width) node.vx *= -1;
          if (node.y < 0 || node.y > height) node.vy *= -1;
        }

        context.beginPath();
        context.arc(node.x, node.y, 1.6, 0, Math.PI * 2);
        context.fillStyle = 'rgba(125, 211, 252, 0.55)';
        context.fill();
      }

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x;
          const dy = nodes[i].y - nodes[j].y;
          const distance = Math.hypot(dx, dy);
          if (distance > LINK_DISTANCE) continue;

          context.beginPath();
          context.moveTo(nodes[i].x, nodes[i].y);
          context.lineTo(nodes[j].x, nodes[j].y);
          context.strokeStyle = `rgba(96, 165, 250, ${0.28 * (1 - distance / LINK_DISTANCE)})`;
          context.lineWidth = 1;
          context.stroke();
        }
      }
    };

    const loop = () => {
      draw();
      if (!reduceMotion && visible) frame = window.requestAnimationFrame(loop);
    };

    const stop = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
    };

    const restart = () => {
      stop();
      if (!reduceMotion && visible) frame = window.requestAnimationFrame(loop);
    };

    const onResize = () => {
      resize();
      if (reduceMotion) draw();
      else restart();
    };

    const onVisibility = () => {
      visible = document.visibilityState === 'visible';
      if (visible) restart();
      else stop();
    };

    // Off-screen means no work at all once the visitor scrolls past the hero.
    const observer = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true;
        if (visible) restart();
        else stop();
      },
      { threshold: 0 },
    );
    observer.observe(canvas);

    resize();
    if (reduceMotion) draw();
    else restart();

    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      observer.disconnect();
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return (
    <Box
      component="canvas"
      ref={canvasRef}
      aria-hidden
      sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    />
  );
}
