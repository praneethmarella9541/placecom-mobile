import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, TextInput, ActivityIndicator,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format, isToday, isYesterday } from 'date-fns';
import ScreenHeader from '../../../components/ScreenHeader';
import EmptyState from '../../../components/EmptyState';
import { useDrawer } from '../_layout';
import { gmailApi, type GmailFolder, type GmailThreadListItem } from '../../../lib/api';
import { Colors } from '../../../constants/colors';
import { cacheGet, cacheSet, cacheIsStale } from '../../../lib/cache';

const FOLDERS: { key: GmailFolder; label: string }[] = [
  { key: 'inbox',  label: 'Inbox'  },
  { key: 'sent',   label: 'Sent'   },
  { key: 'drafts', label: 'Drafts' },
];

const PAGE_SIZE = 15;

export default function InboxScreen() {
  const router = useRouter();
  const { openDrawer } = useDrawer();
  const [folder, setFolder] = useState<GmailFolder>('inbox');
  const [threads, setThreads] = useState<GmailThreadListItem[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Debounce search input → only hit backend after 400ms of stillness
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  const loadFirstPage = useCallback(async (force = false) => {
    setError(null);
    const cacheKey = `inbox:${folder}:${debouncedSearch}`;

    type CachedPage = { threads: GmailThreadListItem[]; nextPageToken?: string };
    const cached = cacheGet<CachedPage>(cacheKey);
    if (cached) {
      setThreads(cached.threads);
      setNextPageToken(cached.nextPageToken);
      setLoading(false);
      // Skip network fetch only on initial mount when data is still fresh
      if (!force && !cacheIsStale(cacheKey)) {
        setRefreshing(false);
        return;
      }
    } else if (force) {
      // Cache was explicitly busted (e.g. draft discarded) — show spinner immediately
      // so the stale list doesn't linger while we wait for the network.
      setLoading(true);
      setThreads([]);
    }

    try {
      const data = await gmailApi.listThreads(folder, {
        maxResults: PAGE_SIZE,
        search: debouncedSearch || undefined,
      });
      // Preserve any optimistic read-flips: if we locally marked a thread as read
      // but Gmail hasn't caught up yet, keep it as read rather than re-bolding it.
      const locallyRead = new Set(
        (cacheGet<CachedPage>(cacheKey)?.threads ?? [])
          .filter((t) => !t.unread)
          .map((t) => t.id)
      );
      const threads = (data.threads ?? []).map((t) =>
        locallyRead.has(t.id) ? { ...t, unread: false } : t
      );
      cacheSet(cacheKey, { threads, nextPageToken: data.nextPageToken });
      setThreads(threads);
      setNextPageToken(data.nextPageToken);
    } catch (e: any) {
      console.error('[inbox] load failed:', e?.message);
      if (!cached) {
        setError(e?.message ?? 'Failed to load emails');
        setThreads([]);
        setNextPageToken(undefined);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [folder, debouncedSearch]);

  const loadMore = useCallback(async () => {
    if (!nextPageToken || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await gmailApi.listThreads(folder, {
        maxResults: PAGE_SIZE,
        pageToken: nextPageToken,
        search: debouncedSearch || undefined,
      });
      setThreads((prev) => [...prev, ...(data.threads ?? [])]);
      setNextPageToken(data.nextPageToken);
    } catch (e: any) {
      console.error('[inbox] loadMore failed:', e?.message);
    } finally {
      setLoadingMore(false);
    }
  }, [folder, nextPageToken, loadingMore, debouncedSearch]);

  useEffect(() => {
    setLoading(true);
    setThreads([]);
    setNextPageToken(undefined);
    loadFirstPage();
  }, [loadFirstPage]);

  // Refresh the list when we navigate back into Inbox from a thread,
  // so opened threads flip from unread→read once Gmail confirms.
  // Skip the very first focus (handled by the effect above).
  const firstFocusRef = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocusRef.current) {
        firstFocusRef.current = false;
        return;
      }
      loadFirstPage(true);
    }, [loadFirstPage])
  );

  function openThread(thread: GmailThreadListItem) {
    // Drafts → open compose pre-filled so the user can continue editing
    if (folder === 'drafts' && thread.draftId) {
      router.push(`/(workspace)/inbox/compose?draftId=${encodeURIComponent(thread.draftId)}` as any);
      return;
    }
    // Optimistic read-flip in state + cache
    setThreads((prev) => {
      const updated = prev.map((t) => (t.id === thread.id ? { ...t, unread: false } : t));
      const cacheKey = `inbox:${folder}:${debouncedSearch}`;
      const cached = cacheGet<{ threads: GmailThreadListItem[]; nextPageToken?: string }>(cacheKey);
      if (cached) {
        cacheSet(cacheKey, {
          ...cached,
          threads: cached.threads.map((t) => (t.id === thread.id ? { ...t, unread: false } : t)),
        });
      }
      return updated;
    });
    router.push(`/(workspace)/inbox/${thread.id}` as any);
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Inbox"
        onMenuPress={openDrawer}
        rightAction={{
          icon: 'create-outline',
          onPress: () => router.push('/(workspace)/inbox/compose' as any),
        }}
      />

      <View style={styles.folderBar}>
        {FOLDERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.folderTab, folder === f.key && styles.folderTabActive]}
            onPress={() => setFolder(f.key)}
          >
            <Text style={[styles.folderTabText, folder === f.key && styles.folderTabTextActive]}>
              {f.label}
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
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="warning-outline" size={32} color={Colors.error} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); loadFirstPage(); }}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={threads}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ThreadRow
              thread={item}
              onPress={() => openThread(item)}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); loadFirstPage(); }}
              tintColor={Colors.primary}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="mail-outline"
              title={debouncedSearch ? 'No matches' : 'No emails'}
              subtitle={debouncedSearch ? 'Try a different search' : `Your ${folder} is empty`}
            />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footerLoader}>
                <ActivityIndicator color={Colors.primary} size="small" />
              </View>
            ) : null
          }
          contentContainerStyle={threads.length === 0 ? { flex: 1 } : undefined}
        />
      )}
    </View>
  );
}

function formatDate(dateStr: string) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  if (isToday(d)) return format(d, 'h:mm a');
  if (isYesterday(d)) return 'Yesterday';
  return format(d, 'MMM d');
}

/** Extract a clean display name + email from Gmail's "Name" <email> format. */
function parseFromHeader(raw: string): { name: string; email: string } {
  const s = (raw ?? '').trim();
  if (!s) return { name: '(unknown)', email: '' };
  const angle = s.match(/^(.*?)<([^>]+)>\s*$/);
  if (angle) {
    const name = angle[1].trim().replace(/^["']|["']$/g, '').trim();
    const email = angle[2].trim();
    return { name: name || email.split('@')[0] || email, email };
  }
  // No angle brackets: could be bare email, or just a name.
  if (s.includes('@')) {
    return { name: s.split('@')[0], email: s };
  }
  return { name: s.replace(/^["']|["']$/g, '').trim(), email: '' };
}

/** Avatar initial: first alphanumeric character of the display name. */
function avatarInitial(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N}]/gu, '');
  return (cleaned.charAt(0) || '?').toUpperCase();
}

function ThreadRow({ thread, onPress }: { thread: GmailThreadListItem; onPress: () => void }) {
  const { name: fromName } = parseFromHeader(thread.from);
  const date = formatDate(thread.date);
  const initial = avatarInitial(fromName);
  const isUnread = Boolean(thread.unread);
  return (
    <TouchableOpacity
      style={[styles.threadRow, isUnread && styles.threadRowUnread]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.avatar, isUnread && styles.avatarUnread]}>
        <Text style={[styles.avatarText, isUnread && styles.avatarTextUnread]}>{initial}</Text>
      </View>
      <View style={styles.threadBody}>
        <View style={styles.threadTopRow}>
          <View style={styles.fromRow}>
            {isUnread ? <View style={styles.unreadDot} /> : null}
            <Text style={[styles.threadFrom, isUnread && styles.threadFromUnread]} numberOfLines={1}>
              {fromName}
            </Text>
          </View>
          <Text style={[styles.threadDate, isUnread && styles.threadDateUnread]}>{date}</Text>
        </View>
        <Text style={[styles.threadSubject, isUnread && styles.threadSubjectUnread]} numberOfLines={1}>
          {thread.subject || '(no subject)'}
        </Text>
        <Text style={styles.threadSnippet} numberOfLines={1}>{thread.snippet}</Text>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
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
  threadRowUnread: {
    // Subtle tint so unread rows stand out without screaming.
    backgroundColor: '#F5F3FF',
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarUnread: {
    backgroundColor: Colors.primary,
  },
  avatarText: { fontSize: 16, fontWeight: '700', color: Colors.primary },
  avatarTextUnread: { color: Colors.surface },
  threadBody: { flex: 1, gap: 3 },
  threadTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  fromRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  unreadDot: {
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: Colors.primary,
  },
  threadFrom: { fontSize: 14, color: Colors.text, flex: 1, fontWeight: '500' },
  threadFromUnread: { color: Colors.text, fontWeight: '800' },
  threadDate: { fontSize: 12, color: Colors.textMuted, fontWeight: '500' },
  threadDateUnread: { color: Colors.text, fontWeight: '700' },
  threadSubject: { fontSize: 13, color: Colors.text, fontWeight: '400' },
  threadSubjectUnread: { fontWeight: '700' },
  threadSnippet: { fontSize: 12, color: Colors.textMuted },
  footerLoader: { paddingVertical: 16, alignItems: 'center' },
  errorText: { fontSize: 14, color: Colors.error, textAlign: 'center' },
  retryBtn: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 8, backgroundColor: Colors.primary, borderRadius: 8 },
  retryText: { color: Colors.surface, fontWeight: '600', fontSize: 14 },
});
