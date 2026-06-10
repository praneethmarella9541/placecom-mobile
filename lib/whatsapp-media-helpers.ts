import type { WhatsAppMessage } from './whatsapp-types';
import { isAudioMessage, isVideoMessage } from './whatsapp-media';
import { isImageMessage } from './whatsapp-message-display';

export type WhatsAppMediaCategory = 'image' | 'video' | 'audio' | 'document';

export function categorizeWhatsAppMedia(message: WhatsAppMessage): WhatsAppMediaCategory | null {
  if (!message.media_url) return null;
  if (isImageMessage(message)) return 'image';
  if (isVideoMessage(message)) return 'video';
  if (isAudioMessage(message)) return 'audio';
  return 'document';
}

export function mediaFilenameFromMessage(message: WhatsAppMessage): string {
  const url = message.media_url ?? '';
  const fromUrl = url.split('/').pop()?.split('?')[0];
  if (fromUrl && fromUrl.includes('.')) return decodeURIComponent(fromUrl);

  const body = message.body?.trim() ?? '';
  if (body && !body.startsWith('[')) return body.slice(0, 120);

  const cat = categorizeWhatsAppMedia(message);
  if (cat === 'image') return 'image.jpg';
  if (cat === 'video') return 'video.mp4';
  if (cat === 'audio') return 'audio.m4a';
  return 'document.pdf';
}

export function mimeTypeFromMessage(message: WhatsAppMessage): string {
  const ct = message.content_type?.trim();
  if (ct && ct !== 'image' && ct !== 'video' && ct !== 'audio' && ct !== 'document') {
    return ct;
  }
  const cat = categorizeWhatsAppMedia(message);
  if (cat === 'image') return 'image/jpeg';
  if (cat === 'video') return 'video/mp4';
  if (cat === 'audio') return 'audio/mpeg';
  if (cat === 'document') {
    const name = mediaFilenameFromMessage(message).toLowerCase();
    if (name.endsWith('.pdf')) return 'application/pdf';
    if (name.endsWith('.doc')) return 'application/msword';
    if (name.endsWith('.docx')) {
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    }
    return 'application/octet-stream';
  }
  return 'application/octet-stream';
}

export function isPdfMessage(message: WhatsAppMessage): boolean {
  const mime = mimeTypeFromMessage(message);
  if (mime === 'application/pdf') return true;
  return mediaFilenameFromMessage(message).toLowerCase().endsWith('.pdf');
}
