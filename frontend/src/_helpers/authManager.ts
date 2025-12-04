/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { baseApi, TAGS } from '@/RTKService/baseApi';
import { setTokenExpired } from '@/store/authSlice';
import { clearNetworkError, setNetworkOffline, setServerUnreachable } from '@/store/networkStatusSlice';
import type { ThunkDispatch, UnknownAction } from '@reduxjs/toolkit';
import type { FetchBaseQueryError, FetchBaseQueryMeta, QueryReturnValue } from '@reduxjs/toolkit/query';
import Global from './global';

let inMemoryAccessToken: string | null = null;

const sanitizeAccessToken = (token: unknown): string | null => {
  if (typeof token === 'string' && token.trim().length > 0) {
    return token.trim();
  }
  return null;
};

const setAccessToken = (token: string | null): void => {
  inMemoryAccessToken = token;
};

const authManager = {
  getAccessToken(): string | null {
    return inMemoryAccessToken;
  },

  clearAccessToken(): void {
    console.log('clearing access token from auth manager');
    setAccessToken(null);
  },

  saveAccessToken(token: string): void {
    const sanitized = sanitizeAccessToken(token);
    if (!sanitized) {
      console.warn('Attempted to save invalid access token', token);
      return;
    }
    setAccessToken(sanitized);
  },

  clearTwoStepVerification(): void {
    localStorage.removeItem('twoStepVerification');
  },

  async handleLoginOnQueryStarted(queryFulfilled: Promise<any>, dispatch: ThunkDispatch<any, any, UnknownAction>): Promise<void> {
    try {
      const { data } = await queryFulfilled;

      const token = data?.data?.token;
      if (token) {
        this.saveAccessToken(token);
      }
      try {
        const allTags = Object.values(TAGS)
          .filter(Boolean)
          .map((t) => ({ type: t }));
        dispatch(baseApi.util.invalidateTags(allTags));
      } catch (invErr) {
        console.error('Failed to invalidate RTK Query tags on login:', invErr);
      }
    } catch (err) {
      // ignore
    }
  },

  // centralize onQueryStarted handling for OTP verification
  async handleOtpVerificationOnQueryStarted(queryFulfilled: Promise<any>, dispatch: ThunkDispatch<any, any, UnknownAction>): Promise<void> {
    try {
      const { data } = await queryFulfilled;

      // Check if OTP verification was successful by presence of token
      const token = data?.data?.token;
      if (token) {
        this.saveAccessToken(token);
      }

      dispatch(baseApi.util.invalidateTags([TAGS.ACCOUNT_INFO]));
    } catch (err) {
      // ignore
    }
  },

  async handleAccountInfo(queryFulfilled: Promise<any>): Promise<void> {
    try {
      const { data } = await queryFulfilled;
      const isRegistered = data.data.is_registered;
      const pathname = typeof window !== 'undefined' ? window.location.pathname : '';

      if (isRegistered !== 'yes') {
        if (pathname === '/admin' || pathname.startsWith('/admin/')) {
          window.location.href = '/pay-now';
        }
      }
    } catch (err) {
      // ignore error
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
      const probeUrl = Global.BASE_API_PATH;
      const res = await fetch(probeUrl, { method: 'HEAD', cache: 'no-store', signal: controller.signal, mode: 'cors' });
      clearTimeout(id);
      return res && (res.ok || res.type === 'opaque');
    } catch (err) {
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
        // refresh token manager handling the unauthorized case
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
      const tokenExpired = api.getState().auth.tokenExpired;
      if (tokenExpired) {
        api.dispatch(setTokenExpired(false));
      }
    }
  },
};

export default authManager;
