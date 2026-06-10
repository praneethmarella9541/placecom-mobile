import { gmailApi } from './api';
import { showAppToast } from './app-toast';
import { cacheDeleteInboxFolder } from './cache';
import {
  fetchAttachmentBase64Directly,
  sendMailDirectly,
  type DirectSendAttachment,
} from './gmail-send-direct';

export type OutboxAttachment = {
  filename: string;
  mimeType: string;
  uri: string;
  base64Data?: string;
  attachmentId?: string;
  savedMessageId?: string;
  status: string;
};

export type ComposeOutboxPayload = {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  textBody: string;
  htmlBody: string;
  draftId?: string;
  attachments: OutboxAttachment[];
};

export type ReplyOutboxPayload = {
  to: string;
  cc?: string;
  subject: string;
  textBody: string;
  threadId?: string;
  inReplyToMessageId?: string;
  attachments: OutboxAttachment[];
  useDirectSend: boolean;
};

async function resolveOutboxAttachments(
  accessToken: string,
  attachments: OutboxAttachment[]
): Promise<DirectSendAttachment[]> {
  return Promise.all(
    attachments.map(async (f) => {
      if (f.status === 'saved' && f.attachmentId && f.savedMessageId) {
        const base64Data = await fetchAttachmentBase64Directly(
          accessToken,
          f.savedMessageId,
          f.attachmentId
        );
        return { filename: f.filename, mimeType: f.mimeType, uri: '', base64Data };
      }
      return {
        filename: f.filename,
        mimeType: f.mimeType,
        uri: f.uri,
        base64Data: f.base64Data,
      };
    })
  );
}

export function queueComposeMailSend(payload: ComposeOutboxPayload): void {
  showAppToast('Sending…', 'info', 120_000);

  void (async () => {
    try {
      const { accessToken } = await gmailApi.getGoogleToken();
      const attachments = payload.attachments.length
        ? await resolveOutboxAttachments(accessToken, payload.attachments)
        : [];

      await sendMailDirectly({
        accessToken,
        to: payload.to,
        cc: payload.cc,
        bcc: payload.bcc,
        subject: payload.subject,
        textBody: payload.textBody,
        htmlBody: payload.htmlBody,
        attachments,
      });

      if (payload.draftId) {
        try {
          await gmailApi.deleteDraft(payload.draftId);
        } catch {
          /* non-fatal */
        }
      }

      cacheDeleteInboxFolder('sent');
      cacheDeleteInboxFolder('drafts');
      showAppToast('Sent', 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong';
      console.error('[mail-outbox] compose send failed:', msg);
      showAppToast('Failed to send', 'error', 4000);
    }
  })();
}

export function queueReplyMailSend(payload: ReplyOutboxPayload): void {
  showAppToast('Sending…', 'info', 120_000);

  void (async () => {
    try {
      if (payload.useDirectSend) {
        const { accessToken } = await gmailApi.getGoogleToken();
        const attachments = payload.attachments.length
          ? await resolveOutboxAttachments(accessToken, payload.attachments)
          : [];
        await sendMailDirectly({
          accessToken,
          to: payload.to,
          cc: payload.cc,
          subject: payload.subject,
          textBody: payload.textBody,
          threadId: payload.threadId,
          inReplyToMessageId: payload.inReplyToMessageId,
          attachments,
        });
      } else {
        await gmailApi.send({
          to: payload.to,
          cc: payload.cc,
          subject: payload.subject,
          textBody: payload.textBody,
          threadId: payload.threadId,
          inReplyToMessageId: payload.inReplyToMessageId,
        });
      }

      cacheDeleteInboxFolder('sent');
      showAppToast('Sent', 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong';
      console.error('[mail-outbox] reply send failed:', msg);
      showAppToast('Failed to send', 'error', 4000);
    }
  })();
}
