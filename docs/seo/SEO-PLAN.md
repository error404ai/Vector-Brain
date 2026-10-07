# SEO implementation plan — for approval

Ordered by impact. Phases 1–3 are infrastructure and can ship without new copy decisions. Phases 4–5 need the decisions listed at the end.

## Phase 1 — Make the public pages crawlable (fixes C1, C2, C3, H1, H2)

1. **Prerender public routes at build time.**
   - `frontend/src/entry-server.tsx` renders the public routes with `renderToString`, through a `vite build --ssr` step.
   - `scripts/prerender.mjs` writes `public/index.html` (home), `public/docs/index.html`, and so on. Each file gets per-page `<title>`, description, canonical, Open Graph and Twitter tags, and JSON-LD.
   - The client hydrates (`hydrateRoot`) on public pages; the private app keeps `createRoot`.
   - The landing page's WebGL and scroll engine already start in `useEffect`, so they are unaffected by server rendering.
2. **Server routing** (`src/app.ts`):
   - Prerendered paths are served as static files.
   - Known app routes get the SPA shell plus `X-Robots-Tag: noindex`.
   - Unknown paths get **404** plus a prerendered not-found page.
   - `/api` is unchanged.
3. **robots.txt and sitemap.xml**, generated at build from one route list, and served before the catch-all.
4. **Canonical host.** One host in every canonical. 301 redirects for the other hosts belong at Cloudflare or Coolify (manual; see the launch checklist).

## Phase 2 — Entity, metadata and structured data (H3, H5, H6, M5)

- One name across titles, Open Graph, schema, llms.txt and docs (decision 1).
- JSON-LD:
  - Organization and WebSite (home);
  - SoftwareApplication (home);
  - FAQPage (home FAQ, already visible);
  - TechArticle and BreadcrumbList (docs and new pages).
  - Validated with Google's Rich Results Test schema rules. No ratings, prices or counts.
- A share image (1200×630) built from a real dashboard screenshot.

## Phase 3 — Performance (M1)

- three.js loads after first paint (idle callback), and is skipped when `prefers-reduced-motion` is set or the device is low-memory. The landing page already has a `.nogl` fallback.
- Self-hosted Archivo and IBM Plex Mono, with the H1 font preloaded.
- Public pages no longer pull the app's providers bundle.
- Targets: LCP < 2.5 s and CLS < 0.1 on mobile. Measured before and after with Lighthouse in the repo's Playwright setup.

## Phase 4 — Copy, honesty and internal links (H4, M2, M3)

- Rewrite the home H1, intro and H2s so the first 300 words define the product. The visual design stays the same.
- Remove "unlimited", "10,000" and "Free to use" unless backed. Label example runs as examples.
- Add a footer link map: product, use cases, docs, company, legal. Add contextual links between pages.

## Phase 5 — New pages (only after Phases 1–4)

Start with four pages, each with real screenshots and a distinct purpose:

1. `/how-it-works`
2. `/android-fleet-automation`
3. `/use-cases/mobile-app-testing`
4. `/compare/appium`

Guides (`/guides/...`) come next, at one a week, only when there is real material (screenshots, runs, numbers).

## Not doing (on purpose)

- No mass programmatic pages, city/industry permutations or doorway pages.
- No `/android-automation-api` page until a public API exists.
- No hidden text "for LLMs". llms.txt mirrors the visible docs only.
- No fake reviews, ratings, customer logos or usage numbers.
- No full Next.js or Astro migration. Build-time prerendering gets the same crawlability without rewriting the app.

## Decisions needed before building

1. **Name:** "Vector Brain" everywhere, with "FLEET" dropped or kept only as a visual logo? (Recommended.)
2. **Canonical host:** stay on `app.vectoragent.in`, or move marketing to `vectoragent.in` with the app on `app.`? (The root domain is better long-term, but it is a hosting change.)
3. **Claims:** is the product free today? What is the largest number of phones actually run at once?
4. **Phone-farm keywords:** target them (they attract multi-account intent that conflicts with the acceptable-use policy) or skip them?
5. **Legal pages:** can you provide privacy, terms and contact details (company name, email, address)? I will structure the pages, but the legal text must be yours.
6. **AI crawlers:** allow search and answer bots (OAI-SearchBot, PerplexityBot, Claude-SearchBot, Googlebot, Bingbot) but block training bots (GPTBot, ClaudeBot, CCBot, Google-Extended)? Or allow all for maximum AI visibility? (Recommended: allow all. Visibility in AI answers depends partly on training data, and the content is public marketing anyway.)

## Off-site / manual action required

- **Search Console and Bing Webmaster Tools:** verify the domain, submit the sitemap, and request indexing for the home page and docs.
- **Cloudflare:** check the AI-bot blocking settings and set up 301s for alternate hosts.
- **Real proof:** record real screen clips of real runs to replace the stock footage, and collect a few real case results.
- **Listings and links:** list on Product Hunt, AlternativeTo and relevant GitHub awesome-lists (honest descriptions); write a launch post on a developer community.
