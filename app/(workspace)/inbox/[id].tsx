import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Linking,
  useWindowDimensions, Modal, SafeAreaView,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import WebView from 'react-native-webview';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { File, Paths } from 'expo-file-system';
import { supabase } from '../../../lib/supabase';
import { gmailApi, type GmailMessage } from '../../../lib/api';
import { sendMailDirectly, readFileAsBase64 } from '../../../lib/gmail-send-direct';
import { Colors } from '../../../constants/colors';

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
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
  const [sending, setSending] = useState(false);
  const bodyInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    gmailApi.getThread(id)
      .then((data) => setMessages(data.messages ?? []))
      .catch((e) => {
        console.error('[thread] load failed:', e?.message);
        setError(e?.message ?? 'Failed to load thread');
      })
      .finally(() => setLoading(false));
    // Note: mark-read is fired from the inbox's openThread (the moment the
    // user taps the row), not here, so a slow thread load doesn't delay it.
  }, [id]);

  const lastMessage = messages?.[messages.length - 1];
  const firstMessage = messages?.[0];
  const subject = firstMessage?.subject ?? '';

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

    setSending(true);
    try {
      const driveLinks = attachments.filter((f) => f.status === 'drive' && f.driveLink);
      let finalBody = replyBody;
      if (driveLinks.length > 0) {
        const linkBlock = driveLinks.map((f) => `${f.name}: ${f.driveLink}`).join('\n');
        finalBody = finalBody ? `${finalBody}\n\n--- Attachments ---\n${linkBlock}` : linkBlock;
      }

      const readyAttachments = attachments.filter((f) => f.status === 'ready');

      const commonParams = {
        to: replyTo,
        cc: replyCc || undefined,
        subject: replySubject,
        textBody: finalBody,
        threadId: replyMode !== 'forward' ? lastMessage.threadId : undefined,
        inReplyToMessageId: replyMode !== 'forward' ? (lastMessage.messageIdHeader ?? lastMessage.id) : undefined,
      };

      if (readyAttachments.length > 0) {
        const { accessToken } = await gmailApi.getGoogleToken();
        await sendMailDirectly({
          accessToken,
          ...commonParams,
          attachments: readyAttachments.map((f) => ({ filename: f.name, mimeType: f.mimeType, uri: f.uri, base64Data: f.base64Data })),
        });
      } else {
        await gmailApi.send(commonParams);
      }

      Alert.alert('Sent', 'Message sent successfully.');
      setReplyMode(null);
      setReplyBody('');
      setAttachments([]);
    } catch (e: any) {
      console.error('[thread] send failed:', e?.message);
      Alert.alert('Failed to send', e?.message ?? 'Something went wrong.');
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (error || !messages) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Ionicons name="warning-outline" size={32} color={Colors.error} />
        <Text style={styles.errorText}>{error ?? 'Thread not found'}</Text>
        <TouchableOpacity style={styles.backLink} onPress={() => router.back()}>
          <Text style={styles.backLinkText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const modeLabel = replyMode === 'replyAll' ? 'Reply All' : replyMode === 'forward' ? 'Forward' : 'Reply';

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.container, { paddingTop: insets.top }]}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.subject} numberOfLines={2}>{subject || '(No Subject)'}</Text>
        </View>

        {/* Thread messages */}
        <ScrollView style={styles.messages} contentContainerStyle={{ padding: 12, gap: 12 }}>
          {messages.map((msg, idx) => (
            <MessageBubble key={msg.id ?? idx} msg={msg} />
          ))}
        </ScrollView>

        {/* Bottom action bar */}
        <View style={[styles.actionBar, { paddingBottom: insets.bottom + 6 }]}>
          <ActionBtn icon="arrow-undo-outline" label="Reply" onPress={() => openReply('reply')} />
          <ActionBtn icon="arrow-redo-outline" label="Reply All" onPress={() => openReply('replyAll')} />
          <ActionBtn icon="share-outline" label="Forward" onPress={() => openReply('forward')} />
        </View>
      </View>

      {/* Compose modal */}
      <Modal
        visible={replyMode !== null}
        animationType="slide"
        onRequestClose={closeReply}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: Colors.surface }}>
          {/* Modal header */}
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={closeReply} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={24} color={Colors.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{modeLabel}</Text>
            <TouchableOpacity
              onPress={handleSend}
              disabled={sending || attachments.some((f) => f.status === 'uploading' || f.status === 'preparing')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              {sending
                ? <ActivityIndicator size="small" color={Colors.primary} />
                : <Ionicons name="send" size={22} color={Colors.primary} />
              }
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
    </KeyboardAvoidingView>
  );
}

function ActionBtn({ icon, label, onPress }: { icon: any; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.actionBtn} onPress={onPress} activeOpacity={0.7}>
      <Ionicons name={icon} size={20} color={Colors.primary} />
      <Text style={styles.actionBtnLabel}>{label}</Text>
    </TouchableOpacity>
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

const WEBVIEW_WRAPPER = `<!DOCTYPE html><html><head>
<meta name="viewport" content="initial-scale=1"/>
<style>
  * { box-sizing: border-box; }
  body { margin:0; padding:0; font-family:-apple-system,system-ui,sans-serif; font-size:14px; line-height:1.5; color:#111827; background:#fff; }
  img { height:auto !important; }
  a { color:#3B82F6; }
  pre, code { white-space:pre-wrap; }
</style></head><body>__BODY__</body></html>`;

function buildHtml(html: string, plain: string): string {
  if (html && html.trim().length > 0) {
    const content = html
      .replace(/<html[^>]*>/i, '').replace(/<\/html>/i, '')
      .replace(/<head[\s\S]*?<\/head>/i, '')
      .replace(/<body[^>]*>/i, '').replace(/<\/body>/i, '');
    return WEBVIEW_WRAPPER.replace('__BODY__', content);
  }
  const escaped = (plain || '(no body)')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');
  return WEBVIEW_WRAPPER.replace('__BODY__', escaped);
}

async function fetchAttachmentToCache(
  messageId: string,
  attachmentId: string,
  filename: string,
  mimeType: string
): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in');

  const url = gmailApi.attachmentUrl(messageId, attachmentId, filename, mimeType);
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  const dest = new File(Paths.cache, `gmail_att_${safe}`);
  if (dest.exists) dest.delete();

  const downloaded = await File.downloadFileAsync(url, dest, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return downloaded.uri;
}

function isPreviewable(mimeType: string): boolean {
  return (
    mimeType.startsWith('image/') ||
    mimeType === 'application/pdf' ||
    mimeType.startsWith('text/')
  );
}

interface AttachmentPreviewState {
  localUri: string;
  filename: string;
  mimeType: string;
}

function AttachmentPreviewModal({
  preview,
  onClose,
  onDownload,
  downloading,
}: {
  preview: AttachmentPreviewState;
  onClose: () => void;
  onDownload: () => void;
  downloading: boolean;
}) {
  const canPreview = isPreviewable(preview.mimeType);
  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#111' }}>
        <View style={previewStyles.header}>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
          <Text style={previewStyles.title} numberOfLines={1}>{preview.filename}</Text>
          <TouchableOpacity
            onPress={onDownload}
            disabled={downloading}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            {downloading
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="share-outline" size={24} color="#fff" />
            }
          </TouchableOpacity>
        </View>

        {canPreview ? (
          <WebView
            source={{ uri: preview.localUri }}
            style={{ flex: 1, backgroundColor: '#fff' }}
            originWhitelist={['*', 'file://']}
            allowFileAccess
            allowUniversalAccessFromFileURLs
            allowFileAccessFromFileURLs
            startInLoadingState
            renderLoading={() => (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' }}>
                <ActivityIndicator color={Colors.primary} />
              </View>
            )}
          />
        ) : (
          <View style={previewStyles.noPreview}>
            <Ionicons name="document-outline" size={64} color="#888" />
            <Text style={previewStyles.noPreviewText}>{preview.filename}</Text>
            <Text style={previewStyles.noPreviewSub}>No preview available for this file type</Text>
            <TouchableOpacity
              style={previewStyles.downloadBtn}
              onPress={onDownload}
              disabled={downloading}
            >
              {downloading
                ? <ActivityIndicator size="small" color="#fff" />
                : <Text style={previewStyles.downloadBtnText}>Save / Share</Text>
              }
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const previewStyles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#111',
  },
  title: { flex: 1, fontSize: 15, fontWeight: '600', color: '#fff', marginHorizontal: 12 },
  noPreview: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: '#1a1a1a', padding: 32 },
  noPreviewText: { fontSize: 16, fontWeight: '600', color: '#fff', textAlign: 'center' },
  noPreviewSub: { fontSize: 13, color: '#888', textAlign: 'center' },
  downloadBtn: {
    marginTop: 8, paddingHorizontal: 28, paddingVertical: 12,
    backgroundColor: Colors.primary, borderRadius: 10,
  },
  downloadBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});

function MessageBubble({ msg }: { msg: GmailMessage }) {
  const { width: screenWidth } = useWindowDimensions();
  const [webViewHeight, setWebViewHeight] = useState(120);
  const [contentWidth, setContentWidth] = useState(screenWidth - 56);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<AttachmentPreviewState | null>(null);
  const [sharing, setSharing] = useState(false);
  const fromAddr = parseAddress(msg.from);
  const toAddr = parseAddress(msg.to);
  const date = msg.date && !Number.isNaN(new Date(msg.date).getTime())
    ? format(new Date(msg.date), 'MMM d, yyyy h:mm a') : '';
  const html = buildHtml(msg.bodyHtml, msg.body);

  const injectedJs = `(function(){function s(){var h=document.body.scrollHeight,w=document.body.scrollWidth;window.ReactNativeWebView.postMessage(JSON.stringify({type:'size',height:h,width:w}));}s();new MutationObserver(s).observe(document.body,{childList:true,subtree:true,attributes:true});window.addEventListener('load',s);})();true;`;

  function onMessage(e: any) {
    try {
      const data = JSON.parse(e.nativeEvent.data);
      if (data.type === 'size') {
        if (data.height > 0) setWebViewHeight(data.height + 16);
        if (data.width > 0) setContentWidth(Math.max(data.width, screenWidth - 56));
      }
    } catch {}
  }

  async function handleAttachmentPress(att: GmailMessage['attachments'][number]) {
    setLoadingId(att.attachmentId);
    try {
      const localUri = await fetchAttachmentToCache(msg.id, att.attachmentId, att.filename, att.mimeType);
      setPreview({ localUri, filename: att.filename, mimeType: att.mimeType });
    } catch (e: any) {
      Alert.alert('Failed to load', e?.message ?? 'Could not load attachment');
    } finally {
      setLoadingId(null);
    }
  }

  async function handleShare() {
    if (!preview) return;
    setSharing(true);
    try {
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(preview.localUri, {
          dialogTitle: preview.filename,
          mimeType: preview.mimeType,
          UTI: preview.mimeType,
        });
      } else {
        Alert.alert('Saved', `File saved to cache: ${preview.filename}`);
      }
    } catch (e: any) {
      Alert.alert('Share failed', e?.message ?? 'Could not share file');
    } finally {
      setSharing(false);
    }
  }

  const isWide = contentWidth > screenWidth - 56;

  return (
    <View style={styles.messageBubble}>
      <View style={styles.msgHeader}>
        <View style={styles.msgFromBlock}>
          <Text style={styles.msgFromName} numberOfLines={1}>{fromAddr.name || fromAddr.email || '(unknown)'}</Text>
          <Text style={styles.msgFromEmail} numberOfLines={1}>{fromAddr.email}</Text>
        </View>
        <Text style={styles.msgDate}>{date}</Text>
      </View>
      <Text style={styles.msgTo} numberOfLines={1}>To: {toAddr.name || toAddr.email}</Text>

      <ScrollView
        horizontal
        scrollEnabled={isWide}
        showsHorizontalScrollIndicator={isWide}
        scrollIndicatorInsets={{ bottom: 0 }}
        style={{ marginHorizontal: -14 }}
        contentContainerStyle={{ paddingHorizontal: 14 }}
      >
        <WebView
          style={{ height: webViewHeight, width: contentWidth }}
          originWhitelist={['*']}
          source={{ html }}
          scrollEnabled={false}
          injectedJavaScript={injectedJs}
          onMessage={onMessage}
          onShouldStartLoadWithRequest={(req) => {
            if (req.url !== 'about:blank' && !req.url.startsWith('data:')) {
              Linking.openURL(req.url).catch(() => {});
              return false;
            }
            return true;
          }}
          showsVerticalScrollIndicator={false}
          javaScriptEnabled
        />
      </ScrollView>

      {msg.attachments?.length > 0 && (
        <View style={styles.attachmentsRow}>
          {msg.attachments.map((att) => {
            const isLoading = loadingId === att.attachmentId;
            return (
              <TouchableOpacity
                key={att.attachmentId}
                style={styles.attChip}
                onPress={() => handleAttachmentPress(att)}
                disabled={!!loadingId}
                activeOpacity={0.7}
              >
                {isLoading
                  ? <ActivityIndicator size="small" color={Colors.primary} style={{ width: 14, height: 14 }} />
                  : <Ionicons name="eye-outline" size={14} color={Colors.primary} />
                }
                <Text style={styles.attChipName} numberOfLines={1}>{att.filename}</Text>
                {att.size > 0 && <Text style={styles.attChipSize}>{formatBytes(att.size)}</Text>}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {preview && (
        <AttachmentPreviewModal
          preview={preview}
          onClose={() => setPreview(null)}
          onDownload={handleShare}
          downloading={sharing}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background, padding: 24, gap: 8 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    padding: 16, backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  subject: { flex: 1, fontSize: 15, fontWeight: '700', color: Colors.text },
  messages: { flex: 1 },

  // Action bar
  actionBar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: 8,
    paddingHorizontal: 8,
  },
  actionBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8, gap: 4,
  },
  actionBtnLabel: { fontSize: 11, fontWeight: '600', color: Colors.primary },

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

  // Message bubble
  messageBubble: {
    backgroundColor: Colors.surface, borderRadius: 12,
    padding: 14, gap: 6,
    shadowColor: Colors.shadow, shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1, shadowRadius: 4, elevation: 2,
  },
  msgHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 },
  msgFromBlock: { flex: 1 },
  msgFromName: { fontSize: 14, fontWeight: '700', color: Colors.text },
  msgFromEmail: { fontSize: 12, color: Colors.textMuted },
  msgDate: { fontSize: 11, color: Colors.textMuted, textAlign: 'right' },
  msgTo: { fontSize: 12, color: Colors.textSecondary },
  attachmentsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  attChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: Colors.primaryLight, borderRadius: 999,
  },
  attChipName: { fontSize: 12, color: Colors.primary, maxWidth: 140 },
  attChipSize: { fontSize: 11, color: Colors.primary, opacity: 0.7 },
  errorText: { fontSize: 14, color: Colors.error, textAlign: 'center' },
  backLink: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 8, backgroundColor: Colors.primary, borderRadius: 8 },
  backLinkText: { color: Colors.surface, fontWeight: '600', fontSize: 14 },
});
