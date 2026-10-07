# Replay as the main engine — design

Status: **built (Oct 2026), all switches off by default.** Roadmap item 4. Judged against
[RELIABILITY.md](RELIABILITY.md): this is levels 2 (selector-based action) and 3
(rule-based recovery) of the hierarchy of methods, with AI (level 5) used only
for the step that broke.

## Switches (Settings → Saved flows)

All four are per account and **off by default**; each Flows-page flow also has
its own on/off.

| Switch | On | Off |
|---|---|---|
| `flow_record` — save successful tasks as flows | every run that ends SUCCEEDED (and whose completion check did not fail) is saved as a checkable flow, once per task wording | flows only come from "Save as flow" |
| `flow_replay_first` — use a saved flow first | a task whose wording matches an enabled flow replays it before any AI; missions run one phone first (below) | every run is AI from the first step |
| `flow_ai_repair` — the AI fixes the broken step only | a broken step gets a scoped AI round; the flow resumes as soon as the phone is back on track | a broken step hands the rest of the task to the AI |
| `flow_share_fixes` — use step fixes on my other phones | other phones try a saved fix before asking the AI; it joins the flow after 3 runs on 2 models | a fix is reused only on the phone that made it |

Not switchable: a replayed flow is checked step by step and at the end; a flow
that ran but fails the end check is a failed run, not a success.

Code: `src/services/android/flowSteps.ts` (step model, recorder, matching),
`flowRunner.ts` (replay), `FlowLibraryService.ts` (settings, matching, fixes,
promotion, stats), `AndroidPlannerService.executeLoop` (replay first, repair,
fallback), `MissionService` (first phone, then the rest). Tests:
`flowSteps.test.ts`, `flowRunner.test.ts`, and the harness scenarios named
"flows: …" (scripted app on a fake phone).

## Why

A task that has been done once on a phone should not cost a full AI run the
next time. Today every run is AI from the first step: 5–30 model calls, seconds
of thinking per step, and a fresh chance to get stuck. A recorded, checked path
is cheaper, faster and more predictable. The AI is still needed, but only where
the recorded path no longer fits the screen.

## What existed before (verified in code, Oct 2026)

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

So the old replay was a macro recorder, not an engine (format 1 flows still replay that way). Most of this design is
making each step *checkable*; the AI repair is the smaller part.

## 1. A step that can be checked

(The built shape is `FlowStepV2` in `flowSteps.ts`: the element list the agent
sees has no resource ids, so a target is its label, type and grid position; the
sketch below is the original proposal.)

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

- Sharing off: a candidate is reused only on the phone that made it. Sharing on:
  the account's other phones try it before asking the AI (a failed try costs a
  few seconds, then the AI repairs as usual). Without that, it could never prove
  itself on a second model.
- It is **promoted** into the flow (new `flow_version`) after **3 successful
  runs across at least 2 device models** (the run that made it counts as the
  first). RELIABILITY.md → Learning over time.
- After a promotion, 2 runs in a row that fail or need the AI to finish roll the
  flow back to its steps before the fix (another new version).
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

All four phases are built; they ship behind the switches above, off by default,
until the weekly benchmark (roadmap 5) shows they do not regress completion.

## Decisions taken

- Auto-recording is the `flow_record` switch, off by default.
- Missions: with recording and replay-first on and no flow for the task yet, one
  phone runs it with the AI; the others wait (`WAITING_PILOT`) and replay the flow
  it produced. If the first phone fails, the rest run with the AI at once.
- Anchors in other languages: a phone in Hindi records Hindi anchors; such a flow
  breaks on an English phone and is repaired like any other break.
- Typed text: only text that is part of the task's wording becomes a parameter
  ("Search YouTube for {{p1}}"); anything else typed is never stored, and that
  step is left to the AI on each run.

## Not verified yet

Everything above is tested against unit tests and a scripted fake app, not on a
real phone. The anchor and target rules (stable labels, editable fields ignored,
label-first targets) need checking against real apps before the switches are
turned on for everyone.

## Risks

- Feeds and search results change every run; anchors must come from fixed UI,
  not content. Steps that act on content ("open the first post") need a
  structural target (first item in the list), not its text.
- App updates move buttons. That is exactly what step repair is for; the
  promotion rule keeps one bad repair from spreading.
- A replay that looks right but did the wrong thing. The completion check at the
  end is mandatory, as for AI runs.
