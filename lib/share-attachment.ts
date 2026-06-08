import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';

/** Open the system share / save sheet for a cached attachment file. */
export async function shareCachedAttachment(
  localUri: string,
  filename: string,
  mimeType: string
): Promise<void> {
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    Alert.alert('Not available', 'Sharing is not available on this device.');
    return;
  }
  await Sharing.shareAsync(localUri, {
    dialogTitle: filename,
    mimeType: mimeType || 'application/octet-stream',
    UTI: mimeType || 'public.data',
  });
}
