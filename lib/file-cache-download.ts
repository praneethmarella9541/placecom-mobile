import * as FileSystem from 'expo-file-system/legacy';

export type CacheDownloadResult = {
  uri: string;
};

const DOWNLOAD_TIMEOUT_MS = 90_000;

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  if (typeof globalThis.btoa === 'function') {
    return globalThis.btoa(binary);
  }
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let i = 0; i < binary.length; i += 3) {
    const a = binary.charCodeAt(i);
    const b = i + 1 < binary.length ? binary.charCodeAt(i + 1) : 0;
    const c = i + 2 < binary.length ? binary.charCodeAt(i + 2) : 0;
    const n = (a << 16) | (b << 8) | c;
    output +=
      chars[(n >> 18) & 63] +
      chars[(n >> 12) & 63] +
      (i + 1 < binary.length ? chars[(n >> 6) & 63] : '=') +
      (i + 2 < binary.length ? chars[n & 63] : '=');
  }
  return output;
}

/**
 * Download into app cache via fetch + legacy write (Base64).
 * Avoids FileSystem.downloadAsync / File.create permission failures on Android.
 */
export async function downloadUrlToCacheFile(
  url: string,
  cacheSubdir: string,
  filename: string,
  headers?: Record<string, string>
): Promise<CacheDownloadResult> {
  const root = FileSystem.cacheDirectory;
  if (!root) throw new Error('Cache directory unavailable');

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 200);
  const dir = `${root}${cacheSubdir}/`;
  const dest = `${dir}${safeName}`;

  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

  const info = await FileSystem.getInfoAsync(dest);
  if (info.exists) {
    await FileSystem.deleteAsync(dest, { idempotent: true });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, { headers, signal: controller.signal });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Network request failed';
    throw new Error(`Could not download file: ${msg}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Download failed (${res.status})${text ? `: ${text.slice(0, 200)}` : ''}`
    );
  }

  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length === 0) {
    throw new Error('Download returned an empty file');
  }

  await FileSystem.writeAsStringAsync(dest, uint8ArrayToBase64(bytes), {
    encoding: FileSystem.EncodingType.Base64,
  });

  const written = await FileSystem.getInfoAsync(dest);
  if (!written.exists || (written.size ?? 0) === 0) {
    throw new Error('Failed to save file to cache');
  }

  return { uri: dest };
}

export async function cacheFileExists(uri: string): Promise<boolean> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists && (info.size ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function readCacheFileBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

export async function readCacheFileText(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri);
}
