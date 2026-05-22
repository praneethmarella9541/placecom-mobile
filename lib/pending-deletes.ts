/**
 * Tracks IDs of items the user has deleted but that may still appear
 * in upstream API responses for a short window (e.g. Gmail's drafts list
 * has eventual consistency — a deleted draft can linger 5–15s).
 *
 * Each entry self-expires after `ttlMs` so a deleted-then-recreated id
 * never gets permanently hidden.
 */

const TTL_MS = 30_000;

const pending = new Map<string, number>(); // id → expiry timestamp

function gc() {
  const now = Date.now();
  for (const [id, expiry] of pending) {
    if (expiry <= now) pending.delete(id);
  }
}

export function markPendingDelete(id: string): void {
  if (!id) return;
  pending.set(id, Date.now() + TTL_MS);
}

export function isPendingDelete(id: string): boolean {
  gc();
  return pending.has(id);
}

export function clearPendingDelete(id: string): void {
  pending.delete(id);
}
