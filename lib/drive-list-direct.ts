import { gmailApi } from './api';
import type { DriveFile } from './types';
import { decodeDisplayFilename } from './filename-utils';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

const FILE_FIELDS =
  'nextPageToken,files(id,name,mimeType,size,modifiedTime,webViewLink,starred,shared,sharedWithMeTime,thumbnailLink)';

function mapDriveFile(f: Record<string, unknown>): DriveFile {
  return {
    id: String(f.id ?? ''),
    name: decodeDisplayFilename(String(f.name ?? 'Untitled')),
    mimeType: String(f.mimeType ?? 'application/octet-stream'),
    size: f.size != null ? String(f.size) : null,
    modifiedTime: String(f.modifiedTime ?? new Date().toISOString()),
    webViewLink: (f.webViewLink as string) ?? null,
    starred: !!(f.starred ?? f.isStarred),
    shared: !!(f.shared ?? f.sharedWithMe),
    thumbnailLink: (f.thumbnailLink as string) ?? null,
  };
}

/**
 * List Drive files via Google Drive API (same token as Gmail).
 * Used for Starred / Shared / Recent when the backend view param is incomplete.
 */
export async function listDriveFilesDirectly(opts: {
  q: string;
  pageToken?: string;
  pageSize?: number;
  orderBy?: string;
  /** Defaults to `user`; use for shared-with-me queries per Drive API. */
  corpora?: 'user' | 'allDrives';
}): Promise<{ files: DriveFile[]; nextPageToken?: string }> {
  const { accessToken } = await gmailApi.getGoogleToken();
  const params = new URLSearchParams({
    q: opts.q,
    fields: FILE_FIELDS,
    pageSize: String(opts.pageSize ?? 30),
    spaces: 'drive',
    corpora: opts.corpora ?? 'user',
    includeItemsFromAllDrives: 'true',
    supportsAllDrives: 'true',
  });
  if (opts.orderBy) params.set('orderBy', opts.orderBy);
  if (opts.pageToken) params.set('pageToken', opts.pageToken);

  const res = await fetch(`${DRIVE_API}/files?${params.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Drive list failed (${res.status}): ${text.slice(0, 120)}`);
  }

  const data = (await res.json()) as { files?: Record<string, unknown>[]; nextPageToken?: string };
  return {
    files: (data.files ?? []).map(mapDriveFile),
    nextPageToken: data.nextPageToken,
  };
}

/** Starred files and folders (matches Google Drive “Starred” view). */
export function driveStarredQuery(): string {
  return 'starred = true and trashed = false';
}

/** Matches Google Drive “Shared with me” (top-level items only). */
export function buildDriveSharedQuery(search?: string): string {
  let q = 'sharedWithMe = true and trashed = false';
  const term = search?.trim();
  if (term) {
    const escaped = term.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    q += ` and name contains '${escaped}'`;
  }
  return q;
}

/** @deprecated Use buildDriveSharedQuery */
export function driveSharedQuery(): string {
  return buildDriveSharedQuery();
}

export function driveRecentQuery(): string {
  return 'trashed = false';
}

export function driveFolderQuery(folderId: string): string {
  return `'${folderId}' in parents and trashed = false`;
}
