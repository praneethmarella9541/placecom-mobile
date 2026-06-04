/** Match placecom/lib/phone.ts — E.164 for Indian mobiles without +91 prefix. */
export function normalizePhone(raw: string): string {
  const cleaned = raw.replace(/[\s\-().]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('+')) return cleaned;
  if (/^\d{10}$/.test(cleaned)) return `+91${cleaned}`;
  if (/^0\d{10}$/.test(cleaned)) return `+91${cleaned.slice(1)}`;
  if (/^\d{11,14}$/.test(cleaned)) return `+${cleaned}`;
  return cleaned;
}

export function isValidE164(input: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(normalizePhone(input));
}
