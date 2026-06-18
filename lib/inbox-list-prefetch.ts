import { gmailApi, type GmailFolder, type GmailThreadListItem } from './api';
import {
  bindMailListPrefetchUser,
  clearMailListSessionStorage,
  loadPersistedMailListViews,
  persistMailListSessionCache,
} from './mail-list-session-cache';
import { bumpCacheWriteGeneration, getCacheWriteGeneration, MUTATION_COOLDOWN_MS } from './session-cache-core';
import { withApiDebugTagAsync } from './api-debug';

export { bindMailListPrefetchUser };

export type MailListPage = { threads: GmailThreadListItem[]; nextPageToken?: string };

const MAIL_LIST_CACHE = new Map<string, MailListPage>();
export const PREFETCH_IN_FLIGHT = new Set<string>();

let lastMutationAt = 0;
let warmAbort: AbortController | null = null;
let loginWarmAbort: AbortController | null = null;

/** First-page size for list + login prefetch (all mail categories). */
export const MAIL_LIST_PAGE_SIZE = 25;
const PAGE_SIZE = MAIL_LIST_PAGE_SIZE;

/** Delimiter-separated key: folder|labelId|search */
export function buildMailListCacheKey(
  folder: GmailFolder,
  labelId: string | null | undefined,
  search: string
): string {
  return `${folder}|${labelId ?? ''}|${search}`;
}

export function getMailListCache(key: string): MailListPage | undefined {
  return MAIL_LIST_CACHE.get(key);
}

export function setMailListCache(key: string, page: MailListPage): void {
  MAIL_LIST_CACHE.set(key, page);
  persistMailListSessionCache(key, page);
}

let listHydrateUserId: string | null = null;
let listHydratePromise: Promise<void> | null = null;

/** Hydrate list views from disk (call once per user session). */
export function hydrateMailListPrefetchCache(userId: string): Promise<void> {
  if (!userId) return Promise.resolve();
  if (listHydrateUserId === userId && listHydratePromise) return listHydratePromise;
  listHydrateUserId = userId;
  listHydratePromise = loadPersistedMailListViews(userId).then((entries) => {
    for (const [key, snapshot] of entries) {
      if (!MAIL_LIST_CACHE.has(key)) {
        MAIL_LIST_CACHE.set(key, snapshot);
      }
    }
  });
  return listHydratePromise;
}

export function touchMailListMutation(): void {
  lastMutationAt = Date.now();
}

export function getMailListLastMutationAt(): number {
  return lastMutationAt;
}

export function isWithinMailMutationCooldown(): boolean {
  return Date.now() - lastMutationAt < MUTATION_COOLDOWN_MS;
}

export function clearMailListSessionCache(): void {
  MAIL_LIST_CACHE.clear();
  PREFETCH_IN_FLIGHT.clear();
  cancelMailPrefetch();
  bumpCacheWriteGeneration();
  lastMutationAt = 0;
  listHydrateUserId = null;
  listHydratePromise = null;
  void clearMailListSessionStorage();
}

/** Bust list cache entries for one mailbox folder (sent/drafts/etc.). */
export function invalidateMailListFolder(folder: GmailFolder): void {
  for (const key of MAIL_LIST_CACHE.keys()) {
    if (key.startsWith(`${folder}|`)) MAIL_LIST_CACHE.delete(key);
  }
  bumpCacheWriteGeneration();
}

export function cancelMailPrefetch(): void {
  warmAbort?.abort();
  warmAbort = null;
  loginWarmAbort?.abort();
  loginWarmAbort = null;
}

/** Patch every warmed mail list cache after an optimistic mutation. */
export function mutateAllMailListCaches(
  transform: (threads: GmailThreadListItem[]) => GmailThreadListItem[]
): void {
  touchMailListMutation();
  for (const [key, page] of MAIL_LIST_CACHE) {
    MAIL_LIST_CACHE.set(key, { ...page, threads: transform(page.threads) });
  }
}

/**
 * Invalidate cache entries whose key contains a specific labelId.
 * Called on rollback so partially-mutated bucket caches are cleared.
 */
export function invalidateMailListLabel(labelId: string): void {
  for (const key of MAIL_LIST_CACHE.keys()) {
    // Key format: "folder|labelId|search"
    const parts = key.split('|');
    if (parts[1] === labelId) MAIL_LIST_CACHE.delete(key);
  }
}

/**
 * Sync label bucket caches after a star / label mutation so that switching
 * to Starred / Important / a user-label view feels instant.
 *
 * - toAdd: label IDs being applied   → insert threads into those buckets
 * - toRemove: label IDs being removed → filter threads out of those buckets
 *
 * Seeding (creating a cache entry when the bucket was never opened) means the
 * first visit to that bucket after a label action paints from memory with no
 * spinner.
 */
export function syncLabelBucketCaches(
  affectedThreads: GmailThreadListItem[],
  toAdd: string[],
  toRemove: string[]
): void {
  if (affectedThreads.length === 0) return;

  for (const labelId of toAdd) {
    const key = buildMailListCacheKey('inbox', labelId, '');
    const existing = getMailListCache(key);
    const existingIds = new Set(existing?.threads.map((t) => t.id) ?? []);
    const toInsert = affectedThreads.filter((t) => !existingIds.has(t.id));

    if (existing) {
      if (toInsert.length > 0) {
        const merged = [...toInsert, ...existing.threads].sort(
          (a, b) => (b.date ?? 0) - (a.date ?? 0)
        );
        setMailListCache(key, { ...existing, threads: merged });
      }
    } else {
      // Seed the bucket so navigating to it is instant.
      setMailListCache(key, {
        threads: [...affectedThreads].sort((a, b) => (b.date ?? 0) - (a.date ?? 0)),
      });
    }
  }

  for (const labelId of toRemove) {
    const key = buildMailListCacheKey('inbox', labelId, '');
    const existing = getMailListCache(key);
    if (existing) {
      const removeIds = new Set(affectedThreads.map((t) => t.id));
      setMailListCache(key, {
        ...existing,
        threads: existing.threads.filter((t) => !removeIds.has(t.id)),
      });
    }
  }
}

export type MailPrefetchSpec = {
  folder: GmailFolder;
  labelId?: string;
  search?: string;
};

/** Warm priority order — mirrors Placecom web. */
export const MAIL_LIST_PREFETCH_SPECS: MailPrefetchSpec[] = [
  { folder: 'inbox', labelId: 'CATEGORY_PERSONAL' },
  { folder: 'inbox', labelId: 'CATEGORY_PROMOTIONS' },
  { folder: 'inbox', labelId: 'CATEGORY_SOCIAL' },
  { folder: 'inbox', labelId: 'CATEGORY_UPDATES' },
  { folder: 'inbox', labelId: 'CATEGORY_FORUMS' },
  { folder: 'inbox', labelId: 'STARRED' },
  { folder: 'inbox', labelId: 'IMPORTANT' },
  { folder: 'sent' },
  { folder: 'drafts' },
  { folder: 'spam' },
  { folder: 'trash' },
  { folder: 'allmail' },
];

function dedupeThreads(threads: GmailThreadListItem[]): GmailThreadListItem[] {
  const seen = new Set<string>();
  return threads.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

export async function fetchMailListPage(
  spec: MailPrefetchSpec,
  opts?: { pageToken?: string; signal?: AbortSignal }
): Promise<MailListPage> {
  const data = await gmailApi.listThreads(spec.folder, {
    maxResults: PAGE_SIZE,
    pageToken: opts?.pageToken,
    search: spec.search || undefined,
    labelId: spec.labelId,
    signal: opts?.signal,
  });
  return {
    threads: dedupeThreads(data.threads ?? []),
    nextPageToken: data.nextPageToken,
  };
}

async function warmOneMailKey(
  key: string,
  spec: MailPrefetchSpec,
  signal: AbortSignal,
  writeGen: number
): Promise<void> {
  if (signal.aborted) return;
  if (MAIL_LIST_CACHE.has(key) || PREFETCH_IN_FLIGHT.has(key)) return;
  PREFETCH_IN_FLIGHT.add(key);
  try {
    const page = await withApiDebugTagAsync('mail-list-prefetch', () =>
      fetchMailListPage(spec, { signal })
    );
    if (signal.aborted || writeGen !== getCacheWriteGeneration()) return;
    setMailListCache(key, page);
  } catch {
    /* best-effort */
  } finally {
    PREFETCH_IN_FLIGHT.delete(key);
  }
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
  signal: AbortSignal
): Promise<void> {
  let idx = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length && !signal.aborted) {
      const i = idx++;
      await worker(items[i]!);
    }
  });
  await Promise.all(runners);
}

export async function prefetchMailListViewIfMissing(
  spec: MailPrefetchSpec,
  opts?: { signal?: AbortSignal }
): Promise<MailListPage | null> {
  const key = buildMailListCacheKey(spec.folder, spec.labelId ?? '', spec.search ?? '');
  const cached = MAIL_LIST_CACHE.get(key);
  if (cached?.threads.length) return cached;

  const controller = opts?.signal ?? new AbortController().signal;
  if (controller.aborted) return null;
  if (PREFETCH_IN_FLIGHT.has(key)) return MAIL_LIST_CACHE.get(key) ?? null;

  const writeGen = getCacheWriteGeneration();
  await warmOneMailKey(key, spec, controller, writeGen);
  return MAIL_LIST_CACHE.get(key) ?? null;
}

export async function prefetchMailListViews(opts?: {
  skipKeys?: Set<string>;
  concurrency?: number;
  signal?: AbortSignal;
  force?: boolean;
}): Promise<void> {
  const signal = opts?.signal;
  if (signal?.aborted) return;
  const skip = opts?.skipKeys ?? new Set<string>();
  const concurrency = opts?.concurrency ?? 3;
  const writeGen = getCacheWriteGeneration();

  const force = opts?.force ?? false;
  const jobs: Array<{ key: string; spec: MailPrefetchSpec }> = [];
  for (const spec of MAIL_LIST_PREFETCH_SPECS) {
    const key = buildMailListCacheKey(spec.folder, spec.labelId ?? '', spec.search ?? '');
    if (skip.has(key) || PREFETCH_IN_FLIGHT.has(key)) continue;
    if (!force && MAIL_LIST_CACHE.has(key)) continue;
    jobs.push({ key, spec });
  }

  await runWithConcurrency(
    jobs,
    concurrency,
    async ({ key, spec }) => warmOneMailKey(key, spec, signal ?? new AbortController().signal, writeGen),
    signal ?? new AbortController().signal
  );
}

export function startMailListPrefetchWarm(opts?: {
  skipKeys?: Set<string>;
  concurrency?: number;
}): void {
  warmAbort?.abort();
  const controller = new AbortController();
  warmAbort = controller;
  void prefetchMailListViews({
    skipKeys: opts?.skipKeys,
    concurrency: opts?.concurrency ?? 3,
    signal: controller.signal,
  });
}

export function startLoginMailPrefetch(opts?: {
  skipKeys?: Set<string>;
  concurrency?: number;
}): AbortController {
  loginWarmAbort?.abort();
  const controller = new AbortController();
  loginWarmAbort = controller;
  void prefetchMailListViews({
    skipKeys: opts?.skipKeys,
    concurrency: opts?.concurrency ?? 3,
    signal: controller.signal,
  });
  return controller;
}
