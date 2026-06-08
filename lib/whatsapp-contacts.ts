import { normalizePhone, phoneMatches } from './phone';
import { canonicalWhatsAppPeer } from './whatsapp-peer';
import { displayNameForPeer, formatWhatsAppPhone } from './whatsapp-utils';
import type { WhatsAppConversation } from './whatsapp-types';

export type SavedContact = { peer_e164: string; name: string };

/** Best E.164 for display/storage when the same mobile was saved under legacy keys. */
export function preferContactPeer(a: string, b: string): string {
  const ca = canonicalWhatsAppPeer(a) || a;
  const cb = canonicalWhatsAppPeer(b) || b;
  if (/^\+91[6-9]\d{9}$/.test(ca)) return ca;
  if (/^\+91[6-9]\d{9}$/.test(cb)) return cb;
  if (ca.startsWith('+') && !cb.startsWith('+')) return ca;
  if (cb.startsWith('+') && !ca.startsWith('+')) return cb;
  return ca.length >= cb.length ? ca : cb;
}

/** Stable id for the same mobile across +91 / 10-digit / legacy +{local} storage. */
export function contactGroupId(peer: string): string {
  const n = normalizePhone(peer);
  if (!n) return peer.trim();
  const digits = n.replace(/\D/g, '');
  if (digits.length >= 10) {
    const last10 = digits.slice(-10);
    if (/^[6-9]\d{9}$/.test(last10)) return `IN:${last10}`;
  }
  return n;
}

/** Collapse DB rows that are the same number in different formats (+91 vs 10-digit vs +{local}). */
export function dedupeSavedContacts(rows: SavedContact[]): SavedContact[] {
  const byGroup = new Map<string, SavedContact>();
  for (const row of rows) {
    const name = row.name.trim();
    if (!name) continue;
    const peer = canonicalWhatsAppPeer(row.peer_e164) || row.peer_e164;
    const gid = contactGroupId(peer);
    const existing = byGroup.get(gid);
    if (!existing) {
      byGroup.set(gid, { peer_e164: preferContactPeer(peer, peer), name });
    } else {
      byGroup.set(gid, {
        peer_e164: preferContactPeer(existing.peer_e164, peer),
        name: existing.name.length >= name.length ? existing.name : name,
      });
    }
  }
  return Array.from(byGroup.values());
}

/** One row per real contact — use deduped rows, not every alias key in the map. */
export function listSavedContacts(contacts: Record<string, string>): SavedContact[] {
  const byGroup = new Map<string, SavedContact>();
  for (const [key, name] of Object.entries(contacts)) {
    const trimmed = name.trim();
    if (!trimmed) continue;
    const gid = contactGroupId(key);
    const peer = canonicalWhatsAppPeer(key) || key;
    const existing = byGroup.get(gid);
    if (!existing) {
      byGroup.set(gid, { peer_e164: peer, name: trimmed });
    } else {
      byGroup.set(gid, {
        peer_e164: preferContactPeer(existing.peer_e164, peer),
        name: existing.name,
      });
    }
  }
  return Array.from(byGroup.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  );
}

export function filterSavedContacts(
  contacts: Record<string, string>,
  query: string
): SavedContact[] {
  const q = query.trim().toLowerCase();
  const all = listSavedContacts(contacts);
  if (!q) return all;
  return all.filter(
    (c) =>
      c.name.toLowerCase().includes(q) ||
      c.peer_e164.includes(q) ||
      formatWhatsAppPhone(c.peer_e164).toLowerCase().includes(q)
  );
}

export function labelForPeer(peer: string, contacts: Record<string, string>): string {
  return displayNameForPeer(peer, contacts);
}

export function conversationExistsForPeer(
  peer: string,
  conversations: WhatsAppConversation[]
): boolean {
  return conversations.some((c) => phoneMatches(c.peer_e164, peer));
}

/** Saved contacts with no thread yet (shown on the main list). */
export function savedContactsWithoutConversation(
  contacts: Record<string, string>,
  conversations: WhatsAppConversation[],
  query?: string
): SavedContact[] {
  const listed = filterSavedContacts(contacts, query ?? '');
  return listed.filter((c) => !conversationExistsForPeer(c.peer_e164, conversations));
}
