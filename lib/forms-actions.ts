import * as Clipboard from 'expo-clipboard';
import { Alert, Share } from 'react-native';

export async function copyFormLink(link: string): Promise<void> {
  await Clipboard.setStringAsync(link);
  Alert.alert('Link copied', 'Form link copied to clipboard.');
}

export async function shareFormLink(link: string, title?: string): Promise<void> {
  try {
    await Share.share({
      message: title ? `${title}\n${link}` : link,
      url: link,
      title: title ?? 'Google Form',
    });
  } catch {
    await copyFormLink(link);
  }
}
