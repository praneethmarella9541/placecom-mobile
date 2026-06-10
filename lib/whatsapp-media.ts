import { BASE_URL } from './api';
import type { WhatsAppMessage } from './whatsapp-types';

const MEDIA_PLACEHOLDER_RE = /^\[(Image|Video|Audio|Voice|Document|Sticker)\]/i;

function messageNeedsMedia(row: WhatsAppMessage): boolean {
  if ((row.num_media ?? 0) > 0) return true;
  if (MEDIA_PLACEHOLDER_RE.test((row.body ?? '').trim())) return true;
  const ct = (row.content_type ?? '').toLowerCase();
  return ['image', 'video', 'audio', 'document', 'sticker'].includes(ct);
}

/** When DB/cache has no media_url, load via authenticated Exotel proxy. */
export function synthesizeWhatsAppMediaUrl(message: WhatsAppMessage): string | null {
  const stored = message.media_url?.trim();
  if (stored) return stored;
  const sid = message.message_sid?.trim();
  if (!sid || !messageNeedsMedia(message)) return null;
  return `/api/whatsapp/media?msgSid=${encodeURIComponent(sid)}`;
}

/**
 * Resolve a stored media URL into something <Image>/<Audio> can actually load.
 *
 * Rules:
 *  • Relative paths (/api/...) → prepend BASE_URL (our proxy, gets Bearer token).
 *  • Exotel API host URLs      → route through our proxy (require Exotel credentials).
 *  • Other absolute HTTPS URLs → use as-is (public CDN links).
 */
export function resolveWhatsAppMediaUrl(
  url: string | null | undefined
): string | null {
  const u = url?.trim();
  if (!u) return null;

  // Relative path → our own API (proxy adds Bearer token automatically).
  if (u.startsWith('/')) return `${BASE_URL}${u}`;

  // Exotel API URLs require server-side credentials — route through our proxy.
  if (
    u.startsWith('https://api.exotel.com/') ||
    u.startsWith('https://api.in.exotel.com/')
  ) {
    return `${BASE_URL}/api/whatsapp/media?url=${encodeURIComponent(u)}`;
  }

  if (u.startsWith('//')) return `https:${u}`;
  if (/^(https?:|data:|file:|content:)/i.test(u)) return u;

  // Bare token / id with no scheme → treat as relative API path.
  return `${BASE_URL}/${u}`;
}

/** True when the resolved URL is served by our own API (and so needs auth). */
export function isOwnApiMedia(resolvedUrl: string | null | undefined): boolean {
  if (!resolvedUrl || !BASE_URL) return false;
  return resolvedUrl.startsWith(BASE_URL);
}

/**
 * Build an Image/Audio `source` for a resolved media URL. When the media is
 * served by our own API, attach the Bearer token — otherwise the loader gets a
 * 401 and silently shows a blank/broken attachment.
 */
export function whatsAppMediaSource(
  resolvedUrl: string | null | undefined,
  token: string | null | undefined
): { uri: string; headers?: Record<string, string> } | null {
  if (!resolvedUrl) return null;
  if (token && isOwnApiMedia(resolvedUrl)) {
    return { uri: resolvedUrl, headers: { Authorization: `Bearer ${token}` } };
  }
  return { uri: resolvedUrl };
}

const AUDIO_EXT = /\.(mp3|m4a|aac|ogg|oga|opus|wav|amr|3gp|3gpp|caf)(\?|$)/i;

/** True when the message is a voice note / audio attachment. */
export function isAudioMessage(message: WhatsAppMessage): boolean {
  if (!message.media_url) return false;
  const ct = message.content_type ?? '';
  if (ct.startsWith('audio/') || ct === 'audio' || ct === 'voice') return true;
  if (message.body === '[Audio]' || message.body === '[Voice]') return true;
  return AUDIO_EXT.test(message.media_url);
}

/** True when the message is a video attachment. */
export function isVideoMessage(message: WhatsAppMessage): boolean {
  if (!message.media_url) return false;
  const ct = message.content_type ?? '';
  if (ct.startsWith('video/') || ct === 'video') return true;
  if (message.body === '[Video]') return true;
  return /\.(mp4|mov|3gp|3gpp|webm|mkv|avi)(\?|$)/i.test(message.media_url);
}
