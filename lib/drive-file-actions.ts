import * as Clipboard from 'expo-clipboard';
import { Alert, Share } from 'react-native';
import { gmailApi } from './api';
import type { DriveFile } from './types';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

export function driveFileViewLink(file: DriveFile): string {
  return file.webViewLink ?? `https://drive.google.com/file/d/${file.id}/view`;
}

export async function copyDriveFileLink(file: DriveFile): Promise<void> {
  const link = driveFileViewLink(file);
  await Clipboard.setStringAsync(link);
  Alert.alert('Link copied', 'Drive link copied to clipboard.');
}

export async function shareDriveFileLink(file: DriveFile): Promise<void> {
  const link = driveFileViewLink(file);
  await Share.share({
    message: `${file.name}\n${link}`,
    url: link,
    title: file.name,
  });
}

export async function getDriveFileParents(fileId: string): Promise<string[]> {
  const { accessToken } = await gmailApi.getGoogleToken();
  const res = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?fields=parents`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error('Could not read file location');
  const data = (await res.json()) as { parents?: string[] };
  return data.parents ?? [];
}

export async function moveDriveFile(
  fileId: string,
  destinationFolderId: string,
  removeParentIds: string[]
): Promise<void> {
  const { accessToken } = await gmailApi.getGoogleToken();
  const params = new URLSearchParams({ addParents: destinationFolderId });
  if (removeParentIds.length > 0) {
    params.set('removeParents', removeParentIds.join(','));
  }
  const res = await fetch(
    `${DRIVE_API}/files/${encodeURIComponent(fileId)}?${params.toString()}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Move failed (${res.status})`);
  }
}
