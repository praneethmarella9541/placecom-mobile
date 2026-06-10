import type { WhatsAppMessage } from './whatsapp-types';

const PLACEHOLDER_BODIES = new Set([
  '[Image]',
  '[Video]',
  '[Audio]',
  '[Document]',
  '[Sticker]',
  '[Location]',
]);

/** True for short emoji-only text (not placeholders like [Image]). */
export function isEmojiOnlyMessage(body: string | null | undefined): boolean {
  const t = body?.trim() ?? '';
  if (!t || t.length > 20 || PLACEHOLDER_BODIES.has(t) || t.startsWith('[')) return false;
  if (/[\dA-Za-z]/.test(t)) return false;
  return /\p{Extended_Pictographic}/u.test(t);
}

export function isImageMessage(message: WhatsAppMessage): boolean {
  if (!message.media_url) return false;
  return (
    message.content_type?.startsWith('image/') === true ||
    message.content_type === 'image' ||
    message.body === '[Image]' ||
    /\.(jpe?g|png|gif|webp)(\?|$)/i.test(message.media_url)
  );
}

export function messageSearchText(message: WhatsAppMessage): string {
  const parts = [message.body, message.media_url].filter(Boolean) as string[];
  return parts.join(' ').toLowerCase();
}

export function messageMatchesChatSearch(message: WhatsAppMessage, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return messageSearchText(message).includes(q);
}

/** Skip blank rows that add empty spacing in the thread. */
export function shouldRenderInThread(message: WhatsAppMessage): boolean {
  if (message.media_url) return true;
  const body = message.body?.trim() ?? '';
  return body.length > 0;
}

/** Drop back-to-back duplicate rows (common with optimistic + server emoji). */
export function dedupeThreadMessages(messages: WhatsAppMessage[]): WhatsAppMessage[] {
  const out: WhatsAppMessage[] = [];
  for (const m of messages) {
    const prev = out[out.length - 1];
    if (prev) {
      const sameBody = (prev.body?.trim() ?? '') === (m.body?.trim() ?? '');
      const sameDir = prev.direction === m.direction;
      const closeInTime =
        Math.abs(
          new Date(prev.created_at).getTime() - new Date(m.created_at).getTime()
        ) < 4000;
      if (sameBody && sameDir && closeInTime) {
        if (m.id.startsWith('optimistic-')) continue;
        if (prev.id.startsWith('optimistic-')) {
          out[out.length - 1] = m;
          continue;
        }
        continue;
      }
    }
    out.push(m);
  }
  return out;
}
