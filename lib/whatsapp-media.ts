import { BASE_URL } from './api';
import type { WhatsAppMessage } from './whatsapp-types';

/**
 * Resolve a stored media URL into something <Image>/<Audio> can actually load.
 *
 * The server may hand us either an absolute URL (S3/CDN/Twilio) or a relative
 * path like `/api/whatsapp/media/123`. Relative paths must be joined onto the
 * API base or the native image/audio loader silently fails (grey box / no audio).
 */
export function resolveWhatsAppMediaUrl(
  url: string | null | undefined
): string | null {
  const u = url?.trim();
  if (!u) return null;
  if (/^(https?:|data:|file:|content:)/i.test(u)) return u;
  if (u.startsWith('//')) return `https:${u}`;
  if (u.startsWith('/')) return `${BASE_URL}${u}`;
  // Bare token / id with no scheme and no leading slash — treat as API path.
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
