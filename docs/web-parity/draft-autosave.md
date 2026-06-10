# Prompt: Draft auto-save (body, headers, attachments)

Use this prompt when implementing Gmail-style compose draft persistence on mobile.

---

## Goal

- Auto-save after user pauses typing
- Reuse same `draftId` on subsequent saves (PUT semantics)
- Save body as HTML (rich text)
- Preserve attachments across saves without re-uploading everything
- Update draft count badge on first create

## Web reference

- `app/(workspace)/inbox/page.tsx` — `saveDraft`, close/discard
- `app/api/gmail/drafts/route.ts`
- `lib/gmail-draft-autosave.ts` — `DRAFT_AUTOSAVE_DELAY_MS = 2000`
- `lib/gmail-compose-types.ts`

---

## Compose state

Keep a **ref mirror** synced with UI:

```ts
{ to, cc, bcc, subject, body (HTML), draftId, files: PendingFile[] }
```

---

## When to save

| Trigger | Behavior |
|---------|----------|
| Auto-save | Debounce **2000ms** after field changes |
| Close compose | Save immediately if any content |
| Discard | `DELETE` draft, do not save |

**Skip save if:**

- All fields empty
- Fingerprint unchanged since last save
- Staged upload still in progress

---

## Concurrency guards

```ts
draftLastSavedRef   // JSON fingerprint snapshot
draftSavingRef      // in-flight lock
draftSavePendingRef // queue one retry after current save
```

**Fingerprint** (`pendingFileFingerprint`):

- `new:{name}:{size}`
- `staged:{uploadId}`
- `drive:{driveFileId}`
- `saved:{attachmentId}`

---

## Save API

`POST /api/gmail/drafts`

```json
{
  "to", "cc", "bcc", "subject",
  "textBody": "",
  "htmlBody": "<p>...</p>",
  "draftId": "optional",
  "preserveAttachments": true,
  "mergeExistingAttachments": true,
  "attachments": [{ "filename", "mimeType", "base64Data" }],
  "stagedUploadIds": ["..."]
}
```

Response: `{ draftId, messageId, threadId }`

---

## Attachment save strategies

| Scenario | Flags |
|----------|-------|
| Text edit only, files unchanged | `preserveAttachments: true` |
| Add files to existing draft | `mergeExistingAttachments: true` + encode **new** only |
| First save with small files | `attachments` array |
| 3–25 MB staged files | `stagedUploadIds` only |
| >25 MB Drive files | links in HTML via `appendDriveLinksToHtml` — not MIME attachments |

After save with attachment changes: `GET /api/gmail/drafts?draftId=` → rehydrate `saved` refs (Gmail rotates ids).

Keep `drive` files in local state.

---

## Open draft

`GET /api/gmail/drafts?draftId=`

- Prefer `htmlBody` for editor; wrap `textBody` in `<p>` if needed
- Map `attachments` → `PendingFile` kind `saved`
- Seed `draftLastSavedRef` fingerprint

Prefetch on row press-in; reuse on open.

---

## Draft count

- First create: `adjustDraftCount(+1)` + `scheduleCountRefresh()`
- Discard: `DELETE` + `adjustDraftCount(-1)`

---

## Save status UI

`idle | saving | saved | error` — show "saved" 2.5s, error 5s.

---

## Acceptance criteria

1. Pause typing 2s → draft in Gmail
2. Re-open → same draftId, body + attachments intact
3. Body-only edit → no re-upload (`preserveAttachments`)
4. Add attachment → existing ones kept (`mergeExistingAttachments`)
5. Close compose → draft saved (Gmail behavior)
