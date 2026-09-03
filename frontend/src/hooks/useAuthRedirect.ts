import authManager from '@/_helpers/authManager';
import { useGetProfileQuery } from '@/RTKService/authService/authService';
import { setTokenExpired } from '@/store/authSlice';
import type { RootState } from '@/store/store';
import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useLocation, useNavigate } from 'react-router-dom';

const publicRoutes = ['/login', '/signup', '/'];

/**
 * Routes that must render for everyone and never bounce anywhere: a shared run
 * link has to open for a stranger with no session, and for a signed-in owner
 * without being pushed to the dashboard.
 */
const openRoutePrefixes = ['/r/'];

export default function useAuthRedirect(skip: boolean = false) {
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useDispatch();
  const authInitialized = useSelector((state: RootState) => state.auth.authInitialized);
  const isOpenRoute = openRoutePrefixes.some((prefix) => location.pathname.startsWith(prefix));
  const isPublicRoute = isOpenRoute || publicRoutes.includes(location.pathname);

  const hasToken = !!authManager.getAccessToken();

  // Use getProfile to initialize auth if token exists but auth not initialized
  // The access token lives in memory only, so after a reload there is none
  // until a silent refresh runs. Firing this query anyway is what triggers that
  // refresh; without it the app decided the user was logged out on every reload.
  const { isLoading: isProfileLoading } = useGetProfileQuery(undefined, {
    skip: isPublicRoute,
  });

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
      navigate(path);
    };
    if (skip || isOpenRoute) {
      return;
    }

    // Deciding before the silent refresh resolves is what bounced every reload
    // to the dashboard: the page redirected to /login, the token then came
    // back, and /login forwarded the now-authenticated user to /dashboard.
    if (!authInitialized && !isPublicRoute) {
      return;
    }

    if (!hasToken && isPublicRoute) {
      return;
    }

    if (!hasToken && !isPublicRoute) {
      performRedirect('/login');
      return;
    }

    if (hasToken && isPublicRoute) {
      performRedirect('/dashboard');
      return;
    }
  }, [authInitialized, isPublicRoute, isOpenRoute, navigate, hasToken, dispatch, skip]);

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

  const loading = Boolean(isProfileLoading || (!authInitialized && !isPublicRoute));

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
