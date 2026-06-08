import * as XLSX from 'xlsx';
import { Platform } from 'react-native';
import { File } from 'expo-file-system';
import type { DriveFile } from './types';
import { getFileExtension } from './drive-utils';
import { isLocalPdfFile, readLocalFileAsBase64 } from './drive-file-read';
import { exportDriveFileToPdfCache, canExportDriveFileToPdf } from './drive-export-direct';

export type DrivePreviewKind = 'pdf' | 'image' | 'csv' | 'office' | 'unsupported';

export type DrivePreviewContent =
  | { type: 'file-uri'; uri: string }
  | { type: 'html'; html: string }
  | { type: 'unavailable' };

const EXTENSION_KIND: Record<string, DrivePreviewKind> = {
  pdf: 'pdf',
  jpg: 'image',
  jpeg: 'image',
  png: 'image',
  csv: 'csv',
  xlsx: 'office',
  xls: 'office',
  ppt: 'office',
  pptx: 'office',
};

const IMAGE_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

export { getFileExtension };

export function getDrivePreviewKind(file: DriveFile): DrivePreviewKind {
  const ext = getFileExtension(file.name);
  if (EXTENSION_KIND[ext]) return EXTENSION_KIND[ext]!;

  if (file.mimeType === 'application/pdf') return 'pdf';
  if (file.mimeType.startsWith('image/')) return 'image';
  if (file.mimeType === 'text/csv' || file.mimeType === 'application/csv') return 'csv';
  if (
    file.mimeType.includes('spreadsheet') ||
    file.mimeType === 'application/vnd.google-apps.spreadsheet' ||
    file.mimeType === 'application/vnd.ms-excel'
  ) {
    return 'office';
  }
  if (
    file.mimeType.includes('presentation') ||
    file.mimeType === 'application/vnd.google-apps.presentation' ||
    file.mimeType === 'application/vnd.ms-powerpoint'
  ) {
    return 'office';
  }

  return 'unsupported';
}

export function canPreviewDriveFile(file: DriveFile): boolean {
  return getDrivePreviewKind(file) !== 'unsupported';
}

async function readFileAsText(uri: string): Promise<string> {
  const res = await fetch(uri);
  if (!res.ok) throw new Error('Could not read file');
  return res.text();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapDocumentHtml(inner: string, title: string): string {
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=4.0"/>
<title>${escapeHtml(title)}</title>
<style>
body{margin:0;font-family:Roboto,Arial,sans-serif;font-size:13px;background:#fff;color:#202124;}
.wrap{overflow:auto;padding:12px;-webkit-overflow-scrolling:touch;}
table{border-collapse:collapse;width:100%;min-width:max-content;}
th,td{border:1px solid #e8eaed;padding:8px 10px;text-align:left;white-space:nowrap;}
th{background:#f6f8fc;font-weight:600;position:sticky;top:0;}
tr:nth-child(even) td{background:#fafafa;}
</style></head><body><div class="wrap">${inner}</div></body></html>`;
}

function wrapPdfJsHtml(base64: string): string {
  const safe = base64.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=4.0"/>
<style>
html,body{margin:0;height:100%;background:#525659;}
#wrap{position:absolute;inset:0;overflow:auto;-webkit-overflow-scrolling:touch;}
canvas{display:block;margin:8px auto;box-shadow:0 1px 4px rgba(0,0,0,.3);}
#status{color:#fff;text-align:center;padding:24px;font-family:sans-serif;}
</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"><\/script>
</head><body>
<div id="status">Rendering PDF…</div>
<div id="wrap"></div>
<script>
(function(){
  var pdfjsLib = window['pdfjs-dist/build/pdf'] || window.pdfjsLib;
  if (!pdfjsLib) { document.getElementById('status').textContent = 'PDF viewer failed to load'; return; }
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var raw = atob('${safe}');
  var len = raw.length;
  var bytes = new Uint8Array(len);
  for (var i = 0; i < len; i++) bytes[i] = raw.charCodeAt(i);
  pdfjsLib.getDocument({ data: bytes }).promise.then(function(pdf) {
    document.getElementById('status').style.display = 'none';
    var wrap = document.getElementById('wrap');
    var chain = Promise.resolve();
    for (var p = 1; p <= pdf.numPages; p++) {
      (function(pageNum) {
        chain = chain.then(function() {
          return pdf.getPage(pageNum).then(function(page) {
            var viewport = page.getViewport({ scale: 1.35 });
            var canvas = document.createElement('canvas');
            var ctx = canvas.getContext('2d');
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            wrap.appendChild(canvas);
            return page.render({ canvasContext: ctx, viewport: viewport }).promise;
          });
        });
      })(p);
    }
    return chain;
  }).catch(function(err) {
    document.getElementById('status').textContent = 'Could not render PDF';
    console.error(err);
  });
})();
<\/script>
</body></html>`;
}

function wrapImageHtml(base64: string, mime: string): string {
  return wrapDocumentHtml(
    `<img src="data:${mime};base64,${base64}" style="max-width:100%;height:auto;display:block;margin:0 auto;" alt="preview"/>`,
    'Image'
  );
}

function parseCsvRow(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      cells.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

function wrapCsvHtml(csv: string): string {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(0, 200);
  const rows = lines.map(parseCsvRow);
  const tableRows = rows
    .map(
      (cells, ri) =>
        `<tr>${cells
          .map(
            (c) =>
              `<${ri === 0 ? 'th' : 'td'}>${escapeHtml(c.trim())}</${ri === 0 ? 'th' : 'td'}>`
          )
          .join('')}</tr>`
    )
    .join('');
  return wrapDocumentHtml(`<table>${tableRows}</table>`, 'CSV');
}

async function xlsxUriToHtml(uri: string): Promise<string | null> {
  try {
    const file = new File(uri);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(new Uint8Array(buf), { type: 'array' });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return null;
    const sheet = wb.Sheets[sheetName];
    const table = XLSX.utils.sheet_to_html(sheet, { header: '', id: 'sheet' });
    return wrapDocumentHtml(table, sheetName);
  } catch {
    return null;
  }
}

export interface ResolvePreviewInput {
  file: DriveFile;
  localUri: string;
}

/**
 * Turn a cached download into preview content (PDF / image / spreadsheet HTML).
 */
export async function buildDrivePreviewContent(
  localUri: string,
  file: DriveFile,
  kind: DrivePreviewKind
): Promise<DrivePreviewContent> {
  if (kind === 'unsupported') return { type: 'unavailable' };

  if (await isLocalPdfFile(localUri)) {
    if (Platform.OS === 'ios') {
      return { type: 'file-uri', uri: localUri };
    }
    const base64 = await readLocalFileAsBase64(localUri);
    return { type: 'html', html: wrapPdfJsHtml(base64) };
  }

  if (kind === 'pdf') {
    const base64 = await readLocalFileAsBase64(localUri);
    return { type: 'html', html: wrapPdfJsHtml(base64) };
  }

  if (kind === 'image') {
    const ext = getFileExtension(file.name);
    const mime = IMAGE_MIME[ext] ?? 'image/jpeg';
    const base64 = await readLocalFileAsBase64(localUri);
    return { type: 'html', html: wrapImageHtml(base64, mime) };
  }

  if (kind === 'csv') {
    const text = await readFileAsText(localUri);
    return { type: 'html', html: wrapCsvHtml(text) };
  }

  if (kind === 'office') {
    const ext = getFileExtension(file.name);
    if (ext === 'xlsx' || ext === 'xls') {
      const sheetHtml = await xlsxUriToHtml(localUri);
      if (sheetHtml) return { type: 'html', html: sheetHtml };
    }
    return { type: 'unavailable' };
  }

  return { type: 'unavailable' };
}

/** Download / export file for preview — tries Drive PDF export for Office types. */
/** PDF.js HTML fallback when native WebView cannot open file:// PDFs (common on Android). */
export async function pdfUriToPdfJsHtml(uri: string): Promise<string> {
  const base64 = await readLocalFileAsBase64(uri);
  return wrapPdfJsHtml(base64);
}

export async function resolveDrivePreviewFile(file: DriveFile): Promise<string> {
  const kind = getDrivePreviewKind(file);
  const ext = getFileExtension(file.name);

  if (kind === 'pdf' || ext === 'pdf' || file.mimeType === 'application/pdf') {
    const { fetchDriveFileToCache } = await import('./drive-download');
    return fetchDriveFileToCache(file.id, file.name, 'preview', file.mimeType);
  }

  if (kind === 'office' && canExportDriveFileToPdf(file.mimeType, file.name)) {
    const exported = await exportDriveFileToPdfCache(file.id, file.name);
    if (exported && (await isLocalPdfFile(exported))) {
      return exported;
    }
  }

  const { fetchDriveFileToCache } = await import('./drive-download');
  return fetchDriveFileToCache(file.id, file.name, 'preview', file.mimeType);
}
