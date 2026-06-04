import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, TextInput, Alert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { formatDistanceToNow } from 'date-fns';
import ScreenHeader from '../../../components/ScreenHeader';
import EmptyState from '../../../components/EmptyState';
import { useDrawer } from '../_layout';
import { whatsappApi } from '../../../lib/api';
import { Colors } from '../../../constants/colors';

export default function WhatsAppScreen() {
  const router = useRouter();
  const { openDrawer } = useDrawer();
  const [conversations, setConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [businessLine, setBusinessLine] = useState<string | null>(null);
  const [lineError, setLineError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await whatsappApi.listConversations();
      setConversations(data.conversations ?? []);
      setBusinessLine(data.businessLine ?? null);
      setLineError((data as { error?: string }).error ?? null);
    } catch (e: unknown) {
      setConversations([]);
      setLineError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function newConversation() {
    Alert.prompt('New WhatsApp Message', 'Enter phone number (with country code)', (num) => {
      if (num) router.push(`/(workspace)/whatsapp/${encodeURIComponent(num)}` as any);
    }, 'plain-text');
  }

  const filtered = conversations.filter((c) => {
    const q = search.toLowerCase();
    const body = (c.last_body ?? c.last_message ?? '').toLowerCase();
    return c.peer_e164?.includes(search) || body.includes(q);
  });

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="WhatsApp"
        onMenuPress={openDrawer}
        rightAction={{ icon: 'create-outline', onPress: newConversation }}
      />
      {lineError && !businessLine ? (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{lineError}</Text>
        </View>
      ) : businessLine ? (
        <View style={styles.lineBanner}>
          <Text style={styles.lineBannerText}>Your line: {businessLine}</Text>
        </View>
      ) : null}
      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search conversations..."
          placeholderTextColor={Colors.textMuted}
        />
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.peer_e164}
          renderItem={({ item }) => (
            <ConvRow conv={item} onPress={() => router.push(`/(workspace)/whatsapp/${encodeURIComponent(item.peer_e164)}` as any)} />
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.primary} />}
          ListEmptyComponent={<EmptyState icon="logo-whatsapp" title="No WhatsApp conversations" subtitle="Tap + to start a new conversation" />}
          contentContainerStyle={conversations.length === 0 ? { flex: 1 } : undefined}
        />
      )}
    </View>
  );
}

function ConvRow({ conv, onPress }: { conv: any; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.avatar}>
        <Ionicons name="logo-whatsapp" size={22} color="#25D366" />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.peerNum}>{conv.peer_e164}</Text>
          <Text style={styles.time}>
            {(conv.last_at ?? conv.last_message_at)
              ? formatDistanceToNow(new Date(conv.last_at ?? conv.last_message_at), { addSuffix: true })
              : ''}
          </Text>
        </View>
        <Text style={styles.lastMsg} numberOfLines={1}>
          {conv.last_body ?? conv.last_message ?? 'No messages yet'}
        </Text>
      </View>
      {conv.unread_count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{conv.unread_count}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  banner: {
    marginHorizontal: 12,
    marginTop: 8,
    padding: 12,
    backgroundColor: '#FEF3C7',
    borderRadius: 8,
  },
  bannerText: { fontSize: 13, color: '#92400E' },
  lineBanner: {
    marginHorizontal: 12,
    marginTop: 8,
    padding: 10,
    backgroundColor: '#DCFCE7',
    borderRadius: 8,
  },
  lineBannerText: { fontSize: 12, color: '#166534' },
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
    backgroundColor: '#E9FAF0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, gap: 4 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between' },
  peerNum: { fontSize: 14, fontWeight: '600', color: Colors.text },
  time: { fontSize: 11, color: Colors.textMuted },
  lastMsg: { fontSize: 13, color: Colors.textSecondary },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#25D366',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { color: Colors.surface, fontSize: 11, fontWeight: '700' },
});
