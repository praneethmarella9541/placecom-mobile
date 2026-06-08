import { gmailApi } from './api';

type DraftAttachmentPayload = {
  filename: string;
  mimeType: string;
  base64Data: string;
};
import { fetchAttachmentBase64Directly, readFileAsBase64 } from './gmail-send-direct';
import { stripOuterHtml } from './html-email';

type DraftFileLike = {
  key: string;
  name: string;
  mimeType: string;
  size: number;
  uri: string;
  status: 'preparing' | 'ready' | 'uploading' | 'drive' | 'saved' | 'error';
  base64Data?: string;
  driveLink?: string;
  attachmentId?: string;
  savedMessageId?: string;
};

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
  const hasSaved = opts.attachments.some((f) => f.status === 'saved');
  const hasNewReady = opts.attachments.some((f) => f.status === 'ready');
  const hasDrive = opts.attachments.some((f) => f.status === 'drive');

  const preserveAttachments =
    !!opts.draftId && hasSaved && !hasNewReady && !hasDrive;
  const mergeExistingAttachments = !!opts.draftId && hasSaved && hasNewReady;

  let filesToEncode: DraftFileLike[] = [];
  if (mergeExistingAttachments) {
    filesToEncode = opts.attachments.filter((f) => f.status === 'ready');
  } else if (!preserveAttachments) {
    filesToEncode = opts.attachments.filter(
      (f) => f.status === 'ready' || f.status === 'saved'
    );
  }

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
  });

  return { draftId: res.draftId, messageId: res.messageId };
}
