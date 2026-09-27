/**
 * Browser-side failure detection.
 *
 * Catches what the server cannot see and sends it to /api/client-reports:
 * - unclean_exit: the tab died without closing (the next load of the same tab
 *   finds its last heartbeat never marked clean). A normal reload, navigation
 *   or close fires `pagehide` and is not reported.
 * - stuck_loader: the full-screen loader stayed up for more than 10 s.
 * - main_thread_stall: the page froze. Reported by a worker while it is still
 *   frozen (8 s+), and by the page itself once it runs again (10 s+ late beat).
 * - js_error / unhandled_rejection / render_error.
 *
 * Every report carries a snapshot: page, time since boot, memory where the
 * browser exposes it, DOM/image counts, WebSocket traffic (live frames), the
 * last 40 API requests and any still pending, and the auth state.
 * No request or response bodies, no screenshots, no tokens are recorded.
 */

type RequestEntry = { method: string; path: string; status: number | 'pending' | 'failed'; ms: number | null; at: number };
type Snapshot = Record<string, unknown>;
type AuthProbe = () => Record<string, unknown>;
type TokenGetter = () => string | null | undefined;

const TAB_KEY = 'vb_diag_tab';
const LIVE_PREFIX = 'vb_diag_live_';
const QUEUE_KEY = 'vb_diag_queue';
const HEARTBEAT_MS = 3000;
const STUCK_LOADER_MS = 10_000;
const MAX_REQUESTS = 40;
const MAX_ERRORS_PER_KIND = 5;

const bootAt = Date.now();
const requests: RequestEntry[] = [];
const ws = { opened: 0, closed: 0, messages: 0, bytes: 0, frames: 0, frameBytes: 0, lastFrameAt: 0, lastCloseCode: null as number | null };
let longTasks = 0;
let longTaskMs = 0;
const errorCounts: Record<string, number> = {};
const seenErrors = new Set<string>();
let tabId = '';
let authProbe: AuthProbe | null = null;
let tokenGetter: TokenGetter | null = null;
let loaderShownAt: number | null = null;
let loaderReported = false;
let started = false;
/** Set on pagehide: the page is going away cleanly, so nothing may mark it alive again. */
let leaving = false;
let nativeFetch: typeof fetch = typeof window !== 'undefined' ? window.fetch.bind(window) : fetch;

const safe = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

function appVersion(): string {
  return safe(() => {
    const src = (document.querySelector('script[type="module"][src]') as HTMLScriptElement | null)?.src ?? '';
    return src.split('/').pop()?.slice(0, 40) ?? '';
  }, '');
}

function pathOf(url: string): string {
  return safe(() => {
    const u = new URL(url, window.location.origin);
    const keys = [...u.searchParams.keys()];
    return `${u.pathname}${keys.length ? `?${keys.join('&')}` : ''}`.slice(0, 160);
  }, String(url).slice(0, 160));
}

export function snapshot(): Snapshot {
  const now = Date.now();
  const perf = performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } };
  const images = safe(() => [...document.images], [] as HTMLImageElement[]);
  const dataImages = images.filter((img) => img.src.startsWith('data:'));
  return {
    page: window.location.pathname,
    since_boot_s: Math.round((now - bootAt) / 1000),
    visible: document.visibilityState,
    online: navigator.onLine,
    memory: perf.memory
      ? {
          used_mb: Math.round(perf.memory.usedJSHeapSize / 1048576),
          total_mb: Math.round(perf.memory.totalJSHeapSize / 1048576),
          limit_mb: Math.round(perf.memory.jsHeapSizeLimit / 1048576),
        }
      : null,
    device_memory_gb: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    dom_nodes: safe(() => document.getElementsByTagName('*').length, -1),
    images: images.length,
    data_images: dataImages.length,
    data_image_mb: Math.round((dataImages.reduce((sum, img) => sum + img.src.length, 0) / 1048576) * 10) / 10,
    blob_images: images.filter((img) => img.src.startsWith('blob:')).length,
    // Decoded size is what runs a tab out of memory: width × height × 4 bytes each.
    decoded_image_mb: Math.round(images.reduce((sum, img) => sum + img.naturalWidth * img.naturalHeight * 4, 0) / 1048576),
    ws: { ...ws, frame_mb: Math.round((ws.frameBytes / 1048576) * 10) / 10, last_frame_s_ago: ws.lastFrameAt ? Math.round((now - ws.lastFrameAt) / 1000) : null },
    long_tasks: { count: longTasks, total_ms: Math.round(longTaskMs) },
    // React's development build logs a measure per render; a production build none.
    perf_measures: safe(() => performance.getEntriesByType('measure').length, -1),
    loader_visible_s: loaderShownAt ? Math.round((now - loaderShownAt) / 1000) : null,
    pending: requests.filter((r) => r.status === 'pending').map((r) => ({ method: r.method, path: r.path, age_s: Math.round((now - r.at) / 1000) })),
    requests: requests.slice(-MAX_REQUESTS).map((r) => ({ ...r, at: Math.round((r.at - bootAt) / 1000) })),
    auth: safe(() => authProbe?.() ?? null, null),
  };
}

function readQueue(): Snapshot[] {
  return safe(() => JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') as Snapshot[], []);
}

function writeQueue(queue: Snapshot[]): void {
  safe(() => localStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-20))), undefined);
}

export function report(kind: string, extra: Record<string, unknown> = {}): void {
  const entry = {
    kind,
    page: window.location.pathname,
    tab_id: tabId,
    app_version: appVersion(),
    payload: { ...extra, snapshot: snapshot(), reported_at: new Date().toISOString(), user_agent: navigator.userAgent },
  };
  writeQueue([...readQueue(), entry]);
  void flush();
}

let flushing = false;
async function flush(): Promise<void> {
  if (flushing || !navigator.onLine) return;
  const queue = readQueue();
  if (!queue.length) return;
  flushing = true;
  try {
    const token = safe(() => tokenGetter?.() ?? undefined, undefined);
    const remaining: Snapshot[] = [];
    for (const entry of queue) {
      try {
        const res = await nativeFetch('/api/client-reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(entry),
          keepalive: JSON.stringify(entry).length < 60_000,
        });
        // 4xx other than rate limiting will not get better on retry.
        if (!res.ok && (res.status === 429 || res.status >= 500)) remaining.push(entry);
      } catch {
        remaining.push(entry);
      }
    }
    writeQueue(remaining);
  } finally {
    flushing = false;
  }
}

/** This page load. The live record is keyed by tab and load, so two tabs that
 * share a tab id (Chrome copies sessionStorage into a duplicated tab) never
 * overwrite each other's record. */
const instanceId = `${bootAt.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const liveKey = () => `${LIVE_PREFIX}${tabId}:${instanceId}`;
/** A visible page's heartbeat that comes this late means its main thread was stuck. */
const STALL_REPORT_MS = 10_000;
let lastBeatAt = 0;
let lastBeatPerf = 0;
let hiddenSinceLastBeat = false;
let longestStallMs = 0;

type LiveRecord = { clean: boolean; lastBeat: number; bootAt: number; app_version?: string; hidden?: boolean; snapshot?: Snapshot | null; longest_stall_s?: number };

function heartbeat(clean = false): void {
  // On navigation `visibilitychange` fires after `pagehide`; without this it
  // would overwrite the clean mark and every reload would look like a crash.
  if (leaving && !clean) return;
  const now = Date.now();
  const perfNow = performance.now();
  if (lastBeatAt && !clean) {
    const gap = now - lastBeatAt;
    // A beat is due every 3 s. Much later while the page stayed visible: the
    // main thread was blocked (a hang), unless the whole machine slept — then
    // the monotonic clock usually shows a much smaller gap, so both are sent.
    if (!hiddenSinceLastBeat && gap > STALL_REPORT_MS) {
      longestStallMs = Math.max(longestStallMs, gap);
      report('main_thread_stall', { from: 'page', recovered: true, stalled_s: Math.round(gap / 1000), monotonic_s: Math.round((perfNow - lastBeatPerf) / 1000) });
    }
  }
  lastBeatAt = now;
  lastBeatPerf = perfNow;
  hiddenSinceLastBeat = document.visibilityState === 'hidden';
  const snap = clean ? null : snapshot();
  safe(
    () =>
      localStorage.setItem(
        liveKey(),
        JSON.stringify({
          clean,
          lastBeat: now,
          bootAt,
          app_version: appVersion(),
          hidden: document.visibilityState === 'hidden',
          longest_stall_s: Math.round(longestStallMs / 1000),
          snapshot: snap,
        } satisfies LiveRecord),
      ),
    undefined,
  );
  watchdog?.postMessage({ type: 'beat', hidden: document.visibilityState === 'hidden', snapshot: snap, leaving: clean });
}

/** Longer than one heartbeat, so a live sibling tab is seen beating. */
const CHECK_PREVIOUS_AFTER_MS = 4000;

/** How long a page must be silent before it counts as dead, by what it last said. */
function deadAfterMs(rec: LiveRecord): number {
  // Hidden tabs can be throttled to one timer a minute.
  return rec.hidden ? 180_000 : 15_000;
}

function checkPreviousLife(): void {
  const navigation = safe(() => (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type ?? null, null);
  // Chrome sets this when it threw the tab away to free memory and is now reloading it.
  const discarded = safe(() => Boolean((document as Document & { wasDiscarded?: boolean }).wasDiscarded), false);
  const sameTabPrefix = `${LIVE_PREFIX}${tabId}`;
  const describe = (previous: LiveRecord, sameTab: boolean) => ({
    same_tab: sameTab,
    was_discarded: sameTab ? discarded : null,
    was_hidden: previous.hidden ?? null,
    previous_lifetime_s: Math.round((previous.lastBeat - previous.bootAt) / 1000),
    gap_since_last_heartbeat_s: Math.round((Date.now() - previous.lastBeat) / 1000),
    previous_longest_stall_s: previous.longest_stall_s ?? null,
    previous_app_version: previous.app_version ?? null,
    navigation_type: sameTab ? navigation : null,
    last_snapshot: previous.snapshot ?? null,
  });
  const read = (k: string) => safe(() => JSON.parse(localStorage.getItem(k) ?? 'null') as LiveRecord | null, null);
  const keys = safe(() => {
    const found: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k?.startsWith(LIVE_PREFIX) && k !== liveKey()) found.push(k);
    }
    return found;
  }, [] as string[]);
  const first = new Map(keys.map((k) => [k, read(k)?.lastBeat ?? 0]));
  // Decide a little later. The previous page's last write ("closed cleanly")
  // can reach this page's storage after it has booted when the browser
  // switched processes, and a sibling tab that is alive keeps beating.
  setTimeout(() => {
    let reportedSameTab = false;
    for (const k of keys) {
      const rec = read(k);
      if (!rec) continue;
      if (rec.clean) {
        safe(() => localStorage.removeItem(k), undefined);
        continue;
      }
      // Still beating: a live sibling tab (maybe a duplicate sharing our tab id).
      if (rec.lastBeat !== first.get(k)) continue;
      const sameTab = k.startsWith(sameTabPrefix);
      const silentFor = Date.now() - rec.lastBeat;
      // This tab's previous load cannot still be running, unless it is a hidden
      // duplicate whose timers are throttled; other tabs must be silent a while.
      const dead = sameTab && !rec.hidden ? true : silentFor > deadAfterMs(rec);
      if (!dead) continue;
      if (silentFor < 86_400_000) {
        reportedSameTab ||= sameTab;
        report('unclean_exit', describe(rec, sameTab));
      }
      safe(() => localStorage.removeItem(k), undefined);
    }
    if (discarded && !reportedSameTab) report('unclean_exit', { same_tab: true, was_discarded: true, navigation_type: navigation, last_snapshot: null });
  }, CHECK_PREVIOUS_AFTER_MS);
}

/**
 * A worker that keeps time while the page cannot: if the page's beats stop
 * for 8 s while it is visible, the main thread is stuck (an endless loop, a
 * huge render), and the page itself can report nothing. The worker reports it
 * directly, with the page's last snapshot.
 */
let watchdog: Worker | null = null;
const WATCHDOG_SOURCE = `
let last = Date.now(), hidden = false, leaving = false, snapshot = null, reported = false, ctx = null;
onmessage = (e) => {
  const m = e.data || {};
  if (m.type === 'init') { ctx = m; return; }
  if (m.type === 'beat') {
    last = Date.now(); hidden = !!m.hidden; leaving = !!m.leaving; reported = false;
    if (m.snapshot) snapshot = m.snapshot;
  }
};
function send(extra) {
  fetch(ctx.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, keepalive: true, body: JSON.stringify({
    kind: 'main_thread_stall', page: ctx.page, tab_id: ctx.tab_id, app_version: ctx.app_version,
    payload: Object.assign({ snapshot: snapshot, reported_at: new Date().toISOString(), user_agent: ctx.user_agent }, extra),
  }) }).catch(() => {});
}
setInterval(() => {
  if (!ctx || hidden || leaving || reported) return;
  const silent = Date.now() - last;
  if (silent > ${8_000}) { reported = true; send({ from: 'watchdog', recovered: false, frozen_for_s: Math.round(silent / 1000) }); }
}, 1000);
`;

function startWatchdog(): void {
  safe(() => {
    if (typeof Worker === 'undefined') return;
    const url = URL.createObjectURL(new Blob([WATCHDOG_SOURCE], { type: 'text/javascript' }));
    watchdog = new Worker(url);
    URL.revokeObjectURL(url);
    watchdog.postMessage({
      type: 'init',
      url: new URL('/api/client-reports', window.location.origin).href,
      page: window.location.pathname,
      tab_id: tabId,
      app_version: appVersion(),
      user_agent: navigator.userAgent,
    });
  }, undefined);
  // The page answers every second; the heartbeat carries the snapshot every 3 s.
  setInterval(() => watchdog?.postMessage({ type: 'beat', hidden: document.visibilityState === 'hidden' }), 1000);
}

function trackErrors(): void {
  const add = (kind: string, message: string, extra: Record<string, unknown>) => {
    const key = `${kind}:${message}`;
    if (seenErrors.has(key)) return;
    errorCounts[kind] = (errorCounts[kind] ?? 0) + 1;
    if (errorCounts[kind] > MAX_ERRORS_PER_KIND) return;
    seenErrors.add(key);
    report(kind, { message: message.slice(0, 500), ...extra });
  };
  window.addEventListener('error', (event) => {
    // Resource load errors (img/script) have no message; they are not app errors.
    if (!event.message) return;
    add('js_error', event.message, { source: event.filename, line: event.lineno, col: event.colno, stack: String((event.error as Error | undefined)?.stack ?? '').slice(0, 2000) });
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as { message?: string; stack?: string } | undefined;
    add('unhandled_rejection', String(reason?.message ?? reason ?? 'unknown'), { stack: String(reason?.stack ?? '').slice(0, 2000) });
  });
}

function trackFetch(): void {
  nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const entry: RequestEntry = { method: (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase(), path: pathOf(url), status: 'pending', ms: null, at: Date.now() };
    const tracked = entry.path.startsWith('/api/') && !entry.path.startsWith('/api/client-reports');
    if (tracked) {
      requests.push(entry);
      if (requests.length > MAX_REQUESTS * 2) requests.splice(0, requests.length - MAX_REQUESTS);
    }
    try {
      const res = await nativeFetch(input, init);
      entry.status = res.status;
      return res;
    } catch (error) {
      entry.status = 'failed';
      throw error;
    } finally {
      entry.ms = Date.now() - entry.at;
    }
  };
}

function trackWebSockets(): void {
  const Native = window.WebSocket;
  class TrackedWebSocket extends Native {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      ws.opened += 1;
      this.addEventListener('message', (event: MessageEvent) => {
        const data = event.data as unknown;
        const size = typeof data === 'string' ? data.length : (data as { byteLength?: number; size?: number })?.byteLength ?? (data as { size?: number })?.size ?? 0;
        ws.messages += 1;
        ws.bytes += size;
        if (typeof data === 'string' && data.slice(0, 80).includes('screen_capture')) {
          ws.frames += 1;
          ws.frameBytes += size;
          ws.lastFrameAt = Date.now();
        }
      });
      this.addEventListener('close', (event: CloseEvent) => {
        ws.closed += 1;
        ws.lastCloseCode = event.code;
      });
    }
  }
  window.WebSocket = TrackedWebSocket as typeof WebSocket;
}

function trackLongTasks(): void {
  safe(() => {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks += 1;
        longTaskMs += entry.duration;
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
  }, undefined);
}

/** Called by the full-screen loader: reports it if it stays up too long. */
export function loaderVisible(visible: boolean): void {
  if (visible) {
    if (loaderShownAt !== null) return;
    loaderShownAt = Date.now();
    loaderReported = false;
    const shownAt = loaderShownAt;
    setTimeout(() => {
      if (loaderShownAt === shownAt && !loaderReported) {
        loaderReported = true;
        report('stuck_loader', { after_s: Math.round((Date.now() - shownAt) / 1000) });
      }
    }, STUCK_LOADER_MS);
  } else {
    if (loaderShownAt !== null && loaderReported) report('stuck_loader', { recovered_after_s: Math.round((Date.now() - loaderShownAt) / 1000) });
    loaderShownAt = null;
  }
}

/**
 * `probe` describes auth state for reports and must not return secrets;
 * `getToken` is only used to authenticate the report request itself.
 */
export function registerAuthProbe(probe: AuthProbe, getToken?: TokenGetter): void {
  authProbe = () => {
    const state = { ...probe() };
    delete state.token;
    delete state.accessToken;
    return state;
  };
  tokenGetter = getToken ?? null;
}

export function startClientDiagnostics(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  tabId = safe(() => sessionStorage.getItem(TAB_KEY) ?? '', '');
  if (!tabId) {
    tabId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    safe(() => sessionStorage.setItem(TAB_KEY, tabId), undefined);
  }
  trackFetch();
  trackWebSockets();
  trackErrors();
  trackLongTasks();
  checkPreviousLife();
  startWatchdog();
  heartbeat();
  setInterval(() => heartbeat(), HEARTBEAT_MS);
  setInterval(() => void flush(), 15_000);
  window.addEventListener('pagehide', () => {
    leaving = true;
    heartbeat(true);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenSinceLastBeat = true;
    heartbeat();
  });
  // Back/forward cache restores the page without a new boot: it is alive again.
  window.addEventListener('pageshow', (event) => {
    if ((event as PageTransitionEvent).persisted) {
      leaving = false;
      heartbeat();
    }
  });
  window.addEventListener('online', () => void flush());
  setTimeout(() => void flush(), 3000);
}
