import { gmailApi } from './api';

type DraftAttachmentPayload = {
  filename: string;
  mimeType: string;
  base64Data: string;
};
import { fetchAttachmentBase64Directly, readFileAsBase64 } from './gmail-send-direct';
import { stripOuterHtml } from './html-email';

export type DraftFileLike = {
  key: string;
  name: string;
  mimeType: string;
  size: number;
  uri: string;
  status: 'preparing' | 'ready' | 'staged' | 'uploading' | 'drive' | 'saved' | 'error';
  base64Data?: string;
  driveLink?: string;
  /** uploadId returned by /api/gmail/drafts/attachment-chunk (Tier 2: 3–25 MB). */
  stagedUploadId?: string;
  attachmentId?: string;
  savedMessageId?: string;
};

/**
 * Strip the drive-links footer table added by `appendDriveLinksToDraftHtml`
 * from a body string. Call this when loading a draft so the chips can be
 * restored independently and the table is not duplicated on the next save.
 */
export function stripDriveLinksFromHtml(htmlBody: string): string {
  if (!htmlBody) return htmlBody;
  // The footer starts with: <br><table style="border-top:1px solid #e0e0e0;...">
  // and ends with </table>. We strip everything from the first such table onwards
  // if it contains the sentinel "Files shared from Google Drive".
  return htmlBody.replace(
    /<br\s*\/?>\s*<table[^>]*border-top:1px solid #e0e0e0[^>]*>[\s\S]*?<\/table>/gi,
    ''
  ).trim();
}

/**
 * Parse Drive file entries that were previously embedded in a draft body by
 * `appendDriveLinksToDraftHtml`. Returns them as DraftFileLike rows so the
 * compose screen can restore the chip UI without re-uploading.
 *
 * Drive entries look like:
 *   <a href="https://drive.google.com/file/d/ID/view">📎 filename</a>
 */
export function extractDriveLinksFromHtml(htmlBody: string): DraftFileLike[] {
  if (!htmlBody) return [];
  const results: DraftFileLike[] = [];
  // Match every anchor that looks like a Drive share link
  const re = /href="(https:\/\/drive\.google\.com\/file\/d\/[^"]+\/view)"[^>]*>(?:📎\s*)?([^<]+)</gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(htmlBody)) !== null) {
    const driveLink = m[1];
    const name = m[2].replace(/\(Drive\)/i, '').trim();
    if (!driveLink || !name) continue;
    results.push({
      key: `drive-${driveLink}`,
      name,
      mimeType: 'application/octet-stream',
      size: 0,
      uri: '',
      status: 'drive',
      driveLink,
    });
  }
  return results;
}

export function appendDriveLinksToDraftHtml(htmlBody: string, files: DraftFileLike[]): string {
  const driveLinks = files.filter((f) => f.status === 'drive' && f.driveLink);
  if (driveLinks.length === 0) return htmlBody;

  const linkHtml = driveLinks
    .map(
      (f) =>
        `<tr><td style="padding:4px 0;font-size:13px;color:#1a73e8;">` +
        `<a href="${f.driveLink}" style="color:#1a73e8;text-decoration:none;" target="_blank">` +
        `📎 ${f.name}</a>` +
        `<span style="color:#5f6368;font-size:11px;margin-left:6px;">(Drive)</span></td></tr>`
    )
    .join('');

  return (
    `${htmlBody}` +
    `<br><table style="border-top:1px solid #e0e0e0;margin-top:12px;padding-top:8px;width:100%">` +
    `<tr><td style="font-size:11px;color:#5f6368;padding-bottom:4px;">Files shared from Google Drive</td></tr>` +
    linkHtml +
    `</table>`
  );
}

/** Prefer saved HTML; fall back to plain text wrapped for the rich editor. */
export function draftHtmlForEditor(textBody: string, htmlBody?: string): string {
  if (htmlBody?.trim()) {
    return stripOuterHtml(htmlBody);
  }
  if (!textBody.trim()) return '';
  if (/<\/?[a-z][\s\S]*>/i.test(textBody)) {
    return stripOuterHtml(textBody);
  }
  return textBody
    .split(/\n\n+/)
    .map((para) => `<p>${para.replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function draftAttachmentFingerprint(f: DraftFileLike): string {
  if (f.status === 'saved' && f.attachmentId) {
    return `saved:${f.attachmentId}:${f.name}`;
  }
  if (f.status === 'ready') {
    return `ready:${f.name}:${f.size}:${f.mimeType}`;
  }
  if (f.status === 'staged' && f.stagedUploadId) {
    return `staged:${f.stagedUploadId}`;
  }
  if (f.status === 'drive' && f.driveLink) {
    return `drive:${f.driveLink}`;
  }
  return `${f.status}:${f.name}:${f.size}`;
}

async function encodeDraftAttachments(
  files: DraftFileLike[],
  accessToken: string
): Promise<DraftAttachmentPayload[]> {
  const out: DraftAttachmentPayload[] = [];
  for (const f of files) {
    if (f.status === 'saved' && f.attachmentId && f.savedMessageId) {
      const base64Data = await fetchAttachmentBase64Directly(
        accessToken,
        f.savedMessageId,
        f.attachmentId
      );
      out.push({ filename: f.name, mimeType: f.mimeType, base64Data });
      continue;
    }
    if (f.status === 'ready') {
      const base64Data = f.base64Data ?? (await readFileAsBase64(f.uri));
      out.push({ filename: f.name, mimeType: f.mimeType, base64Data });
    }
  }
  return out;
}

/** Rehydrate attachment rows after Gmail rotates message/attachment ids on save. */
export function draftAttachmentsToFiles(
  attachments: Array<{
    attachmentId: string;
    filename: string;
    mimeType: string;
    size: number;
    messageId: string;
  }>,
  messageId?: string,
  nextKey: () => string = () => String(Date.now())
): DraftFileLike[] {
  return attachments.map((a) => ({
    key: nextKey(),
    name: a.filename,
    mimeType: a.mimeType,
    size: a.size,
    uri: '',
    status: 'saved' as const,
    attachmentId: a.attachmentId,
    savedMessageId: a.messageId ?? messageId,
  }));
}

export async function saveComposeDraft(opts: {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  htmlBody: string;
  draftId?: string;
  attachments: DraftFileLike[];
}): Promise<{ draftId: string; messageId?: string }> {
  const htmlBody = appendDriveLinksToDraftHtml(opts.htmlBody, opts.attachments);
  const hasSaved  = opts.attachments.some((f) => f.status === 'saved');
  const hasNewReady = opts.attachments.some((f) => f.status === 'ready');
  const hasStaged = opts.attachments.some((f) => f.status === 'staged');
  const hasDrive  = opts.attachments.some((f) => f.status === 'drive');

  const preserveAttachments =
    !!opts.draftId && hasSaved && !hasNewReady && !hasStaged && !hasDrive;
  const mergeExistingAttachments = !!opts.draftId && hasSaved && (hasNewReady || hasStaged);

  let filesToEncode: DraftFileLike[] = [];
  if (mergeExistingAttachments) {
    filesToEncode = opts.attachments.filter((f) => f.status === 'ready');
  } else if (!preserveAttachments) {
    filesToEncode = opts.attachments.filter(
      (f) => f.status === 'ready' || f.status === 'saved'
    );
  }

  // Tier 2: collect staged upload IDs (3–25 MB files already uploaded to server).
  const stagedUploadIds = opts.attachments
    .filter((f) => f.status === 'staged' && f.stagedUploadId)
    .map((f) => f.stagedUploadId as string);

  let attachments: DraftAttachmentPayload[] | undefined;
  if (filesToEncode.length > 0) {
    const { accessToken } = await gmailApi.getGoogleToken();
    attachments = await encodeDraftAttachments(filesToEncode, accessToken);
  }

  const res = await gmailApi.saveDraft({
    to: opts.to.trim(),
    cc: opts.cc.trim() || undefined,
    bcc: opts.bcc.trim() || undefined,
    subject: opts.subject.trim(),
    textBody: '',
    htmlBody,
    draftId: opts.draftId,
    preserveAttachments: preserveAttachments || undefined,
    mergeExistingAttachments: mergeExistingAttachments || undefined,
    attachments,
    stagedUploadIds: stagedUploadIds.length > 0 ? stagedUploadIds : undefined,
  });

  return { draftId: res.draftId, messageId: res.messageId };
}
