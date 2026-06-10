import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildContactsMap, type WaContactRow } from './wa-contacts-db';
import { getWhatsAppPrefetchCache } from './workspace-feature-prefetch';

const cacheKey = (userId: string) => `wa_contacts_v1:${userId}`;

/** In-memory + disk cache so chat list shows names on first paint. */
export function contactsMapFromPrefetch(): Record<string, string> {
  const pref = getWhatsAppPrefetchCache();
  const rows = pref?.contacts?.contacts ?? [];
  if (!rows.length) return {};
  return buildContactsMap(
    rows.map((c) => ({
      peer_e164: c.peer_e164,
      name: c.name?.trim() ?? '',
    }))
  );
}

export async function loadCachedContactsMap(userId: string): Promise<Record<string, string>> {
  const fromPrefetch = contactsMapFromPrefetch();
  if (Object.keys(fromPrefetch).length) return fromPrefetch;

  try {
    const raw = await AsyncStorage.getItem(cacheKey(userId));
    if (!raw) return {};
    const rows = JSON.parse(raw) as WaContactRow[];
    return buildContactsMap(rows);
  } catch {
    return {};
  }
}

export async function persistContactsCache(userId: string, rows: WaContactRow[]): Promise<void> {
  try {
    await AsyncStorage.setItem(cacheKey(userId), JSON.stringify(rows));
  } catch {
    /* best-effort */
  }
}
