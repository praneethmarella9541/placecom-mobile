/**
 * Tracks IDs of items the user has acted on locally where the upstream API
 * has eventual consistency. Two sets:
 *   - pending-delete: hide from list for ~30s after a delete
 *   - locally-read:   keep unread=false for the session after opening a thread
 *
 * Locally-read entries never expire (within a session) — Gmail eventually
 * catches up, but if a user reopens an already-read thread we never want
 * to re-bold it.
 */

const DELETE_TTL_MS = 30_000;

const pendingDeletes = new Map<string, number>();
const locallyRead = new Set<string>();

function gc() {
  const now = Date.now();
  for (const [id, expiry] of pendingDeletes) {
    if (expiry <= now) pendingDeletes.delete(id);
  }
}

export function markPendingDelete(id: string): void {
  if (!id) return;
  pendingDeletes.set(id, Date.now() + DELETE_TTL_MS);
}

export function isPendingDelete(id: string): boolean {
  gc();
  return pendingDeletes.has(id);
}

export function clearPendingDelete(id: string): void {
  pendingDeletes.delete(id);
}

export function markLocallyRead(id: string): void {
  if (!id) return;
  locallyRead.add(id);
}

export function isLocallyRead(id: string): boolean {
  return locallyRead.has(id);
}
