import { gmailApi, type GmailMessage } from './api';
import {
  buildMailListCacheKey,
  getMailListCache,
  MAIL_LIST_PAGE_SIZE,
  MAIL_LIST_PREFETCH_SPECS,
  prefetchMailListViews,
} from './inbox-list-prefetch';

/** Set EXPO_PUBLIC_DISABLE_MAIL_THREAD_PREFETCH=1 in .env to pause background thread fetches. */
export const MAIL_THREAD_PREFETCH_DISABLED =
  process.env.EXPO_PUBLIC_DISABLE_MAIL_THREAD_PREFETCH === '1';

const THREAD_CACHE_TTL_MS = 120_000;
const BODY_PREFETCH_CONCURRENCY = 2;
/** Skip re-warming thread bodies when inbox list reloads frequently (history poll). */
const BODY_WARM_COOLDOWN_MS = 90_000;

let lastBodyWarmAt = 0;
let bodyWarmInFlight = false;

type ThreadPayload = { threadId: string; messages: GmailMessage[]; labelIds?: string[] };

type CacheEntry = {
  data: ThreadPayload;
  fetchedAt: number;
  kind: 'prefetch' | 'open';
};

const threadCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<ThreadPayload>>();

function cacheKey(userId: string, threadId: string, kind: 'prefetch' | 'open'): string {
  return `${kind}:${userId}:${threadId}`;
}

function isFresh(entry: CacheEntry | undefined): boolean {
  if (!entry) return false;
  return Date.now() - entry.fetchedAt < THREAD_CACHE_TTL_MS;
}

function gcThreadCache(): void {
  const now = Date.now();
  for (const [key, entry] of threadCache) {
    if (now - entry.fetchedAt > THREAD_CACHE_TTL_MS) threadCache.delete(key);
  }
}

export function clearMailThreadPrefetchCache(): void {
  threadCache.clear();
  inflight.clear();
}

function store(userId: string, threadId: string, kind: 'prefetch' | 'open', data: ThreadPayload): void {
  gcThreadCache();
  threadCache.set(cacheKey(userId, threadId, kind), { data, fetchedAt: Date.now(), kind });
  // Open fetch also satisfies prefetch consumers.
  if (kind === 'open') {
    threadCache.set(cacheKey(userId, threadId, 'prefetch'), { data, fetchedAt: Date.now(), kind: 'open' });
  }
}

export function getCachedThread(
  userId: string,
  threadId: string
): ThreadPayload | undefined {
  gcThreadCache();
  const open = threadCache.get(cacheKey(userId, threadId, 'open'));
  if (isFresh(open)) return open!.data;
  const prefetch = threadCache.get(cacheKey(userId, threadId, 'prefetch'));
  if (isFresh(prefetch)) return prefetch!.data;
  return undefined;
}

/** Fetch full thread (messages + bodies) without marking read — ?prefetch=1. */
export function prefetchMailThreadOnce(
  userId: string,
  threadId: string,
  opts?: { signal?: AbortSignal }
): Promise<ThreadPayload | null> {
  if (MAIL_THREAD_PREFETCH_DISABLED) return Promise.resolve(null);
  if (!userId || !threadId || opts?.signal?.aborted) return Promise.resolve(null);

  const key = cacheKey(userId, threadId, 'prefetch');
  const cached = threadCache.get(key);
  if (isFresh(cached)) return Promise.resolve(cached!.data);

  const inflightKey = `prefetch:${userId}:${threadId}`;
  const existing = inflight.get(inflightKey);
  if (existing) return existing;

  const promise = gmailApi
    .getThread(threadId, { prefetch: true, signal: opts?.signal })
    .then((data) => {
      store(userId, threadId, 'prefetch', data);
      return data;
    })
    .catch(() => null)
    .finally(() => inflight.delete(inflightKey));

  inflight.set(inflightKey, promise);
  return promise;
}

/** Intent prefetch — server must NOT mark read (?prefetch=1). */
export function prefetchMailThreadIntent(userId: string, threadId: string): void {
  void prefetchMailThreadOnce(userId, threadId);
}

/** Collect thread ids from every warmed mail category list (deduped). */
export function collectThreadIdsFromWarmedMailLists(perCategory = MAIL_LIST_PAGE_SIZE): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const spec of MAIL_LIST_PREFETCH_SPECS) {
    const key = buildMailListCacheKey(spec.folder, spec.labelId ?? '', spec.search ?? '');
    const page = getMailListCache(key);
    if (!page?.threads.length) continue;
    for (const thread of page.threads.slice(0, perCategory)) {
      if (!thread.id || seen.has(thread.id)) continue;
      seen.add(thread.id);
      ids.push(thread.id);
    }
  }
  return ids;
}

/** Background-fetch message bodies for threads already in warmed list caches. */
export async function prefetchMailBodiesForWarmedCategories(
  userId: string,
  opts?: {
    signal?: AbortSignal;
    perCategory?: number;
    concurrency?: number;
  }
): Promise<void> {
  if (MAIL_THREAD_PREFETCH_DISABLED) return;
  if (!userId || opts?.signal?.aborted) return;

  const threadIds = collectThreadIdsFromWarmedMailLists(opts?.perCategory ?? MAIL_LIST_PAGE_SIZE);
  if (!threadIds.length) return;

  const concurrency = opts?.concurrency ?? BODY_PREFETCH_CONCURRENCY;
  let idx = 0;

  const workers = Array.from({ length: Math.min(concurrency, threadIds.length) }, async () => {
    while (idx < threadIds.length && !opts?.signal?.aborted) {
      const i = idx++;
      await prefetchMailThreadOnce(userId, threadIds[i]!, { signal: opts?.signal });
    }
  });

  await Promise.all(workers);
}

/** After the active list loads — warm other categories, then prefetch their thread bodies. */
export function startMailListAndBodyPrefetchWarm(
  userId: string | undefined,
  opts?: {
    skipKeys?: Set<string>;
    listConcurrency?: number;
    bodyConcurrency?: number;
    /** Bypass cooldown (e.g. pull-to-refresh). */
    force?: boolean;
  }
): void {
  const now = Date.now();
  if (!opts?.force && (bodyWarmInFlight || now - lastBodyWarmAt < BODY_WARM_COOLDOWN_MS)) {
    return;
  }
  bodyWarmInFlight = true;
  lastBodyWarmAt = now;

  void prefetchMailListViews({
    skipKeys: opts?.skipKeys,
    concurrency: opts?.listConcurrency ?? 3,
  })
    .then(() => {
      if (userId && !MAIL_THREAD_PREFETCH_DISABLED) {
        return prefetchMailBodiesForWarmedCategories(userId, {
          concurrency: opts?.bodyConcurrency ?? BODY_PREFETCH_CONCURRENCY,
        });
      }
    })
    .finally(() => {
      bodyWarmInFlight = false;
    });
}

/** Login / warm: list metadata first, then thread bodies for each category. */
export async function warmMailListsThenThreadBodies(
  userId: string,
  opts?: {
    skipKeys?: Set<string>;
    listConcurrency?: number;
    bodyConcurrency?: number;
    signal?: AbortSignal;
  }
): Promise<void> {
  await prefetchMailListViews({
    skipKeys: opts?.skipKeys,
    concurrency: opts?.listConcurrency ?? 3,
    signal: opts?.signal,
  });
  if (opts?.signal?.aborted) return;
  if (!MAIL_THREAD_PREFETCH_DISABLED) {
    await prefetchMailBodiesForWarmedCategories(userId, {
      signal: opts?.signal,
      concurrency: opts?.bodyConcurrency ?? BODY_PREFETCH_CONCURRENCY,
    });
  }
}

/** Open thread — reuse prefetch promise if available; else fetch (marks read server-side). */
export async function openMailThread(userId: string, threadId: string): Promise<ThreadPayload> {
  const cached = getCachedThread(userId, threadId);
  if (cached) {
    if (!MAIL_THREAD_PREFETCH_DISABLED) {
      void gmailApi.getThread(threadId).then((data) => store(userId, threadId, 'open', data)).catch(() => {});
    }
    return cached;
  }

  const prefetchInflight = inflight.get(`prefetch:${userId}:${threadId}`);
  if (prefetchInflight) {
    const data = await prefetchInflight;
    if (!MAIL_THREAD_PREFETCH_DISABLED) {
      void gmailApi.getThread(threadId).then((d) => store(userId, threadId, 'open', d)).catch(() => {});
    }
    return data;
  }

  const openInflightKey = `open:${userId}:${threadId}`;
  const existing = inflight.get(openInflightKey);
  if (existing) return existing;

  const promise = gmailApi.getThread(threadId).then((data) => {
    store(userId, threadId, 'open', data);
    return data;
  }).finally(() => inflight.delete(openInflightKey));

  inflight.set(openInflightKey, promise);
  return promise;
}
