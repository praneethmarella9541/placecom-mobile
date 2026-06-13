import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  deleteWaContact,
  fetchWaContacts,
  upsertWaContact,
  type WaContactRow,
} from '../lib/wa-contacts-db';
import { loadCachedContactsList } from '../lib/wa-contacts-cache';
import { useAuth } from './useAuth';

function sortContacts(rows: WaContactRow[]): WaContactRow[] {
  return rows
    .filter((r) => r.name?.trim())
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/**
 * Saved contacts as a sorted list — backed by the SAME `wa_contacts` Supabase
 * table used by WhatsApp and the web app, so anything saved here is universal
 * across the user's WhatsApp threads, the Calls contacts tab, and the web CRM.
 */
export function useContacts() {
  const { session, user } = useAuth();
  const userId = user?.id ?? '';
  const [contacts, setContacts] = useState<WaContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const hasCachedRef = useRef(false);

  useLayoutEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void loadCachedContactsList(userId).then((rows) => {
      if (cancelled || !rows.length) return;
      hasCachedRef.current = true;
      setContacts(sortContacts(rows));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!session) return;
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      const rows = await fetchWaContacts();
      setContacts(sortContacts(rows));
    } catch (e: unknown) {
      if (!hasCachedRef.current) setContacts([]);
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
    void load({ silent: hasCachedRef.current });
  }, [session, load]);

  useFocusEffect(
    useCallback(() => {
      if (session) void load({ silent: true });
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
