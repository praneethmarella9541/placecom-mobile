import { supabase } from './supabase';
import { isGoogleWorkspaceFile, getFileExtension } from './drive-utils';
import { canExportDriveFileToPdf } from './drive-export-direct';
import { downloadUrlToCacheFile } from './file-cache-download';

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

async function getBearerToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

function needsPdfExportForPreview(fileName: string, mimeType: string): boolean {
  if (mimeType === 'application/pdf' || getFileExtension(fileName) === 'pdf') return false;
  if (canExportDriveFileToPdf(mimeType, fileName)) return true;
  if (isGoogleWorkspaceFile(mimeType)) return true;
  const ext = getFileExtension(fileName);
  return ['xlsx', 'xls', 'ppt', 'pptx', 'doc', 'docx'].includes(ext);
}

/** Download via backend proxy → local file:// URI. */
export async function fetchDriveFileToCache(
  fileId: string,
  fileName: string,
  mode: 'preview' | 'download',
  mimeType = 'application/octet-stream'
): Promise<string> {
  const token = await getBearerToken();
  if (!token) throw new Error('Not signed in');

  const ext = getFileExtension(fileName);
  const isCsv =
    ext === 'csv' || mimeType === 'text/csv' || mimeType === 'application/csv';
  // Preview endpoint may return an HTML wrapper for CSV — always fetch raw bytes.
  const effectiveMode = mode === 'preview' && isCsv ? 'download' : mode;

  const params = new URLSearchParams({ mode: effectiveMode });
  if (mode === 'preview' && needsPdfExportForPreview(fileName, mimeType)) {
    params.set('exportMime', 'application/pdf');
  }

  const remoteUrl = `${BASE_URL}/api/drive/file/${encodeURIComponent(fileId)}?${params.toString()}`;
  const suffix =
    mode === 'preview' && needsPdfExportForPreview(fileName, mimeType) ? '.pdf' : '';
  const cacheName = `${fileId}${suffix}`;

  const { uri } = await downloadUrlToCacheFile(remoteUrl, 'drive_files', cacheName, {
    Authorization: `Bearer ${token}`,
  });
  return uri;
}
