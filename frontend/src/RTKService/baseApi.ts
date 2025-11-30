/* eslint-disable @typescript-eslint/no-explicit-any */
import { authHeader } from '@/_helpers/auth-header';
import authManager from '@/_helpers/authManager';
import Global from '@/_helpers/global';
import RefreshTokenManager from '@/_helpers/refreshTokenManager';
import RTKCacheManager from '@/_helpers/RTKCacheManager';
import type { BaseQueryFn, FetchArgs, FetchBaseQueryError, FetchBaseQueryMeta } from '@reduxjs/toolkit/query';
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

export const TAGS = {
  ACCOUNT_INFO: 'accountInfo',
  PROFILE: 'Profile',
  USER: 'User',
  USERS: 'Users',
} as const;

const createBaseQuery = (): BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError, object, FetchBaseQueryMeta> => {
  const rawBaseQuery = fetchBaseQuery({
    baseUrl: Global.BASE_API_PATH,
    credentials: 'include',
    prepareHeaders: (headers) => {
      const authHeaders = authHeader(false);
      Object.entries(authHeaders).forEach(([key, value]) => {
        headers.set(key, String(value));
      });
      return headers;
    },
  });

  return async (args, api, extraOptions) => {
    const cacheKey = RTKCacheManager.getCacheKey(api?.endpoint as string, args);
    const shouldCache = RTKCacheManager.CACHE_ENABLED && api?.type === 'query' && Boolean(cacheKey);

    const executeWithRefresh = async (requestArgs: any, requestApi: any, requestExtraOptions: any): Promise<any> => {
      const result = await RefreshTokenManager.execute({
        requestArgs,
        api: requestApi,
        extraOptions: requestExtraOptions,
        baseQueryFn: rawBaseQuery as any,
      });

      await authManager.handleApiError(result as any, requestApi);
      return result;
    };

    if (shouldCache && cacheKey) {
      const cacheResult: any = RTKCacheManager.handleCache({
        rawBaseQuery: executeWithRefresh,
        args,
        api,
        extraOptions,
        baseApi: null, // Cache is disabled by default
        cacheKey,
      });

      if (cacheResult) {
        return cacheResult;
      }
    }

    // No cache or not cacheable - fetch normally
    return executeWithRefresh(args, api, extraOptions);
  };
};

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery: createBaseQuery(),
  tagTypes: Object.values(TAGS),
  endpoints: () => ({}),
});
