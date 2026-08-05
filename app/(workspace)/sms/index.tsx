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
import { smsApi } from '../../../lib/api';
import { Colors } from '../../../constants/colors';

export default function SmsScreen() {
  const router = useRouter();
  const { openDrawer } = useDrawer();
  const [conversations, setConversations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await smsApi.listConversations();
      setConversations(data.conversations ?? []);
    } catch {
      setConversations([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  function newConversation() {
    Alert.prompt('New SMS', 'Enter phone number', (num) => {
      if (num) router.push(`/(workspace)/sms/${encodeURIComponent(num)}` as any);
    }, 'plain-text');
  }

  const filtered = conversations.filter((c) =>
    c.peer_e164?.includes(search) || c.last_message?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="SMS"
        onMenuPress={openDrawer}
        rightAction={{ icon: 'create-outline', onPress: newConversation }}
      />
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
        <View style={styles.center}><ActivityIndicator color={Colors.copper} /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.peer_e164}
          renderItem={({ item }) => (
            <ConvRow conv={item} onPress={() => router.push(`/(workspace)/sms/${encodeURIComponent(item.peer_e164)}` as any)} />
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={Colors.copper} />}
          ListEmptyComponent={<EmptyState icon="chatbubble-outline" title="No SMS conversations" subtitle="Tap + to start a new conversation" />}
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
        <Ionicons name="chatbubble" size={20} color={Colors.primary} />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.peerNum}>{conv.peer_e164}</Text>
          <Text style={styles.time}>
            {conv.last_message_at ? formatDistanceToNow(new Date(conv.last_message_at), { addSuffix: true }) : ''}
          </Text>
        </View>
        <Text style={styles.lastMsg} numberOfLines={1}>{conv.last_message ?? 'No messages yet'}</Text>
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
    backgroundColor: Colors.primaryLight,
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
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { color: Colors.surface, fontSize: 11, fontWeight: '700' },
});
