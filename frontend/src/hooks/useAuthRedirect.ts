import authManager from '@/_helpers/authManager';
import { useGetProfileQuery } from '@/RTKService/authService/authService';
import type { RootState } from '@/store/store';
import { useLocation, useRouter } from '@tanstack/react-router';
import { useEffect, useMemo } from 'react';
import { useSelector } from 'react-redux';

const publicRoutes = ['/login', '/signup', '/'];

export const useAuthRedirect = () => {
  const router = useRouter();
  const location = useLocation();
  const authInitialized = useSelector((state: RootState) => state.auth.authInitialized);
  const isPublicRoute = publicRoutes.includes(location.pathname);

  const hasToken = !!authManager.getAccessToken();

  // Use getProfile to initialize auth if token exists but auth not initialized
  useGetProfileQuery(undefined);

  useEffect(() => {
    if (!authInitialized) {
      return;
    }

    if (!hasToken && !isPublicRoute) {
      router.navigate({ to: '/login' });
    } else if (hasToken && isPublicRoute) {
      router.navigate({ to: '/dashboard' });
    }
  }, [authInitialized, isPublicRoute, router, hasToken]);

  const isCheckingAuth = useMemo(() => !authInitialized, [authInitialized]);

  return { isCheckingAuth };
};
