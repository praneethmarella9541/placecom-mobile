import AsyncStorage from '@react-native-async-storage/async-storage';
import { callsApi } from './api';
import { getCacheWriteGeneration } from './session-cache-core';
import type { CallLog } from './types';

export type CallsTelephony = {
  mobilePhone: string | null;
  exotelVirtualNumber: string | null;
};

export type CallsListCache = {
  logs: CallLog[];
  telephony?: CallsTelephony | null;
  fetchedAt: number;
};

const FRESH_MS = 60_000;
const diskKey = (userId: string) => `calls_list_v1:${userId}`;

let cache: CallsListCache | null = null;
let inflight: Promise<CallsListCache | null> | null = null;
let persistUserId: string | null = null;

/** Session memory cache for instant Calls tab paint (includes empty lists). */
export function peekCallsPrefetchCache(): CallsListCache | null {
  return cache;
}

export function getCallsPrefetchCache(): CallsListCache | null {
  return cache;
}

export function setCallsPrefetchCache(
  data: {
    logs: CallLog[];
    telephony?: CallsTelephony | null;
  },
  opts?: { userId?: string; fetchedAt?: number }
): void {
  cache = {
    logs: data.logs,
    telephony: data.telephony ?? null,
    fetchedAt: opts?.fetchedAt ?? Date.now(),
  };
  const uid = opts?.userId ?? persistUserId;
  if (uid) void persistCallsList(uid, cache);
}

export function bindCallsPrefetchUser(userId: string): void {
  persistUserId = userId;
}

export async function loadPersistedCallsList(userId: string): Promise<CallsListCache | null> {
  try {
    const raw = await AsyncStorage.getItem(diskKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CallsListCache;
    if (!parsed || !Array.isArray(parsed.logs)) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function persistCallsList(userId: string, entry: CallsListCache): Promise<void> {
  try {
    await AsyncStorage.setItem(diskKey(userId), JSON.stringify(entry));
  } catch {
    /* best-effort */
  }
}

export function clearCallsListSessionCache(): void {
  cache = null;
  inflight = null;
}

export async function prefetchCallsList(signal?: AbortSignal): Promise<CallsListCache | null> {
  if (signal?.aborted) return null;
  if (cache && Date.now() - cache.fetchedAt < FRESH_MS) return cache;
  if (inflight) return inflight;

  const writeGen = getCacheWriteGeneration();
  inflight = (async () => {
    try {
      const data = await callsApi.list();
      if (signal?.aborted || writeGen !== getCacheWriteGeneration()) return null;
      const entry: CallsListCache = {
        logs: (data.logs ?? []) as CallLog[],
        telephony: data.telephony
          ? {
              mobilePhone: data.telephony.mobilePhone ?? null,
              exotelVirtualNumber: data.telephony.exotelVirtualNumber ?? null,
            }
          : null,
        fetchedAt: Date.now(),
      };
      cache = entry;
      if (persistUserId) void persistCallsList(persistUserId, entry);
      return entry;
    } catch {
      return null;
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
