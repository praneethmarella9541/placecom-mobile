import type { WhatsAppMessage } from './whatsapp-types';
import { normalizeWhatsAppDeliveryStatus } from './whatsapp-tick-level';

/** Fill gaps from API/DB so media and emoji-only messages render reliably. */
export function normalizeWhatsAppMessage(row: WhatsAppMessage): WhatsAppMessage {
  const mediaUrl = row.media_url?.trim() || null;
  // Preserve internal whitespace/newlines; only strip leading/trailing on edges.
  let body = row.body?.replace(/^\s+|\s+$/g, '') ?? '';

  // Infer content type from body placeholder when the DB column is absent.
  // Twilio doesn't always populate content_type on inbound messages, and some
  // integrations store only the placeholder string without a MIME type.
  let contentType = row.content_type?.trim() || null;
  if (!contentType && mediaUrl) {
    if (body === '[Image]') contentType = 'image';
    else if (body === '[Audio]' || body === '[Voice]') contentType = 'audio';
    else if (body === '[Video]') contentType = 'video';
    else if (body === '[Document]') contentType = 'application/octet-stream';
  }
  if (!body && contentType === 'sticker') body = '[Sticker]';
  const numMedia =
    row.num_media != null && row.num_media > 0
      ? row.num_media
      : mediaUrl
        ? 1
        : 0;

  return {
    ...row,
    body: body || null,
    media_url: mediaUrl,
    content_type: contentType,
    num_media: numMedia,
    delivery_status: row.delivery_status
      ? normalizeWhatsAppDeliveryStatus(row.delivery_status)
      : row.delivery_status,
  };
}

export function normalizeWhatsAppMessages(rows: WhatsAppMessage[]): WhatsAppMessage[] {
  return rows.map(normalizeWhatsAppMessage);
}
