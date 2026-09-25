import { paintScreen, type ScreenKind } from './screens';
import { clamp, doneFrac, fleetCount, lerp, type FleetState } from './fleetState';

/**
 * Wires the FLEET landing page's scroll story to the markup under `root`:
 * per-chapter progress (`--p` on each pinned chapter), the running side label
 * and index, the London clock, the 1 → ∞ counter, the "Watch 12s" guided
 * scroll, the canvas screens in the cards, and — loaded on demand so the
 * three.js bundle never blocks first paint — the WebGL scene.
 *
 * Returns a cleanup that removes every listener, timer and GPU resource.
 */
export function startFleetLanding(root: HTMLElement): () => void {
  const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T>(sel);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const state: FleetState = { phase: 0, p3: 0, covered: false, reduceMotion, mouseX: 0, mouseY: 0 };
  const cleanups: (() => void)[] = [];
  const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
    window.addEventListener(type, fn, opts);
    cleanups.push(() => window.removeEventListener(type, fn, opts));
  };

  // Barcode on the product label, from a fixed seed so it never changes.
  const bar = q<SVGSVGElement>('.fl-barcode');
  if (bar) {
    let x = 0, seed = 7, out = '';
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    while (x < 240) {
      const w = 1 + Math.floor(rnd() * 4);
      if (rnd() > 0.42) out += `<rect x="${x}" y="0" width="${w}" height="44" fill="#111827"/>`;
      x += w + (rnd() > 0.7 ? 2 : 1);
    }
    bar.innerHTML = out;
  }

  // Canvas screens in the step cards and example runs.
  const paintCards = () => root.querySelectorAll<HTMLCanvasElement>('canvas[data-kind]').forEach((cv) => paintScreen(cv, cv.dataset.kind as ScreenKind));
  paintCards();
  let alive = true;
  document.fonts?.ready.then(() => alive && paintCards());

  // Scroll state.
  const chapters = [...root.querySelectorAll<HTMLElement>('[data-ch]')];
  const labelled = [...root.querySelectorAll<HTMLElement>('[data-label]')];
  const rail = q('.fl-rail-label'), railN = q('.fl-rail-n'), ixN = q('.fl-ix-n');
  const runs = q('#runs'), index = q('#index'), how = q('#how');
  let active = -1, railTimer = 0;
  const progress = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const h = r.height - window.innerHeight;
    return h <= 0 ? (r.top <= 0 ? 1 : 0) : clamp(-r.top / h);
  };
  const readScroll = () => {
    let ph = 0;
    chapters.forEach((el, i) => {
      const p = progress(el);
      el.style.setProperty('--p', p.toFixed(4));
      ph += p;
      if (i === 3) state.p3 = p;
    });
    state.phase = ph;
    let a = 0;
    labelled.forEach((el, i) => {
      if (el.getBoundingClientRect().top < window.innerHeight * 0.5) a = i;
    });
    if (a !== active && rail) {
      active = a;
      rail.style.opacity = '0';
      window.clearTimeout(railTimer);
      railTimer = window.setTimeout(() => {
        rail.textContent = labelled[a].dataset.label ?? '';
        rail.style.opacity = '1';
      }, 180);
      const n = String(Math.min(a, 7)).padStart(2, '0');
      if (railN) railN.textContent = n;
      if (ixN) ixN.textContent = n;
    }
    if (runs) root.classList.toggle('ink', runs.getBoundingClientRect().top < 60);
    const fills = (el: HTMLElement | null) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.top <= 0 && r.bottom >= window.innerHeight;
    };
    state.covered = (index ? index.getBoundingClientRect().top <= 0 : false) || fills(how);
  };
  on('scroll', readScroll, { passive: true });
  on('resize', readScroll);
  readScroll();

  on('pointermove', (e) => {
    state.mouseX = (e.clientX / window.innerWidth) * 2 - 1;
    state.mouseY = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  // London clock.
  const clock = q('.fl-clock');
  const tick = () => {
    if (clock) clock.textContent = new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour12: false });
  };
  tick();
  const clockTimer = window.setInterval(tick, 1000);
  cleanups.push(() => window.clearInterval(clockTimer));

  // Scale chapter copy and the frame counter, once per animation frame.
  const countEl = q('.fl-count'), capEl = q('.fl-cap'), nRun = q('.fl-nrun'), nDone = q('.fl-ndone'), frameEl = q('.fl-frame');
  const STEPS: [number, string][] = [
    [1, 'One phone. Try the instruction here first.'],
    [10, 'Ten. A shelf of test devices.'],
    [100, 'A hundred. A whole QA lab.'],
    [1000, 'A thousand. Same instruction, no rewrite.'],
  ];
  let raf = 0, frameNo = 0;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (document.hidden) return;
    const n = fleetCount(state.p3), inf = state.p3 > 0.86;
    const html = `${inf ? '∞' : n.toLocaleString('en-GB')}<small>${inf ? 'no cap' : n === 1 ? 'phone' : 'phones'}</small>`;
    if (countEl && countEl.innerHTML !== html) countEl.innerHTML = html;
    let cap = STEPS[0][1];
    for (const [min, text] of STEPS) if (n >= min) cap = text;
    if (inf) cap = 'Unlimited. Add phones, keep the same instruction.';
    if (capEl && capEl.textContent !== cap) capEl.textContent = cap;
    const d = Math.floor(n * doneFrac(state.p3));
    if (nRun) nRun.textContent = (n - d).toLocaleString('en-GB');
    if (nDone) nDone.textContent = d.toLocaleString('en-GB');
    if (frameEl && !state.covered && ++frameNo % 3 === 0) frameEl.textContent = String(frameNo).padStart(4, '0');
  };
  raf = requestAnimationFrame(loop);
  cleanups.push(() => cancelAnimationFrame(raf));

  // "Watch 12s": a guided scroll through the story; any wheel or touch hands control back.
  const watch = q<HTMLButtonElement>('.fl-watch');
  let tour = 0;
  const stopTour = () => {
    cancelAnimationFrame(tour);
    window.removeEventListener('wheel', stopTour);
    window.removeEventListener('touchstart', stopTour);
  };
  const startTour = () => {
    stopTour();
    const start = window.scrollY, end = (index?.offsetTop ?? 0) - window.innerHeight * 0.2, t0 = performance.now();
    const dur = reduceMotion ? 1 : 12000;
    const step = (now: number) => {
      const k = clamp((now - t0) / dur);
      window.scrollTo(0, lerp(start, end, k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2));
      if (k < 1) tour = requestAnimationFrame(step);
    };
    tour = requestAnimationFrame(step);
    window.addEventListener('wheel', stopTour, { passive: true });
    window.addEventListener('touchstart', stopTour, { passive: true });
  };
  watch?.addEventListener('click', startTour);
  cleanups.push(() => {
    stopTour();
    watch?.removeEventListener('click', startTour);
  });

  // In-page links scroll without touching the router.
  const onAnchor = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
    if (!a) return;
    const target = root.querySelector(a.getAttribute('href') ?? '');
    if (!target) return;
    e.preventDefault();
    stopTour();
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  };
  root.addEventListener('click', onAnchor);
  cleanups.push(() => root.removeEventListener('click', onAnchor));

  // WebGL scene, loaded after first paint.
  const canvas = q<HTMLCanvasElement>('.fl-gl');
  let disposeScene: (() => void) | null = null;
  if (canvas) {
    import('./fleetScene')
      .then(({ startFleetScene }) => {
        if (!alive) return;
        disposeScene = startFleetScene(canvas, state);
        if (!disposeScene) root.classList.add('nogl');
      })
      .catch(() => alive && root.classList.add('nogl'));
  }

  return () => {
    alive = false;
    window.clearTimeout(railTimer);
    cleanups.forEach((fn) => fn());
    disposeScene?.();
  };
}
