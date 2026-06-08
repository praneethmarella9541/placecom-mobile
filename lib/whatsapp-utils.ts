import { format } from 'date-fns';
import { phoneMatches } from './phone';
import { canonicalWhatsAppPeer } from './whatsapp-peer';

/** Format E.164 for display: +91 98494 31508 */
export function formatWhatsAppPhone(e164: string): string {
  const digits = e164.replace(/\D/g, '');
  if (e164.startsWith('+91') && digits.length === 12) {
    return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 10) return `${digits.slice(0, 5)} ${digits.slice(5)}`;
  return e164;
}

export function peerInitials(peer: string, name?: string): string {
  if (name?.trim()) return name.trim().charAt(0).toUpperCase();
  const digits = peer.replace(/\D/g, '');
  if (digits.length >= 2) return digits.slice(-2);
  return peer.slice(0, 2).toUpperCase() || '?';
}

export function formatWhatsAppListTime(iso: string): string {
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay) return format(d, 'h:mm a');
    return format(d, 'MMM d');
  } catch {
    return '—';
  }
}

export function lookupContactName(
  peer: string,
  contacts: Record<string, string>
): string | undefined {
  const trimmed = (key: string) => contacts[key]?.trim();
  const canonical = canonicalWhatsAppPeer(peer);
  const direct = trimmed(peer) || (canonical ? trimmed(canonical) : undefined);
  if (direct) return direct;
  for (const [key, name] of Object.entries(contacts)) {
    if (name.trim() && phoneMatches(key, peer)) return name.trim();
  }
  return undefined;
}

export function displayNameForPeer(
  peer: string,
  contacts: Record<string, string>
): string {
  return lookupContactName(peer, contacts) || formatWhatsAppPhone(peer);
}
