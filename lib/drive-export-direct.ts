import { gmailApi } from './api';
import { downloadUrlToCacheFile } from './file-cache-download';

function fileExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

const GOOGLE_APP_MIMES = new Set([
  'application/vnd.google-apps.spreadsheet',
  'application/vnd.google-apps.document',
  'application/vnd.google-apps.presentation',
]);

/** File types Google Drive can usually export to PDF. */
export function canExportDriveFileToPdf(mimeType: string, fileName: string): boolean {
  if (GOOGLE_APP_MIMES.has(mimeType)) return true;
  const ext = fileExt(fileName);
  return ['xlsx', 'xls', 'ppt', 'pptx', 'doc', 'docx'].includes(ext);
}

/**
 * Export via Drive API → cached PDF file. Works for Google Docs/Sheets/Slides
 * and many uploaded Office files.
 */
export async function exportDriveFileToPdfCache(fileId: string, fileName: string): Promise<string | null> {
  try {
    const { accessToken } = await gmailApi.getGoogleToken();
    const url = `${DRIVE_API}/files/${encodeURIComponent(fileId)}/export?mimeType=${encodeURIComponent('application/pdf')}`;
    const cacheName = `${fileId}.pdf`;
    const { uri } = await downloadUrlToCacheFile(url, 'drive_exports', cacheName, {
      Authorization: `Bearer ${accessToken}`,
    });
    return uri;
  } catch {
    return null;
  }
}
