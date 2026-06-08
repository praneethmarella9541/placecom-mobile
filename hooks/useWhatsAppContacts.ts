import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { canonicalWhatsAppPeer } from '../lib/whatsapp-peer';
import {
  buildContactsMap,
  deleteWaContact,
  fetchWaContacts,
  upsertWaContact,
} from '../lib/wa-contacts-db';
import { useAuth } from './useAuth';

export function useWhatsAppContacts() {
  const { session } = useAuth();
  const [contacts, setContacts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!session) return;
    setError(null);
    try {
      const rows = await fetchWaContacts();
      setContacts(buildContactsMap(rows));
    } catch (e: unknown) {
      setContacts({});
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

  const saveName = useCallback(async (peer: string, name: string) => {
    const trimmed = name.trim();
    const key = canonicalWhatsAppPeer(peer) || peer;
    try {
      if (trimmed) {
        await upsertWaContact(key, trimmed);
      } else {
        await deleteWaContact(key);
      }
      setError(null);
      await load();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to save contact');
    }
  }, [load]);

  return { contacts, loading, error, reload: load, saveName };
}
