import { calendarApi, formsApi, gmailApi, whatsappApi } from './api';
import { persistContactsCache } from './wa-contacts-cache';
import { clearWhatsAppThreadCache, prefetchWhatsAppThreads } from './whatsapp-thread-cache';
import { cancelMailPrefetch } from './inbox-list-prefetch';
import { warmMailListsThenThreadBodies } from './mail-thread-prefetch';
import { prefetchDriveListViews, cancelDrivePrefetch } from './drive-list-prefetch';
import {
  bindCallsPrefetchUser,
  prefetchCallsList,
  clearCallsListSessionCache,
} from './calls-list-prefetch';
import { prefetchWaContactsList } from './wa-contacts-cache';
import { getCacheWriteGeneration } from './session-cache-core';

const LOGIN_DEBOUNCE_MS = 200;

let loginTimer: ReturnType<typeof setTimeout> | null = null;
let loginChainAbort: AbortController | null = null;
let loginRanForUser: string | null = null;

export type FeaturePrefetchAccess = {
  whatsapp?: boolean;
  calendar?: boolean;
  forms?: boolean;
  calls?: boolean;
};

type FormsCache = { forms: Awaited<ReturnType<typeof formsApi.list>>['forms']; nextPageToken?: string };
type WaCache = {
  status: Awaited<ReturnType<typeof whatsappApi.status>>;
  conversations: Awaited<ReturnType<typeof whatsappApi.listConversations>>;
  contacts: Awaited<ReturnType<typeof whatsappApi.listContacts>>;
};
type GmailContact = { email: string; displayName?: string };

type CalendarCache = {
  events: Awaited<ReturnType<typeof calendarApi.listEvents>>['events'];
  recruiters: GmailContact[];
  contacts: GmailContact[];
};

let whatsappCache: WaCache | null = null;
let calendarCache: CalendarCache | null = null;
let formsCache: FormsCache | null = null;

export function getWhatsAppPrefetchCache(): WaCache | null {
  return whatsappCache;
}

export function getCalendarPrefetchCache(): CalendarCache | null {
  return calendarCache;
}

export function getFormsPrefetchCache(): FormsCache | null {
  return formsCache;
}

export function clearWorkspaceFeaturePrefetchCaches(): void {
  if (loginTimer) clearTimeout(loginTimer);
  loginTimer = null;
  loginChainAbort?.abort();
  loginChainAbort = null;
  loginRanForUser = null;
  cancelMailPrefetch();
  cancelDrivePrefetch();
  clearCallsListSessionCache();
  clearWhatsAppThreadCache();
  whatsappCache = null;
  calendarCache = null;
  formsCache = null;
}

async function prefetchWhatsApp(signal: AbortSignal, userId: string): Promise<void> {
  if (signal.aborted) return;
  try {
    const [status, conversations, contacts] = await Promise.all([
      whatsappApi.status(),
      whatsappApi.listConversations(),
      whatsappApi.listContacts(),
    ]);
    if (signal.aborted) return;
    whatsappCache = { status, conversations, contacts };
    const rows = (contacts.contacts ?? []).map((c) => ({
      peer_e164: c.peer_e164,
      name: c.name?.trim() ?? '',
    }));
    if (rows.length) await persistContactsCache(userId, rows);
    const peers = (conversations.conversations ?? []).map((c) => c.peer_e164);
    if (peers.length) {
      void prefetchWhatsAppThreads(userId, peers, { limit: 24 });
    }
  } catch {
    /* best-effort */
  }
}

async function prefetchCalendar(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  try {
    const now = new Date();
    const timeMin = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const timeMax = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString();
    const [eventsRes, contactsRes] = await Promise.all([
      calendarApi.listEvents(timeMin, timeMax),
      gmailApi.getContacts(),
    ]);
    const contacts = contactsRes.contacts ?? [];
    if (signal.aborted) return;
    calendarCache = {
      events: eventsRes.events ?? [],
      recruiters: contacts,
      contacts,
    };
  } catch {
    /* best-effort */
  }
}

async function prefetchForms(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  try {
    const data = await formsApi.list({ pageSize: 20 });
    if (signal.aborted) return;
    formsCache = { forms: data.forms ?? [], nextPageToken: data.nextPageToken };
  } catch {
    /* best-effort */
  }
}

async function runLoginPrefetchChainInternal(
  userId: string,
  access: FeaturePrefetchAccess,
  signal: AbortSignal
): Promise<void> {
  const writeGen = getCacheWriteGeneration();
  await Promise.all([
    warmMailListsThenThreadBodies(userId, {
      listConcurrency: 3,
      bodyConcurrency: 2,
      signal,
    }),
    prefetchDriveListViews({ concurrency: 2, signal }),
    access.calls ? prefetchCallsList(signal) : Promise.resolve(),
  ]);
  if (signal.aborted || writeGen !== getCacheWriteGeneration()) return;

  if (access.whatsapp) await prefetchWhatsApp(signal, userId);
  if (signal.aborted || writeGen !== getCacheWriteGeneration()) return;

  if (access.calendar) await prefetchCalendar(signal);
  if (signal.aborted || writeGen !== getCacheWriteGeneration()) return;

  if (access.forms) await prefetchForms(signal);
}

/**
 * Start calls + contacts warm immediately on login — do not wait for mailbox / mail prefetch.
 */
export function startEarlyCallsPrefetch(userId: string, callsEnabled: boolean): void {
  if (!callsEnabled) return;
  bindCallsPrefetchUser(userId);
  void prefetchCallsList();
  void prefetchWaContactsList(userId);
}

/**
 * After auth + mailbox ready, warm session caches once per login (200ms debounce).
 */
export function scheduleLoginPrefetchChain(
  userId: string,
  access: FeaturePrefetchAccess
): void {
  if (loginRanForUser === userId) return;

  if (loginTimer) clearTimeout(loginTimer);
  loginChainAbort?.abort();

  loginTimer = setTimeout(() => {
    loginTimer = null;
    loginRanForUser = userId;
    bindCallsPrefetchUser(userId);
    const controller = new AbortController();
    loginChainAbort = controller;
    void runLoginPrefetchChainInternal(userId, access, controller.signal).catch(() => {});
  }, LOGIN_DEBOUNCE_MS);
}
