import * as Clipboard from 'expo-clipboard';
import { Alert, Linking } from 'react-native';

export async function copyText(label: string, text: string): Promise<void> {
  await Clipboard.setStringAsync(text);
  Alert.alert('Copied', `${label} copied to clipboard.`);
}

export function openUrl(url: string): void {
  Linking.openURL(url).catch(() => {
    Alert.alert('Could not open link', url);
  });
}

export function joinGoogleMeet(hangoutLink: string): void {
  openUrl(hangoutLink);
}
