import { supabase } from './supabase';
import { phoneLookupVariants } from './phone';
import { canonicalWhatsAppPeer, legacyMisdialedPeerAliases, peerKeysForQuery } from './whatsapp-peer';
import { dedupeSavedContacts } from './whatsapp-contacts';
import { whatsappApi } from './api';

export type WaContactRow = { peer_e164: string; name: string };

function isMissingTableError(message: string): boolean {
  return /relation.*does not exist|42P01/i.test(message);
}

/** Build lookup map with canonical + legacy alias keys (one contact → many keys). */
export function buildContactsMap(rows: WaContactRow[]): Record<string, string> {
  const map: Record<string, string> = {};
  const unique = dedupeSavedContacts(
    rows
      .filter((c) => c.name?.trim())
      .map((c) => ({ peer_e164: c.peer_e164, name: c.name.trim() }))
  );
  for (const c of unique) {
    const canonical = c.peer_e164;
    const keys = new Set([
      canonical,
      ...legacyMisdialedPeerAliases(canonical),
      ...phoneLookupVariants(canonical),
    ]);
    for (const key of keys) {
      if (key) map[key] = c.name;
    }
  }
  return map;
}

/** Collapse duplicate peer_e164 rows in Supabase to one canonical row per number. */
async function reconcileWaContactRows(
  userId: string,
  deduped: WaContactRow[]
): Promise<void> {
  const now = new Date().toISOString();
  for (const c of deduped) {
    const keys = peerKeysForQuery(c.peer_e164);
    if (keys.length) {
      await supabase
        .from('wa_contacts')
        .delete()
        .eq('user_id', userId)
        .in('peer_e164', keys);
    }
    await supabase.from('wa_contacts').upsert(
      {
        user_id: userId,
        peer_e164: c.peer_e164,
        name: c.name,
        updated_at: now,
      },
      { onConflict: 'user_id,peer_e164' }
    );
  }
}

/** Load saved names from Supabase (same table as web). Falls back to API if needed. */
export async function fetchWaContacts(): Promise<WaContactRow[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('wa_contacts')
    .select('peer_e164, name')
    .order('name', { ascending: true });

  if (!error) {
    const rows = (data ?? []) as WaContactRow[];
    const trimmed = rows.map((r) => ({
      peer_e164: r.peer_e164,
      name: r.name?.trim() ?? '',
    }));
    const deduped = dedupeSavedContacts(trimmed).map((r) => ({
      peer_e164: r.peer_e164,
      name: r.name,
    }));
    if (deduped.length < rows.length) {
      await reconcileWaContactRows(user.id, deduped);
    }
    return deduped;
  }

  if (isMissingTableError(error.message ?? '')) {
    const api = await whatsappApi.listContacts();
    return dedupeSavedContacts(
      (api.contacts ?? []).map((r) => ({
        peer_e164: r.peer_e164,
        name: r.name?.trim() ?? '',
      }))
    ).map((r) => ({ peer_e164: r.peer_e164, name: r.name }));
  }

  throw new Error(error.message);
}

export async function upsertWaContact(peer: string, name: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const peerNorm = canonicalWhatsAppPeer(peer);
  if (!peerNorm) throw new Error('Invalid phone number');

  const trimmedName = name.trim();
  const variantKeys = peerKeysForQuery(peerNorm);
  const now = new Date().toISOString();

  // Remove legacy rows stored as 10-digit, +{local}, etc. so only one row remains.
  if (variantKeys.length) {
    await supabase
      .from('wa_contacts')
      .delete()
      .eq('user_id', user.id)
      .in('peer_e164', variantKeys);
  }

  const { error } = await supabase.from('wa_contacts').upsert(
    {
      user_id: user.id,
      peer_e164: peerNorm,
      name: trimmedName,
      updated_at: now,
    },
    { onConflict: 'user_id,peer_e164' }
  );

  if (!error) return;
  if (!isMissingTableError(error.message ?? '')) throw new Error(error.message);

  await whatsappApi.saveContact(peerNorm, trimmedName);
}

export async function deleteWaContact(peer: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in');

  const keys = peerKeysForQuery(peer);
  if (!keys.length) return;

  const { error } = await supabase
    .from('wa_contacts')
    .delete()
    .eq('user_id', user.id)
    .in('peer_e164', keys);

  if (!error) return;
  if (!isMissingTableError(error.message ?? '')) throw new Error(error.message);

  await whatsappApi.deleteContact(canonicalWhatsAppPeer(peer) || peer);
}
