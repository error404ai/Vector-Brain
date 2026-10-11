import { MUIProvider } from '@/components/providers/MUIProvider';
import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { prefetchAppPages } from '@/pages/lazyPages';
import { AuthLayout } from './AuthLayout';
import { GuestLayout } from './GuestLayout';

/**
 * The signed-in app and the sign-in forms, with the MUI theme. Loaded only on
 * those routes: the public pages are plain CSS, so a visitor reading the
 * landing page or docs never downloads MUI (about a third of the old shared
 * bundle).
 */
export function GuestShell() {
  return (
    <MUIProvider>
      <GuestLayout>
        <Outlet />
      </GuestLayout>
    </MUIProvider>
  );
}

export function ProtectedShell() {
  // Signed in: fetch the other app pages in the background so moving between
  // them is instant, without making the first page wait for them.
  useEffect(() => prefetchAppPages(), []);
  return (
    <MUIProvider>
      <AuthLayout>
        <Outlet />
      </AuthLayout>
    </MUIProvider>
  );
}
