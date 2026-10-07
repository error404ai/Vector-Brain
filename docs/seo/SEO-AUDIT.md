# SEO audit — app.vectoragent.in

> Status: the fixes are implemented. See SEO-REPORT.md for what changed. The decisions taken were: brand **FLEET**, host **app.vectoragent.in**, free to use, up to 1,000 phones per fleet, target the phone-farm keywords, company **Vector AI Agent** with **support@vectoragent.in**, and all crawlers allowed.

Audited from the repository at commit `e7542df` (October 2026): `frontend/` (React 19 + Vite SPA), `src/app.ts` (Express server that serves the built frontend), and the built output in `public/`. The live site could not be fetched from the audit environment, so anything that depends on hosting (DNS, Cloudflare, redirects, the `.io` domain) is marked **verify on live**.

## Summary

The product is strong, but the public site is effectively invisible to every crawler that does not run JavaScript, and Google only sees it after rendering. The biggest problems are:

- **Rendering.** Every URL returns the same empty HTML shell: a loading spinner and a script tag.
- **No crawl infrastructure.** There is no robots.txt, no sitemap, no canonical tags and no structured data.
- **A split identity.** The site calls itself "FLEET by Vector Brain", "Vector Brain" and "Vector" in different places.
- **Unsupported claims.** Some marketing promises scale ("unlimited", "10,000") and pricing ("Free to use") that the product does not back.

The fixes are mostly infrastructure. They do not require redesigning the landing page.

## Public surface today

| URL | What it is | Indexable content in raw HTML |
|---|---|---|
| `/` | Landing page ("FLEET"), with a WebGL scroll scene | None; it is rendered client-side |
| `/docs` | Documentation, added on 2 Oct | None; it is rendered client-side |
| `/login`, `/signup` | Auth forms | None |
| `/llms.txt`, `/llms-full.txt` | Text summary and full docs for AI tools | Yes (plain text) |
| `/dashboard`, `/mission-control`, `/android-*`, `/flows`, `/settings`, … | Private app | Same shell, HTTP 200 |
| Any other path | Unknown URL | Same shell, HTTP 200 |

---

## Critical

### C1. Public pages have no content in the HTML
- **Problem:** Every route is served `index.html`, whose body is only `<div id="root"><div class="vb-boot">…spinner…</div></div>` plus the script. The H1, copy, FAQ and docs exist only after roughly 400 KB (brotli) of JavaScript downloads and runs.
- **Why it matters:**
  - Google renders JavaScript, but in a second, delayed wave.
  - Bing renders it less reliably.
  - Most AI crawlers (GPTBot, ClaudeBot, PerplexityBot, CCBot) and every social link preview read only the raw HTML, so for them the site has no content at all.
  - LCP is also blocked on the JavaScript: the H1 cannot paint until the main bundle (745 KB raw) has run.
- **Current:** `frontend/index.html` is the shell; `src/app.ts` sends it for every path (`app.get('*')`). The page titles come from `react-helmet-async`, which only runs on the client.
- **Fix:** Prerender the public routes (`/`, `/docs` and any new marketing pages) to static HTML at build time with Vite's SSR build and `renderToString`. Hydrate on the client. Express serves the prerendered file for those paths; the private app stays a plain SPA. This needs no framework migration.

### C2. robots.txt and sitemap.xml return the app's HTML
- **Problem:** Neither file exists. The catch-all route answers `/robots.txt` and `/sitemap.xml` with `index.html` and status 200.
- **Why it matters:** Crawlers fetch an HTML page where they expect a robots file. There is no sitemap to speed discovery, and nothing marks the private app as off-limits.
- **Current:** Nothing in `frontend/public/` for either file; the fallback in `src/app.ts:194-203` serves the shell.
- **Fix:**
  - Add a real `robots.txt`: allow the public pages, disallow the app routes and `/api`, and point to the sitemap. Treat AI crawlers deliberately; see the plan.
  - Generate `sitemap.xml` at build time from the list of indexable routes, so the sitemap and the routes cannot disagree.

### C3. Soft 404s: every URL is a 200
- **Problem:** `/anything-at-all` returns 200 with the shell.
- **Why it matters:** Google treats this as a soft 404 and may waste crawl budget. Typo URLs and old URLs never drop out of the index.
- **Current:** The catch-all in `src/app.ts`.
- **Fix:**
  - Keep a server-side list of real routes.
  - Unknown paths get a **404 status** and a prerendered "not found" page.
  - App routes keep 200, but send `X-Robots-Tag: noindex` (see H1).

### C4. No privacy policy, terms, contact or company information
- **Problem:** There are no `/privacy`, `/terms`, `/contact` or `/about` pages anywhere.
- **Why it matters:**
  - **Trust and E-E-A-T.** A product that controls phones and stores encrypted API keys, with no privacy policy or company identity, is a weak trust signal for users and search quality raters alike.
  - **Blocks other plans.** Google OAuth verification (the site has Google sign-in), YouTube API audit and Meta app review all require a public privacy policy. That blocks the reels auto-posting idea too.
- **Fix:** Add privacy, terms and contact pages. The legal text has to come from you; it cannot be invented. Then link them from every footer.

---

## High

### H1. Private app routes are indexable
- **Problem:** `/dashboard`, `/mission-control`, `/settings` and the rest return 200 with no noindex. They then redirect to `/login` client-side.
- **Why it matters:** Thin, duplicate "login" pages can be indexed under many URLs.
- **Fix:**
  - Send an `X-Robots-Tag: noindex, nofollow` header on all app routes and on `/login`/`/signup`.
  - Disallow them in robots.txt.
  - Keep `/signup` indexable only if you want it to rank for brand + "sign up". It is not recommended as a landing page.

### H2. No canonical URLs; possible duplicate domains
- **Problem:** There is no `<link rel="canonical">` anywhere. The server's CORS list includes `https://app.vectoragent.io`, which suggests a second domain may serve the same site.
- **Why it matters:** Duplicate hosts (`.in`/`.io`, `www`, http, trailing slash) split ranking signals.
- **Fix:**
  - Put a canonical on every public page, pointing at one host.
  - 301 all other hosts and variants to it. **Verify on live:** what `vectoragent.io`, `www.` and the bare `vectoragent.in` serve.

### H3. The entity has three names
- **Problem:**
  - The page title and H1 say **"FLEET by Vector Brain"**.
  - `index.html`, Open Graph, login and signup say **"Vector Brain"**.
  - The phone app is **"Vector"**.
  - Some error messages say **"Android Automation"**.
- **Why it matters:** Search engines and LLMs build one entity from consistent naming. Three brand names for one product dilute it, and "FLEET" alone is unrankable: it is a generic word with heavy competition (fleet management).
- **Fix:** Pick one canonical entity name and use it everywhere: titles, H1, schema `name`, Open Graph `site_name`, llms.txt and docs. Recommended (decision needed):
  - **Vector Brain** as the product and organisation;
  - **Vector** as the Android app;
  - **FLEET** dropped, or kept only as a visual wordmark that is never the text name.

### H4. Unsupported claims in titles and copy
- **Problem:**
  - The title and H1 say "AI that automates **unlimited** Android phones", and the copy says "One phone or **10,000**".
  - The code limits a mission to 50 phones and a file send to 1,000.
  - The FAQ says there is no per-device limit, but no fleet of that size has been demonstrated.
  - The `index.html` description says "**Free to use**"; no pricing exists in the code to confirm or deny this.
  - The RUNS section shows device counts ("240", "1,000", "500"). *Correction:* these are already labelled "Illustrative examples", so they can stay.
- **Why it matters:** Unbacked numbers are exactly what the brief forbids. They are a trust risk with users, and with Google's reviews and helpful-content systems.
- **Fix:**
  - Replace them with claims the product backs, for example "one phone or a whole fleet", "up to 50 phones per mission".
  - Label example runs as examples.
  - Confirm pricing, or remove "Free".

### H5. No structured data
- **Problem:** There is no JSON-LD anywhere.
- **Fix:**
  - **Organization + WebSite** on `/`.
  - **SoftwareApplication** (applicationCategory, operatingSystem "Android 10+", offers only if pricing is confirmed).
  - **FAQPage** on pages with visible FAQs.
  - **BreadcrumbList** on deeper pages.
  - **TechArticle** on docs and guides.
  - No ratings, reviews, user counts or prices unless they are real.

### H6. Link previews are generic and have no image
- **Problem:** There is no `og:image`, `twitter:card` is `summary`, and every URL shares the same title and description, because Open Graph tags are only in the shell and Helmet changes them client-side.
- **Fix:** Add per-page Open Graph and Twitter tags in the prerendered HTML, plus a 1200×630 share image built from a real product screenshot.

---

## Medium

### M1. Heavy JavaScript on the landing page (Core Web Vitals)
- **Problem:** The landing page loads the main bundle (`index-*.js`, 745 KB raw) and three.js (511 KB raw) for the WebGL scene, plus Google Fonts from a third-party origin.
- **Why it matters:** These are LCP and INP risks on mid-range phones, which is precisely the audience browsing this.
- **Current:** The main bundle includes app code that the landing page does not use (MUI, RTK Query, and so on). three.js is imported by `fleetScene.ts`. *Correction after implementation:* three.js was already loaded with a dynamic `import()` after first paint, so it never blocked LCP.
- **Fix:**
  - With prerendering, LCP becomes the server-rendered H1 text and no longer waits on JavaScript.
  - Load three.js after first paint, behind an idle callback, and skip it on low-end devices or when reduced motion is set.
  - Self-host the two fonts, preload the H1 font, and use `font-display: swap` with metric-matched fallbacks to avoid CLS.
  - Split the public pages away from the app shell's providers.

### M2. Heading semantics are styled, not structured
- **Problem:**
  - The H1 is "AI that automates *unlimited* Android phones." and never names the category ("Android automation") or the brand in text.
  - H2s are marketing phrases ("Any Android phone", "One instruction runs on every phone.").
  - Some sections expose content only via `aria-label` and visual layout.
- **Fix:** Rewrite the H1 and intro so the first 300 words state plainly what the product is, keeping the visual treatment, and give H2s descriptive text.

### M3. No internal links between public pages
- **Problem:**
  - The landing nav links only to its own sections plus sign-in and signup.
  - The docs link back only to home.
  - The footer now has Docs and llms.txt, and nothing else.
- **Fix:** Add a real footer link map (product, use cases, docs, company, legal) and contextual links between the landing page, the feature and use-case pages, and the docs.

### M4. Hidden and video content
- **Problem:** The six landing videos are stock footage (`aria-hidden`, `preload="none"`, labelled "Illustrative feed · stock footage"). That is honest, but it is not product evidence.
- **Fix:** Replace them with real screen recordings of real runs. `frontend/public/fleet/README.txt` already describes how. Real recordings strengthen trust and enable VideoObject schema later.

### M5. Title and description quality
- **Current:**
  - Home title: "FLEET by Vector Brain — AI that automates unlimited Android phones".
  - Login and signup titles: "Login - Vector Brain" / "Sign Up - Vector Brain".
- **Fix:**
  - Home title along the lines of **"Vector Brain — AI that operates real Android phones"**, with a description that names the category, the mechanism (natural-language tasks, real devices, no ADB/root) and the scale ("one phone or a fleet").
  - Give each page a unique title and description.

---

## Low

- **L1.** `frontend/public/vite.svg` is an unused Vite default asset; remove it.
- **L2.** There is no `apple-touch-icon` or web manifest. Minor for SEO, but nice for shared links and bookmarks.
- **L3.** `/docs` sections have IDs but no per-section shareable title in previews; fine for now.
- **L4.** The landing page's `<html lang="en">` is static. If Hindi or Hinglish pages are added later, they need `hreflang`. Not needed today.
- **L5.** `brand/vector-bot.png` is 64 KB PNG; serve WebP or AVIF if it is used above the fold.

## Already good

- `/docs` content is accurate and fact-checked against code, and it is readable without login (open route).
- `llms.txt` and `llms-full.txt` exist and match the docs (single source).
- Hashed assets are cached for a year with brotli/gzip; `index.html` is `no-cache`.
- The landing FAQ answers are mostly backed by code (the file comment says so), and the stock footage is labelled honestly.
- The pages are responsive, `prefers-reduced-motion` is respected on the landing page and docs, and there is a skip link on the docs.

## Needs verification on the live site

1. What `vectoragent.in`, `www.vectoragent.in`, `app.vectoragent.io` and `http://` return (redirect or duplicate).
2. Whether Cloudflare's "Block AI bots", "AI Labyrinth" or bot-fight settings are on. They would silently block AI crawlers whatever robots.txt says.
3. The real TTFB and Core Web Vitals (PageSpeed Insights or CrUX) for `/`.
4. Whether Google Search Console and Bing Webmaster Tools are already verified.
