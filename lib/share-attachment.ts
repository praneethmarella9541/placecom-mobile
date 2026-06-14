import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';
import { decodeDisplayFilename } from './filename-utils';

const SHARE_STAGING_DIR = 'share_out';

/** Filename shown to the user when saving/sharing — preserves spaces, no URL encoding. */
export function shareDisplayFilename(name: string): string {
  const decoded = decodeDisplayFilename(name.trim());
  const base = decoded.split(/[/\\]/).pop()?.replace(/\0/g, '').trim();
  return base && base.length > 0 ? base.slice(0, 240) : 'download';
}

/** Copy a cached file to a staging path using the exact display filename. */
export async function prepareFileForShare(localUri: string, displayName: string): Promise<string> {
  const name = shareDisplayFilename(displayName);
  const root = FileSystem.cacheDirectory;
  if (!root) throw new Error('Cache directory unavailable');

  const dir = `${root}${SHARE_STAGING_DIR}/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const dest = `${dir}${name}`;

  const info = await FileSystem.getInfoAsync(dest);
  if (info.exists) {
    await FileSystem.deleteAsync(dest, { idempotent: true });
  }

  await FileSystem.copyAsync({ from: localUri, to: dest });
  return dest;
}

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

  const displayName = shareDisplayFilename(filename);
  const shareUri = await prepareFileForShare(localUri, displayName);

  await Sharing.shareAsync(shareUri, {
    dialogTitle: displayName,
    mimeType: mimeType || 'application/octet-stream',
    UTI: mimeType || 'public.data',
  });
}
