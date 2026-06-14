import type { WhatsAppMessage } from './whatsapp-types';
import { downloadUrlToCacheFile } from './file-cache-download';
import { openCachedAttachment } from './open-cached-attachment';
import { isExpoGo } from './expo-runtime';
import { isOwnApiMedia, resolveWhatsAppMediaUrl } from './whatsapp-media';
import { mediaFilenameFromMessage, mimeTypeFromMessage } from './whatsapp-media-helpers';
import { isImageMessage } from './whatsapp-message-display';
import { isAudioMessage, isVideoMessage } from './whatsapp-media';

export type WhatsAppMediaOpenTarget = 'fullscreen-image' | 'inline-video' | 'native-app';

export function whatsAppMediaOpenTarget(message: WhatsAppMessage): WhatsAppMediaOpenTarget {
  if (isImageMessage(message)) return 'fullscreen-image';
  if (isVideoMessage(message)) {
    // react-native-webview is not bundled in Expo Go — open in the device video app instead.
    if (isExpoGo()) return 'native-app';
    return 'inline-video';
  }
  return 'native-app';
}

export function canOpenWhatsAppMessageMedia(message: WhatsAppMessage): boolean {
  return !!message.media_url || !!message.message_sid;
}

/** Download attachment to cache and open with a native app (documents, spreadsheets, audio files). */
export async function openWhatsAppMessageInNativeApp(
  message: WhatsAppMessage,
  authToken?: string | null
): Promise<void> {
  const resolved = resolveWhatsAppMediaUrl(message.media_url);
  if (!resolved) {
    throw new Error('Media URL is missing.');
  }

  const filename = mediaFilenameFromMessage(message);
  const mimeType = mimeTypeFromMessage(message);
  const headers =
    authToken && isOwnApiMedia(resolved) ? { Authorization: `Bearer ${authToken}` } : undefined;

  const cached = await downloadUrlToCacheFile(resolved, 'whatsapp_media', filename, headers);
  await openCachedAttachment(cached.uri, filename, mimeType);
}

export async function openWhatsAppMessageMedia(
  message: WhatsAppMessage,
  authToken: string | null | undefined,
  handlers: {
    openImage: (message: WhatsAppMessage) => void;
    openVideo: (message: WhatsAppMessage) => void;
  }
): Promise<void> {
  const target = whatsAppMediaOpenTarget(message);
  if (target === 'fullscreen-image') {
    handlers.openImage(message);
    return;
  }
  if (target === 'inline-video') {
    handlers.openVideo(message);
    return;
  }
  await openWhatsAppMessageInNativeApp(message, authToken);
}

export function shouldUseNativeAppForMessage(message: WhatsAppMessage): boolean {
  if (isImageMessage(message) || isVideoMessage(message)) return false;
  if (isAudioMessage(message)) return true;
  return !!message.media_url;
}
