import AsyncStorage from '@react-native-async-storage/async-storage';
import { cacheClearAll } from './cache';
import { clearPendingSessionState } from './pending-deletes';
import { clearWhatsAppUnreadSessionState } from './whatsapp-unread';
import { clearGmailAttachmentCaches } from './gmail-attachments';
import { getLastRegisteredPushToken, unregisterPushToken } from './push-notifications';
import { clearMailListSessionCache } from './inbox-list-prefetch';
import { clearDriveListSessionCache } from './drive-list-prefetch';
import { clearMailThreadPrefetchCache } from './mail-thread-prefetch';
import { clearWorkspaceFeaturePrefetchCaches } from './workspace-feature-prefetch';
import { clearSessionInboxUnread } from './inbox-unread-session';
import { clearDriveStarSessionSync } from './drive-star-session-sync';
import { clearDriveMoveSessionSync } from './drive-move-session-sync';
import { resetCacheWriteGeneration } from './session-cache-core';

const WA_CONV_CACHE_PREFIX = 'wa_conv_list_v2';

/** Wipe per-user/session data so a new login never sees the previous account. */
export async function resetAppSessionCaches(userId?: string): Promise<void> {
  cacheClearAll();
  clearMailListSessionCache();
  clearDriveListSessionCache();
  clearMailThreadPrefetchCache();
  clearWorkspaceFeaturePrefetchCaches();
  clearSessionInboxUnread();
  clearDriveStarSessionSync();
  clearDriveMoveSessionSync();
  resetCacheWriteGeneration();
  clearPendingSessionState();
  clearWhatsAppUnreadSessionState();
  clearGmailAttachmentCaches();

  const keys: string[] = [`${WA_CONV_CACHE_PREFIX}`];
  if (userId) {
    keys.push(`${WA_CONV_CACHE_PREFIX}:${userId}`);
  }

  await AsyncStorage.multiRemove(keys).catch(() => {});

  const token = getLastRegisteredPushToken();
  if (token) {
    await unregisterPushToken(token).catch(() => {});
  }
}
