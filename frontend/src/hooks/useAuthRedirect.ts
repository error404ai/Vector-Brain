import type { RootState } from '@/store/store';
import { useLocation, useRouter } from '@tanstack/react-router';
import { useEffect } from 'react';
import { useSelector } from 'react-redux';

const publicRoutes = ['/login', '/signup'];

export const useAuthRedirect = () => {
  const router = useRouter();
  const location = useLocation();
  const isLoggedIn = useSelector((state: RootState) => state.auth.isLoggedIn);
  const isPublicRoute = publicRoutes.includes(location.pathname);

  useEffect(() => {
    if (isLoggedIn === 'initial') return;
    if (!isLoggedIn && !isPublicRoute) {
      router.navigate({ to: '/login' });
    } else if (isLoggedIn && isPublicRoute) {
      router.navigate({ to: '/dashboard' });
    }
  }, [isLoggedIn, isPublicRoute, router]);
};
