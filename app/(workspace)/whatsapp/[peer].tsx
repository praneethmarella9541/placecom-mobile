import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  AppState,
  Platform,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import * as ExpoClipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { format, isSameDay, subDays } from 'date-fns';
import { whatsappApi } from '../../../lib/api';
import { isValidE164, normalizePhone } from '../../../lib/phone';
import { useWhatsAppContacts } from '../../../hooks/useWhatsAppContacts';
import { useAuth } from '../../../hooks/useAuth';
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
import { WhatsAppChatSearchBar } from '../../../components/whatsapp/WhatsAppChatSearchBar';
import { WhatsAppImageViewer } from '../../../components/whatsapp/WhatsAppImageViewer';
import {
  dedupeThreadMessages,
  messageMatchesChatSearch,
  shouldRenderInThread,
} from '../../../lib/whatsapp-message-display';
import { Colors } from '../../../constants/colors';

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

const POLL_MS = 1000;
const LIST_BOTTOM_GAP = 8;

export default function WhatsAppConversationScreen() {
  const { peer } = useLocalSearchParams<{ peer: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const flatListRef = useRef<FlatList>(null);
  const stickToBottomRef = useRef(true);
  const { contacts, saveName } = useWhatsAppContacts();
  const { session } = useAuth();
  const authToken = session?.access_token ?? null;

  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [needsTemplate, setNeedsTemplate] = useState(false);
  const [templateVar1, setTemplateVar1] = useState('');
  const [templateVar2, setTemplateVar2] = useState('');
  const [templatePreview, setTemplatePreview] = useState<string | undefined>();
  const [renameOpen, setRenameOpen] = useState(false);
  const [nameInput, setNameInput] = useState('');
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [chatSearchQuery, setChatSearchQuery] = useState('');
  const [searchMatchCursor, setSearchMatchCursor] = useState(0);
  const [viewerUri, setViewerUri] = useState<string | null>(null);
  const peerDecoded = normalizePhone(decodeURIComponent(peer ?? ''));
  const displayName = displayNameForPeer(peerDecoded, contacts);

  const [contextMenu, setContextMenu] = useState<{ message: WhatsAppMessage } | null>(null);

  const visibleMessages = useMemo(
    () => dedupeThreadMessages(messages.filter(shouldRenderInThread)),
    [messages]
  );

  const chatItems = useMemo(
    () => injectDateSeparators(visibleMessages),
    [visibleMessages]
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

  useEffect(() => {
    setSearchMatchCursor(0);
  }, [chatSearchQuery]);

  useEffect(() => {
    if (!searchMatches.length) return;
    const msg = searchMatches[searchMatchCursor]?.message;
    if (!msg) return;
    // Find the index in chatItems (which includes separator rows)
    const chatIdx = chatItems.findIndex((i) => i.kind === 'message' && i.data.id === msg.id);
    if (chatIdx < 0) return;
    const t = setTimeout(() => {
      flatListRef.current?.scrollToIndex({
        index: chatIdx,
        animated: true,
        viewPosition: 0.35,
      });
    }, 80);
    return () => clearTimeout(t);
  }, [searchMatchCursor, searchMatches, chatItems]);

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
            const grew = merged.length > prev.length;
            const lastChanged =
              merged.length > 0 &&
              prev.length > 0 &&
              merged[merged.length - 1]?.id !== prev[prev.length - 1]?.id;
            if (grew || lastChanged) {
              stickToBottomRef.current = true;
              setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 80);
            }
            return merged;
          });
        } else {
          stickToBottomRef.current = true;
          setMessages(mergeWhatsAppMessages([], incoming));
        }
        void markWhatsAppThreadRead(peerDecoded, new Date().toISOString());
      } catch {
        if (!opts?.silent) setMessages([]);
      } finally {
        if (!opts?.silent) setLoading(false);
      }
    },
    [peerDecoded]
  );

  const refreshSession = useCallback(async () => {
    try {
      const d = await whatsappApi.session(peerDecoded);
      setNeedsTemplate(d.requiresTemplate ?? !d.sessionOpen);
      setTemplatePreview(d.template?.previewExample);
    } catch {
      setNeedsTemplate(false);
    }
  }, [peerDecoded]);

  useEffect(() => {
    if (!isValidE164(peerDecoded)) {
      Alert.alert('Invalid number', 'Use +918489431508 or 10-digit mobile');
      router.back();
      return;
    }
    void loadMessages();
    void refreshSession();
  }, [loadMessages, refreshSession, peerDecoded, router]);

  useFocusEffect(
    useCallback(() => {
      void markWhatsAppThreadRead(peerDecoded, new Date().toISOString());
      void loadMessages({ silent: true });
      const timer = setInterval(() => {
        void loadMessages({ silent: true });
      }, POLL_MS);
      return () => clearInterval(timer);
    }, [loadMessages, peerDecoded])
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void loadMessages({ silent: true });
    });
    return () => sub.remove();
  }, [loadMessages]);

  // Keep the latest message visible when the keyboard opens.
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const sub = Keyboard.addListener(showEvent, () => {
      if (stickToBottomRef.current && !chatSearchQuery.trim()) {
        setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 60);
      }
    });
    return () => sub.remove();
  }, [chatSearchQuery]);

  function sendMessage(payload: WhatsAppSendPayload) {
    if (needsTemplate && (!templateVar1.trim() || !templateVar2.trim())) {
      Alert.alert('Template required', 'Enter recipient name and your name.');
      return;
    }

    const tempId = `optimistic-${Date.now()}`;
    const previewBody = previewOutboundBody(
      payload,
      needsTemplate,
      templateVar1,
      templateVar2,
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
    };

    setMessages((prev) => [...prev, optimistic]);
    setDraft('');
    stickToBottomRef.current = true;
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 50);

    void (async () => {
      try {
        const res = await whatsappApi.send(peerDecoded, {
          useTemplate: needsTemplate,
          messageType: needsTemplate ? 'template' : payload.messageType,
          text: needsTemplate ? undefined : payload.text ?? draft.trim(),
          templateVariables: needsTemplate
            ? [templateVar1.trim(), templateVar2.trim()]
            : undefined,
          mediaUrl: payload.mediaUrl,
          mediaCaption: payload.mediaCaption,
          mediaFilename: payload.mediaFilename,
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

  function openRename() {
    setHeaderMenuOpen(false);
    setNameInput(lookupContactName(peerDecoded, contacts) ?? '');
    setRenameOpen(true);
  }

  async function saveRename() {
    await saveName(peerDecoded, nameInput);
    setRenameOpen(false);
    Alert.alert('Saved', 'Contact name updated.');
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { paddingTop: insets.top }]}
      behavior="padding"
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerAvatar}>
          <Text style={styles.headerAvatarText}>{peerInitials(peerDecoded, displayName)}</Text>
        </View>
        <TouchableOpacity style={styles.headerInfo} onPress={openRename} activeOpacity={0.7}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={styles.headerSub} numberOfLines={1}>
            {displayName !== formatWhatsAppPhone(peerDecoded)
              ? formatWhatsAppPhone(peerDecoded)
              : 'Tap to save contact'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => {
            setHeaderMenuOpen(false);
            setChatSearchOpen((v) => !v);
            if (chatSearchOpen) setChatSearchQuery('');
          }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name={chatSearchOpen ? 'close' : 'search'} size={22} color="#fff" />
        </TouchableOpacity>
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
          <TouchableOpacity
            style={styles.headerMenuItem}
            onPress={() => {
              setHeaderMenuOpen(false);
              void loadMessages();
            }}
          >
            <Ionicons name="refresh" size={18} color={Colors.text} />
            <Text style={styles.headerMenuText}>Refresh messages</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#25D366" size="large" />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          style={styles.list}
          data={chatItems}
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
            return (
              <WhatsAppMessageBubble
                message={item.data}
                highlighted={item.data.id === highlightedMessageId}
                authToken={authToken}
                onImagePress={(uri) => setViewerUri(uri)}
                onLongPress={() => setContextMenu({ message: item.data })}
              />
            );
          }}
          contentContainerStyle={
            chatItems.length === 0
              ? { flexGrow: 1, padding: 12 }
              : {
                  paddingHorizontal: 12,
                  paddingTop: 12,
                  paddingBottom: LIST_BOTTOM_GAP,
                  flexGrow: 1,
                  justifyContent: 'flex-end',
                }
          }
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onScroll={(e) => {
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            const distFromBottom =
              contentSize.height - layoutMeasurement.height - contentOffset.y;
            stickToBottomRef.current = distFromBottom < 72;
          }}
          scrollEventThrottle={64}
          onContentSizeChange={() => {
            if (stickToBottomRef.current && !chatSearchOpen && !chatSearchQuery.trim()) {
              flatListRef.current?.scrollToEnd({ animated: false });
            }
          }}
          onScrollToIndexFailed={(info) => {
            setTimeout(() => {
              flatListRef.current?.scrollToIndex({
                index: info.index,
                animated: true,
                viewPosition: 0.35,
              });
            }, 100);
          }}
          onScrollBeginDrag={() => {
            setHeaderMenuOpen(false);
            Keyboard.dismiss();
          }}
        />
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
              onPress={() => {
                if (contextMenu?.message.body) {
                  setDraft((d) => (d ? `${d}\n` : '') + `> ${contextMenu.message.body}\n`);
                }
                setContextMenu(null);
              }}
            >
              <Ionicons name="return-down-forward-outline" size={20} color={Colors.text} />
              <Text style={styles.ctxLabel}>Quote & reply</Text>
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

      <WhatsAppComposerBar
        needsTemplate={needsTemplate}
        templateVar1={templateVar1}
        templateVar2={templateVar2}
        onTemplateVar1Change={setTemplateVar1}
        onTemplateVar2Change={setTemplateVar2}
        templatePreview={templatePreview}
        draft={draft}
        onDraftChange={setDraft}
        sending={false}
        onSend={sendMessage}
        bottomInset={insets.bottom}
        onEmojiOpenChange={setEmojiOpen}
      />

      <WhatsAppImageViewer
        uri={viewerUri}
        authToken={authToken}
        onClose={() => setViewerUri(null)}
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
  list: { flex: 1 },
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
  headerSub: { fontSize: 12, color: 'rgba(255,255,255,0.85)' },
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
});
