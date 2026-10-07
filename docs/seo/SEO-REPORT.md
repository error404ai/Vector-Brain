# SEO implementation report

## 1. What was wrong before

- **Empty pages for crawlers.** Every URL returned the same spinner shell; content existed only after JavaScript ran, so AI crawlers and link previews saw nothing.
- **No crawl files.** No robots.txt and no sitemap; both URLs answered with the app's HTML.
- **No 404s.** Every URL returned 200, including typos and the private app routes, which had no noindex.
- **No metadata.** No canonical tags, no structured data, no share image.
- **Confused identity.** Three names (FLEET, Vector Brain, Vector).
- **Unbacked claims.** "Unlimited" and "10,000 phones" had no support.
- **No trust pages.** No privacy policy, terms or contact page.
- **Few internal links.** One landing page and the docs, barely linked to each other.

## 2. What changed

- **Build-time prerendering.** The public pages are rendered to static HTML at build time (Vite SSR + `renderToString`). Each page carries its own title, description, canonical, Open Graph/Twitter tags and JSON-LD.
- **Server routing.** Express serves public pages from the prerendered files, app routes with the shell plus `X-Robots-Tag: noindex, nofollow`, and unknown URLs with **HTTP 404** and a not-found page. `/docs/` and `/index.html` 301 to their canonical URLs.
- **Generated crawl files.** robots.txt (all crawlers allowed) and sitemap.xml are generated from the same page list.
- **Eight new pages:** How it works, Android fleet automation, Phone farm automation, AI mobile app testing, FLEET vs Appium, Contact, Privacy, Terms.
- **One name.** FLEET everywhere (with "by Vector Brain"); the company is Vector AI Agent and the phone app is "Vector".
- **Honest claims.** "Unlimited" and "10,000" became "up to 1,000"; the scale counter now tops out at 1,000. The landing H1 and intro now define the product.
- **Internal links.** A footer link map on every public page, breadcrumbs, and a Related box plus a call to action on each product page.
- **Fonts.** Self-hosted (Archivo with the width axis, IBM Plex Mono, Instrument Serif) instead of Google Fonts.
- **Share image.** A 1200×630 image.
- **llms.txt.** Updated with the new pages and facts.

## 3. Files changed

| Area | Files |
|---|---|
| Server | `src/app.ts`; new `src/helpers/publicPages.ts` and its test |
| Frontend config and entry | `frontend/index.html` (markers, default meta), `frontend/vite.config.ts` (SSR config), `frontend/package.json` (build step, font packages), `frontend/pnpm-lock.yaml`, `frontend/scripts/prerender.mjs` (new), `frontend/src/entry-server.tsx` (new), `frontend/src/main.tsx` (mount after the router is ready), `frontend/src/App.tsx` (routes, 404 page, `router` export), `frontend/src/hooks/useAuthRedirect.ts` (public pages open to all) |
| SEO core (new) | `frontend/src/seo/site.ts`, `schema.ts`, `Seo.tsx`, `fonts.ts` |
| Site chrome (new) | `frontend/src/components/site/SiteChrome.tsx`, `ProductPage.tsx`, `site.css` |
| New pages | `frontend/src/pages/site/*.tsx` |
| Updated pages | `frontend/src/pages/HomePage.tsx`, `DocsPage.tsx`, `components/landing/fleetLanding.ts`, `fleetState.ts`, `fleet.css`, `docs/docs.css` |
| Public files | `frontend/public/llms.txt`, `frontend/public/og/fleet-share.png` |
| Repo | `.gitignore` (build output); removed `public/llms*.txt`, which had been committed by accident (they are build output) |

## 4–5. Keyword architecture and page → keyword

See `SEO-KEYWORD-MAP.md`. In short:

| Page | Primary keyword |
|---|---|
| `/` | AI Android automation |
| `/android-fleet-automation` | Android fleet automation |
| `/phone-farm-automation` | phone farm automation |
| `/how-it-works` | how AI automates Android phones / real-device automation |
| `/use-cases/mobile-app-testing` | AI mobile testing on real Android devices |
| `/compare/appium` | Appium alternative |
| `/docs` | FLEET docs / navigational |

## 6. New pages

`/how-it-works`, `/android-fleet-automation`, `/phone-farm-automation`, `/use-cases/mobile-app-testing`, `/compare/appium`, `/contact`, `/privacy`, `/terms`, plus a 404 page.

## 7. Technical SEO

- Prerendered HTML for 10 public URLs.
- Canonicals point at `https://app.vectoragent.in`.
- 301 redirects for trailing slashes and `/index.html`.
- 404 status for unknown URLs.
- noindex header on the 17 app routes, which are read from the router so a new app route is never 404'd.
- `/__pre/` is not reachable directly.
- robots.txt and sitemap.xml generated at build time; `index: false` on static serving so `/` is always the prerendered home.

## 8. Structured data

All JSON-LD sits in one `@graph` per page:

- **Home:** Organization (Vector AI Agent, support email), WebSite and SoftwareApplication (FLEET, price 0, feature list), plus FAQPage from the visible FAQ.
- **Product and legal pages:** WebPage, or TechArticle for docs and the comparison, plus BreadcrumbList.
- **FAQ:** FAQPage wherever a FAQ is visible.

No ratings, reviews, user counts or awards.

## 9. Performance

- **LCP no longer waits on JavaScript.** The H1 and text are in the HTML.
- **No third-party font host.** Fonts are self-hosted.
- **three.js** was already loaded after first paint, so it was left as it was.
- **No content flash.** The client mounts only after the router has loaded the page code, so the prerendered page is swapped for identical markup with no loading flash.
- **Product pages skip the heading animation**, so it cannot delay LCP.

## 10. Internal-link strategy

- **Footer link map on every public page:**
  - Product: How it works, Fleet, Phone farm
  - Use cases: Testing, vs Appium
  - Resources: Docs, llms.txt
  - Company: Contact, Privacy, Terms
- **Breadcrumbs** on inner pages.
- **A Related box** on each product page linking sideways.
- **Contextual links in body text**, for example from testing to Appium and from phone farm to fleet and terms.
- **Header links** to How it works and Docs.

## 11. LLM / AI discoverability

- Real content is now in the HTML for crawlers that don't run JavaScript.
- `llms.txt` lists every page with one-line summaries; `llms-full.txt` is the full docs.
- Every page carries the same one-sentence definition.
- The FAQs answer "What is FLEET?", "Is it free?", "How does it control a phone?" and "What happens when it gets stuck?" in visible HTML.
- All crawlers are allowed in robots.txt.

## 12. Still to do manually

See `SEO-LAUNCH-CHECKLIST.md`. The main items:

- Search Console and Bing verification and sitemap submission.
- Cloudflare bot settings and host redirects.
- Confirming `AI_ENCRYPTION_KEY` and the optional environment settings listed there.
- A lawyer's read of the privacy policy and terms.
- Real screen recordings to replace the stock footage.

## 13. Top 20 next opportunities

1. Verify Search Console and Bing, and submit the sitemap.
2. Real run recordings on the landing page, with VideoObject schema.
3. Real dashboard screenshots (Mission Control, fleet wall) on the product pages.
4. Guide: how to control multiple Android phones (options compared honestly).
5. Guide: how AI agents automate Android (accessibility vs vision).
6. Guide: real phones vs cloud phones vs emulators.
7. `/compare/tasker` (on-device rules vs AI across a fleet).
8. Three or four case studies from your own fleet, with real numbers.
9. A public changelog page (fresh content plus a trust signal).
10. A status or uptime page.
11. A security page (how keys are encrypted, what the app can access).
12. A self-service "delete my account" flow, to back the privacy policy.
13. A working "Forgot password?" (the link exists but no feature is behind it).
14. Re-enable public run sharing (`/r/:token`), with prerendered share pages, so each run becomes a linkable proof.
15. Hindi/Hinglish versions of the key pages, with `hreflang`.
16. Product Hunt launch.
17. AlternativeTo listing.
18. Developer community write-ups.
19. Split the public pages' JavaScript away from the app bundle, to cut first-load JS on mobile.
20. Re-rank the keyword map with 4–6 weeks of Search Console data.

## 14. Deliberately not done

- No mass or programmatic pages, synonym pages or city/industry permutations.
- No `/android-automation-api` page, because there is no public API yet.
- No hidden text, no fake reviews, ratings, logos or user counts.
- No Next.js or Astro migration; build-time prerendering covers crawlability without rewriting the app.
- No hydration (`hydrateRoot`). The client renders over identical prerendered markup, which avoids hydration-mismatch risk across the large app. It can be revisited for INP.
- The app shell keeps its client-side behaviour; private pages were not made public.

## 15. Expected impact (estimate, not a guarantee)

- **Weeks 1–2.** Public pages should be crawled and indexed once Search Console is set up. Brand searches ("FLEET Vector Brain", "vectoragent") should show the home page with correct snippets, and link previews should show the share image.
- **Weeks 2–8.** Long-tail impressions for "Android fleet automation", "phone farm automation" and "FLEET vs Appium", which are low competition with specific intent.
- **"AI Android automation".** The GitHub-heavy SERP will take longer and will depend on backlinks and real proof content.
- **Rankings cannot be guaranteed.** The aim of this work was to remove every technical obstacle to discovery, indexing and understanding.
