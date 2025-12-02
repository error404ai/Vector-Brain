import { useGetProfileQuery } from '@/RTKService/authService/authService';
import { setAuthCheckCompleted, setIsLoggedIn } from '@/store/authSlice';
import type { RootState } from '@/store/store';
import { useAppDispatch } from '@/store/store';
import authManager from '@/utils/authManager';
import type { FetchBaseQueryError } from '@reduxjs/toolkit/query';
import { useLocation, useRouter } from '@tanstack/react-router';
import { useEffect, useMemo, useRef } from 'react';
import { useSelector } from 'react-redux';

const publicRoutes = ['/login', '/signup', '/'];

export const useAuthRedirect = () => {
  const router = useRouter();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const isLoggedIn = useSelector((state: RootState) => state.auth.isLoggedIn);
  const hasCheckedAuth = useSelector((state: RootState) => state.auth.hasCheckedAuth);
  const isPublicRoute = publicRoutes.includes(location.pathname);

  const { data, error, isError } = useGetProfileQuery(undefined);
  const handledErrorRef = useRef(false);

  const profile = data?.data ?? null;

  useEffect(() => {
    if (!profile) return;
    authManager.saveUser(profile);
    dispatch(setIsLoggedIn(true));
    dispatch(setAuthCheckCompleted(true));
    handledErrorRef.current = false;
  }, [profile, dispatch]);

  useEffect(() => {
    if (!isError || handledErrorRef.current) return;
    const status = (error as FetchBaseQueryError | undefined)?.status;
    if (status === 401 || status === 403) {
      handledErrorRef.current = true;
      authManager.clearToken();
      dispatch(setAuthCheckCompleted(true));
    }
  }, [isError, error, dispatch]);

  useEffect(() => {
    if (!hasCheckedAuth) {
      return;
    }

    if (!isLoggedIn && !isPublicRoute) {
      router.navigate({ to: '/login' });
    } else if (isLoggedIn && isPublicRoute) {
      router.navigate({ to: '/dashboard' });
    }
  }, [hasCheckedAuth, isLoggedIn, isPublicRoute, router]);

  const isCheckingAuth = useMemo(() => !hasCheckedAuth, [hasCheckedAuth]);

  return { isCheckingAuth };
};
