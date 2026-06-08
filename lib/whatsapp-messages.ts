import type { WhatsAppMessage } from './whatsapp-types';
import type { WhatsAppSendPayload } from './whatsapp-types';

function optimisticMatchesServer(o: WhatsAppMessage, n: WhatsAppMessage): boolean {
  if (n.message_sid && o.message_sid && o.message_sid === n.message_sid) return true;
  if (n.message_sid && o.id.startsWith('optimistic-')) {
    const dt = Math.abs(new Date(n.created_at).getTime() - new Date(o.created_at).getTime());
    if (dt < 180_000) return true;
  }
  if (o.media_url && n.media_url && o.media_url === n.media_url) return true;
  const dt = Math.abs(new Date(n.created_at).getTime() - new Date(o.created_at).getTime());
  if (dt >= 120_000) return false;
  if (o.body && n.body && o.body.trim() === n.body.trim()) return true;
  if (
    !o.media_url &&
    !n.media_url &&
    o.body?.trim() &&
    n.body?.trim() &&
    o.body.trim() === n.body.trim()
  ) {
    return true;
  }
  if (o.media_url && n.media_url) return true;
  if (
    o.media_url &&
    n.body &&
    (n.body === '[Image]' || n.body === o.body || n.body.startsWith('['))
  ) {
    return true;
  }
  return false;
}

export function mergeWhatsAppMessages(
  prev: WhatsAppMessage[],
  incoming: WhatsAppMessage[]
): WhatsAppMessage[] {
  const optimistics = prev.filter((m) => m.id.startsWith('optimistic-'));
  const kept = optimistics.filter((o) => !incoming.some((n) => optimisticMatchesServer(o, n)));
  return [...incoming, ...kept].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

function realMessages(messages: WhatsAppMessage[]): WhatsAppMessage[] {
  return messages.filter((m) => !m.id.startsWith('optimistic-'));
}

function messageSnapshot(m: WhatsAppMessage): string {
  return [
    m.id,
    m.body ?? '',
    m.created_at,
    m.delivery_status ?? '',
    m.message_sid ?? '',
    m.media_url ?? '',
    String(m.num_media ?? 0),
    m.content_type ?? '',
    m.deleted_at ?? '',
  ].join('\0');
}

/** True when server payload differs from what we show (new msgs, ticks, edits). */
export function hasNewWhatsAppMessages(
  prev: WhatsAppMessage[],
  incoming: WhatsAppMessage[]
): boolean {
  const prevReal = realMessages(prev);
  if (incoming.length !== prevReal.length) return true;
  if (!incoming.length) return prevReal.length > 0;
  for (let i = 0; i < incoming.length; i++) {
    if (messageSnapshot(incoming[i]) !== messageSnapshot(prevReal[i])) return true;
  }
  return false;
}

export function previewOutboundBody(
  payload: WhatsAppSendPayload,
  needsTemplate: boolean,
  templateVar1: string,
  templateVar2: string,
  draft: string
): string {
  if (needsTemplate) return `Hi ${templateVar1}, this is ${templateVar2} from PlaceCom`;
  if (payload.messageType === 'text') return payload.text?.trim() || draft.trim();
  if (payload.mediaCaption?.trim()) return payload.mediaCaption.trim();
  if (payload.mediaFilename) return `[${payload.messageType}: ${payload.mediaFilename}]`;
  if (payload.messageType === 'image') return '[Image]';
  return `[${payload.messageType}]`;
}
