import * as FileSystem from 'expo-file-system/legacy';

/** Read a cached file URI into base64 (legacy FileSystem — reliable on Android). */
export async function readLocalFileAsBase64(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
}

export async function readLocalFileText(uri: string): Promise<string> {
  return FileSystem.readAsStringAsync(uri);
}

export async function readLocalFileBytes(uri: string): Promise<Uint8Array> {
  const base64 = await readLocalFileAsBase64(uri);
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export async function readLocalFileHead(uri: string, byteCount = 8): Promise<string> {
  const base64 = await readLocalFileAsBase64(uri);
  const raw = atob(base64.slice(0, Math.ceil((byteCount * 4) / 3)));
  return raw.slice(0, byteCount);
}

export async function isLocalPdfFile(uri: string): Promise<boolean> {
  try {
    const head = await readLocalFileHead(uri, 5);
    return head.startsWith('%PDF');
  } catch {
    return false;
  }
}
