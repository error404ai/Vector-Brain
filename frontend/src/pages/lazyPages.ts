import type { ComponentType } from 'react';

type PageModule = { default: ComponentType };
type Loader = () => Promise<PageModule>;

/**
 * Every routed page as its own chunk. Kept in one place so the router and the
 * background prefetch import exactly the same modules.
 */
export const pages = {
  home: () => import('./HomePage'),
  docs: () => import('./DocsPage'),
  login: () => import('./LoginPage'),
  signup: () => import('./SignupPage'),
  dashboard: () => import('./DashboardPage'),
  androidAgent: () => import('./AndroidAgentPage'),
  androidDevices: () => import('./AndroidDevicesPage'),
  androidFleet: () => import('./AndroidFleetPage'),
  agentTasks: () => import('./AgentTasksPage'),
  myRules: () => import('./MyRulesPage'),
  schedules: () => import('./SchedulesPage'),
  missionControl: () => import('./MissionControlPage'),
  flows: () => import('./FlowsPage'),
  settings: () => import('./SettingsPage'),
  diagnostics: () => import('./DiagnosticsPage'),
  landingShots: () => import('./LandingShotsPage'),
  users: () => import('./UsersPage'),
  aiRules: () => import('./AiRulesPage'),
  browserWorkerErrors: () => import('./BrowserWorkerErrorsPage'),
} satisfies Record<string, Loader>;

const RELOAD_KEY = 'vb-chunk-reload';

/**
 * A tab opened before a deploy still points at the old chunk names, which the
 * new build removed, so its next page import fails. Reload once to pick up the
 * new build instead of showing the error page; a second failure is real.
 */
export async function loadPage(load: Loader): Promise<PageModule> {
  try {
    const mod = await load();
    try {
      sessionStorage.removeItem(RELOAD_KEY);
    } catch {
      /* storage blocked: nothing to clear */
    }
    return mod;
  } catch (error) {
    let reloaded = false;
    try {
      reloaded = sessionStorage.getItem(RELOAD_KEY) === '1';
      if (!reloaded) sessionStorage.setItem(RELOAD_KEY, '1');
    } catch {
      reloaded = true;
    }
    if (!reloaded) {
      window.location.reload();
      return new Promise<PageModule>(() => undefined);
    }
    throw error;
  }
}

/** The pages people move between most, fetched once the browser is idle. */
const APP_PAGES: Loader[] = [pages.missionControl, pages.dashboard, pages.androidFleet, pages.androidDevices, pages.settings];

export function prefetchAppPages(): () => void {
  const run = () => APP_PAGES.forEach((load) => void load().catch(() => undefined));
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }
  const t = setTimeout(run, 2000);
  return () => clearTimeout(t);
}
