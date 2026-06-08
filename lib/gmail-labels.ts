import type { GmailLabel } from './api';

/** Gmail UI names for system labels (search picker + chips). */
const SYSTEM_DISPLAY: Record<string, string> = {
  IMPORTANT: 'Important',
  STARRED: 'Starred',
  YELLOW_STAR: 'Starred',
  UNREAD: 'Unread',
  CHAT: 'Chats',
  SENT: 'Sent',
  INBOX: 'Inbox',
  DRAFT: 'Drafts',
  SPAM: 'Spam',
  TRASH: 'Trash',
  CATEGORY_PERSONAL: 'Personal',
  CATEGORY_SOCIAL: 'Social',
  CATEGORY_PROMOTIONS: 'Promotions',
  CATEGORY_UPDATES: 'Updates',
  CATEGORY_FORUMS: 'Forums',
};

/** Values for `label:` search operator (Gmail expects lowercase system names). */
const SYSTEM_SEARCH_VALUE: Record<string, string> = {
  IMPORTANT: 'important',
  STARRED: 'starred',
  YELLOW_STAR: 'starred',
  UNREAD: 'unread',
  CHAT: 'chat',
  SENT: 'sent',
  INBOX: 'inbox',
  DRAFT: 'draft',
  SPAM: 'spam',
  TRASH: 'trash',
};

const INTERNAL_SYSTEM_IDS = new Set([
  'INBOX',
  'SENT',
  'DRAFT',
  'SPAM',
  'TRASH',
  'UNREAD',
  'CHAT',
  'YELLOW_STAR',
]);

function looksLikeInternalId(value: string): boolean {
  return /^[A-Z0-9_]+$/.test(value) && value.includes('_');
}

function humanizeInternalName(raw: string): string {
  return raw
    .replace(/^CATEGORY_/i, '')
    .split('/')
    .map((segment) =>
      segment
        .split(/[_-]+/)
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ')
    )
    .join(' / ');
}

export function labelDisplayName(label: GmailLabel): string {
  if (label.type === 'user') return label.name;

  const mapped = SYSTEM_DISPLAY[label.id];
  if (mapped) return mapped;

  const name = label.name?.trim();
  if (name && name !== label.id) {
    if (looksLikeInternalId(name) || name.includes('_')) {
      return humanizeInternalName(name);
    }
    return name;
  }

  return humanizeInternalName(label.id);
}

/** Gmail `label:` operator value (user label name or system token). */
export function labelSearchValue(label: GmailLabel): string {
  if (label.type === 'user') return label.name;
  return SYSTEM_SEARCH_VALUE[label.id] ?? label.name.toLowerCase();
}

/** Labels shown in search / label picker — not folder or category internals. */
export function filterSearchableLabels(labels: GmailLabel[]): GmailLabel[] {
  const hasStarred = labels.some((l) => l.id === 'STARRED');
  const filtered = labels.filter((l) => {
    if (l.isCategory) return false;
    if (l.type === 'user') return true;
    if (!l.surfaced) return false;
    if (INTERNAL_SYSTEM_IDS.has(l.id)) return false;
    if (hasStarred && l.id === 'YELLOW_STAR') return false;
    return true;
  });

  return filtered.sort((a, b) =>
    labelDisplayName(a).localeCompare(labelDisplayName(b), undefined, { sensitivity: 'base' })
  );
}
