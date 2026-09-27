/**
 * Phone screenshots arrive as full-size base64 JPEGs (1080×2400 and up). Put in
 * an <img> as a data: URI, each one costs ~10 MB of decoded bitmap however small
 * it is drawn, and a long chat collects well over a hundred of them: iPhone
 * Safari kills the tab (seen in browser reports: 135 images, tab reloaded).
 *
 * Tiles show a downscaled copy instead: decoded once, redrawn at `maxWidth`,
 * re-encoded, and kept as a Blob URL of a few tens of KB. The full image is only
 * used where it is shown big (the zoom).
 */
import { useEffect, useRef, useState } from 'react';

/** Tiles are ~80–100 CSS px wide; this stays sharp at 3× pixel density. */
export const THUMB_WIDTH = 300;
const MAX_CACHED = 400;
/** Full-size decodes happen one or two at a time, never a hundred at once. */
const MAX_PARALLEL = 2;

const cache = new Map<string, string>(); // key -> blob: URL, oldest first
const inflight = new Map<string, Promise<string | null>>();
let running = 0;
const waiting: (() => void)[] = [];

function remember(key: string, url: string): void {
  cache.delete(key);
  cache.set(key, url);
  while (cache.size > MAX_CACHED) {
    const [oldKey, oldUrl] = cache.entries().next().value as [string, string];
    cache.delete(oldKey);
    URL.revokeObjectURL(oldUrl);
  }
}

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_PARALLEL) await new Promise<void>((resolve) => waiting.push(resolve));
  running += 1;
  try {
    return await fn();
  } finally {
    running -= 1;
    waiting.shift()?.();
  }
}

/** base64 (with or without a data: prefix) to a Blob, without building a data: URI. */
export function base64ToBlob(base64: string): Blob {
  let mime = 'image/jpeg';
  let body = base64;
  if (base64.startsWith('data:')) {
    const comma = base64.indexOf(',');
    mime = base64.slice(5, base64.indexOf(';')) || mime;
    body = base64.slice(comma + 1);
  } else if (base64.startsWith('iVBOR')) {
    mime = 'image/png';
  }
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function decode(blob: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() };
    } catch {
      // Fall through to <img>; some Safari versions refuse certain JPEGs here.
    }
  }
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
  return {
    source: img,
    width: img.naturalWidth,
    height: img.naturalHeight,
    release: () => {
      URL.revokeObjectURL(url);
      img.src = '';
    },
  };
}

async function downscale(base64: string, maxWidth: number): Promise<Blob> {
  const blob = base64ToBlob(base64);
  const image = await decode(blob);
  try {
    if (image.width <= maxWidth) return blob;
    const width = maxWidth;
    const height = Math.max(1, Math.round((image.height / image.width) * maxWidth));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image.source, 0, 0, width, height);
    const small = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    // Hand the canvas memory back right away (Safari holds it otherwise).
    canvas.width = 0;
    canvas.height = 0;
    return small ?? blob;
  } finally {
    image.release();
  }
}

/** The thumbnail for `key` if it is already made. */
export function peekThumbnail(key: string): string | undefined {
  return cache.get(key);
}

/** A small Blob URL for a screenshot, made once per key and cached. Null when it cannot be decoded. */
export function thumbnailUrl(key: string, base64: string, maxWidth = THUMB_WIDTH): Promise<string | null> {
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(key);
  if (pending) return pending;
  const job = withSlot(() => downscale(base64, maxWidth))
    .then((small) => {
      const url = URL.createObjectURL(small);
      remember(key, url);
      return url;
    })
    .catch(() => null)
    .finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}

/** A stable cache key for a screenshot that has no id of its own. */
export function contentKey(prefix: string, base64: string): string {
  return `${prefix}:${base64.length}:${base64.slice(-48)}`;
}

/** React side of thumbnailUrl: null until the thumbnail is ready (the original if it cannot be shrunk). */
export function useThumbnail(key: string | null, base64: string | null | undefined, maxWidth = THUMB_WIDTH): string | null {
  const [made, setMade] = useState<{ key: string; url: string } | null>(null);
  useEffect(() => {
    if (!key || !base64 || peekThumbnail(key)) return;
    let alive = true;
    void thumbnailUrl(key, base64, maxWidth).then((url) => {
      // Could not be shrunk (odd format): show the original rather than nothing.
      if (alive) setMade({ key, url: url ?? (base64.startsWith('data:') ? base64 : `data:image/jpeg;base64,${base64}`) });
    });
    return () => {
      alive = false;
    };
  }, [key, base64, maxWidth]);
  if (!key || !base64) return null;
  return peekThumbnail(key) ?? (made?.key === key ? made.url : null);
}

/**
 * Whether an element is near the viewport, both ways: `near` goes false again
 * when it scrolls far off, so the tile can drop its <img> and the browser its
 * bitmap. `seen` stays true once it has been near (for fetching once).
 */
export function useNearViewport<T extends HTMLElement>(margin = '600px') {
  const ref = useRef<T | null>(null);
  const [near, setNear] = useState(false);
  const [seen, setSeen] = useState(false);
  const supported = typeof IntersectionObserver !== 'undefined';
  useEffect(() => {
    const el = ref.current;
    if (!el || !supported) return;
    const io = new IntersectionObserver(
      (entries) => {
        const visible = entries.some((e) => e.isIntersecting);
        setNear(visible);
        if (visible) setSeen(true);
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [margin, supported]);
  return { ref, near: supported ? near : true, seen: supported ? seen : true };
}
