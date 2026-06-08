import type { GmailFolder } from './api';

/** Same host as other direct Gmail calls in this app. */
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';

export type LabelCount = {
  total: number;
  unread: number;
};

type GmailLabelRow = {
  id: string;
  messagesTotal?: number;
  messagesUnread?: number;
  threadsTotal?: number;
  threadsUnread?: number;
};

const MAILBOX_LABEL_IDS = ['INBOX', 'SENT', 'DRAFT'] as const;

const FOLDER_LABEL_ID: Record<GmailFolder, string> = {
  inbox: 'INBOX',
  sent: 'SENT',
  drafts: 'DRAFT',
};

/** Map backend / alias keys to Gmail label ids. */
const LABEL_KEY_ALIASES: Record<string, string> = {
  inbox: 'INBOX',
  sent: 'SENT',
  drafts: 'DRAFT',
  draft: 'DRAFT',
  DRAFTS: 'DRAFT',
};

function rowToCount(row: GmailLabelRow): LabelCount {
  return {
    total: row.threadsTotal ?? row.messagesTotal ?? 0,
    unread: row.threadsUnread ?? row.messagesUnread ?? 0,
  };
}

function rowHasCounts(row: GmailLabelRow): boolean {
  return (
    row.threadsTotal != null ||
    row.messagesTotal != null ||
    row.threadsUnread != null ||
    row.messagesUnread != null
  );
}

function mergeLabelCounts(
  base: Record<string, LabelCount>,
  patch: Record<string, LabelCount>
): Record<string, LabelCount> {
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const labelId = LABEL_KEY_ALIASES[key] ?? key;
    const prev = out[labelId];
    if (!prev) {
      out[labelId] = value;
      continue;
    }
    out[labelId] = {
      total: Math.max(prev.total, value.total),
      unread: Math.max(prev.unread, value.unread),
    };
  }
  return out;
}

async function gmailFetch(accessToken: string, path: string): Promise<Response> {
  return fetch(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

async function fetchGmailLabelById(
  accessToken: string,
  labelId: string
): Promise<LabelCount | null> {
  const res = await gmailFetch(accessToken, `/labels/${encodeURIComponent(labelId)}`);
  if (!res.ok) return null;
  const row = (await res.json()) as GmailLabelRow;
  if (!rowHasCounts(row)) return null;
  return rowToCount(row);
}

/** Label thread/message totals from Gmail API (matches Gmail app badges). */
export async function fetchGmailLabelCounts(
  accessToken: string
): Promise<Record<string, LabelCount>> {
  const res = await gmailFetch(accessToken, '/labels');
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Gmail labels failed (${res.status})${text ? `: ${text.slice(0, 120)}` : ''}`);
  }

  const data = (await res.json()) as { labels?: GmailLabelRow[] };
  const out: Record<string, LabelCount> = {};
  const sparseIds: string[] = [];
  const mailboxIds = new Set<string>(MAILBOX_LABEL_IDS);

  for (const row of data.labels ?? []) {
    if (!rowHasCounts(row)) {
      if (mailboxIds.has(row.id)) {
        sparseIds.push(row.id);
      }
      continue;
    }
    out[row.id] = rowToCount(row);
  }

  if (sparseIds.length > 0) {
    const filled = await Promise.all(
      sparseIds.map(async (id) => {
        const count = await fetchGmailLabelById(accessToken, id);
        return count ? ([id, count] as const) : null;
      })
    );
    for (const entry of filled) {
      if (entry) out[entry[0]] = entry[1];
    }
  }

  for (const id of MAILBOX_LABEL_IDS) {
    if (!out[id]) {
      const count = await fetchGmailLabelById(accessToken, id);
      if (count) out[id] = count;
    }
  }

  return out;
}

export type MailboxCountsLoader = {
  getGoogleToken: () => Promise<{ accessToken: string }>;
  folderCounts: (ids: string[]) => Promise<{ counts?: Record<string, LabelCount> }>;
  extraLabelIds?: string[];
};

/** Backend + direct Gmail, merged — keeps Inbox/Sent/Drafts in sync with Gmail. */
export async function loadMailboxLabelCounts(
  loader: MailboxCountsLoader
): Promise<Record<string, LabelCount>> {
  const mailboxIds = new Set<string>(MAILBOX_LABEL_IDS);
  const ids = [
    ...MAILBOX_LABEL_IDS,
    ...(loader.extraLabelIds ?? []).filter((id) => !mailboxIds.has(id)),
  ];

  let merged: Record<string, LabelCount> = {};

  const backend = await loader.folderCounts(ids).catch(() => null);
  if (backend?.counts) {
    merged = mergeLabelCounts(merged, backend.counts);
  }

  try {
    const { accessToken } = await loader.getGoogleToken();
    const direct = await fetchGmailLabelCounts(accessToken);
    merged = mergeLabelCounts(merged, direct);
  } catch {
    /* direct Gmail optional when backend succeeded */
  }

  return merged;
}

/** Badge for Inbox / Sent / Drafts — unread on Inbox, totals on Sent & Drafts. */
export function folderSegmentBadge(
  folder: GmailFolder,
  counts: Record<string, LabelCount>
): number | null {
  const c = counts[FOLDER_LABEL_ID[folder]];
  if (!c) return null;

  if (folder === 'inbox') {
    return c.unread > 0 ? c.unread : null;
  }
  return c.total > 0 ? c.total : null;
}
