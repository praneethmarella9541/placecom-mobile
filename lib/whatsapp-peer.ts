import { normalizePhone, phoneLookupVariants } from './phone';

/** Canonical E.164 for a WhatsApp contact (align with placecom/lib/whatsapp-peer.ts). */
export function canonicalWhatsAppPeer(raw: string): string {
  return normalizePhone(raw.trim());
}

/** Legacy rows stored as +{10-digit} instead of +91{10-digit}. */
export function legacyMisdialedPeerAliases(canonical: string): string[] {
  const n = canonicalWhatsAppPeer(canonical);
  if (!n.startsWith('+91') || n.length !== 13) return [];
  const local = n.slice(3);
  if (!/^[6-9]\d{9}$/.test(local)) return [];
  const mistaken = `+${local}`;
  return mistaken === n ? [] : [mistaken];
}

export function peerKeysForQuery(raw: string): string[] {
  const canonical = canonicalWhatsAppPeer(raw);
  if (!canonical) return [];
  const keys = [
    ...phoneLookupVariants(canonical),
    ...legacyMisdialedPeerAliases(canonical),
    canonical,
  ];
  return keys.filter((v, i, arr) => v && arr.indexOf(v) === i);
}
