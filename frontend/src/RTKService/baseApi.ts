/* eslint-disable @typescript-eslint/no-explicit-any */
import { authHeader } from '@/_helpers/auth-header';
import authManager from '@/_helpers/authManager';
import Global from '@/_helpers/global';
import RefreshTokenManager from '@/_helpers/refreshTokenManager';
import RTKCacheManager from '@/_helpers/RTKCacheManager';
import { createApi, fetchBaseQuery } from '@reduxjs/toolkit/query/react';

export const TAGS = {
  ACCOUNT_INFO: 'accountInfo',
  PROFILE: 'Profile',
  USER: 'User',
  USERS: 'Users',
} as const;

const baseQuery = async (args: any, api: any, extraOptions: any) => {
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

  const cacheKey = RTKCacheManager.getCacheKey(api?.endpoint, args);
  const shouldCache = RTKCacheManager.CACHE_ENABLED && api?.type === 'query' && Boolean(cacheKey);

  const executeWithRefresh = async (requestArgs: any, requestApi: any, requestExtraOptions: any) => {
    const result = await RefreshTokenManager.execute({
      requestArgs,
      api: requestApi,
      extraOptions: requestExtraOptions,
      baseQueryFn: rawBaseQuery,
    });

    await authManager.handleApiError(result, requestApi);
    return result;
  };

  if (shouldCache && cacheKey) {
    const cacheResult = RTKCacheManager.handleCache({
      rawBaseQuery: executeWithRefresh,
      args,
      api,
      extraOptions,
      baseApi,
      cacheKey,
    });

    if (cacheResult) {
      return cacheResult;
    }
  }

  // No cache or not cacheable - fetch normally
  return executeWithRefresh(args, api, extraOptions);
};

export const baseApi = createApi({
  reducerPath: 'api',
  baseQuery,
  tagTypes: Object.values(TAGS),
  endpoints: () => ({}),
});
