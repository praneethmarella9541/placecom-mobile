/**
 * Tiny in-memory stale-while-revalidate cache.
 * Data is held for the process lifetime (app session).
 * TTL default: 5 minutes. After TTL, stale data is still served
 * immediately while a fresh fetch runs in the background.
 */

interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const store = new Map<string, CacheEntry<unknown>>();

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export function cacheGet<T>(key: string): T | undefined {
  return (store.get(key) as CacheEntry<T> | undefined)?.data;
}

export function cacheSet<T>(key: string, data: T): void {
  store.set(key, { data, fetchedAt: Date.now() });
}

export function cacheIsStale(key: string, ttlMs = DEFAULT_TTL_MS): boolean {
  const entry = store.get(key);
  if (!entry) return true;
  return Date.now() - entry.fetchedAt > ttlMs;
}

export function cacheDelete(key: string): void {
  store.delete(key);
}
