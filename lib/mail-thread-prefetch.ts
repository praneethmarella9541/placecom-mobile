import { gmailApi, type GmailMessage } from './api';

const THREAD_CACHE_TTL_MS = 120_000;

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

/** Intent prefetch — server must NOT mark read (?prefetch=1). */
export function prefetchMailThreadIntent(userId: string, threadId: string): void {
  if (!userId || !threadId) return;
  const key = cacheKey(userId, threadId, 'prefetch');
  if (isFresh(threadCache.get(key))) return;
  const inflightKey = `prefetch:${userId}:${threadId}`;
  if (inflight.has(inflightKey)) return;

  const promise = gmailApi
    .getThread(threadId, { prefetch: true })
    .then((data) => {
      store(userId, threadId, 'prefetch', data);
      return data;
    })
    .finally(() => inflight.delete(inflightKey));

  inflight.set(inflightKey, promise);
}

/** Open thread — reuse prefetch promise if available; else fetch (marks read server-side). */
export async function openMailThread(userId: string, threadId: string): Promise<ThreadPayload> {
  const cached = getCachedThread(userId, threadId);
  if (cached) {
    // Background revalidate on open.
    void gmailApi.getThread(threadId).then((data) => store(userId, threadId, 'open', data)).catch(() => {});
    return cached;
  }

  const prefetchInflight = inflight.get(`prefetch:${userId}:${threadId}`);
  if (prefetchInflight) {
    const data = await prefetchInflight;
    void gmailApi.getThread(threadId).then((d) => store(userId, threadId, 'open', d)).catch(() => {});
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
