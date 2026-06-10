import { calendarApi, formsApi, gmailApi, whatsappApi } from './api';
import { prefetchMailListViews, cancelMailPrefetch } from './inbox-list-prefetch';
import { prefetchDriveListViews, cancelDrivePrefetch } from './drive-list-prefetch';
import { getCacheWriteGeneration } from './session-cache-core';

const LOGIN_DEBOUNCE_MS = 200;

let loginTimer: ReturnType<typeof setTimeout> | null = null;
let loginChainAbort: AbortController | null = null;
let loginRanForUser: string | null = null;

export type FeaturePrefetchAccess = {
  whatsapp?: boolean;
  calendar?: boolean;
  forms?: boolean;
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
  whatsappCache = null;
  calendarCache = null;
  formsCache = null;
}

async function prefetchWhatsApp(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;
  try {
    const [status, conversations, contacts] = await Promise.all([
      whatsappApi.status(),
      whatsappApi.listConversations(),
      whatsappApi.listContacts(),
    ]);
    if (signal.aborted) return;
    whatsappCache = { status, conversations, contacts };
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
  access: FeaturePrefetchAccess,
  signal: AbortSignal
): Promise<void> {
  const writeGen = getCacheWriteGeneration();
  await Promise.all([
    prefetchMailListViews({ concurrency: 3, signal }),
    prefetchDriveListViews({ concurrency: 2, signal }),
  ]);
  if (signal.aborted || writeGen !== getCacheWriteGeneration()) return;

  if (access.whatsapp) await prefetchWhatsApp(signal);
  if (signal.aborted || writeGen !== getCacheWriteGeneration()) return;

  if (access.calendar) await prefetchCalendar(signal);
  if (signal.aborted || writeGen !== getCacheWriteGeneration()) return;

  if (access.forms) await prefetchForms(signal);
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
    const controller = new AbortController();
    loginChainAbort = controller;
    void runLoginPrefetchChainInternal(access, controller.signal).catch(() => {});
  }, LOGIN_DEBOUNCE_MS);
}
