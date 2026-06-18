import AsyncStorage from '@react-native-async-storage/async-storage';
import type { GmailMessage } from './api';

export type MailThreadCachePayload = {
  threadId: string;
  messages: GmailMessage[];
  labelIds?: string[];
};

const STORAGE_PREFIX = 'placecom:mail-thread-bodies:v1';
const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_THREADS = 30;

type PersistedThread = {
  data: MailThreadCachePayload;
  fetchedAt: number;
};
type PersistedStore = Record<string, PersistedThread>;

let persistUserId: string | null = null;

function diskKey(userId: string): string {
  return `${STORAGE_PREFIX}:${userId}`;
}

export function bindMailThreadPrefetchUser(userId: string): void {
  persistUserId = userId;
}

function pruneStore(store: PersistedStore, max = MAX_THREADS): void {
  const now = Date.now();
  const fresh = Object.entries(store).filter(
    ([, entry]) => now - entry.fetchedAt < SESSION_TTL_MS
  );
  fresh.sort((a, b) => b[1].fetchedAt - a[1].fetchedAt);
  for (const key of Object.keys(store)) delete store[key];
  for (const [threadId, entry] of fresh.slice(0, max)) store[threadId] = entry;
}

export async function loadPersistedMailThreadBodies(
  userId: string
): Promise<Map<string, { data: MailThreadCachePayload; fetchedAt: number }>> {
  const out = new Map<string, { data: MailThreadCachePayload; fetchedAt: number }>();
  try {
    const raw = await AsyncStorage.getItem(diskKey(userId));
    if (!raw) return out;
    const store = JSON.parse(raw) as PersistedStore;
    if (!store || typeof store !== 'object') return out;

    const now = Date.now();
    let changed = false;
    for (const [threadId, entry] of Object.entries(store)) {
      if (now - entry.fetchedAt >= SESSION_TTL_MS) {
        delete store[threadId];
        changed = true;
        continue;
      }
      out.set(threadId, entry);
    }
    if (changed) {
      await AsyncStorage.setItem(diskKey(userId), JSON.stringify(store)).catch(() => {});
    }
  } catch {
    /* ignore */
  }
  return out;
}

export function persistMailThreadSessionCache(
  userId: string,
  threadId: string,
  data: MailThreadCachePayload
): void {
  if (!userId || !threadId) return;

  void (async () => {
    try {
      const raw = await AsyncStorage.getItem(diskKey(userId));
      const store: PersistedStore = raw ? (JSON.parse(raw) as PersistedStore) : {};
      store[threadId] = { data, fetchedAt: Date.now() };
      pruneStore(store);
      await AsyncStorage.setItem(diskKey(userId), JSON.stringify(store));
    } catch {
      /* best-effort */
    }
  })();
}

export async function clearMailThreadSessionStorage(userId?: string): Promise<void> {
  const uid = userId ?? persistUserId;
  if (!uid) return;
  await AsyncStorage.removeItem(diskKey(uid)).catch(() => {});
}
