import type { GmailFolder } from './api';
import type { LabelCount } from './gmail-label-counts';

/** Mailbox views — matches Placecom web sidebar folders. */
export type MailViewKey =
  | 'inbox'
  | 'starred'
  | 'important'
  | 'sent'
  | 'drafts'
  | 'allmail'
  | 'spam'
  | 'trash';

export type CategoryKey = 'primary' | 'promotions' | 'social' | 'updates' | 'forums';

export const CATEGORY_LABEL: Record<CategoryKey, string> = {
  primary: 'CATEGORY_PERSONAL',
  promotions: 'CATEGORY_PROMOTIONS',
  social: 'CATEGORY_SOCIAL',
  updates: 'CATEGORY_UPDATES',
  forums: 'CATEGORY_FORUMS',
};

export const CATEGORIES: { key: CategoryKey; label: string }[] = [
  { key: 'primary', label: 'Primary' },
  { key: 'promotions', label: 'Promotions' },
  { key: 'social', label: 'Social' },
  { key: 'updates', label: 'Updates' },
  { key: 'forums', label: 'Forums' },
];

export const MAILBOX_VIEWS: {
  key: MailViewKey;
  label: string;
  icon:
    | 'mail-outline'
    | 'star-outline'
    | 'alert-circle-outline'
    | 'send-outline'
    | 'document-text-outline'
    | 'mail-open-outline'
    | 'warning-outline'
    | 'trash-outline';
  badgeLabelId: string;
}[] = [
  { key: 'inbox', label: 'Inbox', icon: 'mail-outline', badgeLabelId: 'INBOX' },
  { key: 'starred', label: 'Starred', icon: 'star-outline', badgeLabelId: 'STARRED' },
  { key: 'important', label: 'Important', icon: 'alert-circle-outline', badgeLabelId: 'IMPORTANT' },
  { key: 'sent', label: 'Sent', icon: 'send-outline', badgeLabelId: 'SENT' },
  { key: 'drafts', label: 'Drafts', icon: 'document-text-outline', badgeLabelId: 'DRAFT' },
  { key: 'allmail', label: 'All mail', icon: 'mail-open-outline', badgeLabelId: '' },
  { key: 'spam', label: 'Spam', icon: 'warning-outline', badgeLabelId: 'SPAM' },
  { key: 'trash', label: 'Trash', icon: 'trash-outline', badgeLabelId: 'TRASH' },
];

export function mailViewLabel(key: MailViewKey): string {
  return MAILBOX_VIEWS.find((v) => v.key === key)?.label ?? 'Inbox';
}

/** Map UI mailbox to Gmail API folder + optional label filter (web parity). */
export function resolveMailListQuery(
  mailView: MailViewKey,
  category: CategoryKey,
  filterLabelId: string | null
): { apiFolder: GmailFolder; effectiveLabelId: string | null } {
  if (mailView === 'starred') {
    return { apiFolder: 'inbox', effectiveLabelId: 'STARRED' };
  }
  if (mailView === 'important') {
    return { apiFolder: 'inbox', effectiveLabelId: 'IMPORTANT' };
  }
  if (mailView === 'sent') return { apiFolder: 'sent', effectiveLabelId: null };
  if (mailView === 'drafts') return { apiFolder: 'drafts', effectiveLabelId: null };
  if (mailView === 'trash') return { apiFolder: 'trash', effectiveLabelId: null };
  if (mailView === 'spam') return { apiFolder: 'spam', effectiveLabelId: null };
  if (mailView === 'allmail') return { apiFolder: 'allmail', effectiveLabelId: null };

  return {
    apiFolder: 'inbox',
    effectiveLabelId: filterLabelId ?? CATEGORY_LABEL[category],
  };
}

export function mailViewBadgeCount(
  key: MailViewKey,
  counts: Record<string, LabelCount>
): number | null {
  const spec = MAILBOX_VIEWS.find((v) => v.key === key);
  if (!spec?.badgeLabelId) return null;
  const c = counts[spec.badgeLabelId];
  if (!c) return null;

  if (key === 'inbox') {
    return c.unread > 0 ? c.unread : null;
  }
  if (key === 'starred' || key === 'important') {
    return c.total > 0 ? c.total : null;
  }
  return c.total > 0 ? c.total : null;
}
