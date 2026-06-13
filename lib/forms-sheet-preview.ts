import { fetchDriveFileToCache } from './drive-download';
import { buildDrivePreviewContent, type DrivePreviewContent } from './drive-preview';
import type { DriveFile } from './types';

function linkedSheetDriveFile(sheetId: string, title: string): DriveFile {
  const safe = (title.trim() || 'responses').replace(/[^\w-]+/g, '_').slice(0, 40);
  return {
    id: sheetId,
    name: `${safe}.xlsx`,
    mimeType: 'application/vnd.google-apps.spreadsheet',
    modifiedTime: '',
  };
}

/** Export linked form responses sheet as xlsx and render as HTML table (Drive-style). */
export async function loadLinkedSheetPreview(
  sheetId: string,
  title: string
): Promise<DrivePreviewContent> {
  const file = linkedSheetDriveFile(sheetId, title);
  const localUri = await fetchDriveFileToCache(file.id, file.name, 'download', file.mimeType);
  return buildDrivePreviewContent(localUri, file, 'office');
}
