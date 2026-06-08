import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { router } from 'expo-router';
import type { Session } from '@supabase/supabase-js';
import { getNotifications, obtainExpoPushToken } from '../lib/expo-push-native';
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

  useEffect(() => {
    const Notifications = getNotifications();
    if (!Notifications) return;

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      navigateFromNotificationData(data);
    });

    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!response) return;
      const data = response.notification.request.content.data as Record<string, unknown> | undefined;
      navigateFromNotificationData(data);
    });

    return () => sub.remove();
  }, []);
}
