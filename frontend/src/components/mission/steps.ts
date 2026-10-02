/**
 * Turning a run's raw steps (tool name + params) into lines a person reads,
 * and loading them. The list itself is StepFeed.tsx.
 */
import { useGetTaskStepsQuery, type TaskStepRow } from '@/RTKService/androidService/androidService';
import { useMemo } from 'react';
import type { RunSight, StepSight } from './sight';

/** A step as the server announces it live over the socket. */
export interface LiveStepInput {
  index: number;
  thought: string;
  raw?: Record<string, unknown> | null;
  at: number;
  /** Arrives with the step's result: did the AI see the screen as an image. */
  sight?: StepSight | null;
}

export interface FeedStep {
  key: string;
  n: number;
  kind: StepKind;
  verb: string;
  target: string;
  thought: string;
  failed: boolean;
  error: string | null;
  at: number | null;
  sight?: StepSight | null;
}

export type StepKind = 'app' | 'url' | 'tap' | 'type' | 'scroll' | 'nav' | 'wait' | 'look' | 'settings' | 'done' | 'other';

const APP_NAMES: Record<string, string> = {
  'com.android.chrome': 'Chrome',
  'com.google.android.youtube': 'YouTube',
  'com.android.vending': 'Play Store',
  'com.google.android.gm': 'Gmail',
  'com.android.settings': 'Settings',
  'com.google.android.apps.maps': 'Maps',
  'com.whatsapp': 'WhatsApp',
  'com.instagram.android': 'Instagram',
  'com.twitter.android': 'X',
  'com.reddit.frontpage': 'Reddit',
  'com.facebook.katana': 'Facebook',
  'com.zhiliaoapp.musically': 'TikTok',
  'com.spotify.music': 'Spotify',
};

function appName(pkg: string): string {
  if (APP_NAMES[pkg]) return APP_NAMES[pkg];
  const last = pkg.split('.').filter((part) => !['com', 'android', 'app', 'google', 'org'].includes(part)).pop() ?? pkg;
  return last.charAt(0).toUpperCase() + last.slice(1);
}

function shortUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const quoted = (v: string) => `“${v.length > 60 ? `${v.slice(0, 60)}…` : v}”`;

/** "tap_coordinate" + its params → { kind, verb, target } a person reads. */
export function describeStep(type: string, params: Record<string, unknown> | null | undefined): { kind: StepKind; verb: string; target: string } {
  const p = params ?? {};
  const label = str(p.description) || str(p.text) || str(p.viewId);
  switch (type) {
    case 'open_app':
      return { kind: 'app', verb: 'Opened', target: str(p.packageName) ? appName(str(p.packageName)) : 'an app' };
    case 'open_url':
      return { kind: 'url', verb: 'Opened', target: str(p.url) ? shortUrl(str(p.url)) : 'a page' };
    case 'tap_coordinate':
    case 'click_node':
      return { kind: 'tap', verb: 'Tapped', target: label ? quoted(label.replace(/^"|"$/g, '')) : 'the screen' };
    case 'long_press':
      return { kind: 'tap', verb: 'Long-pressed', target: label ? quoted(label) : 'the screen' };
    case 'type_text':
      return { kind: 'type', verb: 'Typed', target: str(p.text) ? quoted(str(p.text)) : 'text' };
    case 'paste':
    case 'set_clipboard':
      return { kind: 'type', verb: type === 'paste' ? 'Pasted' : 'Copied', target: str(p.text) ? quoted(str(p.text)) : 'text' };
    case 'swipe':
    case 'scroll_element': {
      const dir = str(p.direction).toLowerCase();
      // A swipe UP moves the page down, like a finger on glass.
      const words: Record<string, string> = { up: 'down', forward: 'down', down: 'up', backward: 'up', left: 'left', right: 'right' };
      return { kind: 'scroll', verb: 'Scrolled', target: words[dir] ?? dir };
    }
    case 'global_action':
    case 'press_key': {
      const key = (str(p.action) || str(p.key)).toUpperCase();
      const names: Record<string, string> = { HOME: 'Home', BACK: 'Back', RECENTS: 'Recent apps', ENTER: 'Enter', NOTIFICATIONS: 'Notifications' };
      return { kind: 'nav', verb: 'Pressed', target: names[key] ?? (key ? key.toLowerCase() : 'a key') };
    }
    case 'wait':
      return { kind: 'wait', verb: 'Waited', target: p.durationMillis ? `${Math.round(Number(p.durationMillis) / 100) / 10}s` : 'a moment' };
    case 'wait_for_element':
      return { kind: 'wait', verb: 'Waited for', target: label ? quoted(label) : 'the screen' };
    case 'read_ui_tree':
    case 'capture_screen':
      return { kind: 'look', verb: 'Looked at', target: 'the screen' };
    case 'list_apps':
      return { kind: 'look', verb: 'Checked', target: 'installed apps' };
    case 'install_app':
      return { kind: 'app', verb: 'Installed', target: str(p.appName) || (str(p.packageName) ? appName(str(p.packageName)) : 'an app') };
    case 'read_notifications':
      return { kind: 'look', verb: 'Read', target: 'notifications' };
    case 'read_clipboard':
      return { kind: 'look', verb: 'Read', target: 'the clipboard' };
    case 'open_settings':
      return { kind: 'settings', verb: 'Opened', target: `Settings${str(p.screen) ? ` › ${str(p.screen).toLowerCase().replace(/_/g, ' ')}` : ''}` };
    case 'task_done':
    case 'agent_result':
      return { kind: 'done', verb: 'Finished', target: '' };
    default:
      return { kind: 'other', verb: type.replace(/_/g, ' '), target: '' };
  }
}

/** Strips the boilerplate the planner puts in when the model gave no reason. */
function cleanThought(text: string, type: string): string {
  const t = (text ?? '').trim();
  if (!t || t === `Executing ${type}`) return '';
  return t;
}

export function fromLive(step: LiveStepInput): FeedStep {
  const raw = step.raw ?? {};
  const type = str(raw.type);
  const d = describeStep(type, raw);
  return { key: `n${step.index}`, n: step.index, ...d, thought: cleanThought(step.thought, type), failed: false, error: null, at: step.at, sight: step.sight ?? null };
}

export function fromRow(row: TaskStepRow): FeedStep {
  const d = describeStep(row.action_type, row.action_payload);
  return {
    key: `n${row.step_index}`,
    n: row.step_index,
    ...d,
    thought: cleanThought(row.thought, row.action_type),
    failed: row.status === 'FAILED',
    error: row.error,
    at: Date.parse(row.at) || null,
    sight: row.sight ? { seen: row.sight, why: (row.sight_why as StepSight['why']) ?? null } : null,
  };
}

/**
 * The run's steps: what the server has recorded (so a reload or a finished
 * run shows them all) followed by what arrived live since. Fetched once per
 * run while it is visible; live steps keep it current after that.
 */
export function useRunSteps(taskId: number | null, live: LiveStepInput[], enabled = true): { steps: FeedStep[]; loading: boolean; total: number | null; sight: RunSight | null } {
  const { data, isLoading } = useGetTaskStepsQuery(taskId ?? 0, { skip: !taskId || !enabled });
  const steps = useMemo(() => {
    const byIndex = new Map<number, FeedStep>();
    for (const row of data?.data.steps ?? []) byIndex.set(row.step_index, fromRow(row));
    for (const step of live) {
      const known = byIndex.get(step.index);
      if (!known) byIndex.set(step.index, fromLive(step));
      // The fetched row may predate the step's result; the live one has its sight.
      else if (!known.sight && step.sight) byIndex.set(step.index, { ...known, sight: step.sight });
    }
    return [...byIndex.values()].sort((a, b) => a.n - b.n);
  }, [data, live]);
  return { steps, loading: !!taskId && enabled && isLoading, total: data?.data.task.total_steps ?? null, sight: data?.data.task.sight ?? null };
}

/** One line a person can scan: "12 steps · 3 pages · 2 typed · 1 failed". */
export function stepSummary(steps: FeedStep[]): string {
  const count = (kind: StepKind) => steps.filter((s) => s.kind === kind).length;
  const failed = steps.filter((s) => s.failed).length;
  const parts = [`${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`];
  if (count('url')) parts.push(`${count('url')} ${count('url') === 1 ? 'page' : 'pages'} opened`);
  if (count('type')) parts.push(`${count('type')} typed`);
  if (count('tap')) parts.push(`${count('tap')} taps`);
  if (failed) parts.push(`${failed} failed`);
  return parts.join(' · ');
}

