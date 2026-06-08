import { getAttachmentKind } from './gmail-attachments';
import { readCacheFileBase64, readCacheFileText } from './file-cache-download';
import { readLocalFileHead } from './drive-file-read';
import { wrapPdfPreviewHtml } from './preview-html';

export type AttachmentPreviewContent =
  | { type: 'data-uri'; uri: string }
  | { type: 'html'; html: string }
  | { type: 'unavailable' };

function imageMimeType(mimeType: string, filename: string): string {
  if (mimeType.startsWith('image/')) return mimeType;
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'png') return 'image/png';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

async function uriStartsWithPdf(uri: string): Promise<boolean> {
  try {
    const head = await readLocalFileHead(uri, 5);
    return head.startsWith('%PDF');
  } catch {
    return false;
  }
}

/** Build in-memory preview content — never uses file:// in Image/WebView. */
export async function buildAttachmentPreviewContent(
  cacheUri: string,
  filename: string,
  mimeType: string
): Promise<AttachmentPreviewContent> {
  const kind = getAttachmentKind(mimeType, filename);
  const base64 = await readCacheFileBase64(cacheUri);

  if (kind === 'image') {
    const mime = imageMimeType(mimeType, filename);
    return { type: 'data-uri', uri: `data:${mime};base64,${base64}` };
  }

  if (kind === 'pdf' || (await uriStartsWithPdf(cacheUri))) {
    return { type: 'html', html: wrapPdfPreviewHtml(base64) };
  }

  if (mimeType.startsWith('text/')) {
    try {
      const text = await readCacheFileText(cacheUri);
      return {
        type: 'html',
        html: `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:12px;font-family:monospace;font-size:13px;white-space:pre-wrap;word-break:break-word;">${text
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')}</body></html>`,
      };
    } catch {
      return { type: 'unavailable' };
    }
  }

  return { type: 'unavailable' };
}
