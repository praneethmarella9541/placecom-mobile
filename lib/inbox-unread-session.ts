/**
 * Session-scoped INBOX unread counter.
 *
 * Gmail label count propagation can lag > 5 s after a thread is read,
 * causing the badge to "bounce back" up even after the user's reads are
 * optimistically reflected in the UI.  This module remembers the lowest
 * unread count seen this session and prevents the server from raising it
 * back until actual NEW mail arrives.
 *
 * Rule (matches Placecom web lib/inbox-unread-session.ts):
 *   if session < server  →  keep session  (API still stale after reads)
 *   if server  < session →  adopt server  (new mail arrived / synced)
 */

let sessionInboxUnread: number | null = null;

export function clearSessionInboxUnread(): void {
  sessionInboxUnread = null;
}

/**
 * Merge the server's reported unread count with the session-optimistic value.
 * Returns the count that should be shown to the user.
 */
export function mergeInboxUnread(serverUnread: number): number {
  if (sessionInboxUnread === null) {
    // First call this session — seed from server.
    sessionInboxUnread = serverUnread;
    return serverUnread;
  }
  if (sessionInboxUnread <= serverUnread) {
    // Session is lower: user has read threads the server hasn't propagated yet.
    return sessionInboxUnread;
  }
  // Server is lower: counts synced or new mail read elsewhere.
  sessionInboxUnread = serverUnread;
  return serverUnread;
}

/** Call each time the user reads thread(s) so future merges stay aligned. */
export function decrementSessionInboxUnread(by = 1): void {
  if (sessionInboxUnread !== null) {
    sessionInboxUnread = Math.max(0, sessionInboxUnread - by);
  }
}
