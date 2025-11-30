/* eslint-disable @typescript-eslint/no-explicit-any */
import { clearNetworkError, setNetworkOffline, setServerUnreachable, setTokenExpired } from '@/store/networkStatusSlice';
import type { ThunkDispatch, UnknownAction } from '@reduxjs/toolkit';
import type { FetchBaseQueryError, FetchBaseQueryMeta, QueryReturnValue } from '@reduxjs/toolkit/query';
import Global from './global';

// Dynamic import to avoid circular dependency
let baseApiModule: { baseApi: any; TAGS: any } | null = null;
const getBaseApi = async (): Promise<{ baseApi: any; TAGS: any }> => {
  if (!baseApiModule) {
    baseApiModule = await import('@/RTKService/baseApi');
  }
  return baseApiModule!;
};

export type AuthSessionData = {
  accessToken: string;
  expireAt: string;
};

const authManager = {
  getAccessToken(): string | null {
    const auth = this.getAllTokens();
    if (auth) {
      return auth.accessToken || null;
    }
    return null;
  },

  getAllTokens(): AuthSessionData | null {
    const authSession = localStorage.getItem('authSession');
    if (authSession) {
      try {
        const parsed = JSON.parse(authSession) as AuthSessionData;
        return {
          accessToken: parsed.accessToken,
          expireAt: parsed.expireAt,
        };
      } catch (error) {
        console.error('Error parsing tokens from auth:', error);
        return null;
      }
    }
    return null;
  },

  clearTokens(): void {
    console.log('clearing auth session token from auth manager');
    localStorage.removeItem('authSession');
    localStorage.removeItem('authUser');
  },

  saveAuthSession(data: AuthSessionData): void {
    localStorage.setItem('authSession', JSON.stringify(data));
  },

  async handleLoginOnQueryStarted(queryFulfilled: Promise<any>, dispatch: ThunkDispatch<any, any, UnknownAction>): Promise<void> {
    try {
      const { data } = await queryFulfilled;

      if (data?.message === 'Login successful' && data?.data?.token) {
        // Login successful with tokens
        const expireAt = new Date(Date.now() + 55 * 60 * 1000).toISOString(); // Default 55 mins
        this.saveAuthSession({
          accessToken: data.data.token,
          expireAt: data.data.expireAt || expireAt,
        });

        // Save user data
        if (data.data.user) {
          localStorage.setItem('authUser', JSON.stringify(data.data.user));
        }
      }

      // Invalidate all RTK Query tags so every cached endpoint can be refetched
      try {
        const { baseApi, TAGS } = await getBaseApi();
        const allTags = Object.values(TAGS)
          .filter(Boolean)
          .map((t) => ({ type: t }));
        dispatch(baseApi.util.invalidateTags(allTags));
      } catch (invErr) {
        console.error('Failed to invalidate RTK Query tags on login:', invErr);
      }
    } catch {
      // ignore
    }
  },

  // Image-based internet connectivity check - bypasses CORS
  async isInternetReachable(timeout = 3000): Promise<boolean> {
    const testUrls = ['https://www.google.com/favicon.ico', 'https://www.cloudflare.com/favicon.ico', 'https://github.com/favicon.ico', 'https://www.microsoft.com/favicon.ico'];

    const promises = testUrls.map(
      (url) =>
        new Promise((resolve) => {
          const img = new Image();
          const timeoutId = setTimeout(() => resolve(false), timeout);

          img.onload = () => {
            clearTimeout(timeoutId);
            resolve(true);
          };

          img.onerror = () => {
            clearTimeout(timeoutId);
            resolve(false);
          };

          img.src = url + '?' + Date.now(); // Prevent caching
        })
    );

    try {
      const results = await Promise.allSettled(promises);
      return results.some((result) => (result as any).value === true);
    } catch {
      return false;
    }
  },

  async isBackendReachable(timeout = 3000): Promise<boolean> {
    if (typeof fetch === 'undefined') return false;
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);
      const probeUrl = Global.BASE_API_PATH + '/health';
      const res = await fetch(probeUrl, {
        method: 'GET',
        cache: 'no-store',
        signal: controller.signal,
        mode: 'cors',
      });
      clearTimeout(id);
      return res && (res.ok || res.type === 'opaque');
    } catch {
      return false;
    }
  },

  async handleApiError(result: QueryReturnValue<unknown, FetchBaseQueryError, FetchBaseQueryMeta>, api: any): Promise<void> {
    if (result.error) {
      const { status } = result.error;

      if (status === 'FETCH_ERROR') {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          api.dispatch(setNetworkOffline(true));
        } else {
          const internetOk = await this.isInternetReachable(2500);
          if (!internetOk) {
            api.dispatch(setNetworkOffline(true));
          } else {
            const backendOk = await this.isBackendReachable(2500);
            if (!backendOk) {
              api.dispatch(setServerUnreachable(true));
            } else {
              api.dispatch(setServerUnreachable(true));
            }
          }
        }
      } else if (status === 401) {
        const tokenExpired = api.getState().networkStatus?.tokenExpired;
        if (!tokenExpired) {
          api.dispatch(setTokenExpired(true));
        }
      } else if (typeof status === 'number' && status >= 500 && status < 600) {
        api.dispatch(setServerUnreachable(true));
      }
    } else {
      // API call was successful, clear any network errors
      const networkState = api.getState().networkStatus;
      if (networkState?.isServerUnreachable || networkState?.isNetworkOffline) {
        api.dispatch(clearNetworkError());
      }
    }

    if (this.getAccessToken() && !result.error) {
      const tokenExpired = api.getState().networkStatus?.tokenExpired;
      if (tokenExpired) {
        api.dispatch(setTokenExpired(false));
      }
    }
  },
};

export default authManager;
