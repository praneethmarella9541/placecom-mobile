# Prompt: Compose attachments (≤3 MB, 3–25 MB, >25 MB)

Use this prompt when implementing file pick + upload tiers in compose.

---

## Constants

```ts
GMAIL_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024   // 25 MB Gmail limit
DRAFT_JSON_INLINE_MAX_BYTES = 3 * 1024 * 1024   // inline in draft JSON
DRIVE_UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024      // chunk size
```

## Web reference

- `lib/gmail-compose-types.ts`
- `lib/upload-staged-draft-attachment.ts`
- `lib/upload-large-file-to-drive.ts`
- `app/api/gmail/drafts/attachment-chunk/route.ts`
- `lib/gmail-drive-links.ts`

---

## PendingFile kinds

```ts
| kind    | When |
|---------|------|
| new     | ≤ 3 MB, base64 in memory |
| staged  | 3–25 MB, chunked server staging |
| saved   | Already on Gmail draft |
| drive   | > 25 MB, Drive link in body |
```

---

## Tier 1: ≤ 3 MB — inline base64

1. Read file as base64 client-side
2. `PendingFile { kind: "new", file, base64 }`
3. On draft save → `attachments: [{ filename, mimeType, base64Data }]`

Server rejects total inline base64 > 4 MB in one JSON POST (413).

---

## Tier 2: 3 MB < size ≤ 25 MB — chunked staging

`POST /api/gmail/drafts/attachment-chunk` (multipart):

```
uploadId?   // omit first chunk
offset
totalSize
filename
mimeType
chunk       // binary, max 4 MB per chunk
```

Returns `{ uploadId, done, received }`.

Store `PendingFile { kind: "staged", uploadId, name, mimeType, size }`.

On draft save: `stagedUploadIds: [uploadId]` — server embeds as real Gmail MIME attachment.

**Block auto-save while upload in progress.**

Server rejects `totalSize > 25MB`.

---

## Tier 3: > 25 MB — Google Drive link

1. `POST /api/drive/upload-session`
2. `POST /api/drive/upload-chunk` (4 MB chunks)
3. `PATCH /api/drive/upload-session` finalize

Store `PendingFile { kind: "drive", driveFileId, webViewLink, ... }`.

On save/send: append `appendDriveLinksToHtml(htmlBody, driveFiles)` — not MIME attachments.

---

## Summary table

| Size | Kind | Upload | In MIME? | In body? |
|------|------|--------|----------|----------|
| ≤ 3 MB | `new` | base64 memory | Yes | Yes |
| 3–25 MB | `staged` | attachment-chunk | Yes | Yes |
| > 25 MB | `drive` | Drive chunks | No | HTML link |

---

## Re-open draft

`GET /api/gmail/drafts?draftId=` → map attachments to `saved`.

Drive links already in `htmlBody`.

After save with attachments: re-fetch draft to sync rotated `messageId`/`attachmentId`.

---

## Send flow

Same tiers at send time; `saved` attachments fetched from Gmail API by id.

---

## Mobile notes

1. Per-file progress for staged + drive uploads
2. Block send/save until uploads complete
3. Staged temp TTL ~20 min server-side — may need re-pick if app killed mid-upload
4. Never put >4 MB base64 in one JSON request

---

## APIs

| Endpoint | Purpose |
|----------|---------|
| `POST /api/gmail/drafts` | Create/update draft |
| `GET /api/gmail/drafts?draftId=` | Load draft |
| `DELETE /api/gmail/drafts?draftId=` | Discard |
| `POST /api/gmail/drafts/attachment-chunk` | Stage 3–25 MB |
| `POST /api/drive/upload-session` | Start Drive upload |
| `POST /api/drive/upload-chunk` | Drive chunk |
| `PATCH /api/drive/upload-session` | Finalize Drive file |

---

## Acceptance criteria

1. 1 MB PDF → real Gmail attachment in draft
2. 10 MB → chunked staging → real attachment
3. 30 MB → Drive link in body, not attachment
4. 26 MB rejected at pick with clear error
5. Text-only edit → `preserveAttachments`, no re-upload
