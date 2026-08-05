import type { Ionicons } from '@expo/vector-icons';
import type { DriveFile } from './types';

export type DriveMimeIcon = {
  name: keyof typeof Ionicons.glyphMap;
  color: string;
  bg: string;
};

const MIME_ICONS: Record<string, DriveMimeIcon> = {
  'application/vnd.google-apps.folder': { name: 'folder', color: '#FFFFFF', bg: '#F9AB00' },
  'application/pdf': { name: 'document-text', color: '#FFFFFF', bg: '#D93025' },
  'image/jpeg': { name: 'image', color: '#FFFFFF', bg: '#9334E6' },
  'image/png': { name: 'image', color: '#FFFFFF', bg: '#9334E6' },
  'image/gif': { name: 'image', color: '#FFFFFF', bg: '#9334E6' },
  'image/webp': { name: 'image', color: '#FFFFFF', bg: '#9334E6' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    name: 'grid',
    color: '#FFFFFF',
    bg: '#188038',
  },
  'application/vnd.google-apps.spreadsheet': { name: 'grid', color: '#FFFFFF', bg: '#188038' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    name: 'document-text',
    color: '#FFFFFF',
    bg: '#1A73E8',
  },
  'application/vnd.google-apps.document': { name: 'document-text', color: '#FFFFFF', bg: '#1A73E8' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': {
    name: 'easel',
    color: '#FFFFFF',
    bg: '#E37400',
  },
  'application/vnd.google-apps.presentation': { name: 'easel', color: '#FFFFFF', bg: '#E37400' },
  'video/mp4': { name: 'videocam', color: '#FFFFFF', bg: '#D93025' },
  'audio/mpeg': { name: 'musical-notes', color: '#FFFFFF', bg: '#E37400' },
  'application/zip': { name: 'archive', color: '#FFFFFF', bg: '#5F6368' },
};

const DEFAULT_ICON: DriveMimeIcon = { name: 'document-outline', color: '#FFFFFF', bg: '#5F6368' };

export function getDriveMimeIcon(mime: string): DriveMimeIcon {
  if (MIME_ICONS[mime]) return MIME_ICONS[mime];
  if (mime.startsWith('image/')) return MIME_ICONS['image/png']!;
  if (mime.startsWith('video/')) return MIME_ICONS['video/mp4']!;
  if (mime.startsWith('audio/')) return MIME_ICONS['audio/mpeg']!;
  return DEFAULT_ICON;
}

export function isDriveFolder(file: DriveFile): boolean {
  return file.mimeType === 'application/vnd.google-apps.folder';
}

export function isGoogleWorkspaceFile(mime: string): boolean {
  return mime.startsWith('application/vnd.google-apps.') && mime !== 'application/vnd.google-apps.folder';
}

export function formatDriveSize(size: string | null | undefined): string {
  if (!size) return '';
  const n = parseInt(size, 10);
  if (Number.isNaN(n)) return '';
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (n > 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n > 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

export function formatDriveDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 7 * 86_400_000) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

export type DriveSortKey = 'name' | 'modified' | 'size';
export type DriveSortDir = 'asc' | 'desc';

/** Sensible default direction the first time a column is selected. */
export function defaultDriveSortDir(sortBy: DriveSortKey): DriveSortDir {
  return sortBy === 'name' ? 'asc' : 'desc';
}

export function sortDriveFiles(
  files: DriveFile[],
  sortBy: DriveSortKey,
  dir: DriveSortDir = defaultDriveSortDir(sortBy)
): DriveFile[] {
  const folders = files.filter(isDriveFolder);
  const rest = files.filter((f) => !isDriveFolder(f));
  const base = (a: DriveFile, b: DriveFile) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    if (sortBy === 'size') {
      const sa = parseInt(a.size ?? '0', 10) || 0;
      const sb = parseInt(b.size ?? '0', 10) || 0;
      return sa - sb;
    }
    return new Date(a.modifiedTime).getTime() - new Date(b.modifiedTime).getTime();
  };
  const cmp = (a: DriveFile, b: DriveFile) => (dir === 'asc' ? base(a, b) : -base(a, b));
  return [...folders.sort(cmp), ...rest.sort(cmp)];
}

export function safeDriveCacheName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

export function getFileExtension(name: string): string {
  const i = name.lastIndexOf('.');
  if (i < 0) return '';
  return name.slice(i + 1).toLowerCase();
}
