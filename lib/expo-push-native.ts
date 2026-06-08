import { Platform } from 'react-native';
import Constants from 'expo-constants';

type NotificationsModule = typeof import('expo-notifications');

let notifications: NotificationsModule | null | undefined;
let handlerConfigured = false;

/** True when expo-notifications native code is linked in this binary. */
export function isPushNativeAvailable(): boolean {
  return getNotifications() != null;
}

export function getNotifications(): NotificationsModule | null {
  if (notifications !== undefined) return notifications;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    notifications = require('expo-notifications') as NotificationsModule;
    if (!handlerConfigured) {
      notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowAlert: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
          shouldShowBanner: true,
          shouldShowList: true,
        }),
      });
      handlerConfigured = true;
    }
  } catch (e) {
    console.warn(
      '[push] expo-notifications not available — rebuild the dev client: npx expo run:android (or ios)',
      e instanceof Error ? e.message : e
    );
    notifications = null;
  }
  return notifications;
}

function isPhysicalDevice(): boolean {
  if (Platform.OS === 'web') return false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Device = require('expo-device') as typeof import('expo-device');
    return Device.isDevice;
  } catch {
    // Module missing in an old dev build — still try push on real hardware.
    return Platform.OS === 'android' || Platform.OS === 'ios';
  }
}

export async function obtainExpoPushToken(): Promise<string | null> {
  const Notifications = getNotifications();
  if (!Notifications || !isPhysicalDevice()) return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Messages',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;
  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return null;

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;

  if (!projectId) {
    console.warn('[push] Missing EAS projectId in app.json extra.eas');
    return null;
  }

  try {
    const token = await Notifications.getExpoPushTokenAsync({ projectId });
    console.log('[push] Expo push token obtained:', token.data.slice(0, 30) + '…');
    return token.data;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/FirebaseApp|FCM|fcm-credentials/i.test(msg)) {
      console.warn(
        '[push] Android FCM not configured. Add google-services.json and rebuild — see docs/FCM_SETUP.md'
      );
    } else {
      console.warn('[push] getExpoPushToken failed:', msg);
    }
    return null;
  }
}
