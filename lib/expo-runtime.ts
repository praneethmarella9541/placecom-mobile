import Constants from 'expo-constants';

/** True when running inside the Expo Go app (not a custom dev client or store APK). */
export function isExpoGo(): boolean {
  return Constants.appOwnership === 'expo';
}
