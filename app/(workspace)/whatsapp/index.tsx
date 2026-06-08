import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../components/ScreenHeader';
import EmptyState from '../../../components/EmptyState';
import { NewChatModal } from '../../../components/whatsapp/NewChatModal';
import { useDrawer } from '../_layout';
import { whatsappApi } from '../../../lib/api';
import { useWhatsAppContacts } from '../../../hooks/useWhatsAppContacts';
import type { WhatsAppConversation, WhatsAppStatus } from '../../../lib/whatsapp-types';
import {
  displayNameForPeer,
  formatWhatsAppListTime,
  formatWhatsAppPhone,
  peerInitials,
} from '../../../lib/whatsapp-utils';
import { savedContactsWithoutConversation } from '../../../lib/whatsapp-contacts';
import { attachUnreadCounts } from '../../../lib/whatsapp-unread';
import { useAuth } from '../../../hooks/useAuth';
import { Colors } from '../../../constants/colors';

const LIST_POLL_MS = 4000;
const convCacheKey = (userId: string) => `wa_conv_list_v2:${userId}`;

export default function WhatsAppScreen() {
  const router = useRouter();
  const { openDrawer } = useDrawer();
  const { session, user } = useAuth();
  const userId = user?.id ?? '';
  const { contacts, saveName, error: contactsError } = useWhatsAppContacts();
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<WhatsAppStatus | null>(null);
  const [newChatOpen, setNewChatOpen] = useState(false);

  // Load cached conversations immediately on mount so the list is instant
  useEffect(() => {
    if (!userId) return;
    AsyncStorage.getItem(convCacheKey(userId))
      .then((raw) => {
        if (!raw) return;
        const cached = JSON.parse(raw) as WhatsAppConversation[];
        if (cached.length > 0) {
          setConversations(cached);
          setLoading(false); // show cached list without spinner
        }
      })
      .catch(() => {});
  }, [userId]);

  const applyConversationList = useCallback(
    async (
      convs: WhatsAppConversation[],
      statusData: WhatsAppStatus | null,
      businessLine?: string | null
    ) => {
      const line = businessLine ?? statusData?.businessLine ?? null;
      const withUnread = line ? await attachUnreadCounts(convs, line) : convs;
      setConversations(withUnread);
      if (statusData) setStatus(statusData);
      // Persist to cache for next cold open
      if (userId) {
        AsyncStorage.setItem(convCacheKey(userId), JSON.stringify(withUnread)).catch(() => {});
      }
    },
    [userId]
  );

  const load = useCallback(async () => {
    try {
      const [convData, statusData] = await Promise.all([
        whatsappApi.listConversations(),
        whatsappApi.status().catch(() => null),
      ]);
      await applyConversationList(convData.conversations ?? [], statusData, convData.businessLine);
    } catch (e: unknown) {
      setStatus({
        lineError: e instanceof Error ? e.message : 'Failed to load WhatsApp',
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [applyConversationList]);

  useEffect(() => {
    if (!session || !userId) {
      setConversations([]);
      setLoading(true);
      return;
    }
    void load();
  }, [session, userId, load]);

  const refreshConversations = useCallback(async () => {
    try {
      const convData = await whatsappApi.listConversations();
      await applyConversationList(
        convData.conversations ?? [],
        status,
        convData.businessLine ?? status?.businessLine
      );
    } catch {
      /* keep last list */
    }
  }, [applyConversationList, status]);

  useFocusEffect(
    useCallback(() => {
      if (!session) return;
      void refreshConversations();
      const timer = setInterval(() => {
        void refreshConversations();
      }, LIST_POLL_MS);
      return () => clearInterval(timer);
    }, [session, refreshConversations])
  );

  const filtered = conversations.filter((c) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    const name = displayNameForPeer(c.peer_e164, contacts).toLowerCase();
    const body = (c.last_body ?? c.last_message ?? '').toLowerCase();
    return c.peer_e164.includes(q) || name.includes(q) || body.includes(q);
  });

  const savedSuggestions = useMemo(
    () => savedContactsWithoutConversation(contacts, conversations, search.trim()),
    [search, contacts, conversations]
  );

  const businessLine = status?.businessLine ?? null;
  const lineError = status?.lineError ?? null;
  const configured = status?.sendConfigured !== false;

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="WhatsApp"
        onMenuPress={openDrawer}
        rightAction={{ icon: 'create-outline', onPress: () => setNewChatOpen(true) }}
      />

      {!configured ? (
        <View style={styles.bannerWarn}>
          <Text style={styles.bannerWarnText}>
            WhatsApp sending is not configured on the server. Set Exotel credentials on the API host.
          </Text>
        </View>
      ) : null}

      {contactsError ? (
        <View style={styles.bannerWarn}>
          <Text style={styles.bannerWarnText}>Contacts: {contactsError}</Text>
        </View>
      ) : null}

      {lineError && !businessLine ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{lineError}</Text>
        </View>
      ) : null}

      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search chats..."
          placeholderTextColor={Colors.textMuted}
        />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color="#25D366" />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.peer_e164}
          ListHeaderComponent={
            savedSuggestions.length > 0 ? (
              <View style={styles.savedSection}>
                <Text style={styles.savedSectionLabel}>Saved contacts</Text>
                {savedSuggestions.map((c) => (
                  <TouchableOpacity
                    key={c.peer_e164}
                    style={styles.savedRow}
                    onPress={() =>
                      router.push(`/(workspace)/whatsapp/${encodeURIComponent(c.peer_e164)}` as any)
                    }
                  >
                    <View style={styles.savedAvatar}>
                      <Text style={styles.savedAvatarText}>
                        {peerInitials(c.peer_e164, c.name)}
                      </Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.savedName}>{c.name}</Text>
                      <Text style={styles.savedPhone}>{formatWhatsAppPhone(c.peer_e164)}</Text>
                    </View>
                    <Ionicons name="chatbubble-outline" size={18} color="#25D366" />
                  </TouchableOpacity>
                ))}
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <ConvRow
              conv={item}
              displayName={displayNameForPeer(item.peer_e164, contacts)}
              onPress={() =>
                router.push(`/(workspace)/whatsapp/${encodeURIComponent(item.peer_e164)}` as any)
              }
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor="#25D366"
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="logo-whatsapp"
              title="No WhatsApp conversations"
              subtitle="Tap + to message a contact"
            />
          }
          contentContainerStyle={filtered.length === 0 ? { flex: 1 } : undefined}
        />
      )}

      <NewChatModal
        visible={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        contacts={contacts}
        onSaveContact={saveName}
        onStart={(peer) =>
          router.push(`/(workspace)/whatsapp/${encodeURIComponent(peer)}` as any)
        }
      />
    </View>
  );
}

function ConvRow({
  conv,
  displayName,
  onPress,
}: {
  conv: WhatsAppConversation;
  displayName: string;
  onPress: () => void;
}) {
  const initials = peerInitials(conv.peer_e164, displayName);
  const lastAt = conv.last_at ?? conv.last_message_at ?? '';
  const unread = conv.unread_count ?? 0;
  const hasUnread = unread > 0;
  const badgeLabel = unread > 99 ? '99+' : String(unread);

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initials}</Text>
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={[styles.peerName, hasUnread && styles.peerNameUnread]} numberOfLines={1}>
            {displayName}
          </Text>
          <Text style={[styles.time, hasUnread && styles.timeUnread]}>
            {lastAt ? formatWhatsAppListTime(lastAt) : ''}
          </Text>
        </View>
        <Text style={[styles.lastMsg, hasUnread && styles.lastMsgUnread]} numberOfLines={1}>
          {conv.last_dir === 'outbound' ? 'You: ' : ''}
          {conv.last_body ?? conv.last_message ?? 'No messages yet'}
        </Text>
      </View>
      {hasUnread ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badgeLabel}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  bannerWarn: {
    marginHorizontal: 12,
    marginTop: 8,
    padding: 12,
    backgroundColor: '#FEE2E2',
    borderRadius: 8,
  },
  bannerWarnText: { fontSize: 13, color: '#991B1B' },
  banner: {
    marginHorizontal: 12,
    marginTop: 8,
    padding: 12,
    backgroundColor: '#FEF3C7',
    borderRadius: 8,
  },
  bannerText: { fontSize: 13, color: '#92400E' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#075E54',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  rowBody: { flex: 1, gap: 4 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  peerName: { flex: 1, fontSize: 15, fontWeight: '500', color: Colors.text },
  peerNameUnread: { fontWeight: '700', color: Colors.text },
  time: { fontSize: 11, color: Colors.textMuted },
  timeUnread: { color: '#25D366', fontWeight: '600' },
  lastMsg: { fontSize: 13, color: Colors.textSecondary },
  lastMsgUnread: { color: Colors.text, fontWeight: '600' },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#25D366',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  savedSection: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingBottom: 8,
  },
  savedSectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textMuted,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 6,
    textTransform: 'uppercase',
  },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  savedAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#075E54',
    alignItems: 'center',
    justifyContent: 'center',
  },
  savedAvatarText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  savedName: { fontSize: 15, fontWeight: '600', color: Colors.text },
  savedPhone: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
});
