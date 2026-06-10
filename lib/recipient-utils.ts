/** Extract bare email from `user@x.com` or `Name <user@x.com>`. */
export function extractEmailAddress(token: string): string {
  const trimmed = token.trim();
  const angle = /<([^<>@\s]+@[^<>@\s]+)>/.exec(trimmed);
  if (angle?.[1]) return angle[1].trim();
  return trimmed.replace(/^<|>$/g, '').trim();
}

export function parseRecipients(raw: string): string[] {
  return raw
    .split(/[,;\n]/)
    .map(extractEmailAddress)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isValidEmailAddress(value: string): boolean {
  const email = extractEmailAddress(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/** Strip RFC display-name wrappers so the To field stays sendable. */
export function normalizeRecipientField(raw: string): string {
  if (!raw.trim()) return '';
  return raw
    .split(/[,;]/)
    .map((part) => extractEmailAddress(part))
    .filter(Boolean)
    .join(', ');
}
