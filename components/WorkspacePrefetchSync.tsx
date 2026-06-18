import { useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { meApi } from '../lib/api';
import {
  hydrateMailPrefetchCaches,
  scheduleLoginPrefetchChain,
  startEarlyCallsPrefetch,
} from '../lib/workspace-feature-prefetch';
import { isWorkspacePrefetchSessionComplete } from '../lib/login-prefetch-session';

/**
 * After auth + mailbox link, warm mail/drive/feature caches once per session.
 * Mirrors Placecom web WorkspaceChrome login prefetch chain.
 */
export function WorkspacePrefetchSync() {
  const { user, session, hasFeature } = useAuth();
  const scheduledForRef = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.id || !session) return;

    if (hasFeature('calls')) {
      startEarlyCallsPrefetch(user.id, true);
    }

    if (scheduledForRef.current === user.id) return;

    let cancelled = false;
    void hydrateMailPrefetchCaches(user.id).then(() => {
      if (cancelled) return;
      return meApi.mailbox();
    }).then((mailbox) => {
      if (cancelled) return;
      if (mailbox && !mailbox.hasStoredMailbox && !mailbox.mailboxEmail) return;
      if (scheduledForRef.current === user.id && isWorkspacePrefetchSessionComplete()) return;
      scheduledForRef.current = user.id;
      scheduleLoginPrefetchChain(user.id, {
        whatsapp: hasFeature('whatsapp'),
        calendar: hasFeature('calendar'),
        forms: hasFeature('forms'),
        calls: hasFeature('calls'),
      });
    }).catch(() => {
      if (cancelled) return;
      if (scheduledForRef.current === user.id && isWorkspacePrefetchSessionComplete()) return;
      scheduledForRef.current = user.id;
      scheduleLoginPrefetchChain(user.id, {
        whatsapp: hasFeature('whatsapp'),
        calendar: hasFeature('calendar'),
        forms: hasFeature('forms'),
        calls: hasFeature('calls'),
      });
    });

    return () => {
      cancelled = true;
    };
  }, [user?.id, session, hasFeature]);

  return null;
}
