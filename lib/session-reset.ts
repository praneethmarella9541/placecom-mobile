import AsyncStorage from '@react-native-async-storage/async-storage';
import { cacheClearAll } from './cache';
import { clearPendingSessionState } from './pending-deletes';
import { clearWhatsAppUnreadSessionState } from './whatsapp-unread';
import { clearGmailAttachmentCaches } from './gmail-attachments';
import { getLastRegisteredPushToken, unregisterPushToken } from './push-notifications';
import { clearMailListSessionCache } from './inbox-list-prefetch';
import { clearWorkspacePrefetchSession } from './login-prefetch-session';
import { clearMailListSessionStorage } from './mail-list-session-cache';
import { clearMailThreadSessionStorage } from './mail-thread-session-cache';
import { clearDriveListSessionCache } from './drive-list-prefetch';
import { clearCallsListSessionCache } from './calls-list-prefetch';
import { clearMailThreadPrefetchCache } from './mail-thread-prefetch';
import { clearWorkspaceFeaturePrefetchCaches } from './workspace-feature-prefetch';
import {
  clearWhatsAppThreadCache,
  clearWhatsAppThreadDiskCache,
} from './whatsapp-thread-cache';
import { clearSessionInboxUnread } from './inbox-unread-session';
import { clearDriveStarSessionSync } from './drive-star-session-sync';
import { clearDriveMoveSessionSync } from './drive-move-session-sync';
import { clearComposeContactsCache } from './email-contact-suggestions';
import { clearGmailLabelsCache } from './gmail-labels-cache';
import { resetApiDebugStats } from './api-debug';
import { resetCacheWriteGeneration } from './session-cache-core';

const WA_CONV_CACHE_PREFIX = 'wa_conv_list_v2';

/** Wipe per-user/session data so a new login never sees the previous account. */
export async function resetAppSessionCaches(userId?: string): Promise<void> {
  cacheClearAll();
  clearMailListSessionCache();
  clearDriveListSessionCache();
  clearCallsListSessionCache();
  clearMailThreadPrefetchCache();
  clearWorkspaceFeaturePrefetchCaches();
  clearWorkspacePrefetchSession();
  void clearMailListSessionStorage(userId);
  void clearMailThreadSessionStorage(userId);
  clearSessionInboxUnread();
  clearDriveStarSessionSync();
  clearDriveMoveSessionSync();
  resetCacheWriteGeneration();
  resetApiDebugStats();
  clearPendingSessionState();
  clearWhatsAppUnreadSessionState();
  clearWhatsAppThreadCache();
  clearGmailAttachmentCaches();
  clearGmailLabelsCache();
  clearComposeContactsCache();

  const keys: string[] = [`${WA_CONV_CACHE_PREFIX}`];
  if (userId) {
    keys.push(`${WA_CONV_CACHE_PREFIX}:${userId}`);
    await clearWhatsAppThreadDiskCache(userId);
  }

  await AsyncStorage.multiRemove(keys).catch(() => {});

  const token = getLastRegisteredPushToken();
  if (token) {
    await unregisterPushToken(token).catch(() => {});
  }
}
