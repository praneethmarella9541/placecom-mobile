import { useEffect, useRef } from 'react';
import { Platform, DeviceEventEmitter } from 'react-native';
import { warmWhatsAppThread } from '../lib/whatsapp-thread-cache';
import { router } from 'expo-router';
import type { Session } from '@supabase/supabase-js';
import { markIncomingCallNotified } from '../lib/incoming-call-alerts';
import {
  ensureCallNotificationChannels,
  getNotifications,
  obtainExpoPushToken,
} from '../lib/expo-push-native';
import { registerPushToken, unregisterPushToken } from '../lib/push-notifications';

function navigateFromNotificationData(data: Record<string, unknown> | undefined) {
  if (!data) return;
  const type = data.type;
  if (type === 'whatsapp' && typeof data.peer === 'string' && data.peer) {
    router.push(`/(workspace)/whatsapp/${encodeURIComponent(data.peer)}`);
    return;
  }
  if (type === 'inbox') {
    router.push('/(workspace)/inbox');
    return;
  }
  if (type === 'incoming_call') {
    router.push('/(workspace)/calls');
  }
}

export function usePushNotifications(session: Session | null) {
  const registeredToken = useRef<string | null>(null);

  useEffect(() => {
    if (!session) {
      const token = registeredToken.current;
      if (token) {
        void unregisterPushToken(token);
        registeredToken.current = null;
      }
      return;
    }

    const Notifications = getNotifications();
    if (!Notifications) return;

    void ensureCallNotificationChannels();

    let cancelled = false;

    (async () => {
      const token = await obtainExpoPushToken();
      if (cancelled || !token) return;
      try {
        await registerPushToken(token, Platform.OS);
        registeredToken.current = token;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('[push] register failed:', msg);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session?.access_token]);

  const sessionRef = useRef(session);
  useEffect(() => { sessionRef.current = session; }, [session]);

  useEffect(() => {
    const Notifications = getNotifications();
    if (!Notifications) return;

    const receivedSub = Notifications.addNotificationReceivedListener((notification) => {
      const data = notification.request.content.data as Record<string, unknown> | undefined;
      if (data?.type === 'incoming_call' && typeof data.callSid === 'string' && data.callSid) {
        markIncomingCallNotified(data.callSid);
      }
      if (data?.type === 'whatsapp') {
        DeviceEventEmitter.emit('wa:newMessage', { peer: data.peer });
        // Pre-warm thread cache immediately — use ref so we always have the
        // current session even though this effect runs only once.
        const uid = sessionRef.current?.user?.id;
        if (uid && typeof data.peer === 'string' && data.peer) {
          void warmWhatsAppThread(uid, data.peer);
        }
      }
    });

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      navigateFromNotificationData(data);
    });

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      navigateFromNotificationData(data);
    });

    return () => {
      receivedSub.remove();
      sub.remove();
    };
  }, []);
}
