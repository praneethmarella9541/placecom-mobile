/** Shared session-cache controls (cleared on logout). */

export const MUTATION_COOLDOWN_MS = 5000;

let cacheWriteGeneration = 0;

export function getCacheWriteGeneration(): number {
  return cacheWriteGeneration;
}

export function bumpCacheWriteGeneration(): void {
  cacheWriteGeneration += 1;
}

export function resetCacheWriteGeneration(): void {
  cacheWriteGeneration = 0;
}
