import { useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { meApi } from '../lib/api';
import { scheduleLoginPrefetchChain } from '../lib/workspace-feature-prefetch';

/**
 * After auth + mailbox link, warm mail/drive/feature caches once per session.
 * Mirrors Placecom web WorkspaceChrome login prefetch chain.
 */
export function WorkspacePrefetchSync() {
  const { user, session, hasFeature } = useAuth();
  const scheduledForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.id || !session) return;
    if (scheduledForRef.current === user.id) return;

    let cancelled = false;
    void meApi
      .mailbox()
      .then((mailbox) => {
        if (cancelled) return;
        if (!mailbox.hasStoredMailbox && !mailbox.mailboxEmail) return;
        scheduledForRef.current = user.id;
        scheduleLoginPrefetchChain(user.id, {
          whatsapp: hasFeature('whatsapp'),
          calendar: hasFeature('calendar'),
          forms: hasFeature('forms'),
        });
      })
      .catch(() => {
        // Still warm mail/drive when mailbox endpoint is unavailable.
        if (cancelled) return;
        scheduledForRef.current = user.id;
        scheduleLoginPrefetchChain(user.id, {
          whatsapp: hasFeature('whatsapp'),
          calendar: hasFeature('calendar'),
          forms: hasFeature('forms'),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id, session, hasFeature]);

  return null;
}
