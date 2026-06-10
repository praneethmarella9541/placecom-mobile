# Prompt: Instant counts, label buckets, SWR + cooldown

Use this prompt when implementing optimistic badge updates, label creation, and thread bucket population without race conditions.

---

## Goal

- Badge counts update **instantly** on read/star/label/archive
- Threads appear in correct label buckets immediately (Starred, Important, user labels)
- Background refetches must **not** overwrite optimistic state for ~5 seconds
- No race conditions between in-flight fetches, mutations, and count API

## Web reference

- `app/(workspace)/inbox/page.tsx`
- `lib/inbox-list-prefetch.ts`
- `lib/inbox-unread-session.ts`

---

## Mutation cooldown

```ts
const MUTATION_COOLDOWN_MS = 5000
lastMutationAt = Date.now() // on every optimistic list/count change
```

**During cooldown:**

- Skip SWR background revalidation after painting cache
- Drop count responses: `if (lastMutationAt > fetchStartedAt) return`
- Merge counts: `Math.min(serverUnread, optimisticUnread)` for user labels and INBOX

**Bypass:** `loadThreads({ forceRefresh: true })` from history poll or manual refresh

---

## Instant count helpers

```ts
adjustInboxUnread(delta)
adjustUserLabelUnread(labelIds, delta)
adjustDraftCount(delta)
setUserLabelCount(labelId, { total, unread })
```

**Session inbox unread** (`lib/inbox-unread-session.ts`):

```ts
mergeInboxUnread(server, session):
  if session < server → keep session (API stale after reads)
  else → adopt server (new mail)
```

**Count refresh scheduling:**

```ts
scheduleCountRefresh():
  loadCounts()        // now
  loadCounts() @ 800ms
  loadCounts() @ 2500ms  // Gmail propagation lag
```

---

## Patch all caches on mutation

**`mutateThreads(transform)`** — visible + all session caches + `lastMutationAt`

**`patchAllThreadCaches(transform)`** — all caches only

Never apply active-view filter when patching *other* buckets.

---

## Label bucket sync

**`applyLabelListUpdate(transform, { labelId, added, threadIds })`:**

1. Transform visible list
2. `patchAllThreadCaches(transform)`
3. `syncLabelBucketCache(...)`:
   - **remove:** filter threads from label cache keys
   - **add:** merge into matching buckets (dedupe, sort by date)
   - **seed:** create cache entry if bucket never opened (Starred/Important/user label)
   - If viewing that bucket → `setThreads` from cache immediately

**`threadMatchesLabelView(row, labelId)`:**

- `STARRED` → `row.starred`
- `IMPORTANT` → `row.important || labelIds includes IMPORTANT`
- user label → `labelIds includes labelId`

---

## Optimistic label creation

1. `makePendingLabel(name)` → `pending:${uuid}`
2. Insert in sidebar immediately
3. `setUserLabelCount` if applying to open thread
4. `applyLabelOptimistic(threadId, pending.id)`
5. Background: `POST /api/gmail/labels`
6. `replaceLabelId(tempId, real)` — remap sidebar, threads, all caches, counts
7. On failure: `removePendingLabel(tempId)`

---

## Read thread (instant)

```ts
mutateThreads(rows => mark unread:false)
adjustInboxUnread(-1)
adjustUserLabelUnread(row.labelIds, -1)
mark-read API in parallel (not blocking)
```

Prefetch/hover must NOT mark read.

---

## Race condition checklist

| Guard | Purpose |
|-------|---------|
| `activeListCacheKeyRef` | Drop list fetch if tab switched |
| `listLoadGenRef` | Stale spinner guard |
| `lastMutationAt > fetchStartedAt` | Drop stale list/count merge |
| `MUTATION_COOLDOWN_MS` | Skip revalidate after optimistic edit |
| `mutateThreads` / `patchAllThreadCaches` | Cross-view consistency |
| AbortController on tab switch | Cancel in-flight fetch |
| History `forceRefresh` | Real changes override cooldown |

---

## APIs

| Action | Endpoint |
|--------|----------|
| List | `GET /api/gmail/threads?folder=&labelId=` |
| Counts | `GET /api/gmail/folder-counts?ids=...` |
| Create label | `POST /api/gmail/labels` |
| Apply label | `POST /api/gmail/threads/:id/labels` |
| Batch | `POST /api/gmail/threads/batch-modify` |
| History | `GET /api/gmail/history?since=` |

---

## Acceptance criteria

1. Star thread → Starred bucket + count update instantly
2. Create label on open thread → visible before Gmail API returns
3. Read thread → inbox badge down immediately, no bounce for 5s
4. Tab switch → cached list instant
5. External new mail still refreshes via history poll
