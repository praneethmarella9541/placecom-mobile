import { patchAllDriveListCaches, bumpDriveListMutationEpoch } from './drive-list-prefetch';

const MOVED_AWAY = new Map<string, { expiresAt: number }>();
const OVERRIDE_TTL_MS = 5000;

function gc(): void {
  const now = Date.now();
  for (const [id, entry] of MOVED_AWAY) {
    if (entry.expiresAt <= now) MOVED_AWAY.delete(id);
  }
}

export function markDriveFileMovedAway(fileId: string): void {
  gc();
  MOVED_AWAY.set(fileId, { expiresAt: Date.now() + OVERRIDE_TTL_MS });
}

export function applyDriveMoveOverrides<T extends { id: string }>(files: T[]): T[] {
  gc();
  if (MOVED_AWAY.size === 0) return files;
  return files.filter((f) => !MOVED_AWAY.has(f.id));
}

export function syncDriveMoveAcrossCaches(fileId: string): void {
  markDriveFileMovedAway(fileId);
  bumpDriveListMutationEpoch();
  patchAllDriveListCaches((files) => files.filter((f) => f.id !== fileId));
}

export function clearDriveMoveSessionSync(): void {
  MOVED_AWAY.clear();
}
