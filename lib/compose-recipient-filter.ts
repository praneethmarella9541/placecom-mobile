import type { Contact } from './gmail-contact-suggestions';

/** Web `RecipientField` match — substring on name/email; prefix matches rank higher. */
export function matchesRecipientQuery(s: Contact, q: string): boolean {
  const em = s.email.toLowerCase();
  const name = (s.displayName ?? '').toLowerCase();
  const local = em.split('@')[0] || '';
  return (
    local.startsWith(q) ||
    em.startsWith(q) ||
    name.startsWith(q) ||
    name.split(/\s+/).some((w) => w.startsWith(q)) ||
    em.includes(q) ||
    name.includes(q)
  );
}

function recipientQueryScore(s: Contact, q: string): number {
  const em = s.email.toLowerCase();
  const name = (s.displayName ?? '').toLowerCase();
  const local = em.split('@')[0] || '';
  if (local.startsWith(q)) return 500;
  if (em.startsWith(q)) return 450;
  if (name.startsWith(q)) return 400;
  if (name.split(/\s+/).some((w) => w.startsWith(q))) return 350;
  if (name.includes(q)) return 200;
  if (em.includes(q)) return 100;
  return 0;
}

/** Filter compose suggestions for the active draft token (web `RecipientField` + prefix boost). */
export function filterComposeRecipientSuggestions(
  suggestions: Contact[],
  draft: string,
  limit = 10
): Contact[] {
  const q = draft.trim().toLowerCase();
  if (!q) return [];

  return suggestions
    .filter((s) => matchesRecipientQuery(s, q))
    .sort((a, b) => recipientQueryScore(b, q) - recipientQueryScore(a, q))
    .slice(0, limit);
}
