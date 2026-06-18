import { gmailApi, type GmailMessage } from './api';
import { ingestThreadDerivedFromMessages } from './email-contact-suggestions';
import {
  buildMailListCacheKey,
  getMailListCache,
  MAIL_LIST_PAGE_SIZE,
  MAIL_LIST_PREFETCH_SPECS,
  prefetchMailListViews,
} from './inbox-list-prefetch';
import {
  beginMailBodyPrefetchWarm,
  finishMailBodyPrefetchWarm,
  shouldPrefetchVisibleMailList,
} from './login-prefetch-session';
import { withApiDebugTagAsync } from './api-debug';
import {
  clearMailThreadSessionStorage,
  loadPersistedMailThreadBodies,
  persistMailThreadSessionCache,
  type MailThreadCachePayload,
} from './mail-thread-session-cache';

/** Set EXPO_PUBLIC_DISABLE_MAIL_THREAD_PREFETCH=1 in .env to pause background thread fetches. */
export const MAIL_THREAD_PREFETCH_DISABLED =
  process.env.EXPO_PUBLIC_DISABLE_MAIL_THREAD_PREFETCH === '1';

const BODY_PREFETCH_CONCURRENCY = 2;
const VISIBLE_BODY_PREFETCH_CONCURRENCY = 4;
const VISIBLE_BODY_PREFETCH_LEAD = 15;
const SESSION_THREAD_TTL_MS = 30 * 60 * 1000;
/** After a failed ?prefetch=1, do not retry the same thread for a while. */
const PREFETCH_FAIL_COOLDOWN_MS = 5 * 60 * 1000;
/** Same folder/tab landing warm at most once per interval. */
const LANDING_VIEW_COOLDOWN_MS = 45_000;

let lastBodyWarmAt = 0;
let bodyWarmInFlight = false;
const prefetchFailedAt = new Map<string, number>();
const landingWarmAt = new Map<string, number>();
let hydrateUserId: string | null = null;
let hydratePromise: Promise<void> | null = null;

type ThreadPayload = MailThreadCachePayload;

type CacheEntry = {
  data: ThreadPayload;
  fetchedAt: number;
  kind: 'prefetch' | 'open';
};

const threadCache = new Map<string, CacheEntry>();
const prefetchInflight = new Map<string, Promise<ThreadPayload | null>>();
const openInflight = new Map<string, Promise<ThreadPayload>>();

function cacheKey(userId: string, threadId: string, kind: 'prefetch' | 'open'): string {
  return `${kind}:${userId}:${threadId}`;
}

function isFresh(entry: CacheEntry | undefined): boolean {
  if (!entry) return false;
  return Date.now() - entry.fetchedAt < SESSION_THREAD_TTL_MS;
}

function gcThreadCache(): void {
  const now = Date.now();
  for (const [key, entry] of threadCache) {
    if (now - entry.fetchedAt > SESSION_THREAD_TTL_MS) threadCache.delete(key);
  }
}

export function clearMailThreadPrefetchCache(): void {
  threadCache.clear();
  prefetchInflight.clear();
  openInflight.clear();
  prefetchFailedAt.clear();
  landingWarmAt.clear();
  hydrateUserId = null;
  hydratePromise = null;
  void clearMailThreadSessionStorage();
}

/** Hydrate thread bodies from disk (call once per user session). */
export function hydrateMailThreadPrefetchCache(userId: string): Promise<void> {
  if (!userId) return Promise.resolve();
  if (hydrateUserId === userId && hydratePromise) return hydratePromise;
  hydrateUserId = userId;
  hydratePromise = loadPersistedMailThreadBodies(userId).then((entries) => {
    for (const [threadId, entry] of entries) {
      const key = cacheKey(userId, threadId, 'prefetch');
      if (!isFresh(threadCache.get(key))) {
        threadCache.set(key, { data: entry.data, fetchedAt: entry.fetchedAt, kind: 'prefetch' });
      }
    }
  });
  return hydratePromise;
}

function store(userId: string, threadId: string, kind: 'prefetch' | 'open', data: ThreadPayload): void {
  gcThreadCache();
  threadCache.set(cacheKey(userId, threadId, kind), { data, fetchedAt: Date.now(), kind });
  if (kind === 'open') {
    threadCache.set(cacheKey(userId, threadId, 'prefetch'), { data, fetchedAt: Date.now(), kind: 'open' });
  }
  persistMailThreadSessionCache(userId, threadId, data);
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

function prefetchBlockKey(userId: string, threadId: string): string {
  return `${userId}:${threadId}`;
}

function isPrefetchBlocked(userId: string, threadId: string): boolean {
  const failedAt = prefetchFailedAt.get(prefetchBlockKey(userId, threadId));
  return failedAt != null && Date.now() - failedAt < PREFETCH_FAIL_COOLDOWN_MS;
}

function markPrefetchFailed(userId: string, threadId: string): void {
  prefetchFailedAt.set(prefetchBlockKey(userId, threadId), Date.now());
}

/** Fetch full thread (messages + bodies) without marking read — ?prefetch=1. */
export function prefetchMailThreadOnce(
  userId: string,
  threadId: string,
  opts?: { signal?: AbortSignal }
): Promise<ThreadPayload | null> {
  if (MAIL_THREAD_PREFETCH_DISABLED) return Promise.resolve(null);
  if (!userId || !threadId || opts?.signal?.aborted) return Promise.resolve(null);
  if (isPrefetchBlocked(userId, threadId)) return Promise.resolve(null);

  const key = cacheKey(userId, threadId, 'prefetch');
  const cached = threadCache.get(key);
  if (isFresh(cached)) return Promise.resolve(cached!.data);

  const inflightKey = `prefetch:${userId}:${threadId}`;
  const existing = prefetchInflight.get(inflightKey);
  if (existing) return existing;

  const promise = withApiDebugTagAsync('mail-body-prefetch', () =>
    gmailApi
      .getThread(threadId, { prefetch: true, signal: opts?.signal })
      .then((data) => {
        const payload: ThreadPayload = {
          threadId: data.threadId ?? threadId,
          messages: data.messages ?? [],
          labelIds: data.labelIds,
        };
        store(userId, threadId, 'prefetch', payload);
        prefetchFailedAt.delete(prefetchBlockKey(userId, threadId));
        return payload;
      })
      .catch(() => {
        markPrefetchFailed(userId, threadId);
        return null;
      })
  ).finally(() => prefetchInflight.delete(inflightKey));

  prefetchInflight.set(inflightKey, promise);
  return promise;
}

export function prefetchMailThreadIntent(userId: string, threadId: string): void {
  void prefetchMailThreadOnce(userId, threadId);
}

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

export async function prefetchMailThreadBodies(
  userId: string,
  threadIds: readonly string[],
  opts?: {
    signal?: AbortSignal;
    concurrency?: number;
    forceRefresh?: boolean;
    append?: boolean;
    landing?: boolean;
    viewKey?: string;
  }
): Promise<void> {
  if (MAIL_THREAD_PREFETCH_DISABLED) return;
  if (!userId || opts?.signal?.aborted) return;
  if (!shouldPrefetchVisibleMailList(opts)) return;

  if (opts?.landing && !opts?.append && opts?.viewKey && !opts?.forceRefresh) {
    const last = landingWarmAt.get(opts.viewKey);
    if (last != null && Date.now() - last < LANDING_VIEW_COOLDOWN_MS) return;
  }

  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of threadIds) {
    if (!id || seen.has(id)) continue;
    if (!opts?.forceRefresh && getCachedThread(userId, id)) continue;
    if (!opts?.forceRefresh && isPrefetchBlocked(userId, id)) continue;
    seen.add(id);
    ids.push(id);
  }
  if (!ids.length) return;

  if (opts?.landing && !opts?.append && opts?.viewKey) {
    landingWarmAt.set(opts.viewKey, Date.now());
    if (__DEV__) {
      console.log(`[mail-body-prefetch] landing ${ids.length} threads (view ${opts.viewKey})`);
    }
  }

  const lead = ids.slice(0, VISIBLE_BODY_PREFETCH_LEAD);
  const rest = ids.slice(VISIBLE_BODY_PREFETCH_LEAD);
  const leadConcurrency = opts?.concurrency ?? VISIBLE_BODY_PREFETCH_CONCURRENCY;

  await Promise.all([
    prefetchMailThreadBodiesBatch(userId, lead, { signal: opts?.signal, concurrency: leadConcurrency }),
    rest.length
      ? prefetchMailThreadBodiesBatch(userId, rest, {
          signal: opts?.signal,
          concurrency: Math.max(4, Math.floor(leadConcurrency / 2)),
        })
      : Promise.resolve(),
  ]);
}

async function prefetchMailThreadBodiesBatch(
  userId: string,
  threadIds: readonly string[],
  opts?: { signal?: AbortSignal; concurrency?: number }
): Promise<void> {
  if (!threadIds.length) return;

  const concurrency = opts?.concurrency ?? 4;
  let idx = 0;

  const workers = Array.from({ length: Math.min(concurrency, threadIds.length) }, async () => {
    while (idx < threadIds.length && !opts?.signal?.aborted) {
      const i = idx++;
      await prefetchMailThreadOnce(userId, threadIds[i]!, { signal: opts?.signal });
    }
  });

  await Promise.all(workers);
}

export async function prefetchMailBodiesForWarmedCategories(
  userId: string,
  opts?: {
    signal?: AbortSignal;
    perCategory?: number;
    concurrency?: number;
    force?: boolean;
  }
): Promise<void> {
  if (MAIL_THREAD_PREFETCH_DISABLED) return;
  if (!userId || opts?.signal?.aborted) return;
  if (!beginMailBodyPrefetchWarm({ force: opts?.force })) return;

  try {
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
  } finally {
    finishMailBodyPrefetchWarm();
  }
}

/** After the active list loads — warm other category lists (bodies on tab land only). */
export function startMailListAndBodyPrefetchWarm(
  userId: string | undefined,
  opts?: {
    skipKeys?: Set<string>;
    listConcurrency?: number;
    bodyConcurrency?: number;
    force?: boolean;
  }
): void {
  const now = Date.now();
  if (!opts?.force && (bodyWarmInFlight || now - lastBodyWarmAt < 90_000)) {
    return;
  }
  bodyWarmInFlight = true;
  lastBodyWarmAt = now;

  void prefetchMailListViews({
    skipKeys: opts?.skipKeys,
    concurrency: opts?.listConcurrency ?? 3,
    force: opts?.force,
  }).finally(() => {
    bodyWarmInFlight = false;
  });
}

/** Login warm: list metadata only on mobile — bodies when user lands on a tab. */
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
}

export async function openMailThread(userId: string, threadId: string): Promise<ThreadPayload> {
  const cached = getCachedThread(userId, threadId);
  if (cached) {
    ingestThreadDerivedFromMessages(cached.messages);
    store(userId, threadId, 'open', cached);
    return cached;
  }

  const prefetchInflightPromise = prefetchInflight.get(`prefetch:${userId}:${threadId}`);
  if (prefetchInflightPromise) {
    const data = await prefetchInflightPromise;
    if (data) {
      store(userId, threadId, 'open', data);
      return data;
    }
  }

  const openInflightKey = `open:${userId}:${threadId}`;
  const existing = openInflight.get(openInflightKey);
  if (existing) return existing;

  const promise = gmailApi.getThread(threadId).then((data) => {
    const payload: ThreadPayload = {
      threadId: data.threadId ?? threadId,
      messages: data.messages ?? [],
      labelIds: data.labelIds,
    };
    ingestThreadDerivedFromMessages(payload.messages);
    store(userId, threadId, 'open', payload);
    return payload;
  }).finally(() => openInflight.delete(openInflightKey));

  openInflight.set(openInflightKey, promise);
  return promise;
}
