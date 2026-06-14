import * as Clipboard from 'expo-clipboard';
import { Alert, Share } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { shareCachedAttachment } from './share-attachment';

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

export async function exportResponsesCsv(filename: string, csv: string): Promise<void> {
  const safeName = filename.split(/[/\\]/).pop()?.trim() || 'responses.csv';
  const path = `${FileSystem.cacheDirectory ?? ''}${safeName}`;
  await FileSystem.writeAsStringAsync(path, csv, { encoding: 'utf8' });
  try {
    await shareCachedAttachment(path, safeName, 'text/csv');
  } catch {
    await Clipboard.setStringAsync(csv);
    Alert.alert('CSV copied', 'Response data copied to clipboard.');
  }
}
