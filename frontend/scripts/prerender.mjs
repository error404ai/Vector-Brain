// Writes the public pages as static HTML after the client and SSR builds:
//   public/__pre/*.html     one file per public page, plus 404.html
//   public/__pre/manifest.json   which path is which file, and the app's own routes
//   public/robots.txt, public/sitemap.xml
// The server (src/app.ts) reads the manifest: public pages are sent as these
// files, app routes get the plain shell with noindex, anything else is a 404.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const frontend = path.resolve(here, '..');
const out = path.resolve(frontend, '../public');
const preDir = path.join(out, '__pre');

const ssr = await import(pathToFileURL(path.join(frontend, '.ssr/entry-server.js')).href);
const { render, renderedPaths, PUBLIC_PAGES, SITE, NOT_FOUND } = ssr;

const shell = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
const SEO_BLOCK = /<!--seo:start-->[\s\S]*?<!--seo:end-->/;
const APP_BLOCK = /<!--app:start-->[\s\S]*?<!--app:end-->/;
if (!SEO_BLOCK.test(shell) || !APP_BLOCK.test(shell)) throw new Error('index.html is missing the seo/app markers');

const fileFor = (p) => (p === '/' ? 'index.html' : `${p.slice(1).replace(/\//g, '--')}.html`);

fs.rmSync(preDir, { recursive: true, force: true });
fs.mkdirSync(preDir, { recursive: true });

const pages = {};
for (const p of renderedPaths) {
  const { html, head } = render(p);
  if (!html.includes('<h1')) throw new Error(`Prerendered ${p} has no <h1>`);
  const doc = shell
    .replace(SEO_BLOCK, head)
    .replace(APP_BLOCK, '')
    .replace('<div id="root">', `<div id="root" data-prerendered="${p}">${html}`);
  const file = p === NOT_FOUND ? '404.html' : fileFor(p);
  fs.writeFileSync(path.join(preDir, file), doc);
  if (p !== NOT_FOUND) pages[p] = file;
}

for (const pg of PUBLIC_PAGES) if (!pages[pg.path]) throw new Error(`${pg.path} is in site.ts but has no prerendered page`);

// The app's own routes, read from the router so a new page is never answered
// with a 404 by mistake. Public pages are excluded; they are served above.
const appSource = fs.readFileSync(path.join(frontend, 'src/App.tsx'), 'utf8');
const appRoutes = [...appSource.matchAll(/path:\s*'([^']+)'/g)]
  .map((m) => m[1])
  .filter((r) => r !== '*' && !(r in pages));

fs.writeFileSync(path.join(preDir, 'manifest.json'), JSON.stringify({ pages, notFound: '404.html', appRoutes }, null, 2));

// robots.txt: every crawler is welcome on the public pages (search, AI search
// and AI training alike, by the owner's choice). The API is not for crawling;
// app routes are kept out of the index with an X-Robots-Tag header instead of a
// Disallow, so crawlers can see the noindex.
fs.writeFileSync(
  path.join(out, 'robots.txt'),
  [
    '# FLEET by Vector Brain — all crawlers welcome, including AI search and AI crawlers.',
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    '',
    `Sitemap: ${SITE.origin}/sitemap.xml`,
    '',
  ].join('\n'),
);

const today = new Date().toISOString().slice(0, 10);
const urls = PUBLIC_PAGES.map(
  (pg) =>
    `  <url>\n    <loc>${SITE.origin}${pg.path === '/' ? '/' : pg.path}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${pg.changefreq}</changefreq>\n    <priority>${pg.priority.toFixed(1)}</priority>\n  </url>`,
);
fs.writeFileSync(
  path.join(out, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`,
);

console.log(`✓ prerendered ${Object.keys(pages).length} public pages + 404, robots.txt, sitemap.xml (${appRoutes.length} app routes noindexed)`);
