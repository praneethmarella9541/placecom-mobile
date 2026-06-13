import { showAppToast } from './app-toast';
import { cacheDeleteInboxFolder } from './cache';
import type { ComposeDraftSnapshot } from './compose-draft-save';
import { saveComposeDraft } from './gmail-draft-compose';
import { sanitizeEmailHtml } from './html-email';

export type DraftOutboxOptions = {
  /** Called when a brand-new draft is created (not an update). */
  onDraftCreated?: () => void;
};

/**
 * Save a compose draft in the background (including large attachments).
 * Returns immediately — show toast while Gmail upload runs.
 */
export function queueComposeDraftSave(
  snapshot: ComposeDraftSnapshot,
  opts?: DraftOutboxOptions
): void {
  const isNewDraft = !snapshot.draftId;
  showAppToast('Saving draft…', 'info', 120_000);

  void (async () => {
    try {
      const htmlBody = sanitizeEmailHtml(snapshot.htmlBody);
      await saveComposeDraft({
        to: snapshot.to,
        cc: snapshot.cc,
        bcc: snapshot.bcc,
        subject: snapshot.subject,
        htmlBody,
        draftId: snapshot.draftId,
        attachments: snapshot.attachments.map((f) => ({ ...f })),
      });

      cacheDeleteInboxFolder('drafts');
      if (isNewDraft) opts?.onDraftCreated?.();
      showAppToast('Draft saved', 'success');
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Something went wrong';
      console.error('[draft-outbox] save failed:', msg);
      showAppToast('Failed to save draft', 'error', 5000);
    }
  })();
}
