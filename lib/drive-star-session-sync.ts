import type { DriveFile } from './types';
import { patchAllDriveListCaches, bumpDriveListMutationEpoch } from './drive-list-prefetch';

const STAR_OVERRIDES = new Map<string, { starred: boolean; expiresAt: number }>();
const OVERRIDE_TTL_MS = 5000;

function gc(): void {
  const now = Date.now();
  for (const [id, entry] of STAR_OVERRIDES) {
    if (entry.expiresAt <= now) STAR_OVERRIDES.delete(id);
  }
}

export function setDriveStarOverride(fileId: string, starred: boolean): void {
  gc();
  STAR_OVERRIDES.set(fileId, { starred, expiresAt: Date.now() + OVERRIDE_TTL_MS });
}

export function applyDriveStarOverrides(files: DriveFile[]): DriveFile[] {
  gc();
  if (STAR_OVERRIDES.size === 0) return files;
  return files.map((f) => {
    const o = STAR_OVERRIDES.get(f.id);
    return o ? { ...f, starred: o.starred } : f;
  });
}

export function syncDriveStarAcrossCaches(fileId: string, starred: boolean): void {
  setDriveStarOverride(fileId, starred);
  bumpDriveListMutationEpoch();
  patchAllDriveListCaches((files) =>
    files.map((f) => (f.id === fileId ? { ...f, starred } : f))
  );
}

export function clearDriveStarSessionSync(): void {
  STAR_OVERRIDES.clear();
}
