import type { GmailMessage, GmailThreadListItem } from './api';
import { gmailApi, recruitersApi } from './api';
import type { Contact } from './gmail-contact-suggestions';
import { extractAllEmailsFromText } from './email-recipients';
import { currentRecipientToken } from './recipient-utils';
import { getCalendarPrefetchCache } from './workspace-feature-prefetch';

export type { Contact };

/** Web MailSearchBar debounce for `/api/gmail/search/suggest`. */
export const CONTACT_SEARCH_DEBOUNCE_MS = 180;
export const COMPOSE_SUGGESTION_LIMIT = 10;

let recipientList: Contact[] = [];
let googleContactsCache: Contact[] = [];
let recruitersCache: Array<{ email: string; name: string }> = [];
let contactsHint: string | null = null;
let sessionLoaded = false;
let loadPromise: Promise<{ contacts: Contact[]; hint: string | null }> | null = null;

const contactsLoadedListeners = new Set<() => void>();

function notifyComposeContactsLoaded(): void {
  for (const fn of contactsLoadedListeners) fn();
}

export function subscribeComposeContactsLoaded(listener: () => void): () => void {
  contactsLoadedListeners.add(listener);
  return () => contactsLoadedListeners.delete(listener);
}

export function getGoogleContactsCache(): Contact[] {
  return googleContactsCache;
}

export function getRecruitersCache(): Array<{ email: string; name: string }> {
  return recruitersCache;
}

const threadDerivedEmails = new Set<string>();
const threadDerivedListeners = new Set<() => void>();

function notifyThreadDerivedListeners(): void {
  for (const fn of threadDerivedListeners) fn();
}

export function subscribeThreadDerivedEmails(listener: () => void): () => void {
  threadDerivedListeners.add(listener);
  return () => threadDerivedListeners.delete(listener);
}

export function getThreadDerivedEmailSet(): ReadonlySet<string> {
  return threadDerivedEmails;
}

/** Emails from loaded thread list rows (web `threadDerivedEmails` — from headers). */
export function ingestThreadDerivedEmails(threads: GmailThreadListItem[]): void {
  let changed = false;
  for (const t of threads) {
    for (const e of extractAllEmailsFromText(t.from)) {
      if (!threadDerivedEmails.has(e)) {
        threadDerivedEmails.add(e);
        changed = true;
      }
    }
  }
  if (changed) notifyThreadDerivedListeners();
}

/** Emails from an open thread's messages (web adds from/to when a thread is selected). */
export function ingestThreadDerivedFromMessages(messages: GmailMessage[]): void {
  let changed = false;
  for (const m of messages) {
    for (const e of extractAllEmailsFromText(m.from)) {
      if (!threadDerivedEmails.has(e)) {
        threadDerivedEmails.add(e);
        changed = true;
      }
    }
    for (const e of extractAllEmailsFromText(m.to)) {
      if (!threadDerivedEmails.has(e)) {
        threadDerivedEmails.add(e);
        changed = true;
      }
    }
  }
  if (changed) notifyThreadDerivedListeners();
}

/**
 * Web `composeRecipientSuggestions` — Google contacts, recruiters, then thread emails.
 */
export function buildComposeRecipientSuggestions(
  googleContacts: Contact[],
  recruiters: Array<{ email: string; name: string }>,
  threadEmails: Iterable<string> = threadDerivedEmails
): Contact[] {
  const map = new Map<string, string>();

  for (const c of googleContacts) {
    const em = c.email?.trim().toLowerCase();
    if (em) map.set(em, c.displayName?.trim() || em);
  }

  for (const r of recruiters) {
    const em = r.email?.trim().toLowerCase();
    if (em && !map.has(em)) map.set(em, r.name?.trim() || em);
  }

  for (const raw of threadEmails) {
    const em = raw.trim().toLowerCase();
    if (em && !map.has(em)) map.set(em, em);
  }

  return Array.from(map.entries()).map(([email, label]) => ({
    email,
    displayName: label !== email ? label : undefined,
  }));
}

function mergeContacts(...lists: Contact[][]): Contact[] {
  const seen = new Set<string>();
  const out: Contact[] = [];
  for (const list of lists) {
    for (const c of list) {
      const k = c.email.trim().toLowerCase();
      if (!k || !k.includes('@') || seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
  }
  return out;
}

function contactMatchesQuery(c: Contact, q: string): boolean {
  const em = c.email.toLowerCase();
  const name = (c.displayName ?? '').toLowerCase();
  return em.includes(q) || name.includes(q);
}

export function peekComposeContactsCache(): Contact[] {
  return getComposeRecipientSuggestions();
}

export function getComposeRecipientSuggestions(): Contact[] {
  if (sessionLoaded || googleContactsCache.length > 0 || recruitersCache.length > 0) {
    return buildComposeRecipientSuggestions(googleContactsCache, recruitersCache);
  }
  if (recipientList.length) return recipientList;
  return getCalendarPrefetchCache()?.contacts ?? [];
}

export function peekContactsHint(): string | null {
  return contactsHint;
}

/**
 * Compose — fetch ONCE per session when compose/filter opens (web inbox/page.tsx):
 * `GET /api/recruiters` + `GET /api/gmail/contacts`, merged with thread emails client-side.
 */
export async function loadRecipientSuggestions(
  force = false
): Promise<{ contacts: Contact[]; hint: string | null }> {
  if (!force && sessionLoaded) {
    return { contacts: getComposeRecipientSuggestions(), hint: contactsHint };
  }
  if (!force && loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const [recruitersRes, contactsRes] = await Promise.all([
        recruitersApi.list().catch(() => ({ recruiters: [] as Array<{ email: string; name: string }> })),
        gmailApi.getContacts(),
      ]);

      const hint =
        typeof contactsRes.hint === 'string' && contactsRes.hint.trim()
          ? contactsRes.hint.trim()
          : null;

      googleContactsCache = contactsRes.contacts ?? [];
      recruitersCache = recruitersRes.recruiters ?? [];
      recipientList = buildComposeRecipientSuggestions(googleContactsCache, recruitersCache);
      contactsHint = hint;
      sessionLoaded = true;
      notifyComposeContactsLoaded();

      if (!recipientList.length) {
        const prefetched = getCalendarPrefetchCache()?.contacts ?? [];
        if (prefetched.length) recipientList = prefetched;
      }
    } catch {
      if (!sessionLoaded) {
        recipientList = getCalendarPrefetchCache()?.contacts ?? [];
        contactsHint = null;
      }
    } finally {
      loadPromise = null;
    }

    return { contacts: getComposeRecipientSuggestions(), hint: contactsHint };
  })();

  return loadPromise;
}

/** @deprecated Use loadRecipientSuggestions */
export async function loadComposeContacts(force = false): Promise<Contact[]> {
  const { contacts } = await loadRecipientSuggestions(force);
  return contacts;
}

export function clearComposeContactsCache(): void {
  recipientList = [];
  googleContactsCache = [];
  recruitersCache = [];
  contactsHint = null;
  sessionLoaded = false;
  loadPromise = null;
  threadDerivedEmails.clear();
}

/**
 * Compose / calendar — mirrors web `RecipientField` (local filter only, no API per keystroke).
 */
export function filterRecipientSuggestions(
  contacts: Contact[],
  raw: string,
  limit = COMPOSE_SUGGESTION_LIMIT
): Contact[] {
  const q = currentRecipientToken(raw).trim().toLowerCase();
  if (!q) return [];

  const matches: Contact[] = [];
  for (const c of contacts) {
    if (!contactMatchesQuery(c, q)) continue;
    matches.push(c);
    if (matches.length >= limit) break;
  }
  return matches;
}

function filterContactsByQuery(contacts: Contact[], query: string, limit: number): Contact[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const matches: Contact[] = [];
  for (const c of contacts) {
    if (!contactMatchesQuery(c, q)) continue;
    matches.push(c);
    if (matches.length >= limit) break;
  }
  return matches;
}

/**
 * Mail search From/To chips — mirrors web `MailSearchBar`:
 * local hits + debounced `GET /api/gmail/search/suggest?q=`.
 */
export async function resolveSearchContactSuggestions(
  query: string,
  baseContacts: Contact[],
  limit = 6
): Promise<Contact[]> {
  const q = query.trim();
  if (!q) return [];

  const localHits = filterContactsByQuery(baseContacts, q, 4);
  let remote: Contact[] = [];

  try {
    const res = await gmailApi.searchSuggest(q);
    remote = res.contacts ?? [];
  } catch {
    /* local-only fallback */
  }

  return mergeContacts(remote, localHits).slice(0, limit);
}
