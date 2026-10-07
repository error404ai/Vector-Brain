import ErrorModal from '@/components/ui/ErrorModal';
import { store, useAppSelector } from '@/store';
import { Toaster } from 'react-hot-toast';
import { useEffect, type ComponentType, type ReactNode } from 'react';
import { createBrowserRouter, isRouteErrorResponse, Navigate, Outlet, RouterProvider, useMatches, useRouteError } from 'react-router-dom';
import { report } from './_helpers/clientDiagnostics';
import { AuthLayout } from './components/layout/AuthLayout';
import { GuestLayout } from './components/layout/GuestLayout';
import GlobalLoader from './components/loaders/GlobalLoader';
import useAuthRedirect from './hooks/useAuthRedirect';
import { canManageLandingShots } from './_helpers/landingAccess';
import { isOwner } from './_helpers/ownerAccess';
import { loadPage, pages, prefetchAppPages } from './pages/lazyPages';

function RootShell() {
  // The not-found page is for everyone: no bounce to /login or /dashboard.
  const notFound = useMatches().some((m) => m.id === 'not-found');
  const loading = useAuthRedirect(notFound);

  return (
    <>
      {loading ? <GlobalLoader /> : null}
      <Outlet />
      <ErrorModal />
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            borderRadius: 10,
            fontFamily: '"Inter", sans-serif',
            fontSize: 14,
          },
        }}
      />
    </>
  );
}

/** A render crash anywhere below the root: reported, then a way back instead of a blank page. */
function RootError() {
  const error = useRouteError();
  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? (error.stack ?? '') : '';

  useEffect(() => {
    report('render_error', { message: message.slice(0, 500), stack: stack.slice(0, 3000) });
  }, [message, stack]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', fontFamily: '"Inter", sans-serif', padding: 16 }}>
      <div style={{ maxWidth: 420, textAlign: 'center' }}>
        <h2 style={{ margin: '0 0 8px' }}>Something broke on this page</h2>
        <p style={{ color: '#64748b', margin: '0 0 16px', fontSize: 14, wordBreak: 'break-word' }}>{message}</p>
        <button type="button" onClick={() => window.location.reload()} style={{ padding: '8px 16px', borderRadius: 8, border: 0, background: '#4f46e5', color: '#fff', cursor: 'pointer' }}>
          Reload
        </button>
      </div>
    </div>
  );
}

function GuestShell() {
  return (
    <GuestLayout>
      <Outlet />
    </GuestLayout>
  );
}

function ProtectedShell() {
  // Signed in: fetch the other app pages in the background so moving between
  // them is instant, without making the first page wait for them.
  useEffect(() => prefetchAppPages(), []);
  return (
    <AuthLayout>
      <Outlet />
    </AuthLayout>
  );
}

/** Landing shots: admins plus a temporary allowlist (see _helpers/landingAccess). */
function LandingShotsOnly({ children }: { children: React.ReactNode }) {
  const user = useAppSelector((state) => state.auth.user) ?? store.getState().auth.user;
  if (user && !canManageLandingShots(user)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

/** Run diagnostics: admins plus the owner account (see _helpers/ownerAccess). */
function OwnerOnly({ children }: { children: React.ReactNode }) {
  const user = useAppSelector((state) => state.auth.user) ?? store.getState().auth.user;
  if (user && !isOwner(user)) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

function AdminOnly({ children }: { children: React.ReactNode }) {
  const user = useAppSelector((state) => state.auth.user);
  const fallbackUser = store.getState().auth.user;
  const role = user?.role ?? fallbackUser?.role;

  if (role && role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  return <>{children}</>;
}

type Guard = ComponentType<{ children: ReactNode }>;

/**
 * Each page is its own chunk, fetched when its route is first opened, so the
 * landing page and sign-in no longer download the whole app first.
 */
const lazy = (load: () => Promise<{ default: ComponentType }>, Guarded?: Guard) => async () => {
  const { default: Page } = await loadPage(load);
  return Guarded ? { element: <Guarded><Page /></Guarded> } : { Component: Page };
};

// main.tsx waits on this router before mounting over a prerendered page.
// eslint-disable-next-line react-refresh/only-export-components
export const router = createBrowserRouter([
  {
    Component: RootShell,
    ErrorBoundary: RootError,
    // Shown only while the first page's chunk arrives on a cold load.
    HydrateFallback: GlobalLoader,
    children: [
      // The landing page is full-bleed and dark, so it must not sit inside
      // GuestShell — that wraps its children in the narrow light card the
      // sign-in and sign-up forms are built around.
      { path: '/', lazy: lazy(pages.home) },
      // Public pages, readable without an account (see seo/site.ts).
      { path: '/docs', lazy: lazy(pages.docs) },
      { path: '/how-it-works', lazy: lazy(pages.howItWorks) },
      { path: '/android-fleet-automation', lazy: lazy(pages.fleetAutomation) },
      { path: '/phone-farm-automation', lazy: lazy(pages.phoneFarm) },
      { path: '/use-cases/mobile-app-testing', lazy: lazy(pages.mobileTesting) },
      { path: '/compare/appium', lazy: lazy(pages.compareAppium) },
      { path: '/contact', lazy: lazy(pages.contact) },
      { path: '/privacy', lazy: lazy(pages.privacy) },
      { path: '/terms', lazy: lazy(pages.terms) },
      {
        Component: GuestShell,
        children: [
          { path: '/login', lazy: lazy(pages.login) },
          { path: '/signup', lazy: lazy(pages.signup) },
        ],
      },
      {
        Component: ProtectedShell,
        children: [
          { path: '/dashboard', lazy: lazy(pages.dashboard) },
          { path: '/android-agent', lazy: lazy(pages.androidAgent) },
          { path: '/android-devices', lazy: lazy(pages.androidDevices) },
          { path: '/android-fleet', lazy: lazy(pages.androidFleet) },
          // Agent Tasks is hidden for now: old links land on Mission Control. The page is kept (pages.agentTasks).
          { path: '/agent-tasks', element: <Navigate to="/mission-control" replace /> },
          { path: '/my-rules', lazy: lazy(pages.myRules) },
          { path: '/schedules', lazy: lazy(pages.schedules) },
          { path: '/mission-control', lazy: lazy(pages.missionControl) },
          { path: '/flows', lazy: lazy(pages.flows) },
          { path: '/settings', lazy: lazy(pages.settings) },
          { path: '/diagnostics', lazy: lazy(pages.diagnostics, OwnerOnly) },
          { path: '/landing-shots', lazy: lazy(pages.landingShots, LandingShotsOnly) },
          { path: '/users', lazy: lazy(pages.users, AdminOnly) },
          { path: '/ai-rules', lazy: lazy(pages.aiRules, AdminOnly) },
          { path: '/browserworker-errors', lazy: lazy(pages.browserWorkerErrors, AdminOnly) },
        ],
      },
      // The server answers unknown URLs with 404 and this page.
      { id: 'not-found', path: '*', lazy: lazy(pages.notFound) },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
