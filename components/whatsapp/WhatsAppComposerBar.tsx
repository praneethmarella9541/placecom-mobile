import React, { useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Keyboard,
  type TextInput as RNTextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Colors } from '../../constants/colors';
import { whatsappApi } from '../../lib/api';
import type { WhatsAppSendPayload } from '../../lib/whatsapp-types';
import { WhatsAppEmojiPicker } from './WhatsAppEmojiPicker';
import { WhatsAppAttachSheet } from './WhatsAppAttachSheet';
import {
  WhatsAppMediaAttachmentPreview,
  WHATSAPP_MAX_ATTACHMENTS,
  type PendingAttachment,
} from './WhatsAppMediaAttachmentPreview';

const EMOJI_PANEL_HEIGHT = 280;

type Props = {
  needsTemplate: boolean;
  templateVar1: string;
  templateVar2: string;
  onTemplateVar1Change: (v: string) => void;
  onTemplateVar2Change: (v: string) => void;
  templatePreview?: string;
  draft: string;
  onDraftChange: (v: string) => void;
  sending: boolean;
  onSend: (payload: WhatsAppSendPayload) => void | Promise<void>;
  bottomInset: number;
  onEmojiOpenChange?: (open: boolean) => void;
  onAttachmentActiveChange?: (active: boolean) => void;
};

export function WhatsAppComposerBar({
  needsTemplate,
  templateVar1,
  templateVar2,
  onTemplateVar1Change,
  onTemplateVar2Change,
  templatePreview,
  draft,
  onDraftChange,
  sending,
  onSend,
  bottomInset,
  onEmojiOpenChange,
  onAttachmentActiveChange,
}: Props) {
  const inputRef = useRef<RNTextInput>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachSheetOpen, setAttachSheetOpen] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const uploadGenRef = useRef<Record<string, number>>({});

  // The screen wraps this bar in a KeyboardAvoidingView, so the system keyboard
  // offset is handled there. Here we only reserve the safe-area inset — adding
  // the keyboard height again would double-offset the bar on Android (adjustResize).
  const bottomPad = bottomInset;
  const hasAttachments = attachments.length > 0;

  const setAttachmentsState = useCallback(
    (next: PendingAttachment[] | ((prev: PendingAttachment[]) => PendingAttachment[])) => {
      setAttachments((prev) => {
        const resolved = typeof next === 'function' ? next(prev) : next;
        onAttachmentActiveChange?.(resolved.length > 0);
        return resolved;
      });
    },
    [onAttachmentActiveChange]
  );

  const setEmojiPanel = useCallback(
    (open: boolean) => {
      setEmojiOpen(open);
      onEmojiOpenChange?.(open);
    },
    [onEmojiOpenChange]
  );

  function toggleEmoji() {
    if (emojiOpen) {
      setEmojiPanel(false);
      inputRef.current?.focus();
    } else {
      Keyboard.dismiss();
      setAttachSheetOpen(false);
      setEmojiPanel(true);
    }
  }

  function insertEmoji(emoji: string) {
    onDraftChange(draft + emoji);
  }

  function startUpload(item: PendingAttachment) {
    const gen = (uploadGenRef.current[item.id] ?? 0) + 1;
    uploadGenRef.current[item.id] = gen;
    const { id, localUri, name, mimeType } = item;

    void (async () => {
      try {
        const data = await whatsappApi.uploadMedia(localUri, name, mimeType);
        if (uploadGenRef.current[id] !== gen) return;
        setAttachmentsState((prev) =>
          prev.map((a) =>
            a.id === id
              ? {
                  ...a,
                  status: 'ready',
                  remoteUrl: data.url,
                  kind: data.kind,
                  filename: data.filename,
                  error: undefined,
                }
              : a
          )
        );
      } catch (e: unknown) {
        if (uploadGenRef.current[id] !== gen) return;
        const msg = e instanceof Error ? e.message : 'Upload failed';
        setAttachmentsState((prev) =>
          prev.map((a) => (a.id === id ? { ...a, status: 'failed', error: msg } : a))
        );
      }
    })();
  }

  function queueAttachments(
    items: Array<{
      localUri: string;
      name: string;
      mimeType: string;
      isImage: boolean;
      sizeBytes?: number | null;
    }>
  ) {
    setAttachSheetOpen(false);
    setEmojiPanel(false);

    const newItems: PendingAttachment[] = [];
    setAttachmentsState((prev) => {
      const room = WHATSAPP_MAX_ATTACHMENTS - prev.length;
      const slice = items.slice(0, Math.max(0, room));
      if (slice.length < items.length) {
        Alert.alert(
          'Limit reached',
          `You can attach up to ${WHATSAPP_MAX_ATTACHMENTS} files at once.`
        );
      }
      for (const it of slice) {
        const id = `att-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const item: PendingAttachment = {
          id,
          localUri: it.localUri,
          name: it.name,
          mimeType: it.mimeType,
          isImage: it.isImage,
          status: 'uploading',
          sizeBytes: it.sizeBytes,
        };
        newItems.push(item);
      }
      return newItems.length ? [...prev, ...newItems] : prev;
    });

    for (const item of newItems) {
      startUpload(item);
    }
  }

  function retryUpload(id: string) {
    const item = attachments.find((a) => a.id === id);
    if (!item || item.status !== 'failed') return;
    setAttachmentsState((prev) =>
      prev.map((a) => (a.id === id ? { ...a, status: 'uploading', error: undefined } : a))
    );
    startUpload({ ...item, status: 'uploading' });
  }

  function removeAttachment(id: string) {
    uploadGenRef.current[id] = (uploadGenRef.current[id] ?? 0) + 1;
    setAttachmentsState((prev) => prev.filter((a) => a.id !== id));
  }

  function clearAttachments() {
    for (const a of attachments) {
      uploadGenRef.current[a.id] = (uploadGenRef.current[a.id] ?? 0) + 1;
    }
    setAttachmentsState([]);
  }

  function openAttachSheet() {
    if (needsTemplate) {
      Alert.alert('Template required', 'Send the opening template first, then attach after they reply.');
      return;
    }
    Keyboard.dismiss();
    setEmojiPanel(false);
    setAttachSheetOpen(true);
  }

  async function pickDocument() {
    const res = await DocumentPicker.getDocumentAsync({
      copyToCacheDirectory: true,
      multiple: true,
    });
    if (res.canceled || !res.assets?.length) return;
    queueAttachments(
      res.assets.map((a) => {
        const mime = a.mimeType ?? 'application/octet-stream';
        return {
          localUri: a.uri,
          name: a.name ?? 'file',
          mimeType: mime,
          isImage: mime.startsWith('image/'),
          sizeBytes: a.size ?? null,
        };
      })
    );
  }

  async function pickImage() {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
      allowsMultipleSelection: true,
      selectionLimit: WHATSAPP_MAX_ATTACHMENTS,
    });
    if (res.canceled || !res.assets?.length) return;
    queueAttachments(
      res.assets.map((a, i) => ({
        localUri: a.uri,
        name: a.fileName ?? `photo-${i + 1}.jpg`,
        mimeType: a.mimeType ?? 'image/jpeg',
        isImage: true,
        sizeBytes: a.fileSize ?? null,
      }))
    );
  }

  async function pickCamera() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera', 'Allow camera access to take a photo.');
      return;
    }
    const res = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (res.canceled || !res.assets?.[0]) return;
    const a = res.assets[0];
    queueAttachments([
      {
        localUri: a.uri,
        name: a.fileName ?? 'photo.jpg',
        mimeType: a.mimeType ?? 'image/jpeg',
        isImage: true,
        sizeBytes: a.fileSize ?? null,
      },
    ]);
  }

  function handleSend() {
    if (needsTemplate) {
      if (!templateVar1.trim() || !templateVar2.trim()) return;
      void onSend({ messageType: 'template', text: draft.trim() });
      setEmojiPanel(false);
      return;
    }

    if (hasAttachments) {
      const ready = attachments.filter((a) => a.status === 'ready' && a.remoteUrl);
      if (!ready.length) return;
      const caption = draft.trim();
      clearAttachments();
      onDraftChange('');
      setEmojiPanel(false);

      ready.forEach((att, index) => {
        const isLast = index === ready.length - 1;
        void onSend({
          messageType: att.kind ?? (att.isImage ? 'image' : 'document'),
          mediaUrl: att.remoteUrl!,
          mediaCaption: isLast ? caption || undefined : undefined,
          mediaFilename: att.filename ?? att.name,
        });
      });
      return;
    }

    if (!draft.trim()) return;
    void onSend({ messageType: 'text', text: draft.trim() });
    setEmojiPanel(false);
  }

  const anyUploading = attachments.some((a) => a.status === 'uploading');
  const allReady =
    hasAttachments &&
    attachments.every((a) => a.status === 'ready' && a.remoteUrl) &&
    !anyUploading;

  const canSend = needsTemplate
    ? templateVar1.trim() && templateVar2.trim()
    : hasAttachments
      ? allReady
      : !!draft.trim();

  return (
    <View style={[styles.outer, { paddingBottom: bottomPad }]}>
      <WhatsAppAttachSheet
        visible={attachSheetOpen}
        onClose={() => setAttachSheetOpen(false)}
        onPickGallery={() => void pickImage()}
        onPickCamera={() => void pickCamera()}
        onPickDocument={() => void pickDocument()}
      />

      <WhatsAppEmojiPicker
        visible={emojiOpen}
        onPick={insertEmoji}
        onClose={() => setEmojiPanel(false)}
        height={EMOJI_PANEL_HEIGHT}
      />

      {hasAttachments ? (
        <WhatsAppMediaAttachmentPreview
          attachments={attachments}
          caption={draft}
          onCaptionChange={onDraftChange}
          onRemove={removeAttachment}
          onRemoveAll={clearAttachments}
          onRetry={retryUpload}
          onAddMore={openAttachSheet}
        />
      ) : null}

      <View style={styles.wrap}>
        {needsTemplate ? (
          <View style={styles.templateBox}>
            <Text style={styles.templateTitle}>First message uses approved template</Text>
            <Text style={styles.templateHint}>
              {templatePreview ?? 'Hi [name], this is [you] from PlaceCom'}
            </Text>
            <View style={styles.templateRow}>
              <TextInput
                style={styles.templateInput}
                value={templateVar1}
                onChangeText={onTemplateVar1Change}
                placeholder="Recipient name"
                placeholderTextColor={Colors.textMuted}
              />
              <TextInput
                style={styles.templateInput}
                value={templateVar2}
                onChangeText={onTemplateVar2Change}
                placeholder="Your name"
                placeholderTextColor={Colors.textMuted}
              />
            </View>
          </View>
        ) : null}

        <View style={styles.bar}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={toggleEmoji}
            disabled={needsTemplate || hasAttachments}
          >
            <Ionicons
              name={emojiOpen ? 'keypad-outline' : 'happy-outline'}
              size={26}
              color={needsTemplate || hasAttachments ? Colors.textMuted : '#54656F'}
            />
          </TouchableOpacity>

          {!needsTemplate && !hasAttachments ? (
            <TextInput
              ref={inputRef}
              style={styles.input}
              value={draft}
              onChangeText={onDraftChange}
              placeholder="Message"
              placeholderTextColor={Colors.textMuted}
              multiline
              maxLength={1600}
              onFocus={() => {
                setEmojiPanel(false);
                setAttachSheetOpen(false);
              }}
            />
          ) : (
            <View style={styles.inputSpacer} />
          )}

          {!needsTemplate ? (
            hasAttachments ? (
              <TouchableOpacity
                style={[styles.sendBtn, (!canSend || sending) && styles.sendDisabled]}
                onPress={handleSend}
                disabled={!canSend || sending}
              >
                {anyUploading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="send" size={20} color="#fff" />
                )}
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity style={styles.iconBtn} onPress={openAttachSheet}>
                  <Ionicons name="add" size={28} color="#54656F" />
                </TouchableOpacity>
                {draft.trim() ? (
                  <TouchableOpacity
                    style={[styles.sendBtn, sending && styles.sendDisabled]}
                    onPress={handleSend}
                    disabled={sending}
                  >
                    <Ionicons name="send" size={20} color="#fff" />
                  </TouchableOpacity>
                ) : null}
              </>
            )
          ) : (
            <TouchableOpacity
              style={[styles.sendBtn, (!canSend || sending) && styles.sendDisabled]}
              onPress={handleSend}
              disabled={!canSend || sending}
            >
              {sending ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="send" size={20} color="#fff" />
              )}
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

export const WHATSAPP_COMPOSER_EMOJI_HEIGHT = EMOJI_PANEL_HEIGHT;

const styles = StyleSheet.create({
  outer: {
    backgroundColor: '#F0F2F5',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  wrap: {
    paddingHorizontal: 4,
    paddingBottom: 4,
  },
  templateBox: {
    marginHorizontal: 4,
    marginBottom: 8,
    marginTop: 6,
    padding: 10,
    backgroundColor: '#FFF8E1',
    borderRadius: 8,
    gap: 6,
  },
  templateTitle: { fontSize: 12, fontWeight: '700', color: '#92400E' },
  templateHint: { fontSize: 11, color: '#B45309' },
  templateRow: { flexDirection: 'row', gap: 8 },
  templateInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    padding: 8,
    fontSize: 14,
    backgroundColor: Colors.surface,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
    paddingHorizontal: 2,
  },
  iconBtn: {
    width: 40,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 16,
    color: Colors.text,
    minHeight: 48,
    maxHeight: 120,
    backgroundColor: Colors.surface,
  },
  inputSpacer: { flex: 1, minHeight: 48 },
  sendBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#25D366',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.45 },
});
