/** Decode URL-encoded filename segments (e.g. hello%20check.csv → hello check.csv). */
export function decodeDisplayFilename(name: string): string {
  const trimmed = name.trim();
  if (!trimmed || !/%[0-9A-Fa-f]{2}/.test(trimmed)) return trimmed;

  let current = trimmed.replace(/\+/g, ' ');
  for (let i = 0; i < 2; i++) {
    if (!/%[0-9A-Fa-f]{2}/.test(current)) break;
    try {
      const next = decodeURIComponent(current);
      if (next === current) break;
      current = next;
    } catch {
      break;
    }
  }
  return current;
}

/** Basename with spaces preserved — use for uploads and display. */
export function normalizeUploadFilename(name: string): string {
  const base = name.split(/[/\\]/).pop()?.trim() ?? name.trim();
  const decoded = decodeDisplayFilename(base);
  return decoded || 'upload';
}
