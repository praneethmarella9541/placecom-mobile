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

const MEDIA_PLACEHOLDER_RE = /^\[(Image|Video|Audio|Voice|Document|Sticker)(?::|\])/i;
const UUID_PREFIX_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;

function isCacheLikeFilename(name: string): boolean {
  const n = name.trim();
  if (!n || n === 'upload') return true;
  if (/^(file|document|audio|photo|video|image)(-\d+)?(\.[a-z0-9]+)?$/i.test(n)) return true;
  if (/^[0-9a-f]{8,}(\.[a-z0-9]+)?$/i.test(n)) return true;
  if (/^\d+(\.[a-z0-9]+)?$/i.test(n)) return true;
  return false;
}

/** Best-effort original filename from a picked asset URI when the picker omits `name`. */
export function filenameFromAssetUri(uri: string, fallback: string): string {
  try {
    const path = decodeURIComponent(uri.split('?')[0].split('#')[0]);
    const base = path.split('/').pop()?.trim();
    if (base && base.includes('.')) return base;
  } catch {
    /* ignore */
  }
  return fallback;
}

function filenameFromStoragePath(objectPath: string): string | null {
  const segment = decodeURIComponent(objectPath).split('/').pop()?.trim();
  if (!segment) return null;
  const withoutUuid = segment.replace(UUID_PREFIX_RE, '');
  return withoutUuid.includes('.') ? withoutUuid : null;
}

export function mediaFilenameFromMessage(message: WhatsAppMessage): string {
  const stored = message.media_filename?.trim();
  if (stored) return stored;

  const body = message.body?.trim() ?? '';
  const docMatch = body.match(/^\[Document:\s*(.+)\]$/i);
  if (docMatch?.[1]?.trim()) return docMatch[1].trim();

  const url = message.media_url ?? '';
  try {
    const parsed = new URL(url, 'https://local');
    const storagePath = parsed.searchParams.get('p');
    if (storagePath) {
      const fromStorage = filenameFromStoragePath(storagePath);
      if (fromStorage && !isCacheLikeFilename(fromStorage)) return fromStorage;
    }
  } catch {
    /* ignore */
  }

  const fromUrl = url.split('/').pop()?.split('?')[0];
  if (fromUrl && fromUrl.includes('.') && fromUrl !== 'serve-media') {
    const decoded = decodeURIComponent(fromUrl);
    if (!isCacheLikeFilename(decoded)) return decoded;
  }

  if (body && !MEDIA_PLACEHOLDER_RE.test(body) && !body.startsWith('[')) {
    return body.slice(0, 120);
  }

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
