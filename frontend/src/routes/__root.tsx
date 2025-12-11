import { AuthLayout } from '@/components/layout/AuthLayout';
import { GuestLayout } from '@/components/layout/GuestLayout';
import { GlobalLoader } from '@/components/loaders/GlobalLoader';
import useAuthRedirect from '@/hooks/useAuthRedirect';
import type { RootState } from '@/store/store';
import { Outlet, createRootRoute, useLocation } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { SkeletonTheme } from 'react-loading-skeleton';
import { useSelector } from 'react-redux';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  const location = useLocation();
  const publicRoutes = ['/login', '/signup', '/'];
  const isPublicRoute = publicRoutes.includes(location.pathname);

  const authInitialized = useSelector((state: RootState) => state.auth.authInitialized);

  const loading = useAuthRedirect();

  const [transitionLoading, setTransitionLoading] = useState(false);
  const prevIsPublicRouteRef = useRef(isPublicRoute);

  useEffect(() => {
    if (prevIsPublicRouteRef.current !== isPublicRoute) {
      // eslint-disable-next-line
      setTransitionLoading(true);
      const timer = setTimeout(() => {
        setTransitionLoading(false);
      }, 1000);
      prevIsPublicRouteRef.current = isPublicRoute;
      return () => clearTimeout(timer);
    }
  }, [isPublicRoute]);

  const showLoader = !authInitialized || loading || transitionLoading;

  return (
    <SkeletonTheme baseColor="#e2e8f0" highlightColor="#f1f5f9">
      {showLoader && <GlobalLoader />}
      {!isPublicRoute ? (
        <AuthLayout>
          <Outlet />
        </AuthLayout>
      ) : (
        <GuestLayout>
          <Outlet />
        </GuestLayout>
      )}
    </SkeletonTheme>
  );
}
