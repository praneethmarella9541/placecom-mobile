import type { GmailThreadListItem } from './api';
import {
  getCorrespondentStats,
  listCorrespondentsByRank,
  statsToContact,
  type CorrespondentStats,
} from './correspondent-rank';
import { parseEmailAddress } from './gmail-search';

export type Contact = { email: string; displayName?: string };

export type ContactOperator = 'from' | 'to' | 'cc' | 'bcc';

const EMPTY_SUGGESTION_LIMIT = 25;
const QUERY_SUGGESTION_LIMIT = 50;

function contactKey(c: Contact): string {
  return c.email.trim().toLowerCase();
}

function matchesQuery(c: Contact, q: string): boolean {
  const email = c.email.toLowerCase();
  const name = (c.displayName ?? '').toLowerCase();
  return email.includes(q) || name.includes(q);
}

/** Senders in a thread page, most frequent / recent first. */
export function rankSendersFromThreads(threads: GmailThreadListItem[]): Contact[] {
  const byEmail = new Map<
    string,
    { contact: Contact; count: number; latest: number }
  >();

  for (const thread of threads) {
    const parsed = parseEmailAddress(thread.from);
    if (!parsed.email?.includes('@')) continue;
    const key = parsed.email.toLowerCase();
    const latest = Date.parse(thread.date) || 0;
    const row = byEmail.get(key);
    if (row) {
      row.count += 1;
      if (latest > row.latest) row.latest = latest;
    } else {
      byEmail.set(key, {
        contact: { email: parsed.email, displayName: parsed.displayName },
        count: 1,
        latest,
      });
    }
  }

  return [...byEmail.values()]
    .sort((a, b) => b.count - a.count || b.latest - a.latest)
    .map((r) => r.contact);
}

function rankPreference(operator: ContactOperator): 'inbox' | 'sent' | 'any' {
  if (operator === 'from') return 'inbox';
  if (operator === 'to' || operator === 'cc' || operator === 'bcc') return 'sent';
  return 'any';
}

function scoreContact(
  c: Contact,
  q: string,
  operator: ContactOperator,
  threadRanked: Contact[],
  apiIndex: number,
  stats?: CorrespondentStats
): number {
  let score = 0;
  const key = contactKey(c);

  if (stats) {
    const pref =
      operator === 'from'
        ? stats.inboxCount
        : operator === 'to' || operator === 'cc' || operator === 'bcc'
          ? stats.sentCount
          : stats.count;
    score += pref * 2_000 + stats.count * 200;
    score += Math.floor(stats.latest / 1_000_000_000);
  }

  const threadIndex = threadRanked.findIndex((t) => contactKey(t) === key);
  if (threadIndex >= 0) {
    score += 15_000 - threadIndex * 25;
  }

  if (apiIndex >= 0) {
    score += Math.max(0, 800 - apiIndex * 4);
  }

  if (!q) return score;

  const email = c.email.toLowerCase();
  const name = (c.displayName ?? '').toLowerCase();
  if (email.startsWith(q)) score += 8_000;
  else if (email.includes(q)) score += 3_000;
  if (name.startsWith(q)) score += 7_000;
  else if (name.includes(q)) score += 2_500;

  return score;
}

function mergeUnique(...lists: Contact[][]): Contact[] {
  const seen = new Set<string>();
  const out: Contact[] = [];
  for (const list of lists) {
    for (const c of list) {
      const k = contactKey(c);
      if (!k || !k.includes('@') || seen.has(k)) continue;
      seen.add(k);
      out.push(c);
    }
  }
  return out;
}

function buildThreadRanked(
  operator: ContactOperator,
  inboxThreads: GmailThreadListItem[],
  sentThreads: GmailThreadListItem[]
): Contact[] {
  if (operator === 'from') {
    return rankSendersFromThreads(inboxThreads);
  }
  return mergeUnique(
    rankSendersFromThreads(sentThreads),
    rankSendersFromThreads(inboxThreads)
  );
}

/**
 * Rank contacts for From/To/Cc/Bcc search chips (frequency + recency, like Gmail).
 */
export function suggestContactsForOperator(opts: {
  operator: ContactOperator;
  query: string;
  apiContacts: Contact[];
  threads: GmailThreadListItem[];
  sentThreads?: GmailThreadListItem[];
}): Contact[] {
  const q = opts.query.trim().toLowerCase();
  const prefer = rankPreference(opts.operator);
  const threadRanked = buildThreadRanked(
    opts.operator,
    opts.threads,
    opts.sentThreads ?? []
  );

  const rankedFromHistory = listCorrespondentsByRank(prefer, 80).map(statsToContact);

  const apiIndex = new Map<string, number>();
  opts.apiContacts.forEach((c, i) => apiIndex.set(contactKey(c), i));

  const pool = mergeUnique(threadRanked, rankedFromHistory, opts.apiContacts);
  const filtered = q ? pool.filter((c) => matchesQuery(c, q)) : pool;

  const ranked = filtered
    .map((c) => ({
      c,
      score: scoreContact(
        c,
        q,
        opts.operator,
        threadRanked,
        apiIndex.get(contactKey(c)) ?? -1,
        getCorrespondentStats(c.email)
      ),
    }))
    .sort((a, b) => b.score - a.score);

  const limit = q ? QUERY_SUGGESTION_LIMIT : EMPTY_SUGGESTION_LIMIT;
  return ranked.slice(0, limit).map((r) => r.c);
}
