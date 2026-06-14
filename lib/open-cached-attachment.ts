import { Platform, Alert, Linking } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import { prepareFileForShare, shareDisplayFilename } from './share-attachment';

const VIEW_ACTION = 'android.intent.action.VIEW';
const FLAG_GRANT_READ_URI = 1;

/** Open a cached file in a native app (PDF reader, Excel, audio player, etc.). */
export async function openCachedAttachment(
  localUri: string,
  filename: string,
  mimeType: string
): Promise<void> {
  const type = mimeType?.trim() || guessMimeFromFilename(filename);
  const displayName = shareDisplayFilename(filename);
  const shareUri = await prepareFileForShare(localUri, displayName);

  if (Platform.OS === 'android') {
    const opened = await tryOpenOnAndroid(shareUri, type);
    if (opened) return;
  }

  await openViaShareSheet(shareUri, displayName, type);
}

async function tryOpenOnAndroid(localUri: string, mimeType: string): Promise<boolean> {
  let contentUri: string | null = null;
  try {
    contentUri = await FileSystem.getContentUriAsync(localUri);
  } catch {
    /* fall through to share sheet */
  }

  if (contentUri) {
    try {
      await IntentLauncher.startActivityAsync(VIEW_ACTION, {
        data: contentUri,
        flags: FLAG_GRANT_READ_URI,
        type: mimeType,
      });
      return true;
    } catch {
      /* try Linking next */
    }

    try {
      await Linking.openURL(contentUri);
      return true;
    } catch {
      /* fall through */
    }
  }

  return false;
}

async function openViaShareSheet(
  shareUri: string,
  displayName: string,
  mimeType: string
): Promise<void> {
  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    Alert.alert('Cannot open file', 'No app is available to open this attachment.');
    return;
  }

  await Sharing.shareAsync(shareUri, {
    dialogTitle: displayName,
    mimeType,
    UTI: mimeType,
  });
}

function guessMimeFromFilename(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    csv: 'text/csv',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    mp3: 'audio/mpeg',
    m4a: 'audio/mp4',
    wav: 'audio/wav',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    mp4: 'video/mp4',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
  };
  return map[ext] ?? 'application/octet-stream';
}
