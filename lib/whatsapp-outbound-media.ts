import * as ImageManipulator from 'expo-image-manipulator';

const HEIC_RE = /\.(heic|heif)$/i;
const HEIC_MIME_RE = /^image\/(heic|heif)$/i;

/** True when the asset may still be HEIC despite picker metadata. */
export function needsImageTranscode(uri: string, mimeType: string): boolean {
  const m = (mimeType ?? '').toLowerCase();
  if (HEIC_MIME_RE.test(m)) return true;
  if (HEIC_RE.test(uri)) return true;
  // iPhone camera sometimes labels JPEG while the file is still HEIC.
  if (m === 'image/jpeg' && uri.toLowerCase().includes('.heic')) return true;
  return false;
}

/** Re-encode to JPEG so WhatsApp / Exotel accept the outbound image. */
export async function transcodeImageToJpeg(
  uri: string,
  baseName = 'photo'
): Promise<{ uri: string; name: string; mimeType: string }> {
  const result = await ImageManipulator.manipulateAsync(uri, [], {
    compress: 0.85,
    format: ImageManipulator.SaveFormat.JPEG,
  });
  const safe = baseName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_') || 'photo';
  return { uri: result.uri, name: `${safe}.jpg`, mimeType: 'image/jpeg' };
}

export async function normalizeOutboundImageAsset(
  input: {
    localUri: string;
    name: string;
    mimeType: string;
  },
  opts?: { force?: boolean }
): Promise<{ localUri: string; name: string; mimeType: string }> {
  if (!opts?.force && !needsImageTranscode(input.localUri, input.mimeType)) {
    const mime = input.mimeType?.startsWith('image/') ? input.mimeType : 'image/jpeg';
    const name = input.name || 'photo.jpg';
    return { localUri: input.localUri, name, mimeType: mime };
  }
  const out = await transcodeImageToJpeg(input.localUri, input.name);
  return { localUri: out.uri, name: out.name, mimeType: out.mimeType };
}
