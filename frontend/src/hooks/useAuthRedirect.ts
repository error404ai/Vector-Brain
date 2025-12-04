import authManager from '@/_helpers/authManager';
import { useGetProfileQuery } from '@/RTKService/authService/authService';
import { setTokenExpired } from '@/store/authSlice';
import type { RootState } from '@/store/store';
import { useLocation, useRouter } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

const publicRoutes = ['/login', '/signup', '/'];

export default function useAuthRedirect(skip: boolean = false) {
  const router = useRouter();
  const location = useLocation();
  const dispatch = useDispatch();
  const authInitialized = useSelector((state: RootState) => state.auth.authInitialized);
  const isPublicRoute = publicRoutes.includes(location.pathname);

  const hasToken = !!authManager.getAccessToken();

  // Use getProfile to initialize auth if token exists but auth not initialized
  const { isLoading: isProfileLoading } = useGetProfileQuery(undefined);

  const [isRedirecting, setIsRedirecting] = useState(false);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced loading state to prevent flickering (1 second debounce)
  const [debouncedLoading, setDebouncedLoading] = useState(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const performRedirect = (path: string) => {
      setIsRedirecting(true);
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
      }
      redirectTimerRef.current = setTimeout(() => setIsRedirecting(false), 2000);
      dispatch(setTokenExpired(false));
      router.navigate({ to: path });
    };
    if (skip) {
      return;
    }
    if (!authInitialized) {
      return;
    }

    if (!hasToken && !isPublicRoute) {
      performRedirect('/login');
      return;
    } else if (hasToken && isPublicRoute) {
      performRedirect('/dashboard');
      return;
    }
  }, [authInitialized, isPublicRoute, router, hasToken, dispatch, skip]);

  useEffect(
    () => () => {
      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    },
    []
  );

  const loading = Boolean(hasToken && isProfileLoading);

  const currentLoadingState = loading || isRedirecting;

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (currentLoadingState && !debouncedLoading) {
      // eslint-disable-next-line
      setDebouncedLoading(true);
    } else if (!currentLoadingState && debouncedLoading) {
      debounceTimerRef.current = setTimeout(() => {
        setDebouncedLoading(false);
      }, 1000);
    }
  }, [currentLoadingState, debouncedLoading]);

  return debouncedLoading;
}
