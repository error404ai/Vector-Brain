# Replay as the main engine — design

Status: **proposal, not built.** Roadmap item 4. Judged against
[RELIABILITY.md](RELIABILITY.md): this is levels 2 (selector-based action) and 3
(rule-based recovery) of the hierarchy of methods, with AI (level 5) used only
for the step that broke.

## Why

A task that has been done once on a phone should not cost a full AI run the
next time. Today every run is AI from the first step: 5–30 model calls, seconds
of thinking per step, and a fresh chance to get stuck. A recorded, checked path
is cheaper, faster and more predictable. The AI is still needed, but only where
the recorded path no longer fits the screen.

## What exists today (verified in code, Oct 2026)

- `SavedFlow` (`src/entities/SavedFlow.ts`): a list of `{ action_type, action_payload, label }`.
  No selectors, no expected screen, no checks.
- Saving is manual ("Save as flow" on a finished run, `FlowReplayService.saveFromTask`),
  and does not require the run to have succeeded.
- Only `open_app, open_url, tap_coordinate, tap_element, type_text, swipe, global_action, wait`
  are kept. **`click_node`, the one selector-based action, is dropped**, and so are
  `install_app`, `press_key`, `wait_for_element`, `scroll_element`, `long_press`.
- Taps replay at the recorded **pixels**. Typed text is `[REDACTED]` at log time,
  so replay skips it and still counts the step as ok.
- No post-condition: a step "succeeds" when the phone accepted the gesture.
- A failed step stops the replay (`REPLAY_STEP_FAILED`). There is no AI fallback.
- Replay starts only from the Flows page, on one phone. Nothing matches a prompt
  to a flow; missions and chat never use flows.
- Per flow: `run_count` and `last_run_at` only.

So today's replay is a macro recorder, not an engine. Most of this design is
making each step *checkable*; the AI repair is the smaller part.

## 1. A step that can be checked

Recorded from the step log, which already stores `ui_tree_before`,
`ui_tree_after`, `package_before`, `package_after` and the tapped pixel.

```ts
interface FlowStepV2 {
  action: 'open_app' | 'open_url' | 'click' | 'type' | 'scroll' | 'key' | 'install_app' | 'wait_for';
  /** Where to act. Resolved in this order; pixels are never the first choice. */
  target?: {
    text?: string;          // visible label of the node that was tapped
    desc?: string;          // content description
    viewId?: string;        // resource id, when the app has one
    className?: string;
    /** Relative position (0–1000 grid) — used only when the screen matches `before`. */
    grid?: { x: number; y: number };
  };
  /** Text to type: a literal, or a parameter like {{message}} filled per run. Never a stored secret. */
  value?: string;
  /** The screen this step expects to start on. */
  before: { package: string; anchors: string[] };     // 2–4 stable labels seen on that screen
  /** What must be true after it (RELIABILITY.md → Every action). */
  after: { package?: string; appear?: string[]; disappear?: string[]; changed?: boolean };
  timeoutMs: number;          // how long to wait for `after`
  irreversible?: boolean;     // send / pay / delete: needs the user's confirmation, as live runs do
}
```

Converting a recorded tap: `tap_element idx=N` → the node at `idx` in
`ui_tree_before` gives `text/desc/viewId`; `tap_coordinate` → the node under the
tapped pixel, if any, else `grid` only. **Anchors** are picked from the before-tree:
short labels that are on that screen and not on the previous one (titles, tab
names, button labels), never feed content, counters, times or prices.

## 2. Recording

- Automatic, from runs that ended `first_try` or `recovered` **and** passed the
  completion check (`verification.status === 'verified'`). Unverified runs can be
  saved by hand, marked "unchecked".
- Only the effective path: steps tagged as waste in diagnostics (`failed`,
  `no_effect`, `repeat`), screenshots, `read_ui_tree` and the model's detours are
  dropped. A BACK that undid a wrong tap drops both.
- Typed text becomes a parameter (`{{text_1}}`, named from the prompt when possible).
  The user fills it when running; secrets are never stored.

## 3. Choosing replay for a task

Phase 1: the user picks the flow (today's Flows page, plus "Run with flow" on a mission).
Phase 3: automatic. A task is matched to a flow by normalised prompt
(`normalisePrompt`, already used in diagnostics) and the app it starts in. When
the prompt differs only in values ("message Rahul" vs "message Aman"), one
cheap model call maps it to the flow and its parameters, or says "no flow fits",
and the run goes to the AI engine as today.

## 4. Running a step

For each step:

1. **Sync.** Wait (event-driven, up to the step's timeout) until the screen
   shows the step's `before` package and at least half its anchors. Run the
   existing rule-based obstacle clearer (`clearObstacles`) first.
2. **Resolve the target**: `viewId` → exact `text` → `desc` → `grid` (grid only
   when the before-anchors matched). No match → the step is broken (see 5).
3. **Act** with the selector (`click_node`), not pixels, whenever a selector exists.
4. **Check `after`** within `timeoutMs`. Not met → one retry only if the screen did
   not change (never the same action on a changed screen) → still not met → broken.
5. `irreversible` steps stop for confirmation exactly as live runs do.

At the end, the same completion check as the AI engines (`successVerifier`,
install rule, etc.). A replay that ran every step but fails the check is a
failure, not a success.

## 5. When a step breaks: AI for that step only

The run hands the AI a **scoped goal**, not the whole task:

> You are partway through "<task>". The next recorded step was "<label>", expected
> to lead to a screen showing <after.appear>. The screen is different. Get the
> phone to that state, then stop.

- Budget: 8 actions / 90 s / the normal screenshot budget. Same guards
  (SCREEN_UNCHANGED, LOOP_DETECTED) as a full run.
- After it stops, **re-sync**: find the first remaining step whose `before`
  matches the current screen (the AI may have gone past several steps) and
  continue replay from there.
- If the scoped AI cannot reach it, the rest of the task goes to the full AI
  engine with the original prompt. Only if that fails does the run fail, with
  its failure kind (`failureKind.ts`).

## 6. Learning a fix without spreading a wrong one

The actions the AI took to repair step *k* become a **candidate patch**
`{ flow_id, flow_version, step k, replacement steps, device_model }`.

- A candidate is used again only on the phone model it came from.
- It is **promoted** into the flow (new `flow_version`) after it worked — replay
  only, no AI, completion check passed — on **3 runs across at least 2 device
  models**. RELIABILITY.md → Learning over time.
- A promoted patch that then fails on 2 runs in a row is rolled back to the
  previous version.
- Old versions are kept; the Flows page shows the history.

## 7. What gets measured

Per flow: runs, done by replay alone, done with a step repair, fell back to full
AI, failed (by failure kind), per device model, last verified run.
Fleet-wide, on the Diagnostics page: share of runs finished with **zero model
calls**, tokens and time per run for replay vs AI on the same task. The weekly
benchmark (roadmap 5) runs each benchmark task both ways.

## Phases (each one ships only if the benchmark does not regress)

1. **Checkable steps.** Record `FlowStepV2` from verified runs (keep `click_node`
   and `install_app`), selector-first replay, `before`/`after` checks, parameters
   for typed text. A broken step still stops the run, now with a precise reason.
   Old flows keep working as v1.
2. **Step repair.** Scoped AI for the broken step, re-sync, fallback to full AI.
3. **Automatic matching** from chat and missions.
4. **Promotion** of repairs across phones, with rollback.

Phase 1 alone fixes the worst problems in today's replay (pixel taps, skipped
typing counted as ok, no checks) and needs no AI changes.

## Open questions

- Auto-record every verified run, or only when the user taps "Save as flow"?
  Auto is what makes replay the main engine; it also means more stored flows.
- Missions across many phones: replay on all, or AI on the first phone and replay
  on the rest once it succeeds? The second gives a fresh, verified flow per mission.
- Anchors in other languages: a phone in Hindi records Hindi anchors. Flows
  are matched per locale until there is a reason to do better.

## Risks

- Feeds and search results change every run; anchors must come from fixed UI,
  not content. Steps that act on content ("open the first post") need a
  structural target (first item in the list), not its text.
- App updates move buttons. That is exactly what step repair is for; the
  promotion rule keeps one bad repair from spreading.
- A replay that looks right but did the wrong thing. The completion check at the
  end is mandatory, as for AI runs.
