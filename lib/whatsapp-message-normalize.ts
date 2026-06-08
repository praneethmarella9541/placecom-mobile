import type { WhatsAppMessage } from './whatsapp-types';

/** Fill gaps from API/DB so media and emoji-only messages render reliably. */
export function normalizeWhatsAppMessage(row: WhatsAppMessage): WhatsAppMessage {
  const mediaUrl = row.media_url?.trim() || null;
  const contentType = row.content_type?.trim() || null;
  let body = row.body?.trim() ?? '';
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
  };
}

export function normalizeWhatsAppMessages(rows: WhatsAppMessage[]): WhatsAppMessage[] {
  return rows.map(normalizeWhatsAppMessage);
}
