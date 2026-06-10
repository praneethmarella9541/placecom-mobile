import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import { phoneMatches } from './phone';
import { canonicalWhatsAppPeer, peerKeysForQuery } from './whatsapp-peer';
import type { WhatsAppConversation } from './whatsapp-types';

const LOCAL_READ_KEY = 'wa_thread_reads_v1';
const LOCAL_MIGRATED_KEY = 'wa_thread_reads_migrated_v1';

// ─── In-memory caches ─────────────────────────────────────────────────────────

/**
 * Optimistic read-at map. Updated synchronously inside markWhatsAppThreadRead
 * so the badge disappears instantly when the user opens a chat, without waiting
 * for the Supabase write to complete and propagate back through the poll cycle.
 */
const _optimisticReadAt: Record<string, string> = {};

/**
 * Short-TTL cache of the Supabase `wa_thread_reads` result.
 * Prevents re-querying the DB on every 4-second poll tick.
 */
const _readAtCache: Map<string, { data: Record<string, string>; ts: number }> = new Map();
const READ_AT_CACHE_TTL_MS = 15_000;

/** Merge two read-at maps, keeping the later timestamp for each peer. */
function mergeReadMaps(
  a: Record<string, string>,
  b: Record<string, string>
): Record<string, string> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const ex = out[k];
    if (!ex || new Date(v).getTime() > new Date(ex).getTime()) out[k] = v;
  }
  return out;
}

/** Force next unread-count call to re-fetch from Supabase. */
export function invalidateReadAtCache(userId?: string): void {
  if (userId) _readAtCache.delete(userId);
  else _readAtCache.clear();
}

export function clearWhatsAppUnreadSessionState(): void {
  for (const key of Object.keys(_optimisticReadAt)) {
    delete _optimisticReadAt[key];
  }
  _readAtCache.clear();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isMissingReadTableError(message: string): boolean {
  return (
    /wa_thread_reads/i.test(message) &&
    (/does not exist|schema cache|could not find the table/i.test(message) || /42P01/.test(message))
  );
}

function rowsToReadMap(rows: Array<{ peer_e164: string; read_at: string }>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const row of rows) {
    const key = canonicalWhatsAppPeer(row.peer_e164);
    if (!key || !row.read_at) continue;
    const existing = map[key];
    if (!existing || new Date(row.read_at).getTime() > new Date(existing).getTime()) {
      map[key] = row.read_at;
    }
  }
  return map;
}

async function localReadKey(userId: string): Promise<string> {
  return `${LOCAL_READ_KEY}:${userId}`;
}

async function loadLocalReadAt(userId: string): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(await localReadKey(userId));
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, string>;
  } catch {
    return {};
  }
}

function readRowsForUpsert(
  userId: string,
  entries: Array<[string, string]>
): Array<{ user_id: string; peer_e164: string; read_at: string; updated_at: string }> {
  const byPeer = new Map<string, string>();
  for (const [peer, readAt] of entries) {
    if (!readAt) continue;
    const key = canonicalWhatsAppPeer(peer);
    if (!key) continue;
    const existing = byPeer.get(key);
    if (!existing || new Date(readAt).getTime() > new Date(existing).getTime()) {
      byPeer.set(key, readAt);
    }
  }
  return Array.from(byPeer.entries()).map(([peer_e164, read_at]) => ({
    user_id: userId,
    peer_e164,
    read_at,
    updated_at: read_at,
  }));
}

async function migrateLocalReadStateToSupabase(userId: string): Promise<void> {
  const flagKey = `${LOCAL_MIGRATED_KEY}:${userId}`;
  if (await AsyncStorage.getItem(flagKey)) return;

  const local = await loadLocalReadAt(userId);
  const rows = readRowsForUpsert(userId, Object.entries(local));
  if (rows.length) {
    const { error } = await supabase.from('wa_thread_reads').upsert(rows, {
      onConflict: 'user_id,peer_e164',
    });
    if (error && !isMissingReadTableError(error.message ?? '')) {
      console.warn('[whatsapp] migrate local read state failed:', error.message);
      return;
    }
  }

  await AsyncStorage.setItem(flagKey, '1');
  await AsyncStorage.removeItem(await localReadKey(userId));
}

/** Load read cursors — uses TTL cache unless forceRefresh (cross-device sync). */
async function loadReadAtByPeer(
  userId: string,
  opts?: { forceRefresh?: boolean }
): Promise<Record<string, string>> {
  const now = Date.now();
  if (!opts?.forceRefresh) {
    const cached = _readAtCache.get(userId);
    if (cached && now - cached.ts < READ_AT_CACHE_TTL_MS) {
      return mergeReadMaps(cached.data, _optimisticReadAt);
    }
  }

  const { data, error } = await supabase
    .from('wa_thread_reads')
    .select('peer_e164, read_at')
    .eq('user_id', userId);

  if (!error && data) {
    await migrateLocalReadStateToSupabase(userId);
    const result = rowsToReadMap(data as Array<{ peer_e164: string; read_at: string }>);
    _readAtCache.set(userId, { data: result, ts: now });
    return mergeReadMaps(result, _optimisticReadAt);
  }

  if (error && isMissingReadTableError(error.message ?? '')) {
    const local = await loadLocalReadAt(userId);
    return mergeReadMaps(local, _optimisticReadAt);
  }

  if (error) {
    console.warn('[whatsapp] load read state failed:', error.message);
  }

  return { ..._optimisticReadAt };
}

/** Mark thread read. Updates the optimistic cache synchronously so the badge
 *  disappears immediately, before the Supabase write returns. */
export async function markWhatsAppThreadRead(peer: string, readAt?: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const canonical = canonicalWhatsAppPeer(peer);
  if (!canonical) return;

  const at = readAt ?? new Date().toISOString();

  // ── Optimistic update (synchronous) ──────────────────────────────────────
  // Update the in-memory cache immediately so any concurrent poll sees 0 unread.
  _optimisticReadAt[canonical] = at;
  for (const alias of peerKeysForQuery(canonical)) {
    _optimisticReadAt[alias] = at;
  }
  // Bust the TTL cache so the next full fetch picks up the new value.
  invalidateReadAtCache(user.id);

  // ── Persist to Supabase (async) ───────────────────────────────────────────
  const { error } = await supabase.from('wa_thread_reads').upsert(
    { user_id: user.id, peer_e164: canonical, read_at: at, updated_at: at },
    { onConflict: 'user_id,peer_e164' }
  );

  if (!error) return;

  if (isMissingReadTableError(error.message ?? '')) {
    try {
      const local = await loadLocalReadAt(user.id);
      local[canonical] = at;
      for (const alias of peerKeysForQuery(canonical)) {
        local[alias] = at;
      }
      await AsyncStorage.setItem(await localReadKey(user.id), JSON.stringify(local));
    } catch {
      /* offline */
    }
    return;
  }

  console.warn('[whatsapp] mark read failed:', error.message);
}

function isInboundUnread(
  peer: string,
  createdAt: string,
  readAtByPeer: Record<string, string>
): boolean {
  const canonical = canonicalWhatsAppPeer(peer);

  // Fast path: check optimistic cache first — avoids any timing window
  const optimistic = _optimisticReadAt[canonical];
  if (optimistic && new Date(createdAt).getTime() <= new Date(optimistic).getTime() + 50) {
    return false;
  }

  let readAt: string | undefined;
  for (const [key, at] of Object.entries(readAtByPeer)) {
    if (phoneMatches(key, canonical)) {
      if (!readAt || new Date(at).getTime() > new Date(readAt).getTime()) {
        readAt = at;
      }
    }
  }
  if (!readAt) return true;
  return new Date(createdAt).getTime() > new Date(readAt).getTime() + 50;
}

export async function attachUnreadCounts(
  conversations: WhatsAppConversation[],
  businessLine: string
): Promise<WhatsAppConversation[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !businessLine) return conversations;

  const readAtByPeer = await loadReadAtByPeer(user.id, { forceRefresh: true });

  const { data: rows, error } = await supabase
    .from('whatsapp_messages')
    .select('peer_e164, created_at, direction, deleted_at')
    .eq('business_e164', businessLine)
    .eq('direction', 'inbound')
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200); // reduced from 800 — last 200 inbound messages is enough

  if (error) {
    console.warn('[whatsapp] unread count query failed:', error.message);
    return conversations;
  }

  const unreadByPeer = new Map<string, number>();
  for (const r of rows ?? []) {
    const peer = canonicalWhatsAppPeer((r.peer_e164 as string) || '');
    if (!peer) continue;
    if (!isInboundUnread(peer, r.created_at as string, readAtByPeer)) continue;
    unreadByPeer.set(peer, (unreadByPeer.get(peer) ?? 0) + 1);
  }

  return conversations.map((c) => {
    const peer = canonicalWhatsAppPeer(c.peer_e164);
    const computed = unreadByPeer.get(peer) ?? 0;
    return { ...c, unread_count: computed };
  });
}
