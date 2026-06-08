/** Gmail search operators — passed through to the backend / Gmail API as the search string. */

export type GmailFilterChipId =
  | 'label'
  | 'from'
  | 'to'
  | 'cc'
  | 'bcc'
  | 'subject'
  | 'attachment'
  | 'date'
  | 'is';

export type GmailFilterChipDef = {
  id: GmailFilterChipId;
  label: string;
};

/** Order matches Gmail mobile search (primary row + horizontal scroll). */
export const GMAIL_FILTER_CHIPS: GmailFilterChipDef[] = [
  { id: 'label', label: 'Label' },
  { id: 'from', label: 'From' },
  { id: 'to', label: 'To' },
  { id: 'attachment', label: 'Attachment' },
  { id: 'cc', label: 'Cc' },
  { id: 'bcc', label: 'Bcc' },
  { id: 'subject', label: 'Subject' },
  { id: 'date', label: 'Date' },
  { id: 'is', label: 'Is' },
];

export type AttachmentFilterValue =
  | 'has:attachment'
  | '-has:attachment'
  | 'has:drive'
  | 'has:youtube'
  | 'filename:pdf'
  | 'filename:doc'
  | 'filename:sheet'
  | 'filename:slide'
  | 'filename:image'
  | 'filename:video';

export const ATTACHMENT_FILTER_OPTIONS: { label: string; value: AttachmentFilterValue }[] = [
  { label: 'Has attachment', value: 'has:attachment' },
  { label: "Doesn't have attachment", value: '-has:attachment' },
  { label: 'Google Drive', value: 'has:drive' },
  { label: 'YouTube', value: 'has:youtube' },
  { label: 'Documents', value: 'filename:pdf' },
  { label: 'Spreadsheets', value: 'filename:sheet' },
  { label: 'Presentations', value: 'filename:slide' },
  { label: 'Images', value: 'filename:image' },
  { label: 'Videos', value: 'filename:video' },
];

export type DateFilterValue =
  | ''
  | 'newer_than:1d'
  | 'older_than:1d'
  | 'newer_than:7d'
  | 'older_than:7d'
  | 'newer_than:1m'
  | 'older_than:1m'
  | 'newer_than:1y'
  | 'older_than:1y';

export const DATE_FILTER_OPTIONS: { label: string; value: DateFilterValue }[] = [
  { label: 'Any time', value: '' },
  { label: 'Last 24 hours', value: 'newer_than:1d' },
  { label: 'Older than a day', value: 'older_than:1d' },
  { label: 'Last 7 days', value: 'newer_than:7d' },
  { label: 'Older than a week', value: 'older_than:7d' },
  { label: 'Last month', value: 'newer_than:1m' },
  { label: 'Older than a month', value: 'older_than:1m' },
  { label: 'Last year', value: 'newer_than:1y' },
  { label: 'Older than a year', value: 'older_than:1y' },
];

export type IsFilterValue = '' | 'is:unread' | 'is:read' | 'is:starred' | 'is:important';

export const IS_FILTER_OPTIONS: { label: string; value: IsFilterValue }[] = [
  { label: 'Any', value: '' },
  { label: 'Unread', value: 'is:unread' },
  { label: 'Read', value: 'is:read' },
  { label: 'Starred', value: 'is:starred' },
  { label: 'Important', value: 'is:important' },
];

const ATTACHMENT_TOKENS = ATTACHMENT_FILTER_OPTIONS.map((o) => o.value);

const DATE_TOKENS = DATE_FILTER_OPTIONS.map((o) => o.value).filter(Boolean);

const IS_TOKENS = IS_FILTER_OPTIONS.map((o) => o.value).filter(Boolean);

const OPERATOR_REGEX: Record<string, RegExp> = {
  from: /\bfrom:(?:"([^"]*)"|(\S+))/gi,
  to: /\bto:(?:"([^"]*)"|(\S+))/gi,
  cc: /\bcc:(?:"([^"]*)"|(\S+))/gi,
  bcc: /\bbcc:(?:"([^"]*)"|(\S+))/gi,
  subject: /\bsubject:(?:"([^"]*)"|(\S+))/gi,
  label: /\blabel:(?:"([^"]*)"|(\S+))/gi,
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Extract first value for a simple operator (from, to, cc, bcc, subject, label). */
export function getOperatorValue(search: string, op: keyof typeof OPERATOR_REGEX): string | null {
  const re = new RegExp(OPERATOR_REGEX[op].source, 'i');
  const m = re.exec(search);
  if (!m) return null;
  return (m[1] ?? m[2] ?? '').trim() || null;
}

export function removeOperator(search: string, op: keyof typeof OPERATOR_REGEX): string {
  return collapseSpaces(search.replace(OPERATOR_REGEX[op], ''));
}

export function setOperator(
  search: string,
  op: keyof typeof OPERATOR_REGEX,
  value: string | null
): string {
  let q = removeOperator(search, op);
  const v = value?.trim();
  if (!v) return q;
  const token = formatOperatorToken(op, v);
  return collapseSpaces(q ? `${q} ${token}` : token);
}

function formatOperatorToken(op: string, value: string): string {
  const needsQuotes = /[\s:"]/.test(value);
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const formatted = needsQuotes ? `${op}:"${escaped}"` : `${op}:${value}`;
  return formatted;
}

export function labelSearchToken(labelName: string): string {
  return formatOperatorToken('label', labelName.trim());
}

function removeTokens(search: string, tokens: string[]): string {
  let q = search;
  for (const t of tokens) {
    const re = new RegExp(`\\b${escapeRegex(t)}\\b`, 'gi');
    q = q.replace(re, '');
  }
  return collapseSpaces(q);
}

export function getAttachmentFilter(search: string): AttachmentFilterValue | null {
  for (const t of ATTACHMENT_TOKENS) {
    if (new RegExp(`\\b${escapeRegex(t)}\\b`, 'i').test(search)) return t;
  }
  return null;
}

export function setAttachmentFilter(search: string, value: AttachmentFilterValue | null): string {
  let q = removeTokens(search, ATTACHMENT_TOKENS);
  if (value) q = collapseSpaces(q ? `${q} ${value}` : value);
  return q;
}

export function getDateFilter(search: string): DateFilterValue | null {
  for (const t of DATE_TOKENS) {
    if (new RegExp(`\\b${escapeRegex(t)}\\b`, 'i').test(search)) return t as DateFilterValue;
  }
  return null;
}

export function setDateFilter(search: string, value: DateFilterValue): string {
  let q = removeTokens(search, DATE_TOKENS);
  if (value) q = collapseSpaces(q ? `${q} ${value}` : value);
  return q;
}

export function getIsFilter(search: string): IsFilterValue | null {
  for (const t of IS_TOKENS) {
    if (new RegExp(`\\b${escapeRegex(t)}\\b`, 'i').test(search)) return t as IsFilterValue;
  }
  return null;
}

export function setIsFilter(search: string, value: IsFilterValue): string {
  let q = removeTokens(search, IS_TOKENS);
  if (value) q = collapseSpaces(q ? `${q} ${value}` : value);
  return q;
}

export function isFilterChipActive(search: string, chipId: GmailFilterChipId): boolean {
  switch (chipId) {
    case 'label':
      return /\blabel:/i.test(search);
    case 'from':
      return /\bfrom:/i.test(search);
    case 'to':
      return /\bto:/i.test(search);
    case 'cc':
      return /\bcc:/i.test(search);
    case 'bcc':
      return /\bbcc:/i.test(search);
    case 'subject':
      return /\bsubject:/i.test(search);
    case 'attachment':
      return ATTACHMENT_TOKENS.some((t) => new RegExp(`\\b${escapeRegex(t)}\\b`, 'i').test(search));
    case 'date':
      return DATE_TOKENS.some((t) => new RegExp(`\\b${escapeRegex(t)}\\b`, 'i').test(search));
    case 'is':
      return IS_TOKENS.some((t) => new RegExp(`\\b${escapeRegex(t)}\\b`, 'i').test(search));
    default:
      return false;
  }
}

/** Parse `"Name" <email@x.com>` or plain email from a thread From header. */
export function parseEmailAddress(raw: string): { email: string; displayName?: string } {
  const trimmed = raw.trim();
  const angle = trimmed.match(/<([^>]+)>/);
  if (angle) {
    const email = angle[1]!.trim();
    const name = trimmed.replace(/<[^>]+>/, '').replace(/^["']|["']$/g, '').trim();
    return { email, displayName: name || undefined };
  }
  return { email: trimmed };
}

export function formatContactToken(op: 'from' | 'to' | 'cc' | 'bcc', email: string): string {
  return formatOperatorToken(op, email.trim());
}

/** @deprecated Use setOperator — kept for any legacy callers. */
export function appendSearchOperator(current: string, token: string): string {
  const t = token.trim();
  if (!t) return current;
  const base = current.trimEnd();
  if (!base) return t.endsWith(':') ? t : `${t} `;
  if (base.endsWith(t) || base.includes(` ${t}`)) return `${base} `;
  return `${base} ${t}`;
}
