import { supabase } from './supabase';
import { gmailApi } from './api';
import {
  downloadUrlToCacheFile,
  cacheFileExists,
  readCacheFileBase64,
} from './file-cache-download';

export type AttachmentKind =
  | 'image'
  | 'pdf'
  | 'word'
  | 'excel'
  | 'powerpoint'
  | 'video'
  | 'audio'
  | 'archive'
  | 'generic';

export type AttachmentVisual = {
  kind: AttachmentKind;
  icon: string;
  color: string;
  bg: string;
};

const URI_CACHE = new Map<string, string>();
const IMAGE_DATA_URI_CACHE = new Map<string, string>();
const CACHE_SUBDIR = 'gmail_attachments';

function cacheKey(messageId: string, attachmentId: string): string {
  return `${messageId}:${attachmentId}`;
}

export function formatAttachmentBytes(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getAttachmentKind(mimeType: string, filename: string): AttachmentKind {
  const mt = (mimeType || '').toLowerCase();
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';

  if (mt.startsWith('image/')) return 'image';
  if (mt === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (
    mt.includes('word') ||
    ext === 'doc' ||
    ext === 'docx' ||
    ext === 'rtf'
  ) {
    return 'word';
  }
  if (
    mt.includes('spreadsheet') ||
    mt.includes('excel') ||
    ext === 'xls' ||
    ext === 'xlsx' ||
    ext === 'csv'
  ) {
    return 'excel';
  }
  if (
    mt.includes('presentation') ||
    mt.includes('powerpoint') ||
    ext === 'ppt' ||
    ext === 'pptx'
  ) {
    return 'powerpoint';
  }
  if (mt.startsWith('video/')) return 'video';
  if (mt.startsWith('audio/')) return 'audio';
  if (
    mt.includes('zip') ||
    mt.includes('rar') ||
    ext === 'zip' ||
    ext === 'rar' ||
    ext === '7z'
  ) {
    return 'archive';
  }
  return 'generic';
}

export function getAttachmentVisual(mimeType: string, filename: string): AttachmentVisual {
  const kind = getAttachmentKind(mimeType, filename);
  switch (kind) {
    case 'image':
      return { kind, icon: 'image', color: '#E37400', bg: '#FEF7E0' };
    case 'pdf':
      return { kind, icon: 'document-text', color: '#D93025', bg: '#FCE8E6' };
    case 'word':
      return { kind, icon: 'document-text', color: '#1A73E8', bg: '#E8F0FE' };
    case 'excel':
      return { kind, icon: 'grid', color: '#188038', bg: '#E6F4EA' };
    case 'powerpoint':
      return { kind, icon: 'easel', color: '#E37400', bg: '#FEF7E0' };
    case 'video':
      return { kind, icon: 'videocam', color: '#9334E6', bg: '#F3E8FD' };
    case 'audio':
      return { kind, icon: 'musical-notes', color: '#9334E6', bg: '#F3E8FD' };
    case 'archive':
      return { kind, icon: 'archive', color: '#5F6368', bg: '#F1F3F4' };
    default:
      return { kind, icon: 'document-outline', color: '#5F6368', bg: '#F1F3F4' };
  }
}

export function isPreviewableMime(mimeType: string): boolean {
  return (
    mimeType.startsWith('image/') ||
    mimeType === 'application/pdf' ||
    mimeType.startsWith('text/')
  );
}

export function truncateFilename(name: string, max = 22): string {
  if (name.length <= max) return name;
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  const base = ext ? name.slice(0, name.length - ext.length) : name;
  const keep = Math.max(4, max - ext.length - 1);
  return `${base.slice(0, keep)}…${ext}`;
}

/** Download (if needed) and return a cache file URI for share/save. */
export async function getAttachmentUri(
  messageId: string,
  attachmentId: string,
  filename: string,
  mimeType: string
): Promise<string> {
  const key = cacheKey(messageId, attachmentId);
  const cached = URI_CACHE.get(key);
  if (cached && (await cacheFileExists(cached))) {
    return cached;
  }

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in');

  const url = gmailApi.attachmentUrl(messageId, attachmentId, filename, mimeType);
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  const cacheName = `gmail_att_${attachmentId}_${safe}`;

  const { uri } = await downloadUrlToCacheFile(url, CACHE_SUBDIR, cacheName, {
    Authorization: `Bearer ${token}`,
  });

  URI_CACHE.set(key, uri);
  IMAGE_DATA_URI_CACHE.delete(key);
  return uri;
}

/** @deprecated Use getAttachmentUri */
export async function getAttachmentFile(
  messageId: string,
  attachmentId: string,
  filename: string,
  mimeType: string
): Promise<{ uri: string }> {
  const uri = await getAttachmentUri(messageId, attachmentId, filename, mimeType);
  return { uri };
}

export async function fetchAttachmentToCache(
  messageId: string,
  attachmentId: string,
  filename: string,
  mimeType: string
): Promise<string> {
  return getAttachmentUri(messageId, attachmentId, filename, mimeType);
}

export async function fetchAttachmentImageDataUri(
  messageId: string,
  attachmentId: string,
  filename: string,
  mimeType: string
): Promise<string> {
  const key = cacheKey(messageId, attachmentId);
  const hit = IMAGE_DATA_URI_CACHE.get(key);
  if (hit) return hit;

  const uri = await getAttachmentUri(messageId, attachmentId, filename, mimeType);
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  let mime = mimeType.startsWith('image/') ? mimeType : 'image/jpeg';
  if (!mimeType.startsWith('image/')) {
    if (ext === 'png') mime = 'image/png';
    else if (ext === 'gif') mime = 'image/gif';
    else if (ext === 'webp') mime = 'image/webp';
  }
  const base64 = await readCacheFileBase64(uri);
  const dataUri = `data:${mime};base64,${base64}`;
  IMAGE_DATA_URI_CACHE.set(key, dataUri);
  return dataUri;
}

export function peekAttachmentImageDataUri(
  messageId: string,
  attachmentId: string
): string | undefined {
  return IMAGE_DATA_URI_CACHE.get(cacheKey(messageId, attachmentId));
}

export function clearGmailAttachmentCaches(): void {
  URI_CACHE.clear();
  IMAGE_DATA_URI_CACHE.clear();
}
