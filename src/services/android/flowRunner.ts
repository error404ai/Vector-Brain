import type { ToolResult } from '@eko-ai/eko';
import { afterMet, fillUrl, findTarget, type FlowParam, type FlowStepV2, parseTable, resyncIndex, type Row, screenMatches, startsAnywhere } from './flowSteps';

/**
 * Replays checkable flow steps through the agent's own tools, with no model
 * (docs/REPLAY_ENGINE.md → Running a step). Each step: wait until the phone is
 * on the screen the step starts from, find the element by its label, act, then
 * wait for the step's result. Anything that does not match ends the replay as
 * "broken" at that step; the planner decides what happens next.
 */

export interface ReplayScreen {
  packageName: string | null;
  tree: string | null;
  /** Changes whenever the screen does (eko/screenModel.screenKey). */
  key: string;
}

export interface FlowRunnerDeps {
  observe: () => Promise<ReplayScreen | null>;
  /** Run one agent tool as a recorded replay step (logged and shown like any step). */
  step: (toolName: string, args: Record<string, unknown>, label: string) => Promise<ToolResult>;
  stopped: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  /** Waits, shortened by the tests. */
  syncMs?: number;
  afterMs?: number;
  pollMs?: number;
}

export type ReplayOutcome = { status: 'done' } | { status: 'stopped' } | { status: 'broken'; index: number; reason: string; acted: boolean };

const SYNC_MS = 10_000;
const AFTER_MS = 8_000;
const POLL_MS = 700;

const textOf = (r: ToolResult) => r.content.map((c) => ('text' in c ? c.text : '')).join('\n');

export class FlowRunner {
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: FlowRunnerDeps) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async run(steps: FlowStepV2[], params: FlowParam[], values: Record<string, string>, from = 0): Promise<ReplayOutcome> {
    for (let i = from; i < steps.length; i += 1) {
      if (this.deps.stopped()) return { status: 'stopped' };
      const step = steps[i];

      // 1. The screen this step starts from.
      const placed = startsAnywhere(step);
      const start = await this.waitFor(this.deps.syncMs ?? SYNC_MS, (s, rows) => placed || screenMatches(step.before, s.packageName, rows));
      if (!start) return { status: 'broken', index: i, reason: 'The phone did not answer', acted: false };
      if (!start.ok) {
        const where = step.before.anchors.length ? ` showing "${step.before.anchors.join('", "')}"` : '';
        return { status: 'broken', index: i, reason: `expected ${step.before.package ?? 'the screen'}${where}, but the phone is on ${start.screen.packageName ?? 'another screen'}`, acted: false };
      }

      // 2. What to call.
      const call = this.callFor(step, parseTable(start.screen.tree), params, values);
      if ('reason' in call) return { status: 'broken', index: i, reason: call.reason, acted: false };

      // 3. Act.
      let result = await this.deps.step(call.tool, call.args, step.label);
      // A grid tap on a point the list does not name is questioned once; the same call again goes through.
      if (result.isError && call.tool === 'tap_coordinate' && /call tap_coordinate again/i.test(textOf(result))) result = await this.deps.step(call.tool, call.args, step.label);
      if (result.isError) return { status: 'broken', index: i, reason: textOf(result).split('\n')[0].slice(0, 200), acted: true };
      // install_app waits on the phone's app list itself; its success is the check.
      if (step.action === 'install_app') continue;

      // 4. The step's result.
      const startKey = start.screen.key;
      const done = await this.waitFor(this.deps.afterMs ?? AFTER_MS, (s, rows) => {
        if (afterMet(step, s.packageName, rows, s.key !== startKey)) return true;
        // Already on the next step's screen (the app moved on by itself): fine too.
        return i + 1 < steps.length && resyncIndex(steps, i + 1, s.packageName, rows) === i + 1;
      });
      if (!done?.ok) {
        const expected = step.after.appear.length ? `"${step.after.appear.join('", "')}"` : step.after.package ?? 'a change';
        return { status: 'broken', index: i, reason: `after "${step.label}", ${expected} did not appear`, acted: true };
      }
    }
    return { status: 'done' };
  }

  /** Polls the screen until `test` holds or `ms` runs out. Null when the phone could not be read at all. */
  private async waitFor(ms: number, test: (screen: ReplayScreen, rows: Row[]) => boolean): Promise<{ ok: boolean; screen: ReplayScreen } | null> {
    const deadline = Date.now() + ms;
    let last: ReplayScreen | null = null;
    for (;;) {
      const screen = await this.deps.observe().catch(() => null);
      if (screen) {
        last = screen;
        if (test(screen, parseTable(screen.tree))) return { ok: true, screen };
      }
      if (Date.now() >= deadline || this.deps.stopped()) break;
      await this.sleep(this.deps.pollMs ?? POLL_MS);
    }
    return last ? { ok: false, screen: last } : null;
  }

  private callFor(step: FlowStepV2, rows: Row[], params: FlowParam[], values: Record<string, string>): { tool: string; args: Record<string, unknown> } | { reason: string } {
    const a = step.args;
    switch (step.action) {
      case 'open_app':
        return { tool: 'open_app', args: { packageName: a.packageName } };
      case 'open_url': {
        const url = fillUrl(String(a.url ?? ''), params, values);
        return url ? { tool: 'open_url', args: { url } } : { reason: 'a value for the link is missing from the task' };
      }
      case 'tap': {
        const target = step.target;
        if (!target) return { reason: 'the step has no target' };
        const row = findTarget(target, rows);
        if (row) return { tool: 'tap_element', args: { idx: row.idx } };
        // An unlabelled control the list does not show: the recorded spot, only because the screen matched.
        if (!target.label) return { tool: 'tap_coordinate', args: { x: target.grid.x, y: target.grid.y } };
        return { reason: `"${target.label}" is not on the screen` };
      }
      case 'click_text':
        return { tool: 'click_node', args: { text: a.text } };
      case 'type': {
        const value = step.value && 'param' in step.value ? values[step.value.param] : undefined;
        if (value === undefined) return { reason: 'the text to type is not in the task, so the AI has to type it' };
        return { tool: 'type_text', args: { text: value } };
      }
      case 'key':
        return { tool: 'press_key', args: { key: a.key ?? 'ENTER' } };
      case 'global':
        return { tool: 'global_action', args: { action: a.action ?? 'BACK' } };
      case 'swipe':
        return { tool: 'swipe', args: { direction: a.direction ?? 'UP' } };
      case 'scroll':
        return { tool: 'scroll_element', args: { direction: a.direction ?? 'FORWARD', ...(a.text ? { text: a.text } : {}) } };
      case 'long_press':
        return { tool: 'long_press', args: Object.fromEntries(Object.entries({ text: a.text, x: a.x, y: a.y, durationMillis: a.durationMillis }).filter(([, v]) => v !== undefined && v !== null)) };
      case 'install_app':
        return { tool: 'install_app', args: { packageName: a.packageName, ...(a.appName ? { appName: a.appName } : {}) } };
      case 'open_settings':
        return { tool: 'open_settings', args: { screen: a.screen } };
      default:
        return { reason: `unknown step ${String(step.action)}` };
    }
  }
}
