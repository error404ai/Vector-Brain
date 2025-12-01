/* eslint-disable @typescript-eslint/no-explicit-any */
import type { FetchBaseQueryError, QueryReturnValue } from '@reduxjs/toolkit/query';
import { fetchBaseQuery, type FetchBaseQueryMeta } from '@reduxjs/toolkit/query/react';
import authManager, { type AuthSessionData } from './authManager';
import Global from './global';

const REFRESH_TOKEN_ENDPOINT = '/auth/refresh-token';

const refreshBaseQuery = fetchBaseQuery({
  baseUrl: Global.BASE_API_PATH,
  credentials: 'include',
});

type BaseQueryResult = QueryReturnValue<unknown, FetchBaseQueryError, FetchBaseQueryMeta>;

type MaybePromise<T> = T | PromiseLike<T>;

type BaseQueryFn = (args: any, api: any, extraOptions: any) => MaybePromise<BaseQueryResult>;

type ExecuteParams = {
  requestArgs: any;
  api: any;
  extraOptions: any;
  baseQueryFn: BaseQueryFn;
};

type RefreshTokenPayload = {
  status: string;
  message: string;
  data: {
    accessToken: string;
    expire_at: string;
  };
};

class RefreshTokenManager {
  private static refreshPromise: Promise<boolean> | null = null;

  private static readonly refreshBaseQuery = refreshBaseQuery;

  private static getRequestUrl(args: any): string {
    if (!args) return '';
    if (typeof args === 'string') {
      return args;
    }
    if (typeof args === 'object' && typeof args.url === 'string') {
      return args.url;
    }
    return '';
  }

  private static isRefreshEndpoint(url: string): boolean {
    return url.includes(REFRESH_TOKEN_ENDPOINT.toLowerCase());
  }

  private static shouldRefresh(result: BaseQueryResult, requestArgs: any): boolean {
    if (!result?.error) {
      return false;
    }

    const status = (result.error as any)?.status;
    if (status !== 401) {
      return false;
    }

    const requestUrl = this.getRequestUrl(requestArgs).toLowerCase();
    if (!requestUrl || this.isRefreshEndpoint(requestUrl)) {
      return false;
    }

    return true;
  }

  private static parseSession(payload: RefreshTokenPayload['data']): AuthSessionData | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const { accessToken, expire_at: expireAt } = payload;

    if (typeof accessToken !== 'string' || accessToken.trim().length === 0) {
      return null;
    }

    if (typeof expireAt === 'string' && expireAt.trim().length > 0) {
      return {
        accessToken,
        expireAt,
      };
    }

    const fallbackExpireAt = new Date(Date.now() + 55 * 60 * 1000).toISOString();
    return {
      accessToken,
      expireAt: fallbackExpireAt,
    };
  }

  private static async performRefresh(api: any, extraOptions: any): Promise<boolean> {
    try {
      const response = await this.refreshBaseQuery(
        {
          url: REFRESH_TOKEN_ENDPOINT,
          method: 'POST',
        },
        api,
        extraOptions
      );

      if (response.error) {
        const status = response.error.status;

        if (status === 400 || status === 401) {
          return false;
        }
        throw new Error(`Token refresh failed with status ${status}`);
      }

      const payload = response.data as RefreshTokenPayload;
      const sessionData = this.parseSession(payload?.data);
      if (!sessionData) {
        console.warn('Token refresh response did not contain new session data', response.data);
        return false;
      }

      authManager.saveAuthSession(sessionData);
      return true;
    } catch (error) {
      console.error('Token refresh threw unexpectedly', error);
      throw error;
    }
  }

  private static async waitForActiveRefresh(): Promise<void> {
    while (this.refreshPromise) {
      const pending = this.refreshPromise;
      try {
        await pending;
      } catch {
        // ignore; the caller will handle refresh failure if needed
      }

      if (this.refreshPromise === pending) {
        break;
      }
    }
  }

  private static async ensureRefresh(api: any, extraOptions: any): Promise<boolean> {
    const createPromise = () => this.performRefresh(api, extraOptions);

    const pending = this.refreshPromise ?? createPromise();
    if (!this.refreshPromise) {
      this.refreshPromise = pending;
    }

    try {
      return await pending;
    } finally {
      if (this.refreshPromise === pending) {
        this.refreshPromise = null;
      }
    }
  }

  static async execute({ requestArgs, api, extraOptions, baseQueryFn }: ExecuteParams): Promise<BaseQueryResult> {
    await this.waitForActiveRefresh();

    let result = await baseQueryFn(requestArgs, api, extraOptions);

    if (this.shouldRefresh(result, requestArgs)) {
      try {
        const refreshSucceeded = await this.ensureRefresh(api, extraOptions);
        console.log('refresh token result is', refreshSucceeded);
        if (refreshSucceeded) {
          result = await baseQueryFn(requestArgs, api, extraOptions);
        } else {
          console.warn('Refresh token is invalid, clearing auth session');
          authManager.clearTokens();
        }
      } catch (error) {
        console.error('Token refresh failed with retryable error:', error);
      }
    }

    return result;
  }
}

export default RefreshTokenManager;
