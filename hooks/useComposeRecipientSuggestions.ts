import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  buildComposeRecipientSuggestions,
  getGoogleContactsCache,
  getRecruitersCache,
  getThreadDerivedEmailSet,
  loadRecipientSuggestions,
  subscribeComposeContactsLoaded,
  subscribeThreadDerivedEmails,
  type Contact,
} from '../lib/email-contact-suggestions';

/**
 * Web inbox/page.tsx `composeRecipientSuggestions` parity.
 */
export function useComposeRecipientSuggestions() {
  const [googleContacts, setGoogleContacts] = useState<Contact[]>(() => [
    ...getGoogleContactsCache(),
  ]);
  const [recruiterSuggestions, setRecruiterSuggestions] = useState(() => [
    ...getRecruitersCache(),
  ]);
  const [contactsHint, setContactsHint] = useState<string | null>(null);
  const [threadEmailTick, setThreadEmailTick] = useState(0);
  const [loadTick, setLoadTick] = useState(0);

  const syncFromModuleCache = useCallback(() => {
    setGoogleContacts([...getGoogleContactsCache()]);
    setRecruiterSuggestions([...getRecruitersCache()]);
    setLoadTick((n) => n + 1);
  }, []);

  useEffect(() => {
    const unsubContacts = subscribeComposeContactsLoaded(syncFromModuleCache);
    const unsubThreads = subscribeThreadDerivedEmails(() => {
      setThreadEmailTick((n) => n + 1);
    });
    return () => {
      unsubContacts();
      unsubThreads();
    };
  }, [syncFromModuleCache]);

  const threadDerivedEmails = useMemo(
    () => getThreadDerivedEmailSet(),
    [threadEmailTick]
  );

  const suggestions = useMemo(
    () =>
      buildComposeRecipientSuggestions(
        googleContacts,
        recruiterSuggestions,
        threadDerivedEmails
      ),
    [googleContacts, recruiterSuggestions, threadDerivedEmails, loadTick]
  );

  const loadContacts = useCallback(() => {
    void loadRecipientSuggestions().then(({ hint }) => {
      setContactsHint(hint);
      syncFromModuleCache();
    });
  }, [syncFromModuleCache]);

  useFocusEffect(
    useCallback(() => {
      syncFromModuleCache();
      loadContacts();
    }, [loadContacts, syncFromModuleCache])
  );

  return { suggestions, contactsHint, contactsCount: googleContacts.length };
}
