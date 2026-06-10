# Placecom web → mobile parity prompts

Copy-paste prompts for implementing Placecom web mail/Drive behavior in the mobile app. Each file is self-contained for an AI coding session or engineer handoff.

| File | Topic |
|------|--------|
| [swr-prefetch-warm-loading.md](./swr-prefetch-warm-loading.md) | Session SWR cache, login prefetch chain, cooldown, hover/intent prefetch |
| [counts-labels-buckets-cooldown.md](./counts-labels-buckets-cooldown.md) | Instant badge counts, label creation, bucket population, race-condition guards |
| [draft-autosave.md](./draft-autosave.md) | Draft auto-save, body/HTML, attachment preserve/merge strategies |
| [compose-attachments.md](./compose-attachments.md) | Attachment tiers: ≤3 MB inline, 3–25 MB staged, >25 MB Drive links |

## Web reference repo

Implementation lives in the sibling `placecom` Next.js app:

- `lib/inbox-list-prefetch.ts`, `lib/drive-list-prefetch.ts`, `lib/workspace-feature-prefetch.ts`
- `app/(workspace)/inbox/page.tsx`
- `app/api/gmail/drafts/route.ts`, `app/api/gmail/drafts/attachment-chunk/route.ts`
- `lib/gmail-compose-types.ts`, `lib/upload-staged-draft-attachment.ts`, `lib/upload-large-file-to-drive.ts`

## Suggested implementation order

1. SWR + prefetch warm loading (lists feel instant)
2. Counts, labels, buckets + cooldown (optimistic UI without flicker)
3. Draft auto-save (compose persistence)
4. Compose attachments (size tiers)
