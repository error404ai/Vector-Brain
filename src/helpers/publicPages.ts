import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * How a browser-facing path is answered, from the manifest the frontend build
 * writes (frontend/scripts/prerender.mjs):
 *  - a public page → its prerendered HTML (crawlable, indexable);
 *  - an app route → the plain app shell, kept out of search with noindex;
 *  - anything else → HTTP 404 with the not-found page.
 * Without a manifest (a dev build), everything falls back to the app shell.
 */

export interface PublicManifest {
  pages: Record<string, string>;
  notFound: string;
  appRoutes: string[];
}

export type PageDecision =
  | { kind: 'page'; file: string }
  | { kind: 'redirect'; to: string }
  | { kind: 'app' }
  | { kind: 'notFound'; file: string };

export function loadManifest(dir: string): PublicManifest | null {
  try {
    const m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as PublicManifest;
    return m && m.pages && Array.isArray(m.appRoutes) ? m : null;
  } catch {
    return null;
  }
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** '/runs/:id' → /^\/runs\/[^/]+\/?$/ */
export const routePattern = (route: string) =>
  new RegExp(`^${route.split('/').map((seg) => (seg.startsWith(':') ? '[^/]+' : escape(seg))).join('/')}/?$`);

export function createPageRouter(manifest: PublicManifest | null) {
  const app = (manifest?.appRoutes ?? []).map(routePattern);
  return (path: string): PageDecision => {
    if (!manifest) return { kind: 'app' };
    const page = manifest.pages[path];
    if (page) return { kind: 'page', file: page };
    // One URL per page: /docs/ and /index.html redirect to the canonical form.
    if (path === '/index.html') return { kind: 'redirect', to: '/' };
    if (path.length > 1 && path.endsWith('/')) {
      const bare = path.replace(/\/+$/, '') || '/';
      if (manifest.pages[bare]) return { kind: 'redirect', to: bare };
    }
    if (app.some((re) => re.test(path))) return { kind: 'app' };
    return { kind: 'notFound', file: manifest.notFound };
  };
}
