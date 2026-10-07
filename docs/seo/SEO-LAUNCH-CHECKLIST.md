# SEO launch checklist — app.vectoragent.in

## Before launch (before the push to develop)

- [ ] `cd frontend && npm run build` prints `✓ prerendered 10 public pages + 404, robots.txt, sitemap.xml`.
- [ ] Production `.env`: confirm `AI_ENCRYPTION_KEY` is set. Without it, API keys are encrypted with a fallback key that is written in the source code (`src/helpers/CryptoHelper.ts`).
- [ ] Tell us which of these are on in production, so the privacy policy can be updated if needed: `DIAG_GITHUB_REPO` (run diagnostics copied to GitHub), `ANDROID_AGENT_API_KEY` (users without a key run on your OpenAI key), `EMBEDDING_API_KEY` (rule text sent to an embedding provider), `AGENT_ENGINE`.
- [ ] Read `/privacy` and `/terms` once yourself. They were written from the code's actual behaviour, but they are not legal advice; have a lawyer review them when you can.

## Immediately after deploy

Open these on the live site:

| URL | Expect |
|---|---|
| `/` , `/how-it-works`, `/docs` | Page loads; **View source** shows the full text, the `<title>`, `<link rel="canonical">` and `application/ld+json` |
| `/docs/` | 301 to `/docs` |
| `/some-typo` | "Page not found" with HTTP **404** |
| `/mission-control` (signed out) | Goes to login; the response header has `X-Robots-Tag: noindex, nofollow` |
| `/robots.txt` | Plain text with the `Sitemap:` line |
| `/sitemap.xml` | XML with 10 URLs |
| `/llms.txt`, `/llms-full.txt` | Plain text |
| `/og/fleet-share.png` | The share image |

Check with `curl -I https://app.vectoragent.in/some-typo` (expect 404) and `curl -s https://app.vectoragent.in/ | grep -c "<h1"` (expect 1).

**Cloudflare (manual):**
- Security → Bots: make sure "Block AI bots" / "AI Labyrinth" are **off**. You chose to allow every crawler; these settings would block them whatever robots.txt says.
- Make sure `http://` and `www.` variants 301 to `https://app.vectoragent.in`.
- If `app.vectoragent.io` serves the site, 301 it to `.in` as well.

## Within 24 hours

1. **Google Search Console:** add the `app.vectoragent.in` property and verify it, by DNS TXT record (Cloudflare) or by HTML tag. To verify by tag, send me the tag and I will add it.
2. **Sitemaps:** submit `https://app.vectoragent.in/sitemap.xml`.
3. **URL Inspection:** inspect `/`, `/how-it-works` and `/android-fleet-automation`, check that the rendered HTML has the text, then press **Request indexing** (limited per day; use it for the most important pages).
4. **Bing Webmaster Tools:** import from Search Console and submit the sitemap. Bing also feeds ChatGPT search and Copilot.
5. **Rich Results Test** (search.google.com/test/rich-results) on `/` (Organization, SoftwareApplication, FAQ) and `/compare/appium` (FAQ, Breadcrumb). Also run validator.schema.org on the same URLs.
6. **Share preview:** paste the home URL into WhatsApp, LinkedIn Post Inspector and the X/Twitter composer, and check the image and title.

## First week

- Search Console → **Pages**: the 10 public URLs should move to "Indexed". App URLs should appear under "Excluded by noindex", which is correct.
- Search Console → **Core Web Vitals** has no data yet (it needs traffic); use PageSpeed Insights on `/` and `/how-it-works` (mobile). Targets: LCP < 2.5 s, CLS < 0.1, INP < 200 ms.
- Search for `site:app.vectoragent.in` to see what is indexed.
- Fix any "Duplicate without user-selected canonical" or "Soft 404" report.

## First month

- Search Console → **Performance**: which queries show impressions, and at what positions. Re-rank the keyword map with this real data.
- Add the next pages from the plan when there is real material, one per week at most:
  - `/guides/control-multiple-android-phones`
  - `/guides/automate-android-with-ai`
  - a real-phones vs cloud-phones guide
- Replace the stock videos on the landing page with real screen recordings of runs (`frontend/public/fleet/README.txt`).
- Off-site:
  - listings: Product Hunt, AlternativeTo, G2/Capterra once you have users;
  - an honest entry in GitHub "awesome-android-automation"-style lists;
  - one technical write-up on a developer community.

## How to

- **Robots testing:** Search Console → Settings → robots.txt report.
- **Indexing checks:** URL Inspection → "Page is indexed"; Pages report; `site:` search.
- **Structured data:** Rich Results Test and validator.schema.org; Search Console → Enhancements (FAQ, Breadcrumbs).
- **Core Web Vitals:** PageSpeed Insights (lab and field), and Search Console → Core Web Vitals once traffic exists.
