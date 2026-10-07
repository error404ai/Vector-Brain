# SEO keyword map — Vector Brain

**Data note:** no keyword-volume tool (Search Console, Ahrefs, Semrush) was available. Priorities below come from:

- search intent;
- what currently ranks (SERPs checked October 2026);
- whether the product actually supports the claim.

Re-rank priorities with real volume once Search Console has 4–6 weeks of data.

## Entity definition (use everywhere, word for word where possible)

- **Name:** FLEET (FLEET by Vector Brain; made by Vector AI Agent). The phone app is "Vector".
- **Category:** AI Android automation platform
- **Short description:** FLEET is an AI Android automation platform: you describe a task in plain words and an AI agent carries it out on real Android phones, from one phone to a fleet of up to 1,000.
- **Long description:**
  - Vector Brain lets you describe a task in plain words and have an AI agent do it on real Android phones.
  - Each phone runs the Vector app, which uses Android's accessibility service to read the screen and tap, type and swipe. No root, ADB or USB cable is needed, on Android 10 or newer.
  - From one dashboard you send a task to one phone, a tagged group or the whole fleet, and watch every screen live.
  - Runs that get stuck stop with a reason, and failed phones can be retried.
  - You bring your own AI model key (OpenAI, Anthropic, Google, DeepSeek, Groq, OpenRouter or any OpenAI-compatible API).
- **Not:** an emulator, a cloud phone rental, a test-script framework or an ADB tool. Testing is one use case.

## What the SERPs look like (checked October 2026)

| Query family | Who ranks | What it means for us |
|---|---|---|
| "AI Android automation" / natural-language phone control | GitHub repos (Google ARTEMIS, DroidRun/Mobilerun, minitap mobile-use, callstack agent-device), dev blogs | Developer-heavy and open-source. Winnable with a clear product page plus a technical explainer; the differentiator is *fleet + no ADB + dashboard*. |
| "phone farm automation" / "AI phone farm" | Cloud-phone and antidetect vendors (VMOS Cloud, Multilogin, MoreLogin, DeviceFarm, ShadowPhone) | Intent is mostly multi-account social automation, which conflicts with Vector Brain's acceptable-use policy. Target the *management* angle carefully, or not at all (decision needed). |
| "Appium alternative" | Testing vendors' listicles (Katalon, TestGrid, Testsigma), plus Mobilerun and minitap alternative pages | A legitimate, high-intent comparison, but only factual: "no scripts / natural language" vs "selectors and code". |
| "how to control multiple Android phones" | Mixed: scrcpy guides, device-farm vendors | Problem-aware; a genuine guide can rank. |

## Clusters → pages

| # | Cluster | Primary keyword | Secondary terms | Intent | Page | Content required | Conversion |
|---|---|---|---|---|---|---|---|
| 1 | Core category | AI Android automation | AI phone automation, Android AI agent, AI agent for Android, automate Android phone with AI | Commercial / informational | `/` (home) | What it is, how it works (app → AI → taps), live screens, fleet, FAQ | Sign up |
| 2 | Fleet | Android fleet automation | automate multiple Android phones, multi-device Android automation, control many Android phones at once | Commercial | `/android-fleet-automation` (built) | Missions to many phones, tags, lanes, retries, live wall, real limits (50 per mission) | Sign up |
| 3 | Mechanism / real devices | real Android device automation | automate real Android phones, no root no ADB automation, Android accessibility automation | Commercial + technical | `/how-it-works` (built) | Architecture: Vector app (accessibility) ↔ WebSocket ↔ AI model; checks after each action; what it can't do | Docs → Sign up |
| 4 | Natural language | natural language Android automation | automate Android apps with AI, plain English phone automation | Commercial | Merge into `/` and `/how-it-works` (no separate page, to avoid cannibalisation) | — | — |
| 5 | Testing (one use case) | AI mobile testing on real Android devices | Android test automation without code, real-device Android testing, AI QA Android | Commercial | `/use-cases/mobile-app-testing` (built) | Same task on every model/version, pass/fail per phone, final screenshots, flows for no-cost replays; honest about no CI integration yet | Sign up |
| 6 | Comparison | Appium alternative | no-code Android automation, AI vs Appium | Commercial investigation | `/compare/appium` (built) | Factual: scripts and selectors vs a sentence; where Appium is better (CI, iOS, deterministic assertions) | Sign up |
| 7 | Monitoring / routines | automate repetitive Android tasks | scheduled Android automation, Android workflow automation | Commercial | `/use-cases/repetitive-phone-tasks` | Settings audits, app checks, updates across phones, answer cards | Sign up |
| 8 | Problem-aware guide | how to control multiple Android phones from one PC | manage many Android phones remotely | Informational | `/guides/control-multiple-android-phones` | Options compared (scrcpy/ADB, MDM, cloud phones, AI agents), with real trade-offs | Soft CTA |
| 9 | Problem-aware guide | how to automate Android phones with AI | AI that controls Android phones | Informational | `/guides/automate-android-with-ai` | How screen-reading agents work, accessibility vs vision, reliability limits | Soft CTA |
| 10 | Developer | Android automation API | Android agent API, programmatic Android control | Commercial (dev) | **Not yet.** There is no public API today; create the page only when one exists | — | — |
| 11 | Docs | Vector Brain docs | how to pair Android phone, proxy rotation Android fleet | Navigational | `/docs` (exists) | Already written | Sign up |
| 12 | Phone farm | phone farm automation | phone farm software, AI phone farm, phone farm management, Android phone farm, manage hundreds of Android phones | Commercial | `/phone-farm-automation` (built) | Pairing without ADB, phone states, network checks, proxy lanes, farm-wide app updates, acceptable-use line | Sign up |

## Anti-cannibalisation rules

- One primary keyword per page. Home owns "AI Android automation"; nothing else targets it.
- Natural-language terms live on the home page and `/how-it-works`, not on a third page.
- Use cases never repeat the home page's feature copy; each page gets its own examples, screenshots and FAQ.
- No city, country or industry permutations ("Android automation for X in Y").

## Titles and descriptions

The live titles and descriptions are in `frontend/src/seo/site.ts`, which is the single source for every page's `<head>`, the sitemap and the server routing. The drafts that used "Vector Brain" as the name were replaced when FLEET was chosen.

## Wider "mobile automation" vocabulary (owner request: target the terms used for products that automate phones)

Each term is mapped to an existing page as a secondary term, used naturally in copy and headings, so there is no new thin page per synonym.

| Term family | Mapped to | Note |
|---|---|---|
| mobile automation software, mobile automation platform, phone automation software, Android automation tool / app / software | `/` | Home secondary terms; the definition sentence already says "AI Android automation platform" |
| Android RPA, mobile RPA, Android workflow automation, automate repetitive phone tasks | `/how-it-works`, `/android-fleet-automation` | Use "workflow" and "repetitive tasks" in copy; avoid claiming enterprise RPA features |
| control multiple Android phones, multi-device Android control, Android remote control from PC, manage many phones remotely | `/android-fleet-automation` | Next: the guide `/guides/control-multiple-android-phones` (honest options: scrcpy/ADB, MDM, cloud phones, AI agents) |
| phone farm software, Android phone farm, device farm automation, phone farm management | `/phone-farm-automation` | Done |
| AI agent for Android, Android AI agent, LLM phone agent, autonomous Android agent | `/`, `/how-it-works` | The SERP is GitHub-heavy; the explainer page is the entry point |
| no-code Android automation, Appium alternative, AI mobile testing, real-device testing | `/use-cases/mobile-app-testing`, `/compare/appium` | Done |
| Tasker / MacroDroid / Automate alternative | Future `/compare/tasker` | Only with an honest angle: on-device rules on one phone vs AI tasks across a fleet |
| cloud phone, virtual Android phone | Do not target as our product | FLEET uses real phones; a future honest "real phones vs cloud phones" guide could target it |
