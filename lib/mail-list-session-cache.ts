import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GmailThreadListItem } from './api';

export type MailListCacheSnapshot = {
  threads: GmailThreadListItem[];
  nextPageToken?: string;
};

const STORAGE_PREFIX = 'placecom:mail-list-views:v1';
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_VIEWS = 20;

type PersistedView = MailListCacheSnapshot & { fetchedAt: number };
type PersistedStore = Record<string, PersistedView>;

let persistUserId: string | null = null;

function diskKey(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

export function bindMailListPrefetchUser(userId: string): void {
  persistUserId = userId;
}

function pruneStore(store: PersistedStore): void {
  const now = Date.now();
  const fresh = Object.entries(store).filter(([, v]) => now - v.fetchedAt < SESSION_TTL_MS);
  fresh.sort((a, b) => b[1].fetchedAt - a[1].fetchedAt);
  for (const key of Object.keys(store)) delete store[key];
  for (const [key, value] of fresh.slice(0, MAX_VIEWS)) store[key] = value;
}

export async function loadPersistedMailListViews(
  userId: string
): Promise<Map<string, MailListCacheSnapshot>> {
  const out = new Map<string, MailListCacheSnapshot>();
  try {
    const raw = await AsyncStorage.getItem(diskKey(userId));
    if (!raw) return out;
    const store = JSON.parse(raw) as PersistedStore;
    if (!store || typeof store !== 'object') return out;

    const now = Date.now();
    let changed = false;
    for (const [key, entry] of Object.entries(store)) {
      if (now - entry.fetchedAt >= SESSION_TTL_MS) {
        delete store[key];
        changed = true;
        continue;
      }
      out.set(key, { threads: entry.threads, nextPageToken: entry.nextPageToken });
    }
    if (changed) {
      await AsyncStorage.setItem(diskKey(userId), JSON.stringify(store)).catch(() => {});
    }
  } catch {
    /* ignore */
  }
  return out;
}

export function persistMailListSessionCache(
  cacheKey: string,
  snapshot: MailListCacheSnapshot,
  opts?: { userId?: string }
): void {
  if (!cacheKey) return;
  const userId = opts?.userId ?? persistUserId;
  if (!userId) return;

  void (async () => {
    try {
      const raw = await AsyncStorage.getItem(diskKey(userId));
      const store: PersistedStore = raw ? (JSON.parse(raw) as PersistedStore) : {};
      store[cacheKey] = { ...snapshot, fetchedAt: Date.now() };
      pruneStore(store);
      await AsyncStorage.setItem(diskKey(userId), JSON.stringify(store));
    } catch {
      /* quota / parse — best-effort */
    }
  })();
}

export async function clearMailListSessionStorage(userId?: string): Promise<void> {
  const uid = userId ?? persistUserId;
  if (!uid) return;
  await AsyncStorage.removeItem(diskKey(uid)).catch(() => {});
}
