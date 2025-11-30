/* eslint-disable @typescript-eslint/no-explicit-any */

interface CacheEntry {
  key: string;
  timestamp: number;
  size: number;
  data: unknown;
}

/**
 * RTK Cache Manager - uses in-memory cache as a fallback when idb is not available
 * To enable IndexedDB caching, install 'idb' package and update this class
 */
class RTKCacheManager {
  private static readonly CACHE_PREFIX = 'rtk-query::';
  public static readonly CACHE_ENABLED = false; // Set to true to enable caching
  private static readonly MAX_CACHE_SIZE = 5 * 1024 * 1024; // 5MB in bytes
  private static memoryCache = new Map<string, CacheEntry>();

  private static calculateSize(data: unknown): number {
    try {
      return new Blob([JSON.stringify(data)]).size;
    } catch {
      return 0;
    }
  }

  private static cleanupOldCache(newEntrySize: number): void {
    try {
      const entries = Array.from(this.memoryCache.entries())
        .map(([mapKey, entry]) => ({ ...entry, key: mapKey }))
        .sort((a: CacheEntry, b: CacheEntry) => a.timestamp - b.timestamp);

      let totalSize = entries.reduce((sum: number, entry: CacheEntry) => sum + (entry.size || 0), 0);
      const targetSize = this.MAX_CACHE_SIZE - newEntrySize;

      if (totalSize + newEntrySize <= this.MAX_CACHE_SIZE) {
        return;
      }

      for (const entry of entries) {
        if (totalSize <= targetSize) break;
        this.memoryCache.delete(entry.key);
        totalSize -= entry.size || 0;
      }
    } catch (error) {
      console.warn('Failed to cleanup old cache entries', error);
    }
  }

  static getCacheKey(endpointName: string, args?: unknown): string | null {
    try {
      const serializedArgs = JSON.stringify(args ?? null);
      return `${this.CACHE_PREFIX}${endpointName}:${serializedArgs}`;
    } catch (error) {
      console.warn(`RTK Query cache serialization failed for endpoint "${endpointName}"`, error);
      return null;
    }
  }

  static async readCacheEntry(key: string): Promise<CacheEntry | null> {
    if (!key) {
      return null;
    }

    return this.memoryCache.get(key) || null;
  }

  static async writeCacheEntry(key: string, data: unknown): Promise<void> {
    if (!key) {
      return;
    }

    try {
      const size = this.calculateSize(data);
      this.cleanupOldCache(size);

      const entry: CacheEntry = {
        key,
        timestamp: Date.now(),
        size,
        data,
      };

      this.memoryCache.set(key, entry);
    } catch (error) {
      console.warn(`Failed to persist RTK Query cache for key "${key}"`, error);
    }
  }

  static async deleteCacheEntry(key: string): Promise<void> {
    if (!key) {
      return;
    }

    try {
      this.memoryCache.delete(key);
    } catch (error) {
      console.warn(`Failed to remove RTK Query cache for key "${key}"`, error);
    }
  }

  static handleCache({ rawBaseQuery, args, api, extraOptions, baseApi, cacheKey }: { rawBaseQuery: any; args: any; api: any; extraOptions: any; baseApi: any; cacheKey: string }): boolean | object | Promise<any> {
    const cachedEntryPromise = RTKCacheManager.readCacheEntry(cacheKey);

    rawBaseQuery(args, api, extraOptions)
      .then(async (result: any) => {
        if (result?.error && result.error.status === 500) {
          await RTKCacheManager.deleteCacheEntry(cacheKey);
          return;
        }

        if (result && typeof result === 'object' && 'data' in result) {
          await RTKCacheManager.writeCacheEntry(cacheKey, result.data);
          // Get original args from RTK Query state
          const state = api.getState?.();
          const queryCacheKey = api.queryCacheKey;
          const queryState = state?.[baseApi.reducerPath]?.queries?.[queryCacheKey];
          if (typeof api.endpoint === 'string') {
            const originalArgs = queryState?.originalArgs;
            api.dispatch(baseApi.util.upsertQueryData(api.endpoint, originalArgs, result.data));
          }
        }
      })
      .catch(async (error: unknown) => {
        await RTKCacheManager.deleteCacheEntry(cacheKey);
        console.warn(`RTK Query request failed for key "${cacheKey}"`, error);
      });

    return cachedEntryPromise.then((cachedEntry) => {
      if (cachedEntry) {
        return {
          data: cachedEntry.data,
          meta: {
            size: cachedEntry.size,
            cacheTimestamp: cachedEntry.timestamp,
            source: 'memory',
          },
        };
      }
      return false;
    });
  }
}

export default RTKCacheManager;
