import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TextInput,
  Modal,
  Keyboard,
  KeyboardAvoidingView,
  AppState,
  Platform,
  DeviceEventEmitter,
} from 'react-native';
import * as ExpoClipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format, isSameDay, subDays } from 'date-fns';
import { whatsappApi } from '../../../lib/api';
import { isValidE164, normalizePhone } from '../../../lib/phone';
import { useWhatsAppContacts } from '../../../hooks/useWhatsAppContacts';
import { useAuth } from '../../../hooks/useAuth';
import { useKeyboardHeight } from '../../../hooks/useKeyboardHeight';
import type { WhatsAppMessage, WhatsAppSendPayload } from '../../../lib/whatsapp-types';
import {
  displayNameForPeer,
  formatWhatsAppPhone,
  lookupContactName,
  peerInitials,
} from '../../../lib/whatsapp-utils';
import {
  mergeWhatsAppMessages,
  hasNewWhatsAppMessages,
  previewOutboundBody,
} from '../../../lib/whatsapp-messages';
import { markWhatsAppThreadRead } from '../../../lib/whatsapp-unread';
import { normalizeWhatsAppMessages } from '../../../lib/whatsapp-message-normalize';
import { WhatsAppMessageBubble } from '../../../components/whatsapp/WhatsAppMessageBubble';
import { WhatsAppComposerBar } from '../../../components/whatsapp/WhatsAppComposerBar';
import type { PendingAttachment } from '../../../components/whatsapp/WhatsAppMediaAttachmentPreview';
import { WhatsAppChatSearchBar } from '../../../components/whatsapp/WhatsAppChatSearchBar';
import { WhatsAppMediaViewer } from '../../../components/whatsapp/WhatsAppMediaViewer';
import { WhatsAppImageViewer } from '../../../components/whatsapp/WhatsAppImageViewer';
import { openWhatsAppMessageInNativeApp, whatsAppMediaOpenTarget } from '../../../lib/whatsapp-open-media';
import { WhatsAppReplyBar } from '../../../components/whatsapp/WhatsAppReplyBar';
import { ForwardChatModal } from '../../../components/whatsapp/ForwardChatModal';
import {
  categorizeWhatsAppMedia,
  mediaFilenameFromMessage,
} from '../../../lib/whatsapp-media-helpers';
import { resolveWhatsAppMediaUrl } from '../../../lib/whatsapp-media';
import {
  dedupeThreadMessages,
  messageMatchesChatSearch,
  shouldRenderInThread,
} from '../../../lib/whatsapp-message-display';
import { Colors } from '../../../constants/colors';
import {
  getMemoryThreadMessages,
  readThreadCache,
  writeThreadCache,
} from '../../../lib/whatsapp-thread-cache';
import { normalizeOutboundImageAsset } from '../../../lib/whatsapp-outbound-media';

// ─── Date separator helpers ───────────────────────────────────────────────────

type ChatItem =
  | { kind: 'message'; data: WhatsAppMessage }
  | { kind: 'separator'; id: string; label: string };

function getDateLabel(date: Date): string {
  const today = new Date();
  if (isSameDay(date, today)) return 'Today';
  if (isSameDay(date, subDays(today, 1))) return 'Yesterday';
  return format(date, 'MMMM d, yyyy');
}

function injectDateSeparators(messages: WhatsAppMessage[]): ChatItem[] {
  const items: ChatItem[] = [];
  let lastDateStr = '';
  for (const m of messages) {
    if (m.created_at) {
      const d = new Date(m.created_at);
      const dateStr = format(d, 'yyyy-MM-dd');
      if (dateStr !== lastDateStr) {
        items.push({ kind: 'separator', id: `sep-${dateStr}`, label: getDateLabel(d) });
        lastDateStr = dateStr;
      }
    }
    items.push({ kind: 'message', data: m });
  }
  return items;
}

const CHAT_SEARCH_BAR_HEIGHT = 48;

const LIST_BOTTOM_GAP = 8;
const EST_MSG_HEIGHT = 76;
const EST_SEP_HEIGHT = 34;

function estimatedOffsetForIndex(items: ChatItem[], index: number): number {
  let y = 0;
  for (let i = 0; i < index; i++) {
    y += items[i].kind === 'separator' ? EST_SEP_HEIGHT : EST_MSG_HEIGHT;
  }
  return y;
}

export default function WhatsAppConversationScreen() {
  const { peer } = useLocalSearchParams<{ peer: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const flatListRef = useRef<FlatList>(null);
  const stickToBottomRef = useRef(true);
  const pendingScrollIndexRef = useRef<number | null>(null);
  const chatItemsRef = useRef<ChatItem[]>([]);
  const { contacts, saveName } = useWhatsAppContacts();
  const { session, user } = useAuth();
  const userId = user?.id ?? '';
  const authToken = session?.access_token ?? null;

  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sessionOpen, setSessionOpen] = useState<boolean | null>(null);
  const [needsTemplate, setNeedsTemplate] = useState(false);
  const [forceTemplate, setForceTemplate] = useState(false);
  const [templates, setTemplates] = useState<{ name: string; languageCode: string; bodyParamCount: number; label: string; preview: string }[]>([]);
  const [selectedTemplateName, setSelectedTemplateName] = useState('');
  const [templateVariables, setTemplateVariables] = useState(['', '']);
  const [renameOpen, setRenameOpen] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [searchMatchCursor, setSearchMatchCursor] = useState(0);
  const [viewerMessage, setViewerMessage] = useState<WhatsAppMessage | null>(null);
  const [imageViewerIndex, setImageViewerIndex] = useState<number>(-1);
  const [openingMedia, setOpeningMedia] = useState(false);

  // All image messages in chronological order — used for swipe navigation.
  const imageMessages = useMemo(
    () => messages.filter((m) => whatsAppMediaOpenTarget(m) === 'fullscreen-image'),
    [messages]
  );

  async function handleMediaPress(message: WhatsAppMessage) {
    const target = whatsAppMediaOpenTarget(message);
    if (target === 'fullscreen-image') {
      const idx = imageMessages.findIndex((m) => m.id === message.id);
      setImageViewerIndex(idx >= 0 ? idx : 0);
      return;
    }
    if (target === 'inline-video') {
      setViewerMessage(message);
      return;
    }
    try {
      setOpeningMedia(true);
      await openWhatsAppMessageInNativeApp(message, authToken);
    } catch (e: unknown) {
      Alert.alert('Cannot open file', e instanceof Error ? e.message : 'Could not open attachment');
    } finally {
      setOpeningMedia(false);
    }
  }

  const peerDecoded = normalizePhone(decodeURIComponent(peer ?? ''));
  const displayName = displayNameForPeer(peerDecoded, contacts);

  const [contextMenu, setContextMenu] = useState<{ message: WhatsAppMessage } | null>(null);
  const [replyingTo, setReplyingTo] = useState<WhatsAppMessage | null>(null);
  const [forwardingMessage, setForwardingMessage] = useState<WhatsAppMessage | null>(null);
  const [forwardModalOpen, setForwardModalOpen] = useState(false);
  const [flashMessageId, setFlashMessageId] = useState<string | null>(null);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [listAnchored, setListAnchored] = useState(false);

  const visibleMessages = useMemo(
    () => dedupeThreadMessages(messages.filter(shouldRenderInThread)),
    [messages]
  );

  const chatItems = useMemo(
    () => injectDateSeparators(visibleMessages),
    [visibleMessages]
  );

  /** Newest-first for inverted FlatList — opens at latest message without scroll jump. */
  const listItems = useMemo(() => [...chatItems].reverse(), [chatItems]);

  chatItemsRef.current = listItems;

  const scrollToLatest = useCallback((animated = false) => {
    flatListRef.current?.scrollToOffset({ offset: 0, animated });
  }, []);

  const listIndexForMessageId = useCallback(
    (messageId: string) =>
      listItems.findIndex((i) => i.kind === 'message' && i.data.id === messageId),
    [listItems]
  );

  const searchMatches = useMemo(() => {
    const q = chatSearchQuery.trim();
    if (!q) return [];
    return visibleMessages
      .map((m, index) => ({ message: m, index }))
      .filter(({ message }) => messageMatchesChatSearch(message, q));
  }, [visibleMessages, chatSearchQuery]);

  const highlightedMessageId =
    searchMatches.length > 0 ? searchMatches[searchMatchCursor]?.message.id ?? null : null;

  const messagesById = useMemo(() => {
    const map = new Map<string, WhatsAppMessage>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  const scrollToBottom = useCallback(
    (animated = true) => {
      stickToBottomRef.current = true;
      setShowScrollDown(false);
      scrollToLatest(animated);
    },
    [scrollToLatest]
  );

  const scrollToMessage = useCallback(
    (messageId: string) => {
      const listIdx = listIndexForMessageId(messageId);
      if (listIdx < 0) {
        Alert.alert('Message not found', 'The original message is not in this chat.');
        return;
      }
      stickToBottomRef.current = false;
      setShowScrollDown(true);
      setFlashMessageId(messageId);
      setTimeout(() => setFlashMessageId(null), 1800);
      pendingScrollIndexRef.current = listIdx;

      const offset = estimatedOffsetForIndex(listItems, listIdx);
      flatListRef.current?.scrollToOffset({ offset, animated: false });
      requestAnimationFrame(() => {
        flatListRef.current?.scrollToIndex({
          index: listIdx,
          animated: true,
          viewPosition: 0.45,
        });
      });
    },
    [listIndexForMessageId, listItems]
  );

  useEffect(() => {
    setSearchMatchCursor(0);
  }, [chatSearchQuery]);

  useEffect(() => {
    if (!searchMatches.length) return;
    const msg = searchMatches[searchMatchCursor]?.message;
    if (!msg) return;
    // Find the index in chatItems (which includes separator rows)
    const listIdx = listIndexForMessageId(msg.id);
    if (listIdx < 0) return;
    const t = setTimeout(() => {
      flatListRef.current?.scrollToIndex({
        index: listIdx,
        animated: true,
        viewPosition: 0.35,
      });
    }, 80);
    return () => clearTimeout(t);
  }, [searchMatchCursor, searchMatches, listIndexForMessageId]);

  const loadMessages = useCallback(
    async (opts?: { silent?: boolean }) => {
      try {
        const data = await whatsappApi.getMessages(peerDecoded);
        const incoming = normalizeWhatsAppMessages(
          (data.messages ?? []) as WhatsAppMessage[]
        );
        if (opts?.silent) {
          setMessages((prev) => {
            if (!hasNewWhatsAppMessages(prev, incoming)) return prev;
            const merged = mergeWhatsAppMessages(prev, incoming);
            if (userId) writeThreadCache(userId, peerDecoded, merged);
            const grew = merged.length > prev.length;
            const lastChanged =
              merged.length > 0 &&
              prev.length > 0 &&
              merged[merged.length - 1]?.id !== prev[prev.length - 1]?.id;
            if (grew || lastChanged) {
              stickToBottomRef.current = true;
              setTimeout(() => scrollToLatest(true), 80);
            }
            return merged;
          });
        } else {
          stickToBottomRef.current = true;
          const merged = mergeWhatsAppMessages([], incoming);
          setMessages(merged);
          if (userId) writeThreadCache(userId, peerDecoded, merged);
        }
        void markWhatsAppThreadRead(peerDecoded, new Date().toISOString());
      } catch {
        if (!opts?.silent && !getMemoryThreadMessages(peerDecoded)?.length) {
          setMessages([]);
        }
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [peerDecoded, scrollToLatest, userId]
  );

  const refreshSession = useCallback(async () => {
    try {
      const d = await whatsappApi.session(peerDecoded);
      const open = d.sessionOpen ?? true;
      setSessionOpen(open);
      const required = d.requiresTemplate ?? !open;
      setNeedsTemplate(required);

      const tplList = d.templates?.length
        ? d.templates
        : d.template
        ? [{
            name: d.template.name,
            languageCode: '',
            bodyParamCount: d.template.bodyParamCount ?? 2,
            label: d.template.label ?? d.template.name,
            preview: d.template.previewExample ?? '',
          }]
        : [];
      setTemplates(tplList);
      if (tplList.length > 0 && !selectedTemplateName) {
        setSelectedTemplateName(tplList[0].name);
        setTemplateVariables(Array(tplList[0].bodyParamCount ?? 2).fill(''));
      }
    } catch {
      setSessionOpen(null);
      setNeedsTemplate(false);
    }
  }, [peerDecoded, selectedTemplateName]);

  useEffect(() => {
    if (!isValidE164(peerDecoded)) {
      Alert.alert('Invalid number', 'Use +918489431508 or 10-digit mobile');
      router.back();
      return;
    }

    const memCached = getMemoryThreadMessages(peerDecoded);
    stickToBottomRef.current = true;
    setShowScrollDown(false);

    if (memCached?.length) {
      setMessages(memCached);
      setLoading(false);
      void loadMessages({ silent: true });
    } else {
      setLoading(true);
      setMessages([]);
      if (userId) {
        void readThreadCache(userId, peerDecoded).then((disk) => {
          if (disk?.length) {
            setMessages(disk);
            setLoading(false);
            void loadMessages({ silent: true });
          } else {
            void loadMessages({ silent: false });
          }
        });
      } else {
        void loadMessages({ silent: false });
      }
    }

    void refreshSession();
  }, [loadMessages, refreshSession, peerDecoded, router, userId]);

  useEffect(() => {
    setListAnchored(false);
  }, [peerDecoded]);

  useLayoutEffect(() => {
    if (chatSearchOpen) {
      setListAnchored(true);
      return;
    }
    if (loading && messages.length === 0) return;
    if (!listItems.length) {
      setListAnchored(true);
      return;
    }
    stickToBottomRef.current = true;
    setShowScrollDown(false);
    // Inverted list starts at offset 0 (newest) — show immediately, no scroll jump.
    setListAnchored(true);
    scrollToLatest(false);
  }, [
    peerDecoded,
    loading,
    messages.length,
    listItems.length,
    chatSearchOpen,
    scrollToLatest,
  ]);

  // Stable ref so the Supabase callback always calls the latest loadMessages
  // without triggering channel teardown/recreate.
  const loadMessagesRef = useRef(loadMessages);
  useEffect(() => { loadMessagesRef.current = loadMessages; }, [loadMessages]);

  useFocusEffect(
    useCallback(() => {
      void markWhatsAppThreadRead(peerDecoded, new Date().toISOString());
      void loadMessages({ silent: true });
    }, [loadMessages, peerDecoded])
  );

  // Foreground push: load new messages immediately when a notification arrives
  // for this specific peer.
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('wa:newMessage', (payload: { peer?: unknown }) => {
      if (!payload?.peer || payload.peer === peerDecoded) {
        void loadMessagesRef.current({ silent: true });
      }
    });
    return () => sub.remove();
  }, [peerDecoded]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void loadMessagesRef.current({ silent: true });
    });
    return () => sub.remove();
  }, []);

  // Keep the latest message visible when the keyboard opens.
  useEffect(() => {
    if (keyboardHeight > 0 && stickToBottomRef.current && !chatSearchQuery.trim()) {
      const t = setTimeout(() => scrollToLatest(true), 80);
      return () => clearTimeout(t);
    }
  }, [keyboardHeight, chatSearchQuery, scrollToLatest]);

  const activeTemplate = templates.find((t) => t.name === selectedTemplateName) ?? templates[0];

  function sendMessage(payload: WhatsAppSendPayload) {
    const varsForSend = templateVariables.slice(0, activeTemplate?.bodyParamCount ?? 2);
    if (needsTemplate && varsForSend.some((v) => !v.trim())) {
      Alert.alert('Template required', 'Please fill in all template fields.');
      return;
    }

    const tempId = `optimistic-${Date.now()}`;
    const previewBody = previewOutboundBody(
      payload,
      needsTemplate,
      templateVariables[0] ?? '',
      templateVariables[1] ?? '',
      draft
    );
    const contentType = needsTemplate
      ? 'template'
      : payload.messageType === 'image'
        ? 'image'
        : payload.messageType;
    const optimistic: WhatsAppMessage = {
      id: tempId,
      direction: 'outbound',
      peer_e164: peerDecoded,
      body: previewBody,
      created_at: new Date().toISOString(),
      delivery_status: 'sent',
      message_sid: null,
      num_media: payload.mediaUrl ? 1 : 0,
      media_url: payload.mediaUrl ?? null,
      content_type: contentType,
      reply_to_id: payload.replyToId ?? null,
    };

    setMessages((prev) => [...prev, optimistic]);
    setDraft('');
    setReplyingTo(null);
    stickToBottomRef.current = true;
    setTimeout(() => scrollToLatest(true), 50);

    void (async () => {
      try {
        const res = await whatsappApi.send(peerDecoded, {
          useTemplate: needsTemplate,
          messageType: needsTemplate ? 'template' : payload.messageType,
          text: needsTemplate ? undefined : payload.text ?? draft.trim(),
          templateVariables: needsTemplate
            ? varsForSend.map((v) => v.trim())
            : undefined,
          mediaUrl: payload.mediaUrl,
          mediaCaption: payload.mediaCaption,
          mediaFilename: payload.mediaFilename,
          replyToId: payload.replyToId,
        });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempId
              ? {
                  ...m,
                  delivery_status: 'sent',
                  message_sid: res.messageSid ?? m.message_sid ?? null,
                }
              : m
          )
        );
        void loadMessages({ silent: true });
        void refreshSession();
      } catch (e: unknown) {
        const err = e instanceof Error ? e.message : 'Send failed';
        setMessages((prev) =>
          prev.map((m) =>
            m.id === tempId ? { ...m, delivery_status: `failed: ${err}` } : m
          )
        );
        Alert.alert('Send failed', err);
      }
    })();
  }

  function openContactInfo() {
    setHeaderMenuOpen(false);
    router.push(`/(workspace)/whatsapp/contact/${encodeURIComponent(peerDecoded)}`);
  }

  function openRename() {
    setHeaderMenuOpen(false);
    setNameInput(lookupContactName(peerDecoded, contacts) ?? '');
    setRenameOpen(true);
  }

  function startReply(message: WhatsAppMessage) {
    setContextMenu(null);
    setReplyingTo(message);
  }

  function startForward(message: WhatsAppMessage) {
    setContextMenu(null);
    setForwardingMessage(message);
    setForwardModalOpen(true);
  }

  function sendAttachments(items: PendingAttachment[], caption: string) {
    if (!items.length) return;
    const replyId = replyingTo?.id;
    const replyToId = replyId && !replyId.startsWith('optimistic-') ? replyId : undefined;

    items.forEach((att, index) => {
      const isLast = index === items.length - 1;
      const tempId = `optimistic-${Date.now()}-${index}`;
      const messageType = att.kind ?? (att.isImage ? 'image' : 'document');
      const optimistic: WhatsAppMessage = {
        id: tempId,
        direction: 'outbound',
        peer_e164: peerDecoded,
        body:
          isLast && caption
            ? caption
            : messageType === 'image'
              ? '[Image]'
              : messageType === 'video'
                ? '[Video]'
                : messageType === 'audio'
                  ? '[Audio]'
                  : `[Document: ${att.name ?? att.filename}]`,
        created_at: new Date().toISOString(),
        delivery_status: 'pending',
        message_sid: null,
        num_media: 1,
        media_url: att.remoteUrl ?? att.localUri,
        content_type: messageType,
        reply_to_id: isLast ? replyToId ?? null : null,
      };

      setMessages((prev) => [...prev, optimistic]);
      stickToBottomRef.current = true;

      void (async () => {
        try {
          let remoteUrl = att.remoteUrl;
          let kind = messageType;
          if (!remoteUrl) {
            let uploadUri = att.localUri;
            let uploadName = att.name;
            let uploadMime = att.mimeType;
            if (messageType === 'image' || att.isImage) {
              const norm = await normalizeOutboundImageAsset(
                { localUri: att.localUri, name: att.name, mimeType: att.mimeType },
                { force: att.fromCamera }
              );
              uploadUri = norm.localUri;
              uploadName = norm.name;
              uploadMime = norm.mimeType;
            }
            const data = await whatsappApi.uploadMedia(uploadUri, uploadName, uploadMime);
            remoteUrl = data.url;
            kind = data.kind ?? messageType;
            setMessages((prev) =>
              prev.map((m) =>
                m.id === tempId ? { ...m, media_url: remoteUrl!, content_type: kind } : m
              )
            );
          }
          const res = await whatsappApi.send(peerDecoded, {
            messageType: kind,
            mediaUrl: remoteUrl,
            mediaCaption: isLast ? caption || undefined : undefined,
            mediaFilename: att.name ?? att.filename,
            replyToId: isLast ? replyToId : undefined,
          });
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempId
                ? {
                    ...m,
                    delivery_status: 'sent',
                    message_sid: res.messageSid ?? m.message_sid ?? null,
                    media_url: remoteUrl!,
                  }
                : m
            )
          );
          void loadMessages({ silent: true });
          void refreshSession();
        } catch (e: unknown) {
          const err = e instanceof Error ? e.message : 'Send failed';
          setMessages((prev) =>
            prev.map((m) =>
              m.id === tempId ? { ...m, delivery_status: `failed: ${err}` } : m
            )
          );
        }
      })();
    });

    setReplyingTo(null);
    setTimeout(() => scrollToLatest(true), 50);
  }

  async function forwardToPeer(targetPeer: string) {
    const msg = forwardingMessage;
    if (!msg) return;
    setForwardModalOpen(false);
    setForwardingMessage(null);

    try {
      if (msg.media_url) {
        const cat = categorizeWhatsAppMedia(msg);
        const messageType = cat ?? 'document';
        const mediaUrl = resolveWhatsAppMediaUrl(msg.media_url) ?? msg.media_url;
        if (!mediaUrl?.startsWith('http')) {
          Alert.alert('Forward failed', 'Media URL is not available for forwarding.');
          return;
        }
        await whatsappApi.send(targetPeer, {
          messageType,
          mediaUrl,
          mediaCaption: msg.body?.trim() && !msg.body.startsWith('[') ? msg.body : undefined,
          mediaFilename: mediaFilenameFromMessage(msg),
        });
      } else if (msg.body?.trim()) {
        await whatsappApi.send(targetPeer, {
          messageType: 'text',
          text: msg.body.trim(),
        });
      }
      Alert.alert('Forwarded', 'Message sent.');
    } catch (e: unknown) {
      Alert.alert('Forward failed', e instanceof Error ? e.message : 'Could not forward message');
    }
  }

  function sendWithReply(payload: WhatsAppSendPayload) {
    const replyId = replyingTo?.id;
    return sendMessage({
      ...payload,
      replyToId: replyId && !replyId.startsWith('optimistic-') ? replyId : undefined,
    });
  }

  async function saveRename() {
    await saveName(peerDecoded, nameInput);
    setRenameOpen(false);
    Alert.alert('Saved', 'Contact name updated.');
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={0}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerAvatar}>
          <Text style={styles.headerAvatarText}>{peerInitials(peerDecoded, displayName)}</Text>
        </View>
        <TouchableOpacity style={styles.headerInfo} onPress={openContactInfo} activeOpacity={0.7}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {displayName}
          </Text>
          <View style={styles.headerSubRow}>
            <Text style={styles.headerSub} numberOfLines={1}>
              {displayName !== formatWhatsAppPhone(peerDecoded)
                ? formatWhatsAppPhone(peerDecoded)
                : 'Tap for media & info'}
            </Text>
            {sessionOpen !== null ? (
              <View style={[styles.sessionPill, sessionOpen ? styles.sessionPillOpen : styles.sessionPillClosed]}>
                <View style={[styles.sessionDot, sessionOpen ? styles.sessionDotOpen : styles.sessionDotClosed]} />
                <Text style={[styles.sessionPillText, sessionOpen ? styles.sessionPillTextOpen : styles.sessionPillTextClosed]}>
                  {sessionOpen ? 'Session open' : 'Template required'}
                </Text>
              </View>
            ) : null}
          </View>
        </TouchableOpacity>
        {!chatSearchOpen ? (
          <TouchableOpacity
            onPress={() => {
              setHeaderMenuOpen(false);
              setChatSearchOpen(true);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="search" size={22} color="#fff" />
          </TouchableOpacity>
        ) : null}
        <TouchableOpacity
          onPress={() => setHeaderMenuOpen((v) => !v)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="ellipsis-vertical" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      {chatSearchOpen ? (
        <WhatsAppChatSearchBar
          query={chatSearchQuery}
          onChangeQuery={setChatSearchQuery}
          matchCount={searchMatches.length}
          matchIndex={searchMatchCursor}
          onPrev={() =>
            setSearchMatchCursor((c) =>
              searchMatches.length ? (c - 1 + searchMatches.length) % searchMatches.length : 0
            )
          }
          onNext={() =>
            setSearchMatchCursor((c) =>
              searchMatches.length ? (c + 1) % searchMatches.length : 0
            )
          }
          onClose={() => {
            setChatSearchOpen(false);
            setChatSearchQuery('');
          }}
        />
      ) : null}

      {headerMenuOpen ? (
        <View style={styles.headerMenu}>
          <TouchableOpacity style={styles.headerMenuItem} onPress={openRename}>
            <Ionicons name="person-outline" size={18} color={Colors.text} />
            <Text style={styles.headerMenuText}>Save / edit contact name</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {loading && messages.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color="#25D366" size="large" />
        </View>
      ) : (
        <View style={styles.listWrap}>
        <FlatList
          ref={flatListRef}
          style={[styles.list, { opacity: listAnchored ? 1 : 0 }]}
          inverted={listItems.length > 0}
          data={listItems}
          initialNumToRender={20}
          maxToRenderPerBatch={12}
          windowSize={15}
          keyExtractor={(item) => item.kind === 'separator' ? item.id : item.data.id}
          ListEmptyComponent={
            <View style={styles.emptyThread}>
              <Ionicons name="lock-closed" size={14} color="#54656F" />
              <Text style={styles.emptyThreadText}>
                No messages yet. Say hi to start the conversation.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            if (item.kind === 'separator') {
              return (
                <View style={styles.dateSep}>
                  <Text style={styles.dateSepText}>{item.label}</Text>
                </View>
              );
            }
            const quoted = item.data.reply_to_id
              ? messagesById.get(item.data.reply_to_id) ?? null
              : null;
            return (
              <WhatsAppMessageBubble
                message={item.data}
                highlighted={
                  item.data.id === highlightedMessageId || item.data.id === flashMessageId
                }
                authToken={authToken}
                peerName={displayName}
                quotedMessage={quoted}
                onQuotedPress={quoted ? () => scrollToMessage(quoted.id) : undefined}
                onSwipeReply={() => startReply(item.data)}
                onMediaPress={(msg) => void handleMediaPress(msg)}
                onLongPress={() => setContextMenu({ message: item.data })}
              />
            );
          }}
          contentContainerStyle={
            listItems.length === 0
              ? { flexGrow: 1, padding: 12 }
              : {
                  paddingLeft: 8,
                  paddingRight: 8,
                  paddingTop: LIST_BOTTOM_GAP,
                  paddingBottom: 12,
                }
          }
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onScroll={(e) => {
            const { contentOffset } = e.nativeEvent;
            const nearBottom = contentOffset.y < 72;
            stickToBottomRef.current = nearBottom;
            setShowScrollDown(!nearBottom && listItems.length > 0);
          }}
          scrollEventThrottle={32}
          onContentSizeChange={() => {
            if (stickToBottomRef.current && !chatSearchOpen && !chatSearchQuery.trim()) {
              scrollToLatest(false);
            }
          }}
          onScrollToIndexFailed={(info) => {
            const idx = pendingScrollIndexRef.current ?? info.index;
            const items = chatItemsRef.current;
            const offset = Math.max(
              0,
              items.length ? estimatedOffsetForIndex(items, idx) : info.averageItemLength * idx
            );
            flatListRef.current?.scrollToOffset({ offset, animated: false });
            setTimeout(() => {
              flatListRef.current?.scrollToIndex({
                index: idx,
                animated: true,
                viewPosition: 0.45,
              });
              pendingScrollIndexRef.current = null;
            }, 120);
          }}
          onScrollBeginDrag={() => {
            setHeaderMenuOpen(false);
            Keyboard.dismiss();
          }}
        />
        {showScrollDown && !chatSearchOpen ? (
          <TouchableOpacity
            style={styles.scrollDownFab}
            onPress={() => scrollToBottom(true)}
            activeOpacity={0.85}
            accessibilityLabel="Scroll to latest messages"
          >
            <Ionicons name="chevron-down" size={22} color="#54656F" />
          </TouchableOpacity>
        ) : null}
        </View>
      )}

      {/* Long-press context menu */}
      <Modal
        visible={!!contextMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setContextMenu(null)}
      >
        <TouchableOpacity
          style={styles.ctxBackdrop}
          activeOpacity={1}
          onPress={() => setContextMenu(null)}
        >
          <View style={styles.ctxSheet}>
            {contextMenu?.message.body ? (
              <TouchableOpacity
                style={styles.ctxItem}
                onPress={() => {
                  void ExpoClipboard.setStringAsync(contextMenu.message.body ?? '');
                  setContextMenu(null);
                }}
              >
                <Ionicons name="copy-outline" size={20} color={Colors.text} />
                <Text style={styles.ctxLabel}>Copy text</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={styles.ctxItem}
              onPress={() => contextMenu && startReply(contextMenu.message)}
            >
              <Ionicons name="arrow-undo-outline" size={20} color={Colors.text} />
              <Text style={styles.ctxLabel}>Reply</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.ctxItem}
              onPress={() => contextMenu && startForward(contextMenu.message)}
            >
              <Ionicons name="arrow-redo-outline" size={20} color={Colors.text} />
              <Text style={styles.ctxLabel}>Forward</Text>
            </TouchableOpacity>
            {contextMenu?.message.direction === 'outbound' ? (
              <TouchableOpacity
                style={styles.ctxItem}
                onPress={() => {
                  setContextMenu(null);
                  Alert.alert(
                    'Message info',
                    `Status: ${contextMenu.message.delivery_status ?? 'sent'}\nSent: ${
                      contextMenu.message.created_at
                        ? format(new Date(contextMenu.message.created_at), 'MMM d, h:mm a')
                        : '—'
                    }`
                  );
                }}
              >
                <Ionicons name="information-circle-outline" size={20} color={Colors.text} />
                <Text style={styles.ctxLabel}>Message info</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </TouchableOpacity>
      </Modal>

      {replyingTo ? (
        <WhatsAppReplyBar
          message={replyingTo}
          peerName={displayName}
          onCancel={() => setReplyingTo(null)}
        />
      ) : null}

      <WhatsAppComposerBar
        needsTemplate={needsTemplate}
        forceTemplate={forceTemplate}
        onForceTemplateChange={setForceTemplate}
        templates={templates}
        selectedTemplateName={selectedTemplateName}
        onTemplateChange={(name) => {
          setSelectedTemplateName(name);
          const tpl = templates.find((t) => t.name === name);
          setTemplateVariables(Array(tpl?.bodyParamCount ?? 2).fill(''));
        }}
        templateVariables={templateVariables}
        onTemplateVariablesChange={setTemplateVariables}
        draft={draft}
        onDraftChange={setDraft}
        sending={false}
        onSend={sendWithReply}
        onSendAttachments={sendAttachments}
        bottomInset={keyboardHeight > 0 ? 0 : insets.bottom}
        onEmojiOpenChange={setEmojiOpen}
      />

      <WhatsAppImageViewer
        messages={imageMessages}
        initialIndex={imageViewerIndex}
        authToken={authToken}
        onClose={() => setImageViewerIndex(-1)}
      />

      <WhatsAppMediaViewer
        message={viewerMessage}
        authToken={authToken}
        onClose={() => setViewerMessage(null)}
      />

      {openingMedia ? (
        <View style={styles.openingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color="#25D366" />
        </View>
      ) : null}

      <ForwardChatModal
        visible={forwardModalOpen}
        contacts={contacts}
        onClose={() => {
          setForwardModalOpen(false);
          setForwardingMessage(null);
        }}
        onForward={(target) => void forwardToPeer(target)}
      />

      <Modal visible={renameOpen} transparent animationType="fade" onRequestClose={() => setRenameOpen(false)}>
        <View style={styles.renameBackdrop}>
          <View style={styles.renameSheet}>
            <Text style={styles.renameTitle}>Save contact</Text>
            <Text style={styles.renameHint}>{formatWhatsAppPhone(peerDecoded)}</Text>
            <TextInput
              style={styles.renameInput}
              value={nameInput}
              onChangeText={setNameInput}
              placeholder="Contact name"
              placeholderTextColor={Colors.textMuted}
              autoFocus
            />
            <View style={styles.renameActions}>
              <TouchableOpacity style={styles.renameCancel} onPress={() => setRenameOpen(false)}>
                <Text style={styles.renameCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.renameSave} onPress={() => void saveRename()}>
                <Text style={styles.renameSaveText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ECE5DD' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listWrap: { flex: 1 },
  list: { flex: 1 },
  scrollDownFab: {
    position: 'absolute',
    bottom: 12,
    right: 16,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 4,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: '#075E54',
  },
  headerAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  headerInfo: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 16, fontWeight: '700', color: '#fff' },
  headerSubRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  headerSub: { fontSize: 12, color: 'rgba(255,255,255,0.85)' },
  sessionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 100,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  sessionPillOpen: { backgroundColor: 'rgba(37,211,102,0.22)' },
  sessionPillClosed: { backgroundColor: 'rgba(255,190,0,0.22)' },
  sessionDot: { width: 6, height: 6, borderRadius: 3 },
  sessionDotOpen: { backgroundColor: '#25D366' },
  sessionDotClosed: { backgroundColor: '#FFBE00' },
  sessionPillText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.2 },
  sessionPillTextOpen: { color: '#25D366' },
  sessionPillTextClosed: { color: '#FFBE00' },
  headerMenu: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingVertical: 4,
  },
  headerMenuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerMenuText: { fontSize: 15, color: Colors.text },
  renameBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    padding: 24,
  },
  renameSheet: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 20,
    gap: 12,
  },
  renameTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },
  renameHint: { fontSize: 14, color: Colors.textSecondary },
  renameInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: Colors.text,
  },
  renameActions: { flexDirection: 'row', gap: 10 },
  renameCancel: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
  },
  renameCancelText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  renameSave: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#25D366',
    alignItems: 'center',
  },
  renameSaveText: { fontSize: 15, fontWeight: '600', color: '#fff' },

  // Empty thread placeholder
  emptyThread: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
    paddingHorizontal: 32,
  },
  emptyThreadText: {
    fontSize: 13,
    color: '#54656F',
    textAlign: 'center',
  },

  // Date separator
  dateSep: {
    alignItems: 'center',
    marginVertical: 8,
  },
  dateSepText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#54656F',
    backgroundColor: 'rgba(255,255,255,0.85)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    overflow: 'hidden',
  },

  // Long-press context menu
  ctxBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  ctxSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 32,
  },
  ctxItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
  },
  ctxLabel: { fontSize: 16, color: Colors.text },
  openingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
});
