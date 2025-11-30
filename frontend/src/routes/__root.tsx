import { AuthLayout } from '@/components/layout/AuthLayout';
import { GuestLayout } from '@/components/layout/GuestLayout';
import type { RootState } from '@/store/store';
import { isDev } from '@/utils/isDev';
import { Outlet, createRootRoute, useLocation } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/router-devtools';
import { SkeletonTheme } from 'react-loading-skeleton';
import { useSelector } from 'react-redux';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const location = useLocation();
  const publicRoutes = ['/login', '/signup', '/'];
  const isPublicRoute = publicRoutes.includes(location.pathname);

  const isLoggedIn = useSelector((state: RootState) => state.auth.isLoggedIn);

  // if (isLoggedIn === 'initial') {
  //   return <GlobalLoader />;
  // }

  return (
    <SkeletonTheme baseColor="#e2e8f0" highlightColor="#f1f5f9">
      {isLoggedIn && !isPublicRoute ? (
        <AuthLayout>
          <Outlet />
        </AuthLayout>
      ) : (
        <GuestLayout>
          <Outlet />
        </GuestLayout>
      )}
      {isDev && <TanStackRouterDevtools />}
    </SkeletonTheme>
  );
}
