# Prompt: SWR + prefetch + warm loading (mail & Drive)

Use this prompt when implementing session-scoped caching and background warm loads so tab/folder switches feel instant.

---

You are implementing the same **session-scoped SWR caching, background warm prefetch, mutation cooldown, and intent prefetch** patterns used in Placecom web. Match the **behavior and order**, adapted for React Native / mobile.

## Goal

Make tab/folder switches feel **instant** (paint from memory first), while keeping data **eventually consistent** with the server. Avoid:

- Empty spinners when cached data exists
- Optimistic UI being overwritten by stale API responses
- Duplicate in-flight requests for the same key
- Prefetch side effects (e.g. marking mail read on prefetch)

---

## 1. Session-scoped cache layer (not persisted to disk)

Create module-level in-memory caches that survive screen navigation within an app session.

### Mail list cache

- Type: `Map<cacheKey, { threads, nextPageToken? }>`
- Key: `buildMailListCacheKey(apiFolder, labelId, search)` → `"inbox|CATEGORY_PERSONAL|"`
- Prefetch specs to warm (priority order):
  1. Inbox Primary (`inbox` + `CATEGORY_PERSONAL`)
  2. Other inbox tabs: Promotions, Social, Updates, Forums
  3. Starred, Important
  4. Sent, Drafts, Spam, Trash, All Mail

### Drive list cache

- Type: `Map<cacheKey, { files, nextPageToken? }>`
- Key: `parent + view + search + mimeFilter + pathDepth + sharedDriveId`
- Prefetch root views: `my-drive`, `shared-with-me`, `starred`, `recent`, plus each shared drive root
- **Sort is client-side only** — do NOT include sort in cache key

### Secondary feature caches

- WhatsApp, Calendar, Forms — single snapshot each (see `lib/workspace-feature-prefetch.ts`)

Also track:

- `PREFETCH_IN_FLIGHT: Set<cacheKey>`
- `cacheWriteGeneration` — increment on manual cache clear
- `listMutationEpoch` (Drive) — increment on optimistic mutations

---

## 2. Login prefetch chain (exact order)

After auth / mailbox linked, run once per session (200ms debounce):

```
Phase 1 (parallel):
  - prefetchMailListViews(concurrency: 3)
  - prefetchDriveListViews(concurrency: 2)

Phase 2 (sequential):
  - WhatsApp → Calendar → Forms (skip restricted features)
```

Best-effort only; use `AbortController` on logout.

---

## 3. SWR list loader pattern

For **first-page** loads:

1. Build cacheKey for current view
2. Set `activeListCacheKey` / `activeLoadId`
3. If cache hit AND NOT forceRefresh:
   - Paint cached rows immediately
   - If within `MUTATION_COOLDOWN_MS` (5000ms) → **STOP** (no background refetch)
   - Else background fetch
4. If cache miss → show loading
5. Before applying result: abort if view switched, mutation epoch changed, or `lastMutationAt > fetchStartedAt` (unless forceRefresh)
6. Update cache + preserve scroll on silent refresh

**Append/load-more:** always network; merge by id.

---

## 4. Mutation cooldown (5 seconds)

`lastMutationAt` on every optimistic mutation.

During cooldown (< 5000ms):

- Skip SWR background revalidation after painting cache
- Prefer derived counts from loaded rows when server counts are stale
- **Bypass:** history poll / `forceRefresh: true`

---

## 5. Optimistic updates patch ALL caches

`mutateThreads(transform)` — visible list + every cache entry + bump `lastMutationAt`

`patchAllThreadCaches(transform)` — all caches only (label bucket sync)

---

## 6. Background warm after first paint

400ms after active list loads:

```
startMailListPrefetchWarm({ skipKeys: { currentViewKey }, concurrency: 3 })
startDriveListPrefetchWarm({ skipKeys: { currentViewKey }, concurrency: 2 })
```

---

## 7. Intent prefetch (mobile: press-in / dwell, not scroll)

**Mail threads:** prefetch with `?prefetch=1` — server must NOT mark read. On open, reuse prefetch promise.

**Drive folders:** prefetch children for visible folders (max 8) + on folder press-in.

**TTL:** evict thread cache ~120s.

---

## 8. Live refresh (mail)

History API every 30s + app foreground → `loadThreads({ forceRefresh: true })` bypasses cooldown.

---

## Web reference files

- `lib/inbox-list-prefetch.ts`
- `lib/drive-list-prefetch.ts`
- `lib/workspace-feature-prefetch.ts`
- `components/WorkspaceChrome.tsx`
- `app/(workspace)/inbox/page.tsx` (`loadThreads`, cooldown)
- `app/(workspace)/drive/page.tsx`
- `app/api/gmail/threads/[id]/route.ts` (prefetch must not mark read)
