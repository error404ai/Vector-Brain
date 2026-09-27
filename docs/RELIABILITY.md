# Reliability principles

Vector Brain is meant to be the most reliable way to automate Android phones
with AI: someone gives a real task, in their own words, on whatever phone they
have, and it gets done. These principles decide how the engine is built and
how every change to it is judged. They apply to every engine (Eko, Vector) and
every layer (backend, companion APK, dashboard).

## The goal

The product goal is not "the AI chose a reasonable next action". It is **the
user's intended outcome, achieved and verified on the device**.

No platform can promise that every task succeeds on its own: apps change,
networks drop, CAPTCHAs appear, accounts get locked. What we can promise is
that every task ends in one of three honest ways:

1. **Done, and checked** on the phone itself.
2. **"This step needs you"**: a human-only step (CAPTCHA, selfie or ID check,
   biometric, payment approval, choosing between accounts). The user does it,
   and the run continues from there. This is a success path, not a failure.
3. **"This can't be done, because …"**: specific, reproducible, and recorded.

We never fail silently, and we never report "done" without checking.

## Hierarchy of methods

Every task goes down this list, cheapest and most certain first. One method
failing is never the task failing.

1. **Direct action.** Android intents and system APIs, with no tapping:
   open or close an app, a Play Store listing, settings panels, alarms,
   contacts, share, call or SMS compose, deep links.
2. **Selector-based action.** Recorded skills and recipes that find elements
   by text or id, never by remembered coordinates, with a check after each
   step.
3. **Rule-based recovery.** Handlers for the known obstacles (see below)
   before any AI reasoning is spent on them.
4. **Vision grounding.** When the accessibility tree does not describe the
   screen, a vision model reads it. No tapping by guesswork.
5. **AI reasoning.** The general agent, for anything new.
6. **Alternate strategy.** Another route to the same outcome (click_node
   instead of a tap, a deep link instead of menus, BACK and try again).
7. **Retry with state verification.** Only after checking what actually
   happened, and never the same action on an unchanged screen.
8. **Human handoff.** Pause, tell the user exactly what is needed, resume.
9. **Only then fail**, with a specific reason.

Real limits that shape the list:
- A normal app cannot silently install apps. Play Store apps are installed
  through the Play Store listing (deep link, Install, then check that the
  package exists). PackageInstaller is only for an APK the user supplied, and
  Android asks the user to confirm it.
- "Exhaust every path" always runs inside a **budget**: steps, time and tokens
  per task. When the budget runs out, the run hands off to the user with the
  reason. It does not keep burning tokens.

## Every action

For every action the engine knows:
- the **expected post-condition** (screen changed, text appeared, app in
  front, package installed, download progressing);
- a **timeout**;
- an **alternate path** if it does not happen;
- a **retry limit**;
- a **recovery path**.

Rules:
- **Never repeat the same action against an unchanged screen.**
- **Never trust the model saying "done".** Check the device: the package is
  installed, the alarm exists, the message shows as sent.
- Waits are event-driven or "until the screen is still", never blind fixed
  pauses. Long operations (downloads, installs) wait on the outcome, not on a
  guess.
- A button that changes after a tap (Install → Cancel, Follow → Unfollow) is
  not tapped again.

## Rollback and confirmation

Real rollback is rare on a phone: settings can be put back, a sent message, a
payment or a deleted file cannot. So anything irreversible (paying, deleting,
sending to other people, changing account security) is **confirmed by the
user first**. That confirmation is the safety net, not undo.

## Recovery engine

Separate from the reasoning model, rule-based first: permission dialogs,
"rate this app", ads and interstitials, cookie banners, the keyboard covering a
field, network error dialogs, "app not responding", app crashes, the lock
screen, "update available", storage full, stale screens, taps with no effect.
If these do not clear it, restart the app and continue from the last
checkpoint.

## Learning over time

- Successful runs become reusable skills (selectors plus checks), so common
  tasks become deterministic.
- When many phones hit the same unknown screen, solve it once and reuse the
  resolution, **but only after it has been verified on a few phones**, so one
  wrong fix does not spread across the fleet.

## Limits on what the platform does

"Any task" means any legitimate task on the user's own phones and accounts.
The platform does not do bulk account creation, account creation fanned out
across phones or proxies, fabricated personas or "realistic history" warm-up,
fake engagement or reviews, or solving and bypassing CAPTCHAs. Those are
handed back to the user or refused. This protects users, and it protects the
platform from app and Google bans.

## Measuring

The primary KPI is **verified task completion**. Every run records one
outcome:

| Outcome | Meaning |
|---|---|
| `first_try` | Done and verified, with no recovery needed |
| `recovered` | Done and verified after the engine recovered (retry, alternate path, backup model, recovery handler) |
| `human_assisted` | Done after the user completed a step the platform handed to them |
| `failed` | Not done, with a specific reason code |

Human-assisted runs are counted separately. They never quietly inflate
"success".

Secondary KPIs: recovery rate, handoff completion rate, recoveries per task,
tokens per task, steps per task, latency.

**Every engine change must keep or improve verified completion on the nightly
benchmark** (everyday tasks, several phone models). If it regresses, it does
not ship.
