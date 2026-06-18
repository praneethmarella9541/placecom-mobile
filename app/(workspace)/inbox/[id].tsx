import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Linking,
  useWindowDimensions, Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppInsets } from '../../../lib/safe-area';
import WebView from 'react-native-webview';
import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import { supabase } from '../../../lib/supabase';
import { gmailApi, type GmailLabel, type GmailMessage } from '../../../lib/api';
import { readFileAsBase64 } from '../../../lib/gmail-send-direct';
import { queueReplyMailSend } from '../../../lib/mail-outbox';
import { peekGmailLabelsCache } from '../../../lib/gmail-labels-cache';
import { getCachedThread, openMailThread } from '../../../lib/mail-thread-prefetch';
import { useAuth } from '../../../hooks/useAuth';
import { Colors } from '../../../constants/colors';
import { Gmail, avatarColorForName } from '../../../constants/gmailTheme';
import { LabelChip } from '../../../components/LabelChip';
import { LabelPickerModal } from '../../../components/LabelPickerModal';
import {
  EMAIL_FIT_WIDTH_JS,
  wrapEmailHtmlBody,
  wrapPlainTextAsEmailDocument,
  looksLikeHtml,
} from '../../../lib/html-email';
import { getAttachmentUri } from '../../../lib/gmail-attachments';
import { buildAttachmentPreviewContent } from '../../../lib/attachment-preview';
import { shareCachedAttachment } from '../../../lib/share-attachment';
import {
  AttachmentViewerModal,
  type AttachmentViewerState,
} from '../../../components/inbox/AttachmentViewerModal';
import { MessageAttachmentPreviews } from '../../../components/inbox/MessageAttachmentPreviews';

const GMAIL_LIMIT = 25 * 1024 * 1024;

function parseAddress(raw: string): { name: string; email: string } {
  if (!raw) return { name: '', email: '' };
  const match = raw.match(/^(.*?)\s*<(.+?)>\s*$/);
  if (match) return { name: match[1].trim().replace(/^"|"$/g, ''), email: match[2].trim() };
  return { name: raw.trim(), email: raw.trim() };
}

function parseAddressList(raw: string): { name: string; email: string }[] {
  if (!raw) return [];
  return raw.split(/,\s*(?=[^>]*(?:<|$))/).map((s) => parseAddress(s.trim())).filter((a) => a.email);
}

function formatBytes(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type ReplyMode = 'reply' | 'replyAll' | 'forward';
type AttachmentStatus = 'preparing' | 'ready' | 'uploading' | 'drive' | 'error';

interface PickedFile {
  key: string;
  name: string;
  mimeType: string;
  size: number;
  uri: string;
  status: AttachmentStatus;
  base64Data?: string;
  progress?: number;
  driveLink?: string;
  errorMsg?: string;
}

let keySeq = 0;
function nextKey() { return String(++keySeq); }

export default function ThreadDetailScreen() {
  const { id, previewSubject, previewFrom } = useLocalSearchParams<{
    id: string;
    previewSubject?: string;
    previewFrom?: string;
  }>();
  const router = useRouter();
  const { user } = useAuth();
  const userId = user?.id ?? '';
  const insets = useAppInsets();
  const [messages, setMessages] = useState<GmailMessage[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Compose panel state
  const [replyMode, setReplyMode] = useState<ReplyMode | null>(null);
  const [replyTo, setReplyTo] = useState('');
  const [replyCc, setReplyCc] = useState('');
  const [replySubject, setReplySubject] = useState('');
  const [replyBody, setReplyBody] = useState('');
  const [attachments, setAttachments] = useState<PickedFile[]>([]);
  const bodyInputRef = useRef<TextInput>(null);

  // Labels — loaded in parallel with the thread, used by chips + picker.
  const [allLabels, setAllLabels] = useState<GmailLabel[]>([]);
  const [threadLabelIds, setThreadLabelIds] = useState<string[]>([]);
  const [labelBusy, setLabelBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  function applyExpandedForMessages(msgs: GmailMessage[]) {
    const keys = msgs.map((m, i) => m.id ?? String(i));
    if (keys.length <= 4) {
      setExpandedIds(new Set(keys));
    } else {
      setExpandedIds(new Set([keys[keys.length - 1]!]));
    }
  }

  function toggleMessageExpanded(key: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  const [starred, setStarred] = useState(false);
  const labelsById = useMemo(() => {
    const m = new Map<string, GmailLabel>();
    for (const l of allLabels) m.set(l.id, l);
    return m;
  }, [allLabels]);

  useEffect(() => {
    if (!id || !userId) return;

    const cached = getCachedThread(userId, id);
    if (cached) {
      setMessages(cached.messages ?? []);
      const lids = cached.labelIds ?? [];
      setThreadLabelIds(lids);
      setStarred(lids.includes('STARRED'));
      applyExpandedForMessages(cached.messages ?? []);
      setLoading(false);
    } else {
      setLoading(true);
      setError(null);
    }

    openMailThread(userId, id)
      .then((data) => {
        const msgs = data.messages ?? [];
        setMessages(msgs);
        applyExpandedForMessages(msgs);
        const lids = data.labelIds ?? [];
        setThreadLabelIds(lids);
        setStarred(lids.includes('STARRED'));
      })
      .catch((e) => {
        if (!cached) {
          console.error('[thread] load failed:', (e as Error)?.message);
          setError((e as Error)?.message ?? 'Failed to load thread');
        }
      })
      .finally(() => setLoading(false));
  }, [id, userId]);

  // Labels — reuse inbox session cache when available.
  useEffect(() => {
    const cached = peekGmailLabelsCache();
    if (cached?.length) {
      setAllLabels(cached);
      return;
    }
    gmailApi.listLabels()
      .then((r) => setAllLabels(r.labels ?? []))
      .catch(() => { /* non-fatal */ });
  }, []);

  async function toggleLabel(labelId: string, nextChecked: boolean) {
    if (!id) return;
    const prev = threadLabelIds;
    setThreadLabelIds((cur) =>
      nextChecked ? Array.from(new Set([...cur, labelId])) : cur.filter((x) => x !== labelId)
    );
    setLabelBusy(true);
    try {
      await gmailApi.modifyThreadLabels(id, nextChecked ? { add: [labelId] } : { remove: [labelId] });
    } catch (e: any) {
      setThreadLabelIds(prev);
      Alert.alert('Could not update labels', e?.message ?? 'Try again.');
    } finally {
      setLabelBusy(false);
    }
  }

  async function toggleStar() {
    if (!id) return;
    const next = !starred;
    setStarred(next);
    try {
      await gmailApi.modifyThreadLabels(id, next ? { add: ['STARRED'] } : { remove: ['STARRED'] });
      setThreadLabelIds((cur) =>
        next ? Array.from(new Set([...cur, 'STARRED'])) : cur.filter((x) => x !== 'STARRED')
      );
    } catch (e: any) {
      setStarred(!next);
      Alert.alert('Could not update star', e?.message ?? 'Try again.');
    }
  }

  async function createAndApplyLabel(name: string) {
    try {
      const r = await gmailApi.createLabel(name);
      setAllLabels((prev) => [...prev, r.label]);
      await toggleLabel(r.label.id, true);
    } catch (e: any) {
      Alert.alert('Could not create label', e?.message ?? 'Try again.');
    }
  }

  const lastMessage = messages?.[messages.length - 1];
  const firstMessage = messages?.[0];
  const subject =
    firstMessage?.subject ||
    (typeof previewSubject === 'string' ? previewSubject : '') ||
    '';
  const hasMessages = Boolean(messages && messages.length > 0);

  function openReply(mode: ReplyMode) {
    if (!lastMessage) return;
    const fromAddr = parseAddress(lastMessage.from);
    const sub = subject.match(/^(Re|Fwd):\s/i) ? subject : mode === 'forward' ? `Fwd: ${subject}` : `Re: ${subject}`;

    let to = '';
    let cc = '';

    if (mode === 'reply') {
      to = lastMessage.from;
    } else if (mode === 'replyAll') {
      // To = original sender; Cc = all other recipients minus ourselves
      to = lastMessage.from;
      const allTo = parseAddressList(lastMessage.to);
      const allCc = parseAddressList(lastMessage.to); // include original To recipients except sender in Cc
      // Build cc from all recipients in the thread except the original sender
      const senderEmail = fromAddr.email.toLowerCase();
      const ccAddrs = [...allTo, ...allCc]
        .filter((a, i, arr) => arr.findIndex((x) => x.email === a.email) === i) // dedupe
        .filter((a) => a.email.toLowerCase() !== senderEmail);
      cc = ccAddrs.map((a) => a.name ? `${a.name} <${a.email}>` : a.email).join(', ');
    } else if (mode === 'forward') {
      to = '';
    }

    let forwardedBody = '';
    if (mode === 'forward') {
      const fromLine = lastMessage.from;
      const dateLine = lastMessage.date ? format(new Date(lastMessage.date), 'EEE, MMM d, yyyy h:mm a') : '';
      const toLine = lastMessage.to;
      forwardedBody = `\n\n---------- Forwarded message ---------\nFrom: ${fromLine}\nDate: ${dateLine}\nSubject: ${subject}\nTo: ${toLine}\n\n${lastMessage.body || ''}`;
    }

    setReplyMode(mode);
    setReplyTo(to);
    setReplyCc(cc);
    setReplySubject(sub);
    setReplyBody(forwardedBody);
    setAttachments([]);
    setTimeout(() => bodyInputRef.current?.focus(), 300);
  }

  function closeReply() {
    if (replyBody.trim() || attachments.length > 0) {
      Alert.alert('Discard?', 'Your message will be lost.', [
        { text: 'Keep editing', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: () => setReplyMode(null) },
      ]);
    } else {
      setReplyMode(null);
    }
  }

  async function uploadToDrive(file: PickedFile) {
    const key = file.key;
    const patch = (p: Partial<PickedFile>) =>
      setAttachments((prev) => prev.map((f) => f.key === key ? { ...f, ...p } : f));

    patch({ status: 'uploading', progress: 0 });
    try {
      const { accessToken } = await gmailApi.getGoogleToken();
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
      if (!initRes.ok) throw new Error(`Drive init failed (${initRes.status})`);
      const sessionUrl = initRes.headers.get('Location');
      if (!sessionUrl) throw new Error('Drive: missing session URL');

      const fileId = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', sessionUrl);
        xhr.setRequestHeader('Content-Type', file.mimeType);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) patch({ progress: Math.round((e.loaded / e.total) * 100) });
        };
        xhr.onload = () => {
          if (xhr.status === 200 || xhr.status === 201) {
            try { resolve(JSON.parse(xhr.responseText).id); } catch { reject(new Error('Invalid response')); }
          } else {
            reject(new Error(`Drive upload failed (${xhr.status})`));
          }
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send({ uri: file.uri, type: file.mimeType, name: file.name } as any);
      });

      await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'anyone', role: 'reader' }),
      });

      patch({ status: 'drive', progress: 100, driveLink: `https://drive.google.com/file/d/${fileId}/view` });
    } catch (e: any) {
      patch({ status: 'error', errorMsg: e?.message ?? 'Upload failed' });
      Alert.alert('Drive upload failed', e?.message ?? 'Could not upload to Google Drive.');
    }
  }

  async function pickAttachment() {
    try {
      const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true, multiple: true });
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
          const captured = file;
          Alert.alert(
            'File too large',
            `"${file.name}" (${formatBytes(size)}) exceeds Gmail's 25 MB limit.\n\nUpload to Drive and insert a link?`,
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
        } else {
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

  async function handleSend() {
    if (!lastMessage || !replyMode) return;

    const preparing = attachments.find((f) => f.status === 'preparing');
    if (preparing) { Alert.alert('Please wait', `"${preparing.name}" is still being prepared.`); return; }
    const uploading = attachments.find((f) => f.status === 'uploading');
    if (uploading) { Alert.alert('Please wait', 'A file is still uploading.'); return; }
    const failed = attachments.find((f) => f.status === 'error');
    if (failed) { Alert.alert('Upload error', `"${failed.name}" failed. Remove it or retry.`); return; }

    if (replyMode === 'forward' && !replyTo.trim()) {
      Alert.alert('Missing recipient', 'Enter at least one email address to forward to.'); return;
    }
    if (!replyBody.trim() && attachments.length === 0) {
      Alert.alert('Empty message', 'Write something before sending.'); return;
    }

    const driveLinks = attachments.filter((f) => f.status === 'drive' && f.driveLink);
    let finalBody = replyBody;
    if (driveLinks.length > 0) {
      const linkBlock = driveLinks.map((f) => `${f.name}: ${f.driveLink}`).join('\n');
      finalBody = finalBody ? `${finalBody}\n\n--- Attachments ---\n${linkBlock}` : linkBlock;
    }

    const readyAttachments = attachments.filter((f) => f.status === 'ready');

    queueReplyMailSend({
      to: replyTo,
      cc: replyCc || undefined,
      subject: replySubject,
      textBody: finalBody,
      threadId: replyMode !== 'forward' ? lastMessage.threadId : undefined,
      inReplyToMessageId:
        replyMode !== 'forward' ? (lastMessage.messageIdHeader ?? lastMessage.id) : undefined,
      useDirectSend: readyAttachments.length > 0,
      attachments: readyAttachments.map((f) => ({
        filename: f.name,
        mimeType: f.mimeType,
        uri: f.uri,
        base64Data: f.base64Data,
        status: f.status,
      })),
    });

    setReplyMode(null);
    setReplyBody('');
    setAttachments([]);
  }

  if (error && !hasMessages) {
    return (
      <SafeAreaView style={[styles.center, { flex: 1 }]} edges={['top', 'bottom', 'left', 'right']}>
        <Ionicons name="warning-outline" size={32} color={Colors.error} />
        <Text style={styles.errorText}>{error ?? 'Thread not found'}</Text>
        <TouchableOpacity style={styles.backLink} onPress={() => router.back()}>
          <Text style={styles.backLinkText}>Go back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const modeLabel = replyMode === 'replyAll' ? 'Reply All' : replyMode === 'forward' ? 'Forward' : 'Reply';

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        {/* Gmail-style toolbar */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerIconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={24} color={Gmail.text} />
          </TouchableOpacity>
          <View style={styles.headerActions}>
            <TouchableOpacity onPress={() => void toggleStar()} style={styles.headerIconBtn}>
              <Ionicons name={starred ? 'star' : 'star-outline'} size={22} color={starred ? Gmail.star : Gmail.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setPickerOpen(true)}
              style={styles.headerIconBtn}
              disabled={labelBusy}
              accessibilityLabel="Labels"
            >
              <Ionicons name="pricetag-outline" size={22} color={Gmail.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>
        <Text style={styles.subjectLine} numberOfLines={3}>{subject || '(No subject)'}</Text>
        {typeof previewFrom === 'string' && previewFrom.length > 0 && !hasMessages && loading && (
          <Text style={styles.previewFrom} numberOfLines={1}>{parseAddress(previewFrom).name}</Text>
        )}

        {/* Label chips for this thread */}
        {threadLabelIds.length > 0 && (
          <View style={styles.threadLabelsRow}>
            {threadLabelIds
              .map((tid) => labelsById.get(tid))
              .filter((l): l is GmailLabel => !!l && l.type === 'user')
              .map((l) => (
                <LabelChip
                  key={l.id}
                  label={l}
                  size="md"
                  onRemove={labelBusy ? undefined : () => void toggleLabel(l.id, false)}
                />
              ))}
          </View>
        )}

        {/* Thread messages */}
        <ScrollView style={styles.messages} contentContainerStyle={{ paddingBottom: 12 }}>
          {loading && !hasMessages ? (
            <View style={styles.threadLoading}>
              <ActivityIndicator color={Gmail.blue} size="large" />
              <Text style={styles.threadLoadingText}>Loading conversation…</Text>
            </View>
          ) : (
            (messages ?? []).map((msg, idx) => {
              const msgKey = msg.id ?? String(idx);
              return (
                <MessageBubble
                  key={msgKey}
                  msg={msg}
                  expanded={expandedIds.has(msgKey)}
                  onToggle={() => toggleMessageExpanded(msgKey)}
                />
              );
            })
          )}
        </ScrollView>

        {/* Gmail-style reply bar */}
        <View style={[styles.actionBar, { paddingBottom: insets.bottom + 8 }]}>
          <TouchableOpacity
            style={styles.replyPill}
            onPress={() => openReply('reply')}
            activeOpacity={0.7}
            disabled={!lastMessage}
          >
            <Ionicons name="arrow-undo-outline" size={18} color={Gmail.textSecondary} />
            <Text style={styles.replyPillText}>Reply</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.replyIconBtn} onPress={() => openReply('replyAll')}>
            <Ionicons name="arrow-redo-outline" size={22} color={Gmail.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.replyIconBtn} onPress={() => openReply('forward')}>
            <Ionicons name="share-outline" size={22} color={Gmail.textSecondary} />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Compose modal */}
      <Modal
        visible={replyMode !== null}
        animationType="slide"
        onRequestClose={closeReply}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: Colors.surface }} edges={['top', 'bottom', 'left', 'right']}>
          {/* Modal header */}
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={closeReply} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={24} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{modeLabel}</Text>
            <TouchableOpacity
              onPress={handleSend}
              disabled={attachments.some((f) => f.status === 'uploading' || f.status === 'preparing')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="send" size={22} color={Colors.primary} />
            </TouchableOpacity>
          </View>

          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }} keyboardShouldPersistTaps="handled">
              {/* To field */}
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>To</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={replyTo}
                  onChangeText={setReplyTo}
                  placeholder="recipient@example.com"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>

              {/* Cc field — always visible for Reply All / Forward */}
              {(replyMode === 'replyAll' || replyMode === 'forward' || replyCc.length > 0) && (
                <View style={styles.fieldRow}>
                  <Text style={styles.fieldLabel}>Cc</Text>
                  <TextInput
                    style={styles.fieldInput}
                    value={replyCc}
                    onChangeText={setReplyCc}
                    placeholder="cc@example.com"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              )}

              {/* Subject */}
              <View style={styles.fieldRow}>
                <Text style={styles.fieldLabel}>Subject</Text>
                <TextInput
                  style={styles.fieldInput}
                  value={replySubject}
                  onChangeText={setReplySubject}
                  placeholderTextColor={Colors.textMuted}
                />
              </View>

              {/* Body */}
              <TextInput
                ref={bodyInputRef}
                style={styles.bodyInput}
                value={replyBody}
                onChangeText={setReplyBody}
                placeholder="Write your message..."
                placeholderTextColor={Colors.textMuted}
                multiline
                textAlignVertical="top"
              />

              {/* Attachment chips */}
              {attachments.length > 0 && (
                <View style={styles.attachmentList}>
                  {attachments.map((f) => (
                    <AttachmentChip
                      key={f.key}
                      file={f}
                      onRemove={() => setAttachments((prev) => prev.filter((x) => x.key !== f.key))}
                    />
                  ))}
                </View>
              )}
            </ScrollView>

            {/* Toolbar */}
            <View style={styles.toolbar}>
              <TouchableOpacity style={styles.toolbarBtn} onPress={pickAttachment}>
                <Ionicons name="attach" size={22} color={Colors.textSecondary} />
                <Text style={styles.toolbarBtnText}>Attach</Text>
                {attachments.length > 0 && (
                  <View style={styles.attachBadge}>
                    <Text style={styles.attachBadgeText}>{attachments.length}</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* Labels picker — bottom sheet */}
      <LabelPickerModal
        visible={pickerOpen}
        allLabels={allLabels}
        selected={new Set(threadLabelIds)}
        onToggle={(labelId, nextChecked) => void toggleLabel(labelId, nextChecked)}
        onCreate={async (name) => { await createAndApplyLabel(name); }}
        onClose={() => setPickerOpen(false)}
        busy={labelBusy}
      />
    </KeyboardAvoidingView>
  );
}

function AttachmentChip({ file, onRemove }: { file: PickedFile; onRemove: () => void }) {
  const isPreparing = file.status === 'preparing';
  const isDrive = file.status === 'drive';
  const isUploading = file.status === 'uploading';
  const isBusy = isPreparing || isUploading;
  const isError = file.status === 'error';
  const progress = file.progress ?? 0;
  const chipColor = isError ? Colors.error : isDrive ? '#0F9D58' : Colors.primary;
  const bgColor = isError ? '#FEE2E2' : isDrive ? '#E6F4EA' : Colors.primaryLight;

  return (
    <View style={[styles.attachmentChip, { backgroundColor: bgColor, borderColor: chipColor + '44' }]}>
      {isBusy
        ? <ActivityIndicator size="small" color={Colors.primary} style={{ width: 14, height: 14 }} />
        : isDrive ? <Ionicons name="logo-google" size={14} color={chipColor} />
        : isError ? <Ionicons name="warning-outline" size={14} color={chipColor} />
        : <Ionicons name="document-outline" size={14} color={chipColor} />
      }
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text style={[styles.attachmentName, { color: chipColor }]} numberOfLines={1}>{file.name}</Text>
        {isPreparing && <Text style={[styles.attachmentMeta, { color: Colors.textMuted }]}>Preparing…</Text>}
        {isUploading && (
          <>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progress}%` as any }]} />
            </View>
            <Text style={[styles.attachmentMeta, { color: Colors.textMuted }]}>Uploading… {progress}%</Text>
          </>
        )}
        {isDrive && <Text style={[styles.attachmentMeta, { color: chipColor }]}>Drive link · in email</Text>}
        {isError && <Text style={[styles.attachmentMeta, { color: chipColor }]} numberOfLines={1}>{file.errorMsg ?? 'Failed'}</Text>}
        {file.status === 'ready' && file.size > 0 && (
          <Text style={[styles.attachmentMeta, { color: Colors.textMuted }]}>{formatBytes(file.size)}</Text>
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

// ─── Message rendering ────────────────────────────────────────────────────────

type MessageBodyContent =
  | { mode: 'html'; html: string }
  | { mode: 'plain'; text: string };

function getMessageBody(msg: GmailMessage): MessageBodyContent {
  const html = (msg.bodyHtml ?? '').trim();
  const body = (msg.body ?? '').trim();
  if (html) return { mode: 'html', html };
  if (body && looksLikeHtml(body)) return { mode: 'html', html: body };
  if (body) return { mode: 'plain', text: body };
  return { mode: 'plain', text: '(No message body)' };
}

const SIZE_REPORT_JS = `
(function() {
  var lastH = 0;
  function contentHeight() {
    var root = document.getElementById('email-root');
    if (!root) {
      return Math.max(document.body.scrollHeight || 0, 80);
    }
    var rootTop = root.getBoundingClientRect().top;
    var maxBottom = rootTop;
    var nodes = root.querySelectorAll(
      'p,div,span,table,img,tr,td,li,blockquote,pre,h1,h2,h3,h4,a,ul,ol'
    );
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var style = window.getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      var r = el.getBoundingClientRect();
      if (r.height < 1 && r.width < 1) continue;
      if (r.bottom > maxBottom) maxBottom = r.bottom;
    }
    var h = Math.ceil(maxBottom - rootTop);
    if (h < 1) h = root.scrollHeight || 80;
    return h + 6;
  }
  function report() {
    var root = document.getElementById('email-root');
    var h = contentHeight();
    if (root) {
      var boxH = root.getBoundingClientRect().height;
      if (boxH > 40) {
        h = Math.ceil(boxH);
      } else {
        var tr = window.getComputedStyle(root).transform;
        if (tr && tr !== 'none') {
          var m = tr.match(/matrix\\(([^)]+)\\)/);
          if (m) {
            var scale = parseFloat(m[1].split(',')[0]) || 1;
            if (scale > 0 && scale < 1) h = Math.ceil(h * scale);
          }
        }
      }
    }
    if (h < 40) h = 40;
    if (Math.abs(h - lastH) < 2) return;
    lastH = h;
    var w = document.body.scrollWidth || document.documentElement.scrollWidth || 0;
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'size', height: h, width: w }));
    }
  }
  report();
  setTimeout(report, 50);
  setTimeout(report, 250);
  setTimeout(report, 700);
  setTimeout(report, 1200);
  if (document.getElementById('email-root')) {
    new MutationObserver(report).observe(document.getElementById('email-root'), {
      childList: true, subtree: true, attributes: true
    });
  }
  window.addEventListener('load', report);
})();
true;
`;

/** Max on-screen body height; taller mail scrolls inside the WebView so attachments stay reachable. */
const MAX_EMAIL_BODY_VIEW_HEIGHT = 640;

function plainSnippet(msg: GmailMessage): string {
  const raw = (msg.bodyHtml || msg.body || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (raw) return raw.slice(0, 140);
  return '(No message body)';
}

function MessageBubble({
  msg,
  expanded,
  onToggle,
}: {
  msg: GmailMessage;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { width: screenWidth } = useWindowDimensions();
  const bodyContent = useMemo(() => getMessageBody(msg), [msg.id, msg.body, msg.bodyHtml]);
  const webViewWidth = Math.floor(screenWidth - 52);
  const htmlSource = useMemo(() => {
    if (bodyContent.mode === 'html') {
      return wrapEmailHtmlBody(bodyContent.html, webViewWidth);
    }
    return wrapPlainTextAsEmailDocument(bodyContent.text, webViewWidth);
  }, [bodyContent, webViewWidth]);
  const [bodyContentHeight, setBodyContentHeight] = useState(200);
  const [bodyLoading, setBodyLoading] = useState(true);
  const webViewDisplayHeight = Math.min(
    Math.max(bodyContentHeight, 80),
    MAX_EMAIL_BODY_VIEW_HEIGHT
  );
  const bodyScrollsInside = bodyContentHeight > MAX_EMAIL_BODY_VIEW_HEIGHT;
  const hasAttachments = (msg.attachments?.length ?? 0) > 0;
  const [viewer, setViewer] = useState<AttachmentViewerState | null>(null);
  const [sharing, setSharing] = useState(false);
  const [busyAttachmentId, setBusyAttachmentId] = useState<string | null>(null);
  const [lastAtt, setLastAtt] = useState<GmailMessage['attachments'][number] | null>(null);
  const fromAddr = parseAddress(msg.from);
  const toAddr = parseAddress(msg.to);
  const displayName = fromAddr.name || fromAddr.email || '(unknown)';
  const initial = (displayName.replace(/[^\p{L}\p{N}]/gu, '').charAt(0) || '?').toUpperCase();
  const avatarBg = avatarColorForName(displayName);
  const date = msg.date && !Number.isNaN(new Date(msg.date).getTime())
    ? format(new Date(msg.date), 'MMM d, yyyy, h:mm a') : '';
  const snippet = plainSnippet(msg);
  const webViewRef = useRef<WebView>(null);

  useEffect(() => {
    if (!expanded) return;
    setBodyContentHeight(200);
    setBodyLoading(true);
  }, [expanded, msg.id, htmlSource]);

  function onMessage(e: any) {
    try {
      const data = JSON.parse(e.nativeEvent.data);
      if (data.type === 'size' && data.height > 0) {
        setBodyContentHeight(Math.max(data.height, 80));
        setBodyLoading(false);
      }
    } catch {}
  }

  function onWebViewLoadEnd() {
    webViewRef.current?.injectJavaScript(`${EMAIL_FIT_WIDTH_JS}\n${SIZE_REPORT_JS}`);
    setBodyLoading(false);
    setBodyContentHeight((h) => (h < 100 ? 240 : h));
  }

  async function openAttachmentPreview(att: GmailMessage['attachments'][number]) {
    setLastAtt(att);
    setBusyAttachmentId(att.attachmentId);
    setViewer({
      phase: 'loading',
      filename: att.filename,
      statusText: 'Loading attachment…',
    });
    try {
      const uri = await getAttachmentUri(msg.id, att.attachmentId, att.filename, att.mimeType);
      const content = await buildAttachmentPreviewContent(uri, att.filename, att.mimeType);
      setViewer({
        phase: 'ready',
        filename: att.filename,
        mimeType: att.mimeType,
        shareUri: uri,
        content,
      });
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Could not load attachment';
      setViewer({
        phase: 'error',
        filename: att.filename,
        message,
      });
    } finally {
      setBusyAttachmentId(null);
    }
  }

  async function downloadAttachment(att: GmailMessage['attachments'][number]) {
    setLastAtt(att);
    setBusyAttachmentId(att.attachmentId);
    setViewer({
      phase: 'loading',
      filename: att.filename,
      statusText: 'Preparing download…',
    });
    try {
      const uri = await getAttachmentUri(msg.id, att.attachmentId, att.filename, att.mimeType);
      setViewer(null);
      await shareCachedAttachment(uri, att.filename, att.mimeType);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Could not download attachment';
      setViewer({
        phase: 'error',
        filename: att.filename,
        message,
      });
    } finally {
      setBusyAttachmentId(null);
    }
  }

  function closeViewer() {
    setViewer(null);
    setBusyAttachmentId(null);
  }

  async function handleViewerDownload() {
    if (viewer?.phase !== 'ready') return;
    setSharing(true);
    try {
      await shareCachedAttachment(viewer.shareUri, viewer.filename, viewer.mimeType);
    } catch (e: unknown) {
      Alert.alert(
        'Download failed',
        e instanceof Error ? e.message : 'Could not share file'
      );
    } finally {
      setSharing(false);
    }
  }

  return (
    <View style={styles.messageCard}>
      <TouchableOpacity style={styles.msgCollapsedHeader} onPress={onToggle} activeOpacity={0.7}>
        <View style={[styles.msgAvatar, { backgroundColor: avatarBg }]}>
          <Text style={styles.msgAvatarText}>{initial}</Text>
        </View>
        <View style={styles.msgHeaderText}>
          <View style={styles.msgHeaderTop}>
            <Text style={styles.msgFromName} numberOfLines={1}>{displayName}</Text>
            <Text style={styles.msgDate}>{date}</Text>
          </View>
          {!expanded && (
            <>
              <Text style={styles.msgSnippet} numberOfLines={2}>{snippet}</Text>
              {hasAttachments ? (
                <View style={styles.attachHint}>
                  <Ionicons name="attach" size={14} color={Gmail.textMuted} />
                  <Text style={styles.attachHintText}>
                    {msg.attachments!.length} attachment{msg.attachments!.length === 1 ? '' : 's'}
                  </Text>
                </View>
              ) : null}
            </>
          )}
          {expanded && (
            <Text style={styles.msgTo} numberOfLines={1}>to {toAddr.name || toAddr.email}</Text>
          )}
        </View>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={Gmail.textMuted}
        />
      </TouchableOpacity>

      {expanded && (
        <View style={styles.msgExpandedBody}>
          {hasAttachments ? (
            <MessageAttachmentPreviews
              messageId={msg.id}
              attachments={msg.attachments!}
              onPreview={(att) => void openAttachmentPreview(att)}
              onDownload={(att) => void downloadAttachment(att)}
              busyAttachmentId={busyAttachmentId}
              placement="above"
            />
          ) : null}

          <View style={styles.msgWebViewWrap}>
              {bodyLoading && (
                <View style={styles.bodyLoading}>
                  <ActivityIndicator color={Gmail.blue} size="small" />
                </View>
              )}
              <View style={[styles.msgWebViewFrame, { height: webViewDisplayHeight }]}>
              {bodyScrollsInside ? (
                <View style={styles.bodyScrollFade} pointerEvents="none">
                  <View style={styles.bodyScrollFadeTop} />
                  <Text style={styles.bodyScrollHint}>Scroll for more</Text>
                </View>
              ) : null}
              <WebView
                ref={webViewRef}
                key={`${msg.id}-${expanded ? 'open' : 'closed'}-${webViewWidth}`}
                style={{
                  width: '100%',
                  height: webViewDisplayHeight,
                  opacity: bodyLoading ? 0.01 : 1,
                  backgroundColor: 'transparent',
                }}
                originWhitelist={['*']}
                source={{ html: htmlSource, baseUrl: 'about:blank' }}
                scrollEnabled={bodyScrollsInside}
                nestedScrollEnabled={bodyScrollsInside}
                injectedJavaScript={`${EMAIL_FIT_WIDTH_JS}\n${SIZE_REPORT_JS}`}
                onMessage={onMessage}
                onLoadEnd={onWebViewLoadEnd}
                onShouldStartLoadWithRequest={(req) => {
                  const url = req.url ?? '';
                  if (
                    url === 'about:blank' ||
                    url.startsWith('data:') ||
                    url.startsWith('blob:')
                  ) {
                    return true;
                  }
                  Linking.openURL(url).catch(() => {});
                  return false;
                }}
                showsVerticalScrollIndicator={bodyScrollsInside}
                javaScriptEnabled
                domStorageEnabled
                mixedContentMode="always"
                androidLayerType="hardware"
                textZoom={100}
                setBuiltInZoomControls={false}
                showsHorizontalScrollIndicator={false}
              />
              </View>
            </View>
        </View>
      )}

      <AttachmentViewerModal
        state={viewer}
        sharing={sharing}
        onClose={closeViewer}
        onDownload={() => void handleViewerDownload()}
        onRetry={
          lastAtt
            ? () => {
                if (viewer?.phase === 'error') void openAttachmentPreview(lastAtt);
              }
            : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Gmail.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Gmail.bg, padding: 24, gap: 8 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingVertical: 4,
    backgroundColor: Gmail.bg,
  },
  headerIconBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerActions: { flex: 1, flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center' },
  subjectLine: {
    fontSize: 22,
    fontWeight: '400',
    color: Gmail.text,
    paddingHorizontal: 16,
    paddingBottom: 10,
    backgroundColor: Gmail.bg,
  },
  previewFrom: {
    fontSize: 14,
    color: Gmail.textSecondary,
    paddingHorizontal: 16,
    paddingBottom: 8,
    backgroundColor: Gmail.bg,
  },
  threadLoading: {
    paddingVertical: 48,
    alignItems: 'center',
    gap: 12,
  },
  threadLoadingText: { fontSize: 14, color: Gmail.textSecondary },
  plainBody: {
    fontSize: 15,
    lineHeight: 22,
    color: Gmail.text,
  },
  bodyLoading: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 24,
    alignItems: 'center',
    zIndex: 1,
  },
  threadLabelsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: Gmail.bg,
    borderBottomWidth: 1,
    borderBottomColor: Gmail.border,
  },
  messages: { flex: 1, backgroundColor: Gmail.bgMuted },

  actionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Gmail.bg,
    borderTopWidth: 1,
    borderTopColor: Gmail.border,
    paddingTop: 10,
    paddingHorizontal: 16,
  },
  replyPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Gmail.border,
    backgroundColor: Gmail.bg,
  },
  replyPillText: { fontSize: 15, color: Gmail.textSecondary, fontWeight: '500' },
  replyIconBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Modal compose
  modalHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  modalTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },
  fieldRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight, gap: 10,
  },
  fieldLabel: { width: 52, fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  fieldInput: { flex: 1, fontSize: 14, color: Colors.text, padding: 0 },
  bodyInput: {
    minHeight: 200, padding: 16,
    fontSize: 15, color: Colors.text, lineHeight: 22,
  },
  attachmentList: { flexDirection: 'column', gap: 6, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  attachmentChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 10, paddingVertical: 8,
    borderRadius: 8, borderWidth: 1,
  },
  attachmentName: { fontSize: 13, fontWeight: '500' },
  attachmentMeta: { fontSize: 11 },
  progressTrack: { height: 3, borderRadius: 2, backgroundColor: Colors.border, overflow: 'hidden' },
  progressFill: { height: 3, borderRadius: 2, backgroundColor: Colors.primary },
  toolbar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 8,
    borderTopWidth: 1, borderTopColor: Colors.border,
    backgroundColor: Colors.surface, gap: 16,
  },
  toolbarBtn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toolbarBtnText: { fontSize: 13, color: Colors.textSecondary, fontWeight: '500' },
  attachBadge: {
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: Colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  attachBadgeText: { fontSize: 10, fontWeight: '700', color: Colors.surface },

  messageCard: {
    marginHorizontal: 12,
    marginBottom: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    overflow: 'hidden',
    shadowColor: '#1a2b4a',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },
  msgCollapsedHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  msgAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  msgAvatarText: { fontSize: 17, fontWeight: '500', color: '#fff' },
  msgHeaderText: { flex: 1, gap: 4, minWidth: 0 },
  msgHeaderTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  msgFromName: { fontSize: 15, fontWeight: '600', color: Gmail.text, flex: 1 },
  msgDate: { fontSize: 12, color: Gmail.textSecondary },
  msgSnippet: { fontSize: 14, lineHeight: 20, color: Gmail.textSecondary },
  attachHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 2,
  },
  attachHintText: { fontSize: 12, color: Gmail.textMuted, fontWeight: '500' },
  msgTo: { fontSize: 13, color: Gmail.textMuted },
  msgWebViewWrap: {
    minHeight: 80,
    width: '100%',
    alignSelf: 'stretch',
    overflow: 'hidden',
  },
  msgWebViewFrame: {
    width: '100%',
    alignSelf: 'stretch',
    overflow: 'hidden',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
  },
  bodyScrollFade: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    paddingBottom: 4,
    alignItems: 'center',
  },
  bodyScrollFadeTop: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 36,
    backgroundColor: '#FFFFFF',
    opacity: 0.94,
  },
  bodyScrollHint: {
    fontSize: 11,
    color: Gmail.textMuted,
    fontWeight: '500',
  },
  msgExpandedBody: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 12,
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Gmail.border,
  },
  errorText: { fontSize: 14, color: Colors.error, textAlign: 'center' },
  backLink: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 8, backgroundColor: Gmail.blue, borderRadius: 20 },
  backLinkText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});
