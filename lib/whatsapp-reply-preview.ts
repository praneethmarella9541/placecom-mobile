import type { WhatsAppMessage } from './whatsapp-types';
import { isAudioMessage, isVideoMessage } from './whatsapp-media';
import { isImageMessage } from './whatsapp-message-display';

const PLACEHOLDER_RE = /^\[(Image|Video|Audio|Voice|Document|Sticker|Location)\]$/i;

export function replyAuthorLabel(
  message: WhatsAppMessage,
  selfName = 'You',
  peerName = 'Contact'
): string {
  return message.direction === 'outbound' ? selfName : peerName;
}

export function replyPreviewText(message: WhatsAppMessage): string {
  if (isImageMessage(message)) return 'Photo';
  if (isVideoMessage(message)) return 'Video';
  if (isAudioMessage(message)) return 'Audio';
  const body = message.body?.trim() ?? '';
  if (body && !PLACEHOLDER_RE.test(body)) return body;
  if (message.media_url) return 'Document';
  return 'Message';
}
