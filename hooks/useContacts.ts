import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  deleteWaContact,
  fetchWaContacts,
  upsertWaContact,
  type WaContactRow,
} from '../lib/wa-contacts-db';
import { useAuth } from './useAuth';

/**
 * Saved contacts as a sorted list — backed by the SAME `wa_contacts` Supabase
 * table used by WhatsApp and the web app, so anything saved here is universal
 * across the user's WhatsApp threads, the Calls contacts tab, and the web CRM.
 */
export function useContacts() {
  const { session } = useAuth();
  const [contacts, setContacts] = useState<WaContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setError(null);
    try {
      const rows = await fetchWaContacts();
      const sorted = rows
        .filter((r) => r.name?.trim())
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
      setContacts(sorted);
    } catch (e: unknown) {
      setContacts([]);
      setError(e instanceof Error ? e.message : 'Failed to load contacts');
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (!session) {
      setLoading(true);
      return;
    }
    setLoading(true);
    void load();
  }, [session, load]);

  useFocusEffect(
    useCallback(() => {
      if (session) void load();
    }, [session, load])
  );

  const saveContact = useCallback(
    async (peer: string, name: string) => {
      const trimmed = name.trim();
      if (trimmed) await upsertWaContact(peer, trimmed);
      else await deleteWaContact(peer);
      await load();
    },
    [load]
  );

  const removeContact = useCallback(
    async (peer: string) => {
      await deleteWaContact(peer);
      await load();
    },
    [load]
  );

  return { contacts, loading, error, reload: load, saveContact, removeContact };
}
