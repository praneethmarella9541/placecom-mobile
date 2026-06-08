import type { GmailFolder, GmailThreadListItem } from './api';
import { parseEmailAddress } from './gmail-search';

export type CorrespondentStats = {
  email: string;
  displayName?: string;
  count: number;
  latest: number;
  /** Higher when seen as a sender in inbox; used for From suggestions. */
  inboxCount: number;
  /** Higher when seen on sent threads; used for To suggestions. */
  sentCount: number;
};

const byEmail = new Map<string, CorrespondentStats>();

function upsert(
  parsed: { email: string; displayName?: string },
  latest: number,
  field: 'inboxCount' | 'sentCount'
) {
  if (!parsed.email?.includes('@')) return;
  const key = parsed.email.toLowerCase();
  const row = byEmail.get(key);
  if (row) {
    row.count += 1;
    row[field] += 1;
    if (latest > row.latest) row.latest = latest;
    if (parsed.displayName && !row.displayName) row.displayName = parsed.displayName;
  } else {
    byEmail.set(key, {
      email: parsed.email,
      displayName: parsed.displayName,
      count: 1,
      latest,
      inboxCount: field === 'inboxCount' ? 1 : 0,
      sentCount: field === 'sentCount' ? 1 : 0,
    });
  }
}

/** Accumulate senders / recipients from loaded thread pages (session memory). */
export function ingestCorrespondentThreads(
  threads: GmailThreadListItem[],
  folder: GmailFolder
) {
  const field = folder === 'sent' ? 'sentCount' : 'inboxCount';
  for (const thread of threads) {
    const parsed = parseEmailAddress(thread.from);
    const latest = Date.parse(thread.date) || 0;
    upsert(parsed, latest, field);
  }
}

export function getCorrespondentStats(email: string): CorrespondentStats | undefined {
  return byEmail.get(email.trim().toLowerCase());
}

/** Ranked by interaction frequency + recency (Gmail-style, not A–Z). */
export function listCorrespondentsByRank(
  prefer: 'inbox' | 'sent' | 'any',
  limit = 50
): CorrespondentStats[] {
  const rows = [...byEmail.values()];
  rows.sort((a, b) => {
    const aPref =
      prefer === 'inbox' ? a.inboxCount : prefer === 'sent' ? a.sentCount : a.count;
    const bPref =
      prefer === 'inbox' ? b.inboxCount : prefer === 'sent' ? b.sentCount : b.count;
    if (bPref !== aPref) return bPref - aPref;
    if (b.count !== a.count) return b.count - a.count;
    return b.latest - a.latest;
  });
  return rows.slice(0, limit);
}

export function statsToContact(s: CorrespondentStats): {
  email: string;
  displayName?: string;
} {
  return { email: s.email, displayName: s.displayName };
}
