import { cacheDeleteInboxFolder } from './cache';
import { saveComposeDraft, type DraftFileLike } from './gmail-draft-compose';
import { sanitizeEmailHtml } from './html-email';

export type DraftSaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export type ComposeDraftSnapshot = {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
  htmlBody: string;
  draftId?: string;
  attachments: DraftFileLike[];
};

export type DraftSaveResult = {
  draftId: string;
  messageId?: string;
  hadAttachmentPayload: boolean;
};

export type ComposeDraftSnapshotSource =
  | ComposeDraftSnapshot
  | (() => ComposeDraftSnapshot | Promise<ComposeDraftSnapshot>);

function snapshotKey(s: ComposeDraftSnapshot): string {
  return JSON.stringify({
    to: s.to,
    cc: s.cc,
    bcc: s.bcc,
    subject: s.subject,
    htmlBody: s.htmlBody,
    draftId: s.draftId ?? '',
    files: s.attachments.map((f) => `${f.status}:${f.name}:${f.size}:${f.attachmentId ?? ''}`),
  });
}

async function resolveSnapshot(source: ComposeDraftSnapshotSource): Promise<ComposeDraftSnapshot> {
  return typeof source === 'function' ? source() : source;
}

export type ComposeDraftSaver = {
  queueSave: (source: ComposeDraftSnapshotSource) => void;
  flushSave: (source: ComposeDraftSnapshotSource) => Promise<DraftSaveResult | null>;
  getStatus: () => DraftSaveStatus;
  getKnownDraftId: () => string | undefined;
  setKnownDraftId: (draftId: string | undefined) => void;
  markSaved: (snapshot: ComposeDraftSnapshot) => void;
  cancelPending: () => void;
  subscribe: (listener: (status: DraftSaveStatus) => void) => () => void;
};

export function createComposeDraftSaver(
  debounceMs = 2000,
  onSaved?: (result: DraftSaveResult, snapshot: ComposeDraftSnapshot) => void
): ComposeDraftSaver {
  let status: DraftSaveStatus = 'idle';
  let lastSavedKey = '';
  let saving = false;
  let pendingSource: ComposeDraftSnapshotSource | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let knownDraftId: string | undefined;
  let inFlight: Promise<DraftSaveResult | null> | null = null;
  const listeners = new Set<(status: DraftSaveStatus) => void>();

  const setStatus = (next: DraftSaveStatus) => {
    status = next;
    listeners.forEach((l) => l(next));
  };

  async function runSave(source: ComposeDraftSnapshotSource): Promise<DraftSaveResult | null> {
    if (inFlight) {
      await inFlight;
    }

    const raw = await resolveSnapshot(source);
    const snapshot: ComposeDraftSnapshot = {
      ...raw,
      draftId: raw.draftId ?? knownDraftId,
    };

    const key = snapshotKey(snapshot);
    if (key === lastSavedKey) {
      setStatus('saved');
      return snapshot.draftId
        ? { draftId: snapshot.draftId, hadAttachmentPayload: false }
        : null;
    }

    if (saving) {
      pendingSource = source;
      return snapshot.draftId
        ? { draftId: snapshot.draftId, hadAttachmentPayload: false }
        : null;
    }

    saving = true;
    setStatus('saving');

    const doSave = async (): Promise<DraftSaveResult | null> => {
      try {
        const htmlBody = sanitizeEmailHtml(snapshot.htmlBody);
        const hasSaved = snapshot.attachments.some((f) => f.status === 'saved');
        const hasNewReady = snapshot.attachments.some((f) => f.status === 'ready');
        const hasDrive = snapshot.attachments.some((f) => f.status === 'drive');
        const preserveAttachments =
          !!snapshot.draftId && hasSaved && !hasNewReady && !hasDrive;
        const mergeExistingAttachments = !!snapshot.draftId && hasSaved && hasNewReady;
        const filesToEncode =
          mergeExistingAttachments
            ? snapshot.attachments.filter((f) => f.status === 'ready')
            : preserveAttachments
              ? []
              : snapshot.attachments.filter((f) => f.status === 'ready' || f.status === 'saved');
        const hadAttachmentPayload = filesToEncode.length > 0;

        const res = await saveComposeDraft({
          to: snapshot.to,
          cc: snapshot.cc,
          bcc: snapshot.bcc,
          subject: snapshot.subject,
          htmlBody,
          draftId: snapshot.draftId,
          attachments: snapshot.attachments,
        });

        knownDraftId = res.draftId;
        const savedSnapshot: ComposeDraftSnapshot = {
          ...snapshot,
          draftId: res.draftId,
          htmlBody,
        };
        lastSavedKey = snapshotKey(savedSnapshot);
        cacheDeleteInboxFolder('drafts');
        setStatus('saved');

        const result: DraftSaveResult = {
          draftId: res.draftId,
          messageId: res.messageId,
          hadAttachmentPayload,
        };
        onSaved?.(result, savedSnapshot);
        return result;
      } catch {
        setStatus('error');
        return null;
      }
    };

    inFlight = doSave();
    try {
      return await inFlight;
    } finally {
      inFlight = null;
      saving = false;
      if (pendingSource) {
        const next = pendingSource;
        pendingSource = null;
        void runSave(next);
      }
    }
  }

  return {
    queueSave(source) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void runSave(source);
      }, debounceMs);
    },
    flushSave(source) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      return runSave(source);
    },
    getStatus: () => status,
    getKnownDraftId: () => knownDraftId,
    setKnownDraftId(draftId) {
      knownDraftId = draftId;
    },
    markSaved(snapshot) {
      lastSavedKey = snapshotKey({
        ...snapshot,
        draftId: snapshot.draftId ?? knownDraftId,
      });
    },
    cancelPending() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      pendingSource = null;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
