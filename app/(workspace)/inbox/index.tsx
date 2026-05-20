import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, TextInput, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import ScreenHeader from '../../../components/ScreenHeader';
import EmptyState from '../../../components/EmptyState';
import { useDrawer } from '../_layout';
import { gmailApi } from '../../../lib/api';
import { Colors } from '../../../constants/colors';

const FOLDERS = ['INBOX', 'SENT', 'DRAFT'] as const;
type Folder = (typeof FOLDERS)[number];

interface Thread {
  id: string;
  threadId: string;
  subject: string;
  snippet: string;
  from: string;
  date: string;
  unread: boolean;
}

export default function InboxScreen() {
  const router = useRouter();
  const { openDrawer } = useDrawer();
  const [folder, setFolder] = useState<Folder>('INBOX');
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');

  const loadThreads = useCallback(async () => {
    try {
      const data = await gmailApi.listThreads(folder);
      setThreads(data.threads ?? []);
    } catch {
      setThreads([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [folder]);

  useEffect(() => {
    setLoading(true);
    loadThreads();
  }, [loadThreads]);

  const filtered = threads.filter(
    (t) =>
      t.subject?.toLowerCase().includes(search.toLowerCase()) ||
      t.from?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Inbox"
        onMenuPress={openDrawer}
        rightAction={{ icon: 'create-outline', onPress: () => router.push('/(workspace)/inbox/compose' as any) }}
      />

      <View style={styles.folderBar}>
        {FOLDERS.map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.folderTab, folder === f && styles.folderTabActive]}
            onPress={() => setFolder(f)}
          >
            <Text style={[styles.folderTabText, folder === f && styles.folderTabTextActive]}>
              {f.charAt(0) + f.slice(1).toLowerCase()}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search emails..."
          placeholderTextColor={Colors.textMuted}
        />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <ThreadRow thread={item} onPress={() => router.push(`/(workspace)/inbox/${item.threadId}` as any)} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadThreads(); }} tintColor={Colors.primary} />}
          ListEmptyComponent={<EmptyState icon="mail-outline" title="No emails" subtitle="Your inbox is empty" />}
          contentContainerStyle={filtered.length === 0 ? { flex: 1 } : undefined}
        />
      )}
    </View>
  );
}

function ThreadRow({ thread, onPress }: { thread: Thread; onPress: () => void }) {
  const fromName = thread.from?.split('<')[0]?.trim() ?? thread.from;
  const date = thread.date ? format(new Date(thread.date), 'MMM d') : '';
  return (
    <TouchableOpacity style={[styles.threadRow, thread.unread && styles.threadUnread]} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.avatar, thread.unread && styles.avatarUnread]}>
        <Text style={styles.avatarText}>{fromName.charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.threadBody}>
        <View style={styles.threadTopRow}>
          <Text style={[styles.threadFrom, thread.unread && styles.bold]} numberOfLines={1}>{fromName}</Text>
          <Text style={styles.threadDate}>{date}</Text>
        </View>
        <Text style={[styles.threadSubject, thread.unread && styles.bold]} numberOfLines={1}>{thread.subject}</Text>
        <Text style={styles.threadSnippet} numberOfLines={1}>{thread.snippet}</Text>
      </View>
      {thread.unread && <View style={styles.unreadDot} />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  folderBar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: 16,
    gap: 4,
  },
  folderTab: { paddingHorizontal: 12, paddingVertical: 12 },
  folderTabActive: { borderBottomWidth: 2, borderBottomColor: Colors.primary },
  folderTabText: { fontSize: 13, fontWeight: '500', color: Colors.textSecondary },
  folderTabTextActive: { color: Colors.primary, fontWeight: '700' },
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
  threadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  threadUnread: { backgroundColor: '#F5F3FF' },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarUnread: { backgroundColor: Colors.primaryLight },
  avatarText: { fontSize: 16, fontWeight: '700', color: Colors.textSecondary },
  threadBody: { flex: 1, gap: 3 },
  threadTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  threadFrom: { fontSize: 14, color: Colors.text, flex: 1 },
  threadDate: { fontSize: 12, color: Colors.textMuted },
  threadSubject: { fontSize: 13, color: Colors.text },
  threadSnippet: { fontSize: 12, color: Colors.textMuted },
  bold: { fontWeight: '700' },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.primary },
});
