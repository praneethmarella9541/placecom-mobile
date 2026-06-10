import AsyncStorage from '@react-native-async-storage/async-storage';
import { whatsappApi } from './api';
import { canonicalWhatsAppPeer } from './whatsapp-peer';
import { normalizeWhatsAppMessages } from './whatsapp-message-normalize';
import type { WhatsAppMessage } from './whatsapp-types';

const CACHE_VERSION = 'v1';
const FRESH_MS = 45_000;
const PREFETCH_CONCURRENCY = 4;

type MemoryEntry = { messages: WhatsAppMessage[]; fetchedAt: number };

const memory = new Map<string, MemoryEntry>();
const inflight = new Map<string, Promise<WhatsAppMessage[] | null>>();

function storageKey(userId: string, peer: string): string {
  return `wa_thread_${CACHE_VERSION}:${userId}:${canonicalWhatsAppPeer(peer)}`;
}

function isFresh(entry: MemoryEntry | undefined): boolean {
  return !!entry && Date.now() - entry.fetchedAt < FRESH_MS;
}

/** Instant read from session memory (no I/O). */
export function getMemoryThreadMessages(peer: string): WhatsAppMessage[] | null {
  const key = canonicalWhatsAppPeer(peer);
  if (!key) return null;
  const entry = memory.get(key);
  return entry?.messages ?? null;
}

export async function readThreadCache(
  userId: string,
  peer: string
): Promise<WhatsAppMessage[] | null> {
  const key = canonicalWhatsAppPeer(peer);
  if (!key) return null;

  const mem = memory.get(key);
  if (mem) return mem.messages;

  try {
    const raw = await AsyncStorage.getItem(storageKey(userId, key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { messages?: WhatsAppMessage[]; fetchedAt?: number };
    const messages = parsed.messages ?? [];
    if (messages.length) {
      memory.set(key, { messages, fetchedAt: parsed.fetchedAt ?? 0 });
    }
    return messages;
  } catch {
    return null;
  }
}

export function writeThreadCache(
  userId: string,
  peer: string,
  messages: WhatsAppMessage[]
): void {
  const key = canonicalWhatsAppPeer(peer);
  if (!key || !userId) return;

  const entry: MemoryEntry = { messages, fetchedAt: Date.now() };
  memory.set(key, entry);
  void AsyncStorage.setItem(
    storageKey(userId, key),
    JSON.stringify({ messages, fetchedAt: entry.fetchedAt })
  ).catch(() => {});
}

async function fetchThread(peer: string): Promise<WhatsAppMessage[] | null> {
  const key = canonicalWhatsAppPeer(peer);
  if (!key) return null;

  const existing = inflight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const data = await whatsappApi.getMessages(key);
      return normalizeWhatsAppMessages((data.messages ?? []) as WhatsAppMessage[]);
    } catch {
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

/** Fetch one thread and update caches (skips if already fresh in memory). */
export async function warmWhatsAppThread(
  userId: string,
  peer: string,
  opts?: { force?: boolean }
): Promise<WhatsAppMessage[] | null> {
  const key = canonicalWhatsAppPeer(peer);
  if (!key) return null;

  if (!opts?.force && isFresh(memory.get(key))) {
    return memory.get(key)!.messages;
  }

  const messages = await fetchThread(key);
  if (messages) writeThreadCache(userId, key, messages);
  return messages;
}

/** Prefetch recent chats in parallel (WhatsApp-style local warm). */
export async function prefetchWhatsAppThreads(
  userId: string,
  peers: string[],
  opts?: { limit?: number; force?: boolean }
): Promise<void> {
  if (!userId) return;

  const limit = opts?.limit ?? 24;
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const p of peers) {
    const key = canonicalWhatsAppPeer(p);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    if (!opts?.force && isFresh(memory.get(key))) continue;
    unique.push(key);
    if (unique.length >= limit) break;
  }

  for (let i = 0; i < unique.length; i += PREFETCH_CONCURRENCY) {
    const batch = unique.slice(i, i + PREFETCH_CONCURRENCY);
    await Promise.all(
      batch.map(async (peer) => {
        const messages = await fetchThread(peer);
        if (messages) writeThreadCache(userId, peer, messages);
      })
    );
  }
}

export function clearWhatsAppThreadCache(): void {
  memory.clear();
  inflight.clear();
}

export async function clearWhatsAppThreadDiskCache(userId?: string): Promise<void> {
  if (!userId) return;
  try {
    const keys = await AsyncStorage.getAllKeys();
    const prefix = `wa_thread_${CACHE_VERSION}:${userId}:`;
    const toRemove = keys.filter((k) => k.startsWith(prefix));
    if (toRemove.length) await AsyncStorage.multiRemove(toRemove);
  } catch {
    /* best-effort */
  }
}
