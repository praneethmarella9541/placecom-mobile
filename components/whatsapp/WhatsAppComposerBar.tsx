import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Keyboard,
  InteractionManager,
  Platform,
  BackHandler,
  type TextInput as RNTextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Colors } from '../../constants/colors';
import { whatsappApi } from '../../lib/api';
import type { WhatsAppSendPayload } from '../../lib/whatsapp-types';
import { WhatsAppEmojiPicker } from './WhatsAppEmojiPicker';
import { WhatsAppAttachSheet, type AttachPickerKind } from './WhatsAppAttachSheet';
import {
  WhatsAppMediaAttachmentPreview,
  WHATSAPP_MAX_ATTACHMENTS,
  type PendingAttachment,
} from './WhatsAppMediaAttachmentPreview';
import { normalizeOutboundImageAsset } from '../../lib/whatsapp-outbound-media';
import { filenameFromAssetUri } from '../../lib/whatsapp-media-helpers';
import { WhatsAppTemplatePanel } from './WhatsAppTemplatePanel';

const EMOJI_PANEL_HEIGHT = 280;

let nativePickerBusy = false;

async function withNativePickerLock(run: () => Promise<void>) {
  if (nativePickerBusy) return;
  nativePickerBusy = true;
  try {
    await run();
  } finally {
    nativePickerBusy = false;
  }
}

type Props = {
  needsTemplate: boolean;
  forceTemplate: boolean;
  onForceTemplateChange: (v: boolean) => void;
  templates: { name: string; languageCode: string; bodyParamCount: number; label: string; preview: string }[];
  selectedTemplateName: string;
  onTemplateChange: (name: string) => void;
  templateVariables: string[];
  onTemplateVariablesChange: (vars: string[]) => void;
  draft: string;
  onDraftChange: (v: string) => void;
  sending: boolean;
  onSend: (payload: WhatsAppSendPayload) => void | Promise<void>;
  onSendAttachments?: (attachments: PendingAttachment[], caption: string) => void;
  bottomInset: number;
  onEmojiOpenChange?: (open: boolean) => void;
  onAttachmentActiveChange?: (active: boolean) => void;
};

export function WhatsAppComposerBar({
  needsTemplate,
  forceTemplate,
  onForceTemplateChange,
  templates,
  selectedTemplateName,
  onTemplateChange,
  templateVariables,
  onTemplateVariablesChange,
  draft,
  onDraftChange,
  sending,
  onSend,
  onSendAttachments,
  bottomInset,
  onEmojiOpenChange,
  onAttachmentActiveChange,
}: Props) {
  const inputRef = useRef<RNTextInput>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [attachSheetOpen, setAttachSheetOpen] = useState(false);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const uploadGenRef = useRef<Record<string, number>>({});
  const pendingPickerRef = useRef<AttachPickerKind | null>(null);
  const [inputKey, setInputKey] = useState(0);

  // Parent passes safe-area + keyboard inset (Android pan / iOS KeyboardAvoidingView).
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

  function dismissComposer() {
    setAttachSheetOpen(false);
    setEmojiPanel(false);
    inputRef.current?.blur();
    Keyboard.dismiss();
  }

  function resetInputField() {
    dismissComposer();
    setInputKey((k) => k + 1);
  }

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const onHardwareBack = () => {
      if (attachSheetOpen) {
        setAttachSheetOpen(false);
        return true;
      }
      if (emojiOpen) {
        setEmojiPanel(false);
        return true;
      }
      if (inputRef.current?.isFocused?.()) {
        resetInputField();
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onHardwareBack);
    return () => sub.remove();
  }, [attachSheetOpen, emojiOpen, setEmojiPanel]);

  function startUpload(item: PendingAttachment) {
    const gen = (uploadGenRef.current[item.id] ?? 0) + 1;
    uploadGenRef.current[item.id] = gen;
    const { id, localUri, name, mimeType } = item;

    void (async () => {
      try {
        let uploadUri = localUri;
        let uploadName = name;
        let uploadMime = mimeType;
        if (item.isImage) {
          const norm = await normalizeOutboundImageAsset(
            { localUri, name, mimeType },
            { force: item.fromCamera }
          );
          uploadUri = norm.localUri;
          uploadName = norm.name;
          uploadMime = norm.mimeType;
        }
        const data = await whatsappApi.uploadMedia(uploadUri, uploadName, uploadMime);
        if (uploadGenRef.current[id] !== gen) return;
        setAttachmentsState((prev) =>
          prev.map((a) =>
            a.id === id
              ? {
                  ...a,
                  status: 'ready',
                  remoteUrl: data.url,
                  kind: data.kind,
                  filename: data.filename?.trim() && data.filename !== 'upload' ? data.filename : name,
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
      fromCamera?: boolean;
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
          fromCamera: it.fromCamera,
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

  function scheduleAttachPicker(kind: AttachPickerKind) {
    pendingPickerRef.current = kind;
    setAttachSheetOpen(false);
  }

  useEffect(() => {
    if (attachSheetOpen || !pendingPickerRef.current) return;

    const kind = pendingPickerRef.current;
    pendingPickerRef.current = null;

    const task = InteractionManager.runAfterInteractions(() => {
      switch (kind) {
        case 'gallery':
          void pickImage();
          break;
        case 'camera':
          void pickCamera();
          break;
        case 'audio':
          void pickAudio();
          break;
        case 'document':
          void pickDocument();
          break;
      }
    });

    return () => task.cancel();
  }, [attachSheetOpen]);

  async function pickDocument() {
    await withNativePickerLock(async () => {
      try {
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
            name: a.name?.trim() || filenameFromAssetUri(a.uri, 'file'),
            mimeType: mime,
            isImage: mime.startsWith('image/'),
            sizeBytes: a.size ?? null,
          };
        })
      );
      } catch (e) {
        Alert.alert('Error', e instanceof Error ? e.message : 'Could not open document picker.');
      }
    });
  }

  async function pickImage() {
    await withNativePickerLock(async () => {
      try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Allow access to your photos and videos to attach them.');
        return;
      }
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images', 'videos'],
        quality: 0.8,
        allowsMultipleSelection: true,
        selectionLimit: WHATSAPP_MAX_ATTACHMENTS,
        // Convert HEIC/TIFF to JPEG so WhatsApp/Exotel can deliver the image.
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
        videoExportPreset: ImagePicker.VideoExportPreset.H264_1280x720,
      });
      if (res.canceled || !res.assets?.length) return;
      queueAttachments(
        res.assets.map((a, i) => {
          // Use asset.type ("image"|"video") as the source of truth — mimeType can be null on some devices.
          const isVideo = a.type === 'video' || (a.mimeType ?? '').startsWith('video/');
          const mime = a.mimeType ?? (isVideo ? 'video/mp4' : 'image/jpeg');
          const fallback = isVideo ? `video-${i + 1}.mp4` : `photo-${i + 1}.jpg`;
          return {
            localUri: a.uri,
            name: a.fileName?.trim() || filenameFromAssetUri(a.uri, fallback),
            mimeType: mime,
            isImage: !isVideo,
            sizeBytes: a.fileSize ?? null,
          };
        })
      );
      } catch (e) {
        Alert.alert('Error', e instanceof Error ? e.message : 'Could not open gallery.');
      }
    });
  }

  async function pickCamera() {
    await withNativePickerLock(async () => {
      try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Camera permission needed', 'Allow camera access to take a photo or video.');
        return;
      }
      const res = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        quality: 0.85,
        exif: false,
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const a = res.assets[0];
      queueAttachments([
        {
          localUri: a.uri,
          name: a.fileName?.trim() || filenameFromAssetUri(a.uri, 'photo.jpg'),
          mimeType: 'image/jpeg',
          isImage: true,
          fromCamera: true,
          sizeBytes: a.fileSize ?? null,
        },
      ]);
      } catch (e) {
        Alert.alert('Error', e instanceof Error ? e.message : 'Could not open camera.');
      }
    });
  }

  async function pickAudio() {
    await withNativePickerLock(async () => {
      try {
      const res = await DocumentPicker.getDocumentAsync({
        type: ['audio/*'],
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (res.canceled || !res.assets?.length) return;
      queueAttachments(
        res.assets.map((a) => ({
          localUri: a.uri,
          name: a.name?.trim() || filenameFromAssetUri(a.uri, 'audio'),
          mimeType: a.mimeType ?? 'audio/mpeg',
          isImage: false,
          sizeBytes: a.size ?? null,
        }))
      );
      } catch (e) {
        Alert.alert('Error', e instanceof Error ? e.message : 'Could not open audio picker.');
      }
    });
  }

  const activeTemplate = templates.find((t) => t.name === selectedTemplateName) ?? templates[0];
  const varsForSend = templateVariables.slice(0, activeTemplate?.bodyParamCount ?? 2);

  function handleSend() {
    if (needsTemplate) {
      if (varsForSend.some((v) => !v.trim())) return;
      void onSend({ messageType: 'template', text: draft.trim() });
      resetInputField();
      return;
    }

    if (hasAttachments) {
      const caption = draft.trim();
      const items = [...attachments];
      for (const a of attachments) {
        uploadGenRef.current[a.id] = (uploadGenRef.current[a.id] ?? 0) + 1;
      }
      setAttachmentsState([]);
      onDraftChange('');
      resetInputField();
      onSendAttachments?.(items, caption);
      return;
    }

    if (!draft.trim()) return;
    void onSend({ messageType: 'text', text: draft.trim() });
    resetInputField();
  }

  const canSend = needsTemplate
    ? varsForSend.every((v) => v.trim())
    : hasAttachments
      ? true
      : !!draft.trim();

  return (
    <View style={[styles.outer, { paddingBottom: bottomPad }]}>
      <WhatsAppAttachSheet
        visible={attachSheetOpen}
        onClose={() => setAttachSheetOpen(false)}
        onSelect={scheduleAttachPicker}
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
        {(needsTemplate || forceTemplate) && templates.length > 0 ? (
          <WhatsAppTemplatePanel
            needsTemplate={needsTemplate}
            templates={templates}
            selectedTemplateName={selectedTemplateName}
            onTemplateChange={onTemplateChange}
            templateVariables={templateVariables}
            onTemplateVariablesChange={onTemplateVariablesChange}
            forceTemplate={forceTemplate}
            onForceTemplateChange={onForceTemplateChange}
          />
        ) : null}

        <View style={styles.bar}>
          {/* ── Left: attach button (WhatsApp order) ───────────────── */}
          {!needsTemplate ? (
            <TouchableOpacity
              style={styles.iconBtn}
              onPress={openAttachSheet}
              disabled={hasAttachments}
            >
              <Ionicons
                name="add"
                size={26}
                color={hasAttachments ? Colors.textMuted : '#54656F'}
              />
            </TouchableOpacity>
          ) : null}

          {/* ── Middle: text input ─────────────────────────────────── */}
          {!needsTemplate && !hasAttachments ? (
            <TextInput
              key={inputKey}
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

          {/* ── Right: emoji toggle + send / mic ───────────────────── */}
          {!needsTemplate ? (
            hasAttachments ? (
              <TouchableOpacity
                style={[styles.sendBtn, (!canSend || sending) && styles.sendDisabled]}
                onPress={handleSend}
                disabled={!canSend || sending}
              >
                <Ionicons name="send" size={20} color="#fff" />
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity
                  style={styles.iconBtn}
                  onPress={toggleEmoji}
                >
                  <Ionicons
                    name={emojiOpen ? 'keypad-outline' : 'happy-outline'}
                    size={24}
                    color="#54656F"
                  />
                </TouchableOpacity>
                {draft.trim() ? (
                  <TouchableOpacity
                    style={[styles.sendBtn, sending && styles.sendDisabled]}
                    onPress={handleSend}
                    disabled={sending}
                  >
                    <Ionicons name="send" size={20} color="#fff" />
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={styles.iconBtn} activeOpacity={0.6}>
                    <Ionicons name="mic-outline" size={24} color="#54656F" />
                  </TouchableOpacity>
                )}
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
    position: 'relative',
    zIndex: 10,
    elevation: 10,
    backgroundColor: '#F0F2F5',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  wrap: {
    paddingHorizontal: 4,
    paddingBottom: 0,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  iconBtn: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    borderRadius: 22,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 15,
    color: Colors.text,
    minHeight: 38,
    maxHeight: 120,
    backgroundColor: Colors.surface,
  },
  inputSpacer: { flex: 1, minHeight: 38 },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#25D366',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { opacity: 0.45 },
});
