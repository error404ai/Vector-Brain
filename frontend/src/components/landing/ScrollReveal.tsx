import { Box } from '@mui/material';
import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

interface ScrollRevealProps {
  children: ReactNode;
  /** Stagger step, in ms, for items revealed together. */
  delay?: number;
}

/**
 * Fades and lifts its children in the first time they reach the viewport.
 *
 * Reveals once and then disconnects, so scrolling back up does not replay the
 * animation — repeating it on every pass reads as jitter rather than polish.
 */
export default function ScrollReveal({ children, delay = 0 }: ScrollRevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setShown(true);
        observer.disconnect();
      },
      { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <Box
      ref={ref}
      sx={{
        opacity: shown ? 1 : 0,
        transform: shown ? 'none' : 'translateY(26px)',
        transition: 'opacity 620ms ease, transform 620ms cubic-bezier(0.22, 1, 0.36, 1)',
        transitionDelay: `${delay}ms`,
        willChange: 'opacity, transform',
      }}
    >
      {children}
    </Box>
  );
}
