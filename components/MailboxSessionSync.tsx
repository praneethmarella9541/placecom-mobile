import { useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { mailboxApi } from '../lib/api';

/**
 * Once per signed-in session, ask the backend to persist the admin's
 * Google refresh token from supabase.auth's provider_refresh_token.
 * Without this, mobile-only admins lose Gmail/Calendar access after
 * their ~1h provider access token expires.
 *
 * Mirrors the web app's `<MailboxSessionSync />` component which runs
 * inside AppShell. Mounted in the workspace layout so it covers every
 * authenticated screen.
 *
 * Fire-and-forget: the backend returns { skipped } for non-admins or
 * when the migration isn't applied, and that's fine — we just want
 * to avoid retrying needlessly within the same session.
 */
export function MailboxSessionSync() {
  const { user, session } = useAuth();
  const lastSyncedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.id || !session) return;
    // Need at least the refresh token; otherwise the server has nothing
    // durable to store (access token alone is short-lived).
    const providerRefreshToken = session.provider_refresh_token ?? undefined;
    const providerAccessToken = session.provider_token ?? undefined;
    if (!providerRefreshToken && !providerAccessToken) return;
    // Re-run if the user id changes (different account). Avoid re-firing
    // on every render or token refresh.
    if (lastSyncedRef.current === user.id) return;
    lastSyncedRef.current = user.id;
    mailboxApi
      .registerSession({ providerRefreshToken, providerAccessToken })
      .catch(() => {
        // Non-fatal — server-side logs will surface anything actionable.
      });
  }, [user?.id, session]);

  return null;
}
