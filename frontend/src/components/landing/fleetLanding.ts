import { fetchPublicLandingShots, publicShotUrl, type PublicLandingShot } from '@/RTKService/landingShotService/landingShotService';
import type { FleetScene } from './fleetScene';
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
  const runs = q('#runs'), index = q('#index'), how = q('#how'), live = q('#live');
  let active = -1, railTimer = 0;
  const progress = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const h = r.height - window.innerHeight;
    return h <= 0 ? (r.top <= 0 ? 1 : 0) : clamp(-r.top / h);
  };
  const visibleLabelled = () => labelled.filter((el) => !el.hidden);
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
    const list = visibleLabelled();
    list.forEach((el, i) => {
      if (el.getBoundingClientRect().top < window.innerHeight * 0.5) a = i;
    });
    if (a !== active && rail) {
      active = a;
      rail.style.opacity = '0';
      window.clearTimeout(railTimer);
      railTimer = window.setTimeout(() => {
        rail.textContent = list[a]?.dataset.label ?? '';
        rail.style.opacity = '1';
      }, 180);
      const n = String(a).padStart(2, '0');
      if (railN) railN.textContent = n;
      if (ixN) ixN.textContent = n;
    }
    // Light header text over the dark sections (live fleet, example runs and the close).
    const overDark = [live, runs, q('#close')].some((el) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.top < 60 && r.bottom > 60;
    });
    root.classList.toggle('ink', overDark);
    const fills = (el: HTMLElement | null) => {
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.top <= 0 && r.bottom >= window.innerHeight;
    };
    state.covered = (index ? index.getBoundingClientRect().top <= 0 : false) || fills(how) || fills(live);
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

  // Live fleet: videos play only while the section is on screen; the feed rotates.
  const videos = [...root.querySelectorAll<HTMLVideoElement>('.fl-live-video')];
  const feed = q('.fl-live-feed');
  const FEED = [
    ['PH-04', 'Started playback'],
    ['PH-06', 'Looped the clip'],
    ['PH-02', 'Scrolled the feed'],
    ['PH-01', 'Opened the video app'],
    ['PH-03', 'Checked the result on screen'],
    ['PH-05', 'Task done in 41s'],
  ];
  let feedTimer = 0, feedAt = 0;
  const rotateFeed = () => {
    if (!feed || document.hidden) return;
    const [id, text] = FEED[feedAt++ % FEED.length];
    const li = document.createElement('li');
    li.innerHTML = `<b>${id}</b> ${text}`;
    li.className = 'in';
    feed.prepend(li);
    while (feed.children.length > 4) feed.lastElementChild?.remove();
  };
  if (live && !reduceMotion && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          videos.forEach((v) => {
            if (v.preload === 'none') v.preload = 'auto';
            v.play().catch(() => undefined);
          });
          if (!feedTimer) feedTimer = window.setInterval(rotateFeed, 2600);
        } else {
          videos.forEach((v) => v.pause());
          window.clearInterval(feedTimer);
          feedTimer = 0;
        }
      },
      { threshold: 0.15 },
    );
    io.observe(live);
    cleanups.push(() => {
      io.disconnect();
      window.clearInterval(feedTimer);
      videos.forEach((v) => v.pause());
    });
  }

  // WebGL scene, loaded after first paint.
  const canvas = q<HTMLCanvasElement>('.fl-gl');
  let scene: FleetScene | null = null;
  const heroImages = new Map<number, HTMLImageElement>();
  const applyHero = () => heroImages.forEach((img, i) => scene?.setScreenImage(i, img));
  if (canvas) {
    import('./fleetScene')
      .then(({ startFleetScene }) => {
        if (!alive) return;
        scene = startFleetScene(canvas, state);
        if (!scene) root.classList.add('nogl');
        applyHero();
      })
      .catch(() => alive && root.classList.add('nogl'));
  }

  // Real screenshots, approved in Landing shots, replace the drawn stand-ins.
  const applyShots = (shots: PublicLandingShot[]) => {
    const one = new Map<string, PublicLandingShot>();
    for (const s of shots) if (!one.has(s.slot)) one.set(s.slot, s);
    root.querySelectorAll<HTMLCanvasElement>('canvas[data-slot]').forEach((cv) => {
      const shot = one.get(cv.dataset.slot ?? '');
      if (!shot) return;
      const img = document.createElement('img');
      img.src = publicShotUrl(shot);
      img.alt = shot.label;
      img.loading = 'lazy';
      img.decoding = 'async';
      cv.replaceWith(img);
    });
    for (let i = 0; i < 5; i++) {
      const shot = one.get(`hero-${i + 1}`);
      if (!shot) continue;
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        if (!alive) return;
        heroImages.set(i, img);
        applyHero();
      };
      img.src = publicShotUrl(shot);
    }
    const wall = q('.fl-real-wall'), apps = q('.fl-real-apps'), section = q('#real');
    const phones = shots.filter((s) => s.slot === 'fleet');
    const pages = shots.filter((s) => s.slot === 'app');
    if (!section || !wall || !apps || (!phones.length && !pages.length)) return;
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);
    wall.innerHTML = phones
      .map((s) => `<figure><div class="ph"><img src="${publicShotUrl(s)}" alt="${esc(s.label)}" loading="lazy" decoding="async"></div><figcaption>${esc(s.device_model || s.label)}</figcaption></figure>`)
      .join('');
    apps.innerHTML = pages
      .map((s) => `<figure><div class="tb"><i></i><i></i><i></i></div><img src="${publicShotUrl(s)}" alt="${esc(s.label)}" loading="lazy" decoding="async"><figcaption>${esc(s.label)}</figcaption></figure>`)
      .join('');
    section.hidden = false;
    const total = q('.fl-ix-total');
    if (total) total.textContent = String(visibleLabelled().length - 1).padStart(2, '0');
    active = -1;
    readScroll();
  };
  fetchPublicLandingShots()
    .then((shots) => alive && shots.length && applyShots(shots))
    .catch(() => undefined);

  return () => {
    alive = false;
    window.clearTimeout(railTimer);
    cleanups.forEach((fn) => fn());
    scene?.dispose();
  };
}
