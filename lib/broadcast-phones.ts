/** Client-side phone normalization for broadcast recipient lists. */

export function normalizeToE164(input: string): string | null {
  let t = input.trim();
  t = t.replace(/^whatsapp:/i, '').replace(/[\s()-]/g, '');
  if (t.startsWith('00')) t = `+${t.slice(2)}`;
  if (!t.startsWith('+')) {
    const digits = t.replace(/\D/g, '');
    if (digits.length === 10) t = `+1${digits}`;
    else if (digits.length >= 8 && digits.length <= 15) t = `+${digits}`;
    else return null;
  }
  const digits = t.slice(1).replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

export function normalizePhoneList(raw: string): string[] {
  const parts = raw
    .split(/[\n,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const n = normalizeToE164(p);
    if (n) out.push(n);
  }
  return Array.from(new Set(out));
}
