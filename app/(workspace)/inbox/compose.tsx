import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, ScrollView, KeyboardAvoidingView, Platform, BackHandler,
} from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useMailView } from '../_layout';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import ComposeRichEditor, { type ComposeEditorHandle } from '../../../components/inbox/ComposeRichEditor';
import { EmailContactSuggestionList } from '../../../components/EmailContactSuggestionList';
import {
  RecipientField,
  type RecipientFieldHandle,
  type RecipientSuggestion,
} from '../../../components/RecipientField';
import { useComposeRecipientSuggestions } from '../../../hooks/useComposeRecipientSuggestions';
import { filterComposeRecipientSuggestions } from '../../../lib/compose-recipient-filter';
import { cacheDeleteInboxFolder } from '../../../lib/cache';
import { markPendingDelete } from '../../../lib/pending-deletes';
import { readFileAsBase64 } from '../../../lib/gmail-send-direct';
import { uploadStagedAttachment } from '../../../lib/gmail-staged-attachment';
import { queueComposeMailSend } from '../../../lib/mail-outbox';
import { queueComposeDraftSave } from '../../../lib/draft-outbox';
import {
  createComposeDraftSaver,
  type ComposeDraftSnapshot,
  type DraftSaveResult,
  type DraftSaveStatus,
} from '../../../lib/compose-draft-save';
import {
  draftAttachmentsToFiles,
  draftHtmlForEditor,
  extractDriveLinksFromHtml,
  parseDraftAttachmentsFromResponse,
  stripDriveLinksFromHtml,
} from '../../../lib/gmail-draft-compose';
import { htmlToPlain, sanitizeEmailHtml } from '../../../lib/html-email';
import {
  isValidEmailAddress,
  normalizeRecipientField,
  parseRecipients,
} from '../../../lib/recipient-utils';
import { gmailApi } from '../../../lib/api';
import { Colors } from '../../../constants/colors';
import { Gmail } from '../../../constants/gmailTheme';

function wrapEmailHtml(inner: string): string {
  return `<div style="font-family:Roboto,Arial,sans-serif;font-size:15px;line-height:1.5;color:#202124">${inner}</div>`;
}

function isBodyEmpty(html: string): boolean {
  // Strip zero-width / invisible characters the WebView contentEditable can
  // inject on focus (U+200B etc). String.trim() does NOT remove these, which
  // would otherwise make a freshly-opened, untouched editor look non-empty and
  // trigger the discard prompt on back-navigation.
  return stripInvisible(htmlToPlain(html)).trim().length === 0;
}

/** Remove zero-width / invisible characters that survive String.trim(). */
function stripInvisible(s: string): string {
  // U+200B-200D zero-width space/joiners, U+FEFF BOM, U+00A0 non-breaking space.
  return s.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, '');
}

const GMAIL_LIMIT        = 25 * 1024 * 1024; // 25 MB — hard Gmail cap
const INLINE_LIMIT       =  3 * 1024 * 1024; // 3 MB — max for inline base64 JSON

function formatBytes(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// 'preparing' = reading file as base64 in background after pick (≤3 MB)
// 'ready'     = base64 read, ready to send inline
// 'staged'    = 3–25 MB chunked upload complete; use stagedUploadId on save
// 'uploading' = Drive upload in progress (>25 MB)
// 'drive'     = Drive upload done; link embedded in body
// 'saved'     = already stored in Gmail draft (loaded on re-open), no local data
type AttachmentStatus = 'preparing' | 'ready' | 'staged' | 'uploading' | 'drive' | 'saved' | 'error';

interface PickedFile {
  key: string;
  name: string;
  mimeType: string;
  size: number;
  uri: string;
  status: AttachmentStatus;
  base64Data?: string; // pre-read on pick so send is instant (≤3 MB only)
  progress?: number;
  driveLink?: string;
  errorMsg?: string;
  // For 3–25 MB staged uploads
  stagedUploadId?: string;
  // For attachments already saved in a Gmail draft
  attachmentId?: string;
  savedMessageId?: string;
}

let keySeq = 0;
function nextKey() { return String(++keySeq); }

export default function ComposeScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ draftId?: string }>();
  const { bumpDraftCount } = useMailView();
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [subject, setSubject] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [editorInitialHtml, setEditorInitialHtml] = useState('');
  const [editorKey, setEditorKey] = useState('new');
  const [showCcBcc, setShowCcBcc] = useState(false);
  const [draftSaveStatus, setDraftSaveStatus] = useState<DraftSaveStatus>('idle');
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [draftId, setDraftId] = useState<string | undefined>(params.draftId);
  const [attachments, setAttachments] = useState<PickedFile[]>([]);
  const editorRef = useRef<ComposeEditorHandle>(null);
  const bodyHtmlRef = useRef('');
  const loadingDraftRef = useRef(false);
  // True once a draft has been persisted this session (for count bump guard).
  const draftCreatedRef = useRef(!!params.draftId);
  const composeStateRef = useRef({
    to: '',
    cc: '',
    bcc: '',
    subject: '',
    bodyHtml: '',
    draftId: params.draftId as string | undefined,
    attachments: [] as PickedFile[],
  });

  const syncAttachmentsFromDraft = useCallback(async (savedDraftId: string) => {
    try {
      const refreshed = await gmailApi.getDraft(savedDraftId);
      const parsed = parseDraftAttachmentsFromResponse(refreshed);
      const driveFiles = composeStateRef.current.attachments.filter((f) => f.status === 'drive');
      const pendingFiles = composeStateRef.current.attachments.filter(
        (f) =>
          f.status === 'ready' ||
          f.status === 'preparing' ||
          f.status === 'uploading' ||
          f.status === 'staged'
      );

      // API may omit attachment metadata — never wipe chips the user already has.
      if (parsed.length === 0) return;

      const savedFiles = draftAttachmentsToFiles(parsed, refreshed.messageId, nextKey);
      const merged = [...savedFiles, ...driveFiles, ...pendingFiles];
      setAttachments(merged);
      composeStateRef.current.attachments = merged;
    } catch {
      /* non-fatal */
    }
  }, []);

  const onDraftSavedRef = useRef<
    (result: DraftSaveResult, snapshot: ComposeDraftSnapshot) => Promise<void>
  >(async () => {});

  const draftSaverRef = useRef(
    createComposeDraftSaver(2000, (result, snapshot) => {
      void onDraftSavedRef.current(result, snapshot);
    })
  );

  onDraftSavedRef.current = async (result, snapshot) => {
    setDraftId(result.draftId);
    composeStateRef.current.draftId = result.draftId;

    // First-ever save for this compose session → draft count +1.
    if (!draftCreatedRef.current) {
      draftCreatedRef.current = true;
      bumpDraftCount(+1);
    }

    if (result.hadAttachmentPayload) {
      await syncAttachmentsFromDraft(result.draftId);
    }

    draftSaverRef.current.markSaved({
      ...snapshot,
      draftId: result.draftId,
      attachments: composeStateRef.current.attachments,
      htmlBody: snapshot.htmlBody,
    });
  };

  useEffect(() => {
    return draftSaverRef.current.subscribe(setDraftSaveStatus);
  }, []);

  // Auto-reset save status: "Saved" → idle after 2.5s, "Save failed" → idle after 5s.
  useEffect(() => {
    if (draftSaveStatus === 'saved') {
      const t = setTimeout(() => setDraftSaveStatus('idle'), 2500);
      return () => clearTimeout(t);
    }
    if (draftSaveStatus === 'error') {
      const t = setTimeout(() => setDraftSaveStatus('idle'), 5000);
      return () => clearTimeout(t);
    }
  }, [draftSaveStatus]);

  const { suggestions: composeRecipientSuggestions } = useComposeRecipientSuggestions();

  type ActiveRecipientField = 'to' | 'cc' | 'bcc';
  const toFieldRef = useRef<RecipientFieldHandle>(null);
  const ccFieldRef = useRef<RecipientFieldHandle>(null);
  const bccFieldRef = useRef<RecipientFieldHandle>(null);
  const [activeRecipientField, setActiveRecipientField] =
    useState<ActiveRecipientField>('to');
  const [recipientDraft, setRecipientDraft] = useState('');

  const filteredSuggestions = useMemo(
    () => filterComposeRecipientSuggestions(composeRecipientSuggestions, recipientDraft),
    [composeRecipientSuggestions, recipientDraft]
  );

  const pickSuggestion = useCallback(
    (contact: RecipientSuggestion) => {
      const ref =
        activeRecipientField === 'cc'
          ? ccFieldRef
          : activeRecipientField === 'bcc'
            ? bccFieldRef
            : toFieldRef;
      ref.current?.applySuggestion(contact);
      setRecipientDraft('');
    },
    [activeRecipientField]
  );

  const onRecipientDraftChange = useCallback(
    (field: ActiveRecipientField, draft: string) => {
      setActiveRecipientField(field);
      setRecipientDraft(draft);
    },
    []
  );

  useEffect(() => {
    composeStateRef.current = {
      to,
      cc,
      bcc,
      subject,
      bodyHtml,
      draftId,
      attachments,
    };
  }, [to, cc, bcc, subject, bodyHtml, draftId, attachments]);

  useEffect(() => {
    if (draftId) draftSaverRef.current.setKnownDraftId(draftId);
  }, [draftId]);

  useEffect(() => {
    loadingDraftRef.current = loadingDraft;
  }, [loadingDraft]);

  // If opened from Drafts folder, fetch and pre-fill draft content
  useEffect(() => {
    if (!params.draftId) return;
    setLoadingDraft(true);
    loadingDraftRef.current = true;
    gmailApi.getDraft(params.draftId)
      .then((d) => {
        const loadedTo = d.to ? normalizeRecipientField(d.to) : '';
        const loadedCc = d.cc ? normalizeRecipientField(d.cc) : '';
        const loadedBcc = d.bcc ? normalizeRecipientField(d.bcc) : '';
        const loadedSubject = d.subject ?? '';
        // Strip the drive-links footer before loading into the editor so we
        // don't duplicate it when saving again (chips will re-add it on save).
        const rawHtml = d.htmlBody ? stripDriveLinksFromHtml(d.htmlBody) : undefined;
        const loadedHtml = draftHtmlForEditor(d.textBody ?? '', rawHtml);

        // Restore MIME attachments (saved on the Gmail draft).
        const savedAttachments: PickedFile[] = draftAttachmentsToFiles(
          parseDraftAttachmentsFromResponse(d),
          d.messageId,
          nextKey
        );

        // Restore Drive file chips that were embedded as links in the HTML body.
        const driveAttachments: PickedFile[] = extractDriveLinksFromHtml(d.htmlBody ?? '').map((f) => ({
          ...f,
          key: nextKey(),
          status: 'drive' as AttachmentStatus,
        }));

        const loadedAttachments = [...savedAttachments, ...driveAttachments];

        if (loadedTo) setTo(loadedTo);
        if (loadedCc) { setCc(loadedCc); setShowCcBcc(true); }
        if (loadedBcc) { setBcc(loadedBcc); setShowCcBcc(true); }
        if (loadedSubject) setSubject(loadedSubject);
        bodyHtmlRef.current = loadedHtml;
        setBodyHtml(loadedHtml);
        setEditorInitialHtml(loadedHtml);
        setEditorKey(`${d.draftId}-${Date.now()}`);
        setDraftId(d.draftId);
        setAttachments(loadedAttachments);
        draftSaverRef.current.setKnownDraftId(d.draftId);
        composeStateRef.current = {
          to: loadedTo,
          cc: loadedCc,
          bcc: loadedBcc,
          subject: loadedSubject,
          bodyHtml: loadedHtml,
          draftId: d.draftId,
          attachments: loadedAttachments,
        };
        draftSaverRef.current.markSaved({
          to: loadedTo,
          cc: loadedCc,
          bcc: loadedBcc,
          subject: loadedSubject,
          htmlBody: loadedHtml,
          draftId: d.draftId,
          attachments: loadedAttachments,
        });
      })
      .catch((e) => Alert.alert('Could not load draft', e?.message ?? 'Something went wrong.'))
      .finally(() => {
        setLoadingDraft(false);
        loadingDraftRef.current = false;
      });
  }, [params.draftId]);

  async function uploadToDrive(file: PickedFile) {
    const key = file.key;
    const setStatus = (patch: Partial<PickedFile>) =>
      setAttachments((prev) => prev.map((f) => f.key === key ? { ...f, ...patch } : f));

    setStatus({ status: 'uploading', progress: 0 });
    try {
      // Fetch the Google access token from our backend
      const { accessToken } = await gmailApi.getGoogleToken();

      // Step 1: start a resumable upload session
      const meta = JSON.stringify({ name: file.name });
      const initRes = await fetch(
        `https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
            'X-Upload-Content-Type': file.mimeType,
            'X-Upload-Content-Length': String(file.size),
          },
          body: meta,
        }
      );
      if (!initRes.ok) {
        const txt = await initRes.text();
        throw new Error(`Drive session init failed (${initRes.status}): ${txt}`);
      }
      const sessionUrl = initRes.headers.get('Location');
      if (!sessionUrl) throw new Error('Drive upload: missing session URL');

      // Step 2: upload the file bytes via XHR so we get progress events
      const fileId = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', sessionUrl);
        xhr.setRequestHeader('Content-Type', file.mimeType);

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            setStatus({ progress: Math.round((e.loaded / e.total) * 100) });
          }
        };

        xhr.onload = () => {
          if (xhr.status === 200 || xhr.status === 201) {
            try {
              const data = JSON.parse(xhr.responseText);
              resolve(data.id);
            } catch {
              reject(new Error('Drive upload: invalid response'));
            }
          } else {
            reject(new Error(`Drive upload failed (${xhr.status}): ${xhr.responseText}`));
          }
        };

        xhr.onerror = () => reject(new Error('Drive upload: network error'));

        // Send the local file URI directly — React Native's XHR handles file:// URIs
        xhr.send({ uri: file.uri, type: file.mimeType, name: file.name } as any);
      });

      // Make the file accessible to anyone with the link (reader)
      await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ type: 'anyone', role: 'reader' }),
      });

      const driveLink = `https://drive.google.com/file/d/${fileId}/view`;
      setStatus({ status: 'drive', progress: 100, driveLink });
    } catch (e: any) {
      setStatus({ status: 'error', errorMsg: e?.message ?? 'Upload failed' });
      Alert.alert('Drive upload failed', e?.message ?? 'Could not upload to Google Drive.');
    }
  }

  async function uploadStaged(file: PickedFile) {
    const key = file.key;
    const setStatus = (patch: Partial<PickedFile>) =>
      setAttachments((prev) => prev.map((f) => f.key === key ? { ...f, ...patch } : f));

    try {
      setStatus({ status: 'uploading', progress: 0 });
      const uploadId = await uploadStagedAttachment(
        { uri: file.uri, name: file.name, mimeType: file.mimeType, size: file.size },
        ({ bytesUploaded, totalBytes }) => {
          setStatus({ progress: Math.round((bytesUploaded / totalBytes) * 100) });
        }
      );
      setStatus({ status: 'staged', progress: 100, stagedUploadId: uploadId });
    } catch (e: any) {
      setStatus({ status: 'error', errorMsg: e?.message ?? 'Upload failed' });
      Alert.alert('Upload failed', e?.message ?? 'Could not upload attachment.');
    }
  }

  async function pickAttachment() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (result.canceled) return;

      for (const a of result.assets) {
        const size = a.size ?? 0;
        const file: PickedFile = {
          key: nextKey(),
          name: a.name,
          mimeType: a.mimeType ?? 'application/octet-stream',
          size,
          uri: a.uri,
          status: 'ready',
        };

        if (size > GMAIL_LIMIT) {
          // Tier 3: >25 MB → Drive link in body
          const captured = file;
          Alert.alert(
            'File too large to attach',
            `"${file.name}" (${formatBytes(size)}) exceeds Gmail's 25 MB limit.\n\nUpload it to Google Drive and insert a link instead?`,
            [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Insert Drive link',
                onPress: () => {
                  setAttachments((prev) => [...prev, { ...captured, status: 'uploading', progress: 0 }]);
                  uploadToDrive(captured);
                },
              },
            ]
          );
        } else if (size > INLINE_LIMIT) {
          // Tier 2: 3–25 MB → chunked staging via /api/gmail/drafts/attachment-chunk
          const captured = { ...file, status: 'uploading' as AttachmentStatus, progress: 0 };
          setAttachments((prev) => [...prev, captured]);
          void uploadStaged(captured);
        } else {
          // Tier 1: ≤3 MB → base64 in memory, inline in draft JSON
          const key = file.key;
          setAttachments((prev) => [...prev, { ...file, status: 'preparing' }]);
          readFileAsBase64(file.uri)
            .then((base64Data) => {
              setAttachments((prev) =>
                prev.map((f) => f.key === key ? { ...f, status: 'ready', base64Data } : f)
              );
            })
            .catch(() => {
              setAttachments((prev) =>
                prev.map((f) => f.key === key ? { ...f, status: 'error', errorMsg: 'Failed to read file' } : f)
              );
            });
        }
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to pick file');
    }
  }

  function removeAttachment(key: string) {
    setAttachments((prev) => prev.filter((f) => f.key !== key));
  }

  async function handleSend() {
    const preparing = attachments.find((f) => f.status === 'preparing');
    if (preparing) {
      Alert.alert('Please wait', `"${preparing.name}" is still being prepared.`);
      return;
    }
    const uploading = attachments.find((f) => f.status === 'uploading');
    if (uploading) {
      const isStaged = (uploading.size ?? 0) > INLINE_LIMIT && uploading.size <= GMAIL_LIMIT;
      Alert.alert(
        'Please wait',
        isStaged
          ? `"${uploading.name}" is still uploading (${uploading.progress ?? 0}%).`
          : 'A file is still uploading to Google Drive.'
      );
      return;
    }
    const failed = attachments.find((f) => f.status === 'error');
    if (failed) {
      Alert.alert('Upload error', `"${failed.name}" failed. Remove it or try again before sending.`);
      return;
    }

    const toList = parseRecipients(to);
    if (toList.length === 0) {
      Alert.alert('Missing recipient', 'Enter at least one email address in "To".');
      return;
    }
    const invalid = toList.find((e) => !isValidEmailAddress(e));
    if (invalid) {
      Alert.alert('Invalid email', `"${invalid}" is not a valid email address.`);
      return;
    }
    const ccList = parseRecipients(cc);
    const ccInvalid = ccList.find((e) => !isValidEmailAddress(e));
    if (ccInvalid) {
      Alert.alert('Invalid email', `Cc "${ccInvalid}" is not valid.`);
      return;
    }
    const bccList = parseRecipients(bcc);
    const bccInvalid = bccList.find((e) => !isValidEmailAddress(e));
    if (bccInvalid) {
      Alert.alert('Invalid email', `Bcc "${bccInvalid}" is not valid.`);
      return;
    }

    const sanitized = await captureBodyHtmlFast();
    let htmlInner = sanitized;
    let plainForSend = htmlToPlain(sanitized);

    const driveLinks = attachments.filter((f) => f.status === 'drive' && f.driveLink);
    if (driveLinks.length > 0) {
      const linkBlock = driveLinks.map((f) => `${f.name}: ${f.driveLink}`).join('\n');
      const linkHtml = driveLinks
        .map((f) => `<div><a href="${f.driveLink}">${f.name}</a></div>`)
        .join('');
      plainForSend = plainForSend
        ? `${plainForSend}\n\n--- Attachments ---\n${linkBlock}`
        : linkBlock;
      htmlInner = `${htmlInner}<br/><br/><b>Attachments</b><br/>${linkHtml}`;
    }

    const htmlForSend = wrapEmailHtml(htmlInner);

    if (isBodyEmpty(sanitized) && attachments.length === 0 && driveLinks.length === 0) {
      Alert.alert('Empty message', 'Write something before sending.');
      return;
    }

    const inlineAttachments = attachments.filter((f) => f.status === 'ready' || f.status === 'saved');
    const outboxDraftId = draftId ?? draftSaverRef.current.getKnownDraftId();

    draftSaverRef.current.cancelPending();
    queueComposeMailSend({
      to: toList.join(', '),
      cc: ccList.length > 0 ? ccList.join(', ') : undefined,
      bcc: bccList.length > 0 ? bccList.join(', ') : undefined,
      subject: subject.trim(),
      textBody: plainForSend,
      htmlBody: htmlForSend,
      draftId: outboxDraftId,
      attachments: inlineAttachments.map((f) => ({
        filename: f.name,
        mimeType: f.mimeType,
        uri: f.uri,
        base64Data: f.base64Data,
        attachmentId: f.attachmentId,
        savedMessageId: f.savedMessageId,
        status: f.status,
      })),
    });
    router.back();
  }

  const onBodyChange = useCallback((html: string) => {
    bodyHtmlRef.current = html;
    composeStateRef.current.bodyHtml = html;
  }, []);

  /** WebView is source of truth — React state can lag behind the editor. */
  const captureBodyHtmlFast = useCallback(async (): Promise<string> => {
    const live = await Promise.race([
      editorRef.current?.getHtml().catch(() => '') ?? Promise.resolve(''),
      new Promise<string>((resolve) => setTimeout(() => resolve(''), 250)),
    ]);
    const trimmed = (live ?? '').trim();
    if (trimmed && !isBodyEmpty(trimmed)) return sanitizeEmailHtml(live);
    return sanitizeEmailHtml(bodyHtmlRef.current || bodyHtml);
  }, [bodyHtml]);

  const buildDraftSnapshot = useCallback((htmlBody: string): ComposeDraftSnapshot => {
    const s = composeStateRef.current;
    return {
      to: s.to,
      cc: s.cc,
      bcc: s.bcc,
      subject: s.subject,
      htmlBody,
      draftId: s.draftId ?? draftSaverRef.current.getKnownDraftId(),
      attachments: s.attachments,
    };
  }, []);

  const prepareDraftSnapshot = useCallback(async (): Promise<ComposeDraftSnapshot> => {
    const live = await Promise.race([
      editorRef.current?.getHtml().catch(() => '') ?? Promise.resolve(''),
      new Promise<string>((resolve) => setTimeout(() => resolve(''), 800)),
    ]);
    const liveTrimmed = live.trim();
    const refHtml = bodyHtmlRef.current.trim();

    let html = bodyHtmlRef.current || bodyHtml;
    if (liveTrimmed && !isBodyEmpty(live)) {
      html = live;
    } else if (refHtml && !isBodyEmpty(refHtml)) {
      html = bodyHtmlRef.current;
    } else if (bodyHtml.trim() && !isBodyEmpty(bodyHtml)) {
      html = bodyHtml;
    } else if (liveTrimmed) {
      html = live;
    }

    const sanitized = sanitizeEmailHtml(html);
    bodyHtmlRef.current = sanitized;
    composeStateRef.current.bodyHtml = sanitized;
    if (sanitized !== bodyHtml) setBodyHtml(sanitized);
    return buildDraftSnapshot(sanitized);
  }, [bodyHtml, buildDraftSnapshot]);

  async function handleSaveDraftAndClose() {
    const blocking = attachments.find((f) => f.status === 'preparing' || f.status === 'uploading');
    if (blocking) {
      Alert.alert('Please wait', `"${blocking.name}" is still ${blocking.status === 'preparing' ? 'being prepared' : 'uploading'}.`);
      return;
    }

    draftSaverRef.current.cancelPending();
    const snapshot = await prepareDraftSnapshot();

    queueComposeDraftSave(snapshot, {
      onDraftCreated: () => bumpDraftCount(+1),
    });
    router.back();
  }

  function discardAndClose() {
    draftSaverRef.current.cancelPending();
    const idToDelete = draftId ?? draftSaverRef.current.getKnownDraftId();
    if (idToDelete) {
      markPendingDelete(idToDelete);
      bumpDraftCount(-1);
      // Fire-and-forget — markPendingDelete already hides the row optimistically.
      gmailApi.deleteDraft(idToDelete)
        .then(() => cacheDeleteInboxFolder('drafts'))
        .catch(() => {});
    }
    router.back();
  }

  function handleDiscard() {
    // Use the ref mirror — no WebView round-trip — so the dialog is instant.
    const hasContent =
      to.trim() ||
      subject.trim() ||
      cc.trim() ||
      bcc.trim() ||
      !isBodyEmpty(bodyHtmlRef.current) ||
      attachments.length > 0;
    if (!hasContent && !draftId) { router.back(); return; }
    Alert.alert(
      'Close',
      draftId ? 'Save changes to draft or discard?' : 'Save this message as a draft or discard it?',
      [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Save as draft', onPress: handleSaveDraftAndClose },
        { text: 'Discard', style: 'destructive', onPress: discardAndClose },
      ]
    );
  }

  const handleDiscardRef = useRef(handleDiscard);
  handleDiscardRef.current = handleDiscard;

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== 'android') return undefined;
      const onHardwareBack = () => {
        if (loadingDraft) return true;
        handleDiscardRef.current();
        return true;
      };
      const sub = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
      return () => sub.remove();
    }, [loadingDraft])
  );

  const hasUploading = attachments.some((f) => f.status === 'uploading' || f.status === 'preparing');

  const composeTitle = draftId && !loadingDraft ? 'Draft' : 'Compose';
  const draftStatusLabel =
    draftSaveStatus === 'saving'
      ? 'Saving…'
      : draftSaveStatus === 'saved'
        ? 'Saved'
        : draftSaveStatus === 'error'
          ? 'Save failed'
          : '';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: Gmail.bg }} edges={['top', 'left', 'right']}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            onPress={handleDiscard}
            disabled={loadingDraft}
            style={styles.headerIconBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons
              name="arrow-back"
              size={24}
              color={loadingDraft ? Gmail.textMuted : Gmail.text}
            />
          </TouchableOpacity>
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>{composeTitle}</Text>
            {draftStatusLabel ? (
              <Text style={styles.headerDraftStatus}>{draftStatusLabel}</Text>
            ) : null}
          </View>
          <TouchableOpacity
            onPress={pickAttachment}
            style={styles.headerIconBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="attach" size={24} color={Gmail.textSecondary} />
            {attachments.length > 0 && (
              <View style={styles.headerAttachBadge}>
                <Text style={styles.headerAttachBadgeText}>{attachments.length}</Text>
              </View>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSend}
            disabled={hasUploading}
            style={[styles.sendBtn, hasUploading && styles.sendBtnDisabled]}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="send" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        {loadingDraft && (
          <View style={styles.loadingBanner}>
            <ActivityIndicator color={Gmail.blue} size="small" />
            <Text style={styles.loadingText}>Loading draft…</Text>
          </View>
        )}

        <View style={styles.recipientsBlock}>
          <ScrollView
            style={styles.recipientsScroll}
            keyboardShouldPersistTaps="always"
            nestedScrollEnabled
          >
            <View style={styles.recipientRow}>
              <Text style={styles.recipientLabel}>To</Text>
              <RecipientField
                ref={toFieldRef}
                value={to}
                onChange={setTo}
                placeholder="Recipients"
                onFocus={() => setActiveRecipientField('to')}
                onDraftChange={(draft) => onRecipientDraftChange('to', draft)}
                style={styles.recipientFieldFlex}
              />
              <TouchableOpacity onPress={() => setShowCcBcc((v) => !v)}>
                <Text style={styles.ccBccToggle}>{showCcBcc ? 'Hide' : 'Cc/Bcc'}</Text>
              </TouchableOpacity>
            </View>

            {showCcBcc && (
              <>
                <View style={styles.recipientRow}>
                  <Text style={styles.recipientLabel}>Cc</Text>
                  <RecipientField
                    ref={ccFieldRef}
                    value={cc}
                    onChange={setCc}
                    placeholder="Cc"
                    onFocus={() => setActiveRecipientField('cc')}
                    onDraftChange={(draft) => onRecipientDraftChange('cc', draft)}
                    style={styles.recipientFieldFlex}
                  />
                </View>

                <View style={styles.recipientRow}>
                  <Text style={styles.recipientLabel}>Bcc</Text>
                  <RecipientField
                    ref={bccFieldRef}
                    value={bcc}
                    onChange={setBcc}
                    placeholder="Bcc"
                    onFocus={() => setActiveRecipientField('bcc')}
                    onDraftChange={(draft) => onRecipientDraftChange('bcc', draft)}
                    style={styles.recipientFieldFlex}
                  />
                </View>
              </>
            )}
          </ScrollView>

          {recipientDraft.trim().length > 0 && filteredSuggestions.length > 0 ? (
            <EmailContactSuggestionList
              suggestions={filteredSuggestions}
              onPick={pickSuggestion}
              maxHeight={220}
            />
          ) : null}

          <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Subject</Text>
              <TextInput
                style={styles.fieldInput}
                value={subject}
                onChangeText={setSubject}
                placeholder="Subject"
                placeholderTextColor={Gmail.textMuted}
              />
            </View>

            {attachments.length > 0 && (
              <View style={styles.attachmentList}>
                {attachments.map((f) => (
                  <AttachmentChip key={f.key} file={f} onRemove={() => removeAttachment(f.key)} />
                ))}
              </View>
            )}
        </View>

        <KeyboardAvoidingView
          style={styles.editorKeyboardAvoid}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={0}
        >
          <ComposeRichEditor
            ref={editorRef}
            key={editorKey}
            initialHtml={editorInitialHtml}
            onChangeHtml={onBodyChange}
          />
        </KeyboardAvoidingView>
      </View>
    </SafeAreaView>
  );
}

function AttachmentChip({ file, onRemove }: { file: PickedFile; onRemove: () => void }) {
  const isPreparing = file.status === 'preparing';
  const isDrive = file.status === 'drive';
  const isUploading = file.status === 'uploading';
  const isSaved = file.status === 'saved';
  const isBusy = isPreparing || isUploading;
  const isError = file.status === 'error';
  const progress = file.progress ?? 0;

  const chipColor = isError ? Colors.error : isDrive ? '#0F9D58' : Colors.primary;
  const bgColor = isError ? '#FEE2E2' : isDrive ? '#E6F4EA' : Colors.primaryLight;

  return (
    <View style={[styles.attachmentChip, { backgroundColor: bgColor, borderColor: chipColor + '44' }]}>
      {isBusy ? (
        <ActivityIndicator size="small" color={Colors.primary} style={{ width: 14, height: 14 }} />
      ) : isDrive ? (
        <Ionicons name="logo-google" size={14} color={chipColor} />
      ) : isError ? (
        <Ionicons name="warning-outline" size={14} color={chipColor} />
      ) : (
        <Ionicons name="document-outline" size={14} color={chipColor} />
      )}

      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={[styles.attachmentName, { color: chipColor }]} numberOfLines={1}>
          {file.name}
        </Text>
        {isPreparing && (
          <Text style={[styles.attachmentStatus, { color: Colors.textMuted }]}>Preparing…</Text>
        )}
        {isUploading && (
          <>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress}%` as any }]} />
            </View>
            <Text style={[styles.attachmentStatus, { color: Colors.textMuted }]}>
              Uploading to Drive… {progress}%
            </Text>
          </>
        )}
        {isDrive && (
          <Text style={[styles.attachmentStatus, { color: chipColor }]}>Saved to Drive · link in email</Text>
        )}
        {isSaved && (
          <Text style={[styles.attachmentStatus, { color: Colors.textMuted }]}>In draft{file.size > 0 ? ` · ${formatBytes(file.size)}` : ''}</Text>
        )}
        {isError && (
          <Text style={[styles.attachmentStatus, { color: chipColor }]} numberOfLines={2}>
            {file.errorMsg ?? 'Upload failed'}
          </Text>
        )}
        {file.status === 'ready' && file.size > 0 && (
          <Text style={[styles.attachmentStatus, { color: Colors.textMuted }]}>{formatBytes(file.size)}</Text>
        )}
      </View>

      {!isBusy && (
        <TouchableOpacity onPress={onRemove} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Gmail.bg },
  editorKeyboardAvoid: { flex: 1, minHeight: 0 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: Gmail.bg,
    borderBottomWidth: 1,
    borderBottomColor: Gmail.border,
  },
  headerIconBtn: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitleWrap: {
    flex: 1,
    marginLeft: 4,
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '500',
    color: Gmail.text,
  },
  headerDraftStatus: {
    fontSize: 11,
    color: Gmail.textSecondary,
    marginTop: 1,
  },
  headerAttachBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: Gmail.blue,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  headerAttachBadgeText: { fontSize: 9, fontWeight: '700', color: '#fff' },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Gmail.blue,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 8,
  },
  sendBtnDisabled: { opacity: 0.5 },
  loadingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
    backgroundColor: Gmail.blueLight,
  },
  recipientsBlock: {
    flexGrow: 0,
    flexShrink: 0,
    zIndex: 40,
    elevation: 16,
    backgroundColor: Gmail.bg,
    overflow: 'visible',
  },
  recipientsScroll: { flexGrow: 0, maxHeight: 180 },
  recipientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Gmail.divider,
    gap: 8,
  },
  recipientLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: Gmail.textSecondary,
    minWidth: 28,
  },
  recipientFieldFlex: {
    flex: 1,
    minWidth: 0,
  },
  fieldBlock: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Gmail.divider,
  },
  fieldHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Gmail.divider,
    gap: 10,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: Gmail.textSecondary,
    paddingTop: 2,
  },
  fieldInput: {
    flex: 1,
    fontSize: 15,
    color: Gmail.text,
    padding: 0,
  },
  ccBccToggle: {
    fontSize: 12,
    fontWeight: '600',
    color: Gmail.blue,
  },
  suggestionBox: {
    backgroundColor: Gmail.bg,
    borderBottomWidth: 1,
    borderTopWidth: 1,
    borderColor: Gmail.border,
    maxHeight: 220,
    zIndex: 50,
    elevation: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  suggestionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Gmail.divider,
  },
  suggestionAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Gmail.blueLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestionAvatarText: { fontSize: 13, fontWeight: '700', color: Gmail.blue },
  suggestionText: { flex: 1 },
  suggestionName: { fontSize: 13, fontWeight: '600', color: Gmail.text },
  suggestionEmail: { fontSize: 12, color: Gmail.textMuted },
  attachmentList: {
    flexDirection: 'column',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  attachmentName: {
    fontSize: 13,
    fontWeight: '500',
  },
  attachmentStatus: {
    fontSize: 11,
  },
  progressTrack: {
    height: 3,
    borderRadius: 2,
    backgroundColor: Colors.border,
    overflow: 'hidden',
  },
  progressFill: {
    height: 3,
    borderRadius: 2,
    backgroundColor: Colors.primary,
  },
  loadingText: {
    fontSize: 13,
    color: Gmail.textSecondary,
  },
});
