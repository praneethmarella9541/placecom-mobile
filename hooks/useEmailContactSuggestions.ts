import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  COMPOSE_SUGGESTION_LIMIT,
  filterRecipientSuggestions,
  getComposeRecipientSuggestions,
  loadRecipientSuggestions,
  type Contact,
} from '../lib/email-contact-suggestions';
import { currentRecipientToken } from '../lib/recipient-utils';

type SuggestField = 'to' | 'cc' | 'bcc' | 'from' | null;

/**
 * Calendar attendee field — same local-only filter as web `RecipientField`.
 * Contact list comes from `loadRecipientSuggestions` (compose path, not search/suggest).
 */
export function useEmailContactSuggestions() {
  const [suggestions, setSuggestions] = useState<Contact[]>([]);
  const [suggestField, setSuggestField] = useState<SuggestField>(null);
  const [pool, setPool] = useState<Contact[]>(() => getComposeRecipientSuggestions());

  useEffect(() => {
    void loadRecipientSuggestions().then(() => {
      setPool(getComposeRecipientSuggestions());
    });
  }, []);

  const applyFilter = useCallback((field: SuggestField, raw: string, contacts: Contact[]) => {
    const token = currentRecipientToken(raw);
    if (!token) {
      setSuggestions([]);
      setSuggestField(null);
      return;
    }
    setSuggestField(field);
    setSuggestions(filterRecipientSuggestions(contacts, raw, COMPOSE_SUGGESTION_LIMIT));
  }, []);

  const onFieldChange = useCallback(
    (field: SuggestField, raw: string) => {
      applyFilter(field, raw, pool);
      void loadRecipientSuggestions().then(() => {
        const next = getComposeRecipientSuggestions();
        setPool(next);
        applyFilter(field, raw, next);
      });
    },
    [applyFilter, pool]
  );

  const dismiss = useCallback(() => {
    setSuggestions([]);
    setSuggestField(null);
  }, []);

  const ensureLoaded = useCallback(() => {
    void loadRecipientSuggestions().then(() => {
      setPool(getComposeRecipientSuggestions());
    });
  }, []);

  const contactsHint = useMemo(() => null, []);

  return {
    suggestions,
    suggestField,
    contactsHint,
    onFieldChange,
    dismiss,
    ensureLoaded,
  };
}
