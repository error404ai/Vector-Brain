/* eslint-disable @typescript-eslint/no-explicit-any */
import type { IDBPDatabase } from 'idb';
import { openDB } from 'idb';

interface CacheEntry {
  key: string;
  timestamp: number;
  size: number;
  data: unknown;
}

/**
 * RTK Cache Manager - uses IndexedDB for persistent caching
 * Follows the pattern from cms-frontend for stale-while-revalidate caching
 */
class RTKCacheManager {
  private static readonly CACHE_PREFIX = 'rtk-query::';
  public static readonly CACHE_ENABLED = true;
  private static readonly DB_NAME = 'rtk-query-cache';
  private static readonly STORE_NAME = 'cache';
  private static readonly MAX_CACHE_SIZE = 10 * 1024 * 1024; // 10MB in bytes
  private static readonly CACHE_INVALIDATION_STATUS_CODES = [500, 404]; // Status codes that invalidate cache
  private static dbPromise: Promise<IDBPDatabase> | null = null;
  /**
   * Endpoints that return screenshots. They were written to IndexedDB like any
   * other query — 100KB+ each, dozens on one page — and every write read the
   * whole store back into memory to size it, which helped crash the tab.
   */
  private static readonly NEVER_PERSIST = ['getFinalScreen', 'getChatScreen', 'sendDirectAction'];
  /** Anything bigger than this is served from the network only. */
  private static readonly MAX_ENTRY_SIZE = 256 * 1024;
  /** A polled query rewrites its entry at most this often. */
  private static readonly MIN_REWRITE_MS = 60_000;
  private static lastWrite = new Map<string, number>();
  /** Queries already answered once in this tab. */
  private static served = new Set<string>();
  /** Running size of the store, so a write never has to read it all back. */
  private static sizes: Map<string, number> | null = null;

  static canPersist(endpointName: string | null | undefined): boolean {
    return !endpointName || !this.NEVER_PERSIST.includes(endpointName);
  }

  private static async getDB(): Promise<IDBPDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDB(this.DB_NAME, 1, {
        upgrade(db) {
          if (!db.objectStoreNames.contains(RTKCacheManager.STORE_NAME)) {
            const store = db.createObjectStore(RTKCacheManager.STORE_NAME, { keyPath: 'key' });
            store.createIndex('timestamp', 'timestamp');
          }
        },
      }).then(async (db) => {
        // Drop screenshots cached by earlier builds (keys only — no data read).
        try {
          const keys = (await db.getAllKeys(RTKCacheManager.STORE_NAME)) as string[];
          const stale = keys.filter((k) => RTKCacheManager.NEVER_PERSIST.some((name) => String(k).includes(`${name}:`)));
          if (stale.length) {
            const tx = db.transaction(RTKCacheManager.STORE_NAME, 'readwrite');
            for (const k of stale) void tx.store.delete(k);
            await tx.done;
          }
        } catch {
          // best effort
        }
        return db;
      });
    }
    return this.dbPromise;
  }

  private static calculateSize(data: unknown): number {
    try {
      return new Blob([JSON.stringify(data)]).size;
    } catch {
      return 0;
    }
  }

  /** Sizes of every entry, read once per session with a cursor (values are not kept). */
  private static async loadSizes(): Promise<Map<string, number>> {
    if (this.sizes) return this.sizes;
    const sizes = new Map<string, number>();
    const db = await this.getDB();
    let cursor = await db.transaction(this.STORE_NAME, 'readonly').store.openCursor();
    while (cursor) {
      sizes.set(String(cursor.key), (cursor.value as CacheEntry)?.size || 0);
      cursor = await cursor.continue();
    }
    this.sizes = sizes;
    return sizes;
  }

  private static async cleanupOldCache(key: string, newEntrySize: number): Promise<void> {
    try {
      const sizes = await this.loadSizes();
      let total = 0;
      for (const [k, size] of sizes) if (k !== key) total += size;
      if (total + newEntrySize <= this.MAX_CACHE_SIZE) return;

      // Oldest first, by key order of the timestamp index (keys only).
      const db = await this.getDB();
      const oldest = (await db.getAllKeysFromIndex(this.STORE_NAME, 'timestamp')) as string[];
      const tx = db.transaction(this.STORE_NAME, 'readwrite');
      for (const k of oldest) {
        if (total + newEntrySize <= this.MAX_CACHE_SIZE) break;
        if (k === key) continue;
        void tx.store.delete(k);
        total -= sizes.get(k) ?? 0;
        sizes.delete(k);
      }
      await tx.done;
    } catch (error) {
      console.warn('Failed to cleanup old cache entries', error);
    }
  }

  private static shouldInvalidateCache(statusCode: number): boolean {
    return this.CACHE_INVALIDATION_STATUS_CODES.includes(statusCode);
  }

  static getCacheKey(endpointName: string, args?: unknown): string | null {
    try {
      const serializedArgs = JSON.stringify(args ?? null);
      const userPrefix = this.getUserCachePrefix();
      const prefix = userPrefix ? `${userPrefix}` : '';
      return `${this.CACHE_PREFIX}${prefix}${endpointName}:${serializedArgs}`;
    } catch (error) {
      console.warn(`RTK Query cache serialization failed for endpoint "${endpointName}"`, error);
      return null;
    }
  }

  static async readCacheEntry(key: string): Promise<CacheEntry | null> {
    if (!key) {
      return null;
    }

    const db = await this.getDB();
    const entry: CacheEntry | undefined = await db.get(this.STORE_NAME, key);

    return entry || null;
  }

  static async writeCacheEntry(key: string, data: unknown): Promise<void> {
    if (!key) {
      return;
    }

    try {
      // Polled queries (fleet state every few seconds) would rewrite their
      // entry on every poll; the cache is for a fast first paint, so once a
      // minute is plenty.
      const now = Date.now();
      if (now - (this.lastWrite.get(key) ?? 0) < this.MIN_REWRITE_MS) return;
      this.lastWrite.set(key, now);

      const size = this.calculateSize(data);
      if (size > this.MAX_ENTRY_SIZE) {
        await this.deleteCacheEntry(key);
        return;
      }

      await this.cleanupOldCache(key, size);

      const db = await this.getDB();
      const entry: CacheEntry = {
        key,
        timestamp: Date.now(),
        size,
        data,
      };

      await db.put(this.STORE_NAME, entry);
      this.sizes?.set(key, size);
    } catch (error) {
      console.warn(`Failed to persist RTK Query cache for key "${key}"`, error);
    }
  }

  static async deleteCacheEntry(key: string): Promise<void> {
    if (!key) {
      return;
    }

    try {
      this.sizes?.delete(key);
      this.lastWrite.delete(key);
      const db = await this.getDB();
      await db.delete(this.STORE_NAME, key);
    } catch (error) {
      console.warn(`Failed to remove RTK Query cache for key "${key}"`, error);
    }
  }

  static async handleCache({ rawBaseQuery, args, api, extraOptions, baseApi, cacheKey }: { rawBaseQuery: any; args: any; api: any; extraOptions: any; baseApi: any; cacheKey: string }): Promise<{
    cachedResponse: { data: unknown; meta: { size: number; cacheTimestamp: number; source: string } } | null;
    networkPromise: Promise<any>;
  }> {
    // The stored copy is only for the first paint of a query in this tab.
    // Serving it on every poll showed an up-to-a-minute-old copy first and
    // then the fresh one — two renders per poll for nothing.
    const firstThisSession = !RTKCacheManager.served.has(cacheKey);
    RTKCacheManager.served.add(cacheKey);
    const cachedEntryPromise = firstThisSession ? RTKCacheManager.readCacheEntry(cacheKey) : Promise.resolve(null);

    const networkPromise = rawBaseQuery(args, api, extraOptions)
      .then(async (result: any) => {
        const endpointName = typeof api?.endpoint === 'string' ? api.endpoint : null;
        RTKCacheManager.syncUserCachePrefix(endpointName, result);

        const errorStatus = result?.error?.originalStatus ?? result?.error?.status;
        if (typeof errorStatus === 'number' && RTKCacheManager.shouldInvalidateCache(errorStatus)) {
          await RTKCacheManager.deleteCacheEntry(cacheKey);
          return result;
        }

        if (result && typeof result === 'object' && 'data' in result) {
          await RTKCacheManager.writeCacheEntry(cacheKey, result.data);
          // Only needed when a cached copy was handed out first: then this
          // fresher result must replace it. Otherwise the network result is
          // returned directly, and a second store update just re-rendered.
          if (!(await cachedEntryPromise)) return result;
          const state = api.getState?.();
          const queryCacheKey = api.queryCacheKey;
          const queryState = state?.[baseApi.reducerPath]?.queries?.[queryCacheKey];
          if (typeof api.endpoint === 'string') {
            const originalArgs = queryState?.originalArgs;
            api.dispatch(baseApi.util.upsertQueryData(api.endpoint, originalArgs, result.data));
          }
        }

        return result;
      })
      .catch(async (error: unknown) => {
        await RTKCacheManager.deleteCacheEntry(cacheKey);
        console.warn(`RTK Query request failed for key "${cacheKey}"`, error);
        throw error;
      });

    const cachedEntry = await cachedEntryPromise;

    if (cachedEntry) {
      return {
        cachedResponse: {
          data: cachedEntry.data,
          meta: {
            size: cachedEntry.size,
            cacheTimestamp: cachedEntry.timestamp,
            source: 'indexedDB',
          },
        },
        networkPromise,
      };
    }

    return {
      cachedResponse: null,
      networkPromise,
    };
  }

  static storeUserCachePrefix(accountUserType: string | null | undefined, accountUserId: string | number | null | undefined): string | null {
    if (!accountUserType || accountUserId === undefined || accountUserId === null) {
      return null;
    }

    const key = `${accountUserType}::${accountUserId}::`;

    try {
      localStorage.setItem('RTKCacheUserPrefix', key);
    } catch (error) {
      console.warn('Failed to set RTK cache user prefix', error);
    }
    return key;
  }

  static clearUserCachePrefix(): void {
    try {
      localStorage.removeItem('RTKCacheUserPrefix');
    } catch (error) {
      console.warn('Failed to clear RTK cache user prefix', error);
    }
  }

  /**
   * Wipe every cached entry and the user prefix. Called on logout so the next
   * person to sign in on this browser can never be served the previous user's
   * cached responses out of IndexedDB.
   */
  static async clearAll(): Promise<void> {
    this.clearUserCachePrefix();
    try {
      const db = await this.getDB();
      await db.clear(this.STORE_NAME);
      this.sizes = new Map();
      this.lastWrite.clear();
      this.served.clear();
    } catch (error) {
      console.warn('Failed to clear RTK cache store', error);
    }
  }

  static getUserCachePrefix(): string | null {
    try {
      return localStorage.getItem('RTKCacheUserPrefix');
    } catch (error) {
      console.warn('Failed to read RTK cache user prefix', error);
      return null;
    }
  }

  static syncUserCachePrefix(endpointName: string | null, result: any): void {
    const errorStatus = result?.error?.status ?? result?.error?.originalStatus;

    if (typeof errorStatus === 'number' && errorStatus === 401) {
      RTKCacheManager.clearUserCachePrefix();
      return;
    }

    // Support both getAccountInfo (cms-frontend) and getProfile (Vector-Brain)
    if (endpointName !== 'getAccountInfo' && endpointName !== 'getProfile') {
      return;
    }

    const payload = result.data?.data ?? result.data;
    const accountType = payload?.account_type ?? payload?.accountUserType ?? payload?.role ?? 'user';
    const accountId = payload?.id ?? payload?.account_user_id ?? payload?.accountUserId ?? null;

    if (accountType != null && accountId != null) {
      RTKCacheManager.storeUserCachePrefix(String(accountType), String(accountId));
    }
  }
}

export default RTKCacheManager;
