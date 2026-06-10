import { invalidateMailListFolder } from './inbox-list-prefetch';
import type { GmailFolder } from './api';

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

export function cacheDeleteByPrefix(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}

/** Drop every in-memory entry (e.g. on sign-out or account switch). */
export function cacheClearAll(): void {
  store.clear();
}

/** Invalidate Gmail list caches for a folder across search/label variants. */
export function cacheDeleteInboxFolder(folder: string): void {
  const needle = `:${folder}:`;
  for (const key of store.keys()) {
    if (key.includes(needle) || key.startsWith(`inbox:${folder}:`)) {
      store.delete(key);
    }
  }
  const apiFolders: GmailFolder[] = [
    'inbox',
    'sent',
    'drafts',
    'trash',
    'spam',
    'allmail',
  ];
  if (apiFolders.includes(folder as GmailFolder)) {
    invalidateMailListFolder(folder as GmailFolder);
  }
}
