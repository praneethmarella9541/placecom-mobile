/**
 * In-process session flags for login / bulk prefetch (cleared on sign-out).
 * Mobile has no browser reload — disk caches cover app restarts.
 */

let workspaceWarming = false;
let mailBodyWarming = false;
let workspacePrefetchDone = false;
let mailBodyPrefetchDone = false;

export function isWorkspacePrefetchSessionComplete(): boolean {
  return workspacePrefetchDone;
}

export function isMailBodyPrefetchSessionComplete(): boolean {
  return mailBodyPrefetchDone;
}

export function clearWorkspacePrefetchSession(): void {
  workspaceWarming = false;
  mailBodyWarming = false;
  workspacePrefetchDone = false;
  mailBodyPrefetchDone = false;
}

/** Full login warm (mail lists + bodies, drive, WhatsApp, calendar, forms). */
export function beginWorkspacePrefetchWarm(opts?: { force?: boolean }): boolean {
  if (opts?.force) {
    clearWorkspacePrefetchSession();
    workspaceWarming = true;
    workspacePrefetchDone = true;
    mailBodyPrefetchDone = true;
    return true;
  }
  if (workspaceWarming || workspacePrefetchDone) return false;
  workspaceWarming = true;
  workspacePrefetchDone = true;
  mailBodyPrefetchDone = true;
  return true;
}

export function finishWorkspacePrefetchWarm(): void {
  workspaceWarming = false;
}

export function abortWorkspacePrefetchWarm(): void {
  workspaceWarming = false;
}

/** Bulk Gmail thread body prefetch (`?prefetch=1`). */
export function beginMailBodyPrefetchWarm(opts?: { force?: boolean }): boolean {
  if (opts?.force) {
    mailBodyWarming = false;
    mailBodyPrefetchDone = false;
    mailBodyWarming = true;
    mailBodyPrefetchDone = true;
    return true;
  }
  if (mailBodyWarming || mailBodyPrefetchDone) return false;
  mailBodyWarming = true;
  mailBodyPrefetchDone = true;
  return true;
}

export function finishMailBodyPrefetchWarm(): void {
  mailBodyWarming = false;
}

/**
 * Background thread-body prefetch for the visible list.
 * `landing` = user opened this folder/tab (always warm current page).
 */
export function shouldPrefetchVisibleMailList(opts?: {
  forceRefresh?: boolean;
  append?: boolean;
  landing?: boolean;
}): boolean {
  if (opts?.forceRefresh || opts?.append || opts?.landing) return true;
  if (!isWorkspacePrefetchSessionComplete()) return true;
  return true;
}
