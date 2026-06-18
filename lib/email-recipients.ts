import { extractEmailAddress } from './recipient-utils';

/** Every plausible email in a header blob (web `email-recipients.ts`). */
export function extractAllEmailsFromText(text: string): string[] {
  const re = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi;
  const found = text.match(re);
  if (!found?.length) return [];
  return Array.from(new Set(found.map((e) => e.toLowerCase())));
}

export type RecipientChipData = {
  email: string;
  displayName?: string;
};

const EMAIL_LIKE = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;

/** Parse parent-controlled comma string into chips + trailing draft (web `RecipientField`). */
export function parseRecipientValue(raw: string): { chips: RecipientChipData[]; draft: string } {
  const s = raw.trim();
  if (!s) return { chips: [], draft: '' };
  const parts = s.split(',').map((p) => p.trim());
  const chips: RecipientChipData[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part) continue;
    const isLast = i === parts.length - 1;
    const extracted = extractEmailAddress(part).trim().toLowerCase();
    const looksComplete = extracted.includes('@') && EMAIL_LIKE.test(extracted);

    if (looksComplete) {
      chips.push({ email: extracted });
    } else if (isLast) {
      return { chips, draft: part };
    }
  }
  return { chips, draft: '' };
}

export function serializeRecipientValue(chips: RecipientChipData[], draft: string): string {
  const out: string[] = chips.map((c) => c.email);
  const d = draft.trim();
  if (d) out.push(d);
  return out.join(', ');
}

export function isCompleteEmailAddress(s: string): boolean {
  const t = extractEmailAddress(s).trim().toLowerCase();
  return t.includes('@') && EMAIL_LIKE.test(t);
}
