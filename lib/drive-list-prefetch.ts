import { driveApi, type DriveListView } from './api';
import {
  listDriveFilesDirectly,
  driveStarredQuery,
  buildDriveSharedQuery,
  driveRecentQuery,
  driveFolderQuery,
} from './drive-list-direct';
import type { DriveFile } from './types';
import { decodeDisplayFilename } from './filename-utils';
import { bumpCacheWriteGeneration, getCacheWriteGeneration } from './session-cache-core';
import { PREFETCH_IN_FLIGHT } from './inbox-list-prefetch';

export type DriveListPage = { files: DriveFile[]; nextPageToken?: string };

export type DriveTabKey = 'my-drive' | 'starred' | 'recent' | 'shared';

const DRIVE_LIST_CACHE = new Map<string, DriveListPage>();
const INFLIGHT_FETCHES = new Map<string, Promise<DriveListPage>>();

let listMutationEpoch = 0;
let warmAbort: AbortController | null = null;
let loginWarmAbort: AbortController | null = null;

const PAGE_SIZE = 30;
const INFLIGHT_TTL_MS = 60_000;

function normalizeFiles(raw: unknown[]): DriveFile[] {
  return (raw ?? []).map((f: any) => ({
    id: f.id,
    name: decodeDisplayFilename(String(f.name ?? 'Untitled')),
    mimeType: f.mimeType,
    size: f.size,
    modifiedTime: f.modifiedTime,
    webViewLink: f.webViewLink ?? null,
    starred: !!(f.starred ?? f.isStarred),
    shared: !!(f.shared ?? f.sharedWithMe),
    thumbnailLink: f.thumbnailLink ?? null,
  }));
}

function dedupeFiles(files: DriveFile[]): DriveFile[] {
  const seen = new Set<string>();
  return files.filter((f) => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });
}

export type DriveListContext = {
  view: DriveListView;
  tab: DriveTabKey;
  parentId?: string;
  search?: string;
  mimeFilter?: string;
  pathDepth?: number;
  sharedDriveId?: string;
};

/** Sort is client-side only — not part of the cache key. */
export function buildDriveListCacheKey(ctx: DriveListContext): string {
  const parts = [
    ctx.parentId ?? 'root',
    ctx.view,
    ctx.search ?? '',
    ctx.mimeFilter ?? '',
    String(ctx.pathDepth ?? 0),
    ctx.sharedDriveId ?? '',
  ];
  return parts.join('|');
}

export function getDriveListCache(key: string): DriveListPage | undefined {
  return DRIVE_LIST_CACHE.get(key);
}

export function setDriveListCache(key: string, page: DriveListPage): void {
  DRIVE_LIST_CACHE.set(key, { ...page, files: dedupeFiles(page.files) });
}

export function syncDriveListCache(
  key: string,
  updater: (prev: DriveListPage | undefined) => DriveListPage
): void {
  setDriveListCache(key, updater(getDriveListCache(key)));
}

export function bumpDriveListMutationEpoch(): void {
  listMutationEpoch += 1;
}

export function getDriveListMutationEpoch(): number {
  return listMutationEpoch;
}

export function clearDriveListSessionCache(): void {
  DRIVE_LIST_CACHE.clear();
  INFLIGHT_FETCHES.clear();
  cancelDrivePrefetch();
  bumpCacheWriteGeneration();
  listMutationEpoch = 0;
}

export function cancelDrivePrefetch(): void {
  warmAbort?.abort();
  warmAbort = null;
  loginWarmAbort?.abort();
  loginWarmAbort = null;
}

/** Patch every warmed drive list cache. */
export function patchAllDriveListCaches(updater: (files: DriveFile[]) => DriveFile[]): void {
  bumpDriveListMutationEpoch();
  for (const [key, page] of DRIVE_LIST_CACHE) {
    DRIVE_LIST_CACHE.set(key, { ...page, files: dedupeFiles(updater(page.files)) });
  }
}

export const DRIVE_PREFETCH_CONTEXTS: DriveListContext[] = [
  { view: 'folder', tab: 'my-drive', parentId: undefined, pathDepth: 0 },
  { view: 'shared', tab: 'shared', pathDepth: 0 },
  { view: 'starred', tab: 'starred', pathDepth: 0 },
  { view: 'recent', tab: 'recent', pathDepth: 0 },
];

async function fetchDrivePageInternal(
  ctx: DriveListContext,
  opts: { pageToken?: string; pageSize?: number; signal?: AbortSignal }
): Promise<DriveListPage> {
  const view = ctx.view;
  const tab = ctx.tab;
  const folderId = ctx.parentId;
  const search = ctx.search;
  const pageSize = opts.pageSize ?? PAGE_SIZE;

  const browsingFolderInView =
    (tab === 'starred' || tab === 'shared' || tab === 'recent') && !!folderId;

  if (view === 'folder' || browsingFolderInView) {
    const parent = folderId ?? 'root';
    try {
      const data = await driveApi.listFiles(parent === 'root' ? undefined : parent, {
        pageToken: opts.pageToken,
        search,
        pageSize,
        view: 'folder',
        signal: opts.signal,
      });
      return { files: normalizeFiles(data.files ?? []), nextPageToken: data.nextPageToken };
    } catch {
      if (parent !== 'root') {
        return listDriveFilesDirectly({
          q: driveFolderQuery(parent),
          pageToken: opts.pageToken,
          pageSize,
          orderBy: 'folder,name',
        });
      }
      throw new Error('Failed to load folder');
    }
  }

  if (view === 'starred') {
    try {
      const data = await driveApi.listFiles(undefined, {
        pageToken: opts.pageToken,
        search,
        pageSize,
        view: 'starred',
        signal: opts.signal,
      });
      const files = normalizeFiles(data.files ?? []);
      if (files.length > 0 || opts.pageToken) {
        return { files, nextPageToken: data.nextPageToken };
      }
    } catch {
      /* fall through */
    }
    const q = search
      ? `starred = true and name contains '${search.replace(/'/g, "\\'")}' and trashed = false`
      : driveStarredQuery();
    return listDriveFilesDirectly({
      q,
      pageToken: opts.pageToken,
      pageSize,
      orderBy: 'folder,name,modifiedTime desc',
    });
  }

  if (view === 'shared') {
    try {
      return await listDriveFilesDirectly({
        q: buildDriveSharedQuery(search),
        pageToken: opts.pageToken,
        pageSize,
        orderBy: 'sharedWithMeTime desc',
        corpora: 'user',
      });
    } catch (directErr) {
      const data = await driveApi.listFiles(undefined, {
        pageToken: opts.pageToken,
        search,
        pageSize,
        view: 'shared',
        signal: opts.signal,
      });
      return {
        files: normalizeFiles(data.files ?? []),
        nextPageToken: data.nextPageToken,
      };
    }
  }

  if (view === 'recent') {
    try {
      const data = await driveApi.listFiles(undefined, {
        pageToken: opts.pageToken,
        search,
        pageSize,
        view: 'recent',
        signal: opts.signal,
      });
      const files = normalizeFiles(data.files ?? []);
      if (files.length > 0 || opts.pageToken) return { files, nextPageToken: data.nextPageToken };
    } catch {
      /* direct */
    }
    return listDriveFilesDirectly({
      q: driveRecentQuery(),
      pageToken: opts.pageToken,
      pageSize,
      orderBy: 'viewedByMeTime desc',
    });
  }

  const data = await driveApi.listFiles(undefined, {
    pageToken: opts.pageToken,
    pageSize,
    view: 'folder',
    signal: opts.signal,
  });
  return { files: normalizeFiles(data.files ?? []), nextPageToken: data.nextPageToken };
}

export async function fetchDriveListPage(
  ctx: DriveListContext,
  opts?: { pageToken?: string; pageSize?: number; signal?: AbortSignal; skipCache?: boolean }
): Promise<DriveListPage> {
  const cacheKey = buildDriveListCacheKey(ctx);
  if (!opts?.pageToken && !opts?.skipCache) {
    const hit = getDriveListCache(cacheKey);
    if (hit) return hit;
  }

  const inflightKey = `${cacheKey}:${opts?.pageToken ?? 'first'}`;
  const existing = INFLIGHT_FETCHES.get(inflightKey);
  if (existing) return existing;

  const epochAtStart = listMutationEpoch;
  const writeGenAtStart = getCacheWriteGeneration();

  const promise = fetchDrivePageInternal(ctx, opts ?? {})
    .then((page) => {
      if (
        !opts?.pageToken &&
        epochAtStart === listMutationEpoch &&
        writeGenAtStart === getCacheWriteGeneration()
      ) {
        setDriveListCache(cacheKey, page);
      }
      return page;
    })
    .finally(() => {
      setTimeout(() => INFLIGHT_FETCHES.delete(inflightKey), INFLIGHT_TTL_MS);
    });

  INFLIGHT_FETCHES.set(inflightKey, promise);
  return promise;
}

async function warmOneDriveKey(
  ctx: DriveListContext,
  signal: AbortSignal,
  writeGen: number,
  epoch: number
): Promise<void> {
  const key = buildDriveListCacheKey(ctx);
  if (signal.aborted) return;
  if (DRIVE_LIST_CACHE.has(key) || PREFETCH_IN_FLIGHT.has(key)) return;
  PREFETCH_IN_FLIGHT.add(key);
  try {
    const page = await fetchDrivePageInternal(ctx, { signal });
    if (
      signal.aborted ||
      writeGen !== getCacheWriteGeneration() ||
      epoch !== listMutationEpoch
    ) {
      return;
    }
    setDriveListCache(key, page);
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

export async function prefetchDriveListViews(opts?: {
  skipKeys?: Set<string>;
  concurrency?: number;
  signal?: AbortSignal;
}): Promise<void> {
  const signal = opts?.signal;
  if (signal?.aborted) return;
  const skip = opts?.skipKeys ?? new Set<string>();
  const concurrency = opts?.concurrency ?? 2;
  const writeGen = getCacheWriteGeneration();
  const epoch = listMutationEpoch;

  const jobs = DRIVE_PREFETCH_CONTEXTS.filter((ctx) => {
    const key = buildDriveListCacheKey(ctx);
    return !skip.has(key) && !DRIVE_LIST_CACHE.has(key) && !PREFETCH_IN_FLIGHT.has(key);
  });

  await runWithConcurrency(
    jobs,
    concurrency,
    (ctx) => warmOneDriveKey(ctx, signal ?? new AbortController().signal, writeGen, epoch),
    signal ?? new AbortController().signal
  );
}

export function startDriveListPrefetchWarm(opts?: {
  skipKeys?: Set<string>;
  concurrency?: number;
}): void {
  warmAbort?.abort();
  const controller = new AbortController();
  warmAbort = controller;
  void prefetchDriveListViews({
    skipKeys: opts?.skipKeys,
    concurrency: opts?.concurrency ?? 2,
    signal: controller.signal,
  });
}

export function startLoginDrivePrefetch(opts?: {
  skipKeys?: Set<string>;
  concurrency?: number;
}): AbortController {
  loginWarmAbort?.abort();
  const controller = new AbortController();
  loginWarmAbort = controller;
  void prefetchDriveListViews({
    skipKeys: opts?.skipKeys,
    concurrency: opts?.concurrency ?? 2,
    signal: controller.signal,
  });
  return controller;
}

/** Prefetch folder children for intent navigation. */
export function prefetchDriveFolderChildren(
  folderId: string,
  tab: DriveTabKey,
  pathDepth: number
): void {
  const ctx: DriveListContext = {
    view: 'folder',
    tab,
    parentId: folderId,
    pathDepth: pathDepth + 1,
  };
  const key = buildDriveListCacheKey(ctx);
  if (DRIVE_LIST_CACHE.has(key) || PREFETCH_IN_FLIGHT.has(key)) return;
  PREFETCH_IN_FLIGHT.add(key);
  const writeGen = getCacheWriteGeneration();
  const epoch = listMutationEpoch;
  void fetchDrivePageInternal(ctx, {})
    .then((page) => {
      if (writeGen === getCacheWriteGeneration() && epoch === listMutationEpoch) {
        setDriveListCache(key, page);
      }
    })
    .catch(() => {})
    .finally(() => PREFETCH_IN_FLIGHT.delete(key));
}
