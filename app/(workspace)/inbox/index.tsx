import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, TextInput, ActivityIndicator, Alert,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format, isToday, isYesterday } from 'date-fns';
import ScreenHeader from '../../../components/ScreenHeader';
import EmptyState from '../../../components/EmptyState';
import { useDrawer } from '../_layout';
import { useAuth } from '../../../hooks/useAuth';
import { gmailApi, type GmailFolder, type GmailLabel, type GmailThreadListItem } from '../../../lib/api';
import { markThreadReadDirectly } from '../../../lib/gmail-send-direct';
import { Colors } from '../../../constants/colors';
import { cacheGet, cacheSet, cacheIsStale } from '../../../lib/cache';
import { isPendingDelete, markLocallyRead, isLocallyRead } from '../../../lib/pending-deletes';
import { LabelChip } from '../../../components/LabelChip';

const FOLDERS: { key: GmailFolder; label: string }[] = [
  { key: 'inbox',  label: 'Inbox'  },
  { key: 'sent',   label: 'Sent'   },
  { key: 'drafts', label: 'Drafts' },
];

const PAGE_SIZE = 15;

export default function InboxScreen() {
  const router = useRouter();
  const { openDrawer } = useDrawer();
  const { session } = useAuth();
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

  // Labels — loaded once, used for chip rendering on rows + filtering.
  const [allLabels, setAllLabels] = useState<GmailLabel[]>([]);
  const [filterLabelId, setFilterLabelId] = useState<string | null>(null);

  // Inbox category sub-tabs (Primary / Promotions / Social / Updates / Forums).
  type CategoryKey = 'primary' | 'promotions' | 'social' | 'updates' | 'forums';
  const CATEGORY_LABEL: Record<CategoryKey, string> = {
    primary: 'CATEGORY_PERSONAL',
    promotions: 'CATEGORY_PROMOTIONS',
    social: 'CATEGORY_SOCIAL',
    updates: 'CATEGORY_UPDATES',
    forums: 'CATEGORY_FORUMS',
  };
  const [category, setCategory] = useState<CategoryKey>('primary');
  const effectiveLabelId =
    filterLabelId ?? (folder === 'inbox' ? CATEGORY_LABEL[category] : null);

  // Multi-select via long-press. selection.size > 0 means we're in
  // "selection mode" and the top bar swaps to bulk actions.
  const [selection, setSelection] = useState<Set<string>>(new Set());
  // bulkBusy removed — actions are fire-and-forget with instant optimistic UI
  // Per-row busy (for the optimistic star toggle)
  const [rowBusy, setRowBusy] = useState<Set<string>>(new Set());

  // Folder + label counts
  const [labelCounts, setLabelCounts] = useState<Record<string, { total: number; unread: number }>>({});

  useEffect(() => {
    gmailApi.listLabels()
      .then((r) => setAllLabels(r.labels ?? []))
      .catch(() => { /* non-fatal — chips will be empty */ });
  }, []);

  // Fetch counts whenever the label list changes.
  useEffect(() => {
    if (allLabels.length === 0) return;
    const ids = [
      'INBOX', 'SENT', 'DRAFT', 'STARRED',
      'CATEGORY_PERSONAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL',
      'CATEGORY_UPDATES', 'CATEGORY_FORUMS',
      ...allLabels.filter((l) => l.type === 'user').map((l) => l.id),
    ];
    gmailApi.folderCounts(ids)
      .then((r) => setLabelCounts(r.counts ?? {}))
      .catch(() => { /* non-fatal */ });
  }, [allLabels]);

  // Clear selection when the visible list changes underneath us.
  useEffect(() => { setSelection(new Set()); }, [folder, debouncedSearch, effectiveLabelId]);

  function toggleSelect(threadId: string) {
    setSelection((s) => {
      const next = new Set(s);
      if (next.has(threadId)) next.delete(threadId);
      else next.add(threadId);
      return next;
    });
  }

  async function toggleStar(threadId: string, nextStarred: boolean) {
    setRowBusy((s) => new Set(s).add(threadId));
    const prev = threads;
    setThreads((rows) => rows.map((r) => (r.id === threadId ? { ...r, starred: nextStarred } : r)));
    try {
      await gmailApi.modifyThreadLabels(threadId, nextStarred ? { add: ['STARRED'] } : { remove: ['STARRED'] });
    } catch (e: any) {
      setThreads(prev);
      Alert.alert('Could not update star', e?.message ?? 'Try again');
    } finally {
      setRowBusy((s) => { const n = new Set(s); n.delete(threadId); return n; });
    }
  }

  function bulkAction(action: 'markRead' | 'markUnread' | 'star') {
    const ids = Array.from(selection);
    if (ids.length === 0) return;

    // 1. Optimistic UI — instant.
    const prev = threads;
    if (action === 'markRead' || action === 'markUnread') {
      setThreads((rows) => rows.map((r) => (selection.has(r.id) ? { ...r, unread: action === 'markUnread' } : r)));
    } else if (action === 'star') {
      setThreads((rows) => rows.map((r) => (selection.has(r.id) ? { ...r, starred: true } : r)));
    }

    // 2. Clear selection immediately — user is unblocked.
    setSelection(new Set());

    // 3. Fire API in the background — silently roll back on failure.
    const body =
      action === 'markRead'   ? { remove: ['UNREAD'] } :
      action === 'markUnread' ? { add: ['UNREAD'] }    :
                                { add: ['STARRED'] };
    gmailApi.batchModifyThreads(ids, body).catch(() => {
      setThreads(prev);
    });
  }

  // O(1) lookup by id when rendering chips on a row.
  const labelsById = React.useMemo(() => {
    const m = new Map<string, GmailLabel>();
    for (const l of allLabels) m.set(l.id, l);
    return m;
  }, [allLabels]);

  // Debounce search input → only hit backend after 400ms of stillness
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  // Apply session-wide local overlays:
  //   - drop items the user just deleted (Gmail's list lags ~5-15s)
  //   - force unread=false on threads the user already opened this session
  //     (Gmail's UNREAD label propagation can lag a few seconds)
  const applyLocalOverlays = useCallback((list: GmailThreadListItem[]) => {
    return list
      .filter((t) => !(t.draftId && isPendingDelete(t.draftId)))
      .map((t) => (isLocallyRead(t.id) ? { ...t, unread: false } : t));
  }, []);

  const loadFirstPage = useCallback(async (force = false) => {
    setError(null);
    const cacheKey = `inbox:${folder}:${debouncedSearch}:${effectiveLabelId ?? ''}`;

    type CachedPage = { threads: GmailThreadListItem[]; nextPageToken?: string };
    const cached = cacheGet<CachedPage>(cacheKey);
    if (cached) {
      setThreads(applyLocalOverlays(cached.threads));
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
        labelId: effectiveLabelId ?? undefined,
      });
      // Dedupe by id — Gmail can rarely return the same thread twice
      // (history-id churn during pagination).
      const seen = new Set<string>();
      const unique = (data.threads ?? []).filter((t) => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });
      // applyLocalOverlays handles both pending-delete filtering AND keeping
      // locally-read threads as unread:false, even if Gmail still says UNREAD.
      const threads = applyLocalOverlays(unique);
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
  }, [folder, debouncedSearch, applyLocalOverlays, effectiveLabelId]);

  const loadMore = useCallback(async () => {
    if (!nextPageToken || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await gmailApi.listThreads(folder, {
        maxResults: PAGE_SIZE,
        pageToken: nextPageToken,
        search: debouncedSearch || undefined,
        labelId: effectiveLabelId ?? undefined,
      });
      const incoming = applyLocalOverlays(data.threads ?? []);
      setThreads((prev) => {
        const seen = new Set(prev.map((t) => t.id));
        const deduped = incoming.filter((t) => !seen.has(t.id));
        const merged = [...prev, ...deduped];
        // Keep the cache in sync so back-nav doesn't lose later pages
        const cacheKey = `inbox:${folder}:${debouncedSearch}:${effectiveLabelId ?? ''}`;
        cacheSet(cacheKey, { threads: merged, nextPageToken: data.nextPageToken });
        return merged;
      });
      setNextPageToken(data.nextPageToken);
    } catch (e: any) {
      console.error('[inbox] loadMore failed:', e?.message);
    } finally {
      setLoadingMore(false);
    }
  }, [folder, nextPageToken, loadingMore, debouncedSearch, applyLocalOverlays, effectiveLabelId]);

  // Wait for the Supabase session to be restored from SecureStore before
  // firing the first API call. Without this guard the call races the session
  // restore on cold-start and the server receives an unauthenticated request,
  // returning "Not signed in" even though the user is logged in.
  useEffect(() => {
    if (!session) return;
    setLoading(true);
    setThreads([]);
    setNextPageToken(undefined);
    loadFirstPage();
  }, [session, loadFirstPage]);

  // On back-navigation: by default, just re-apply local overlays so the
  // scroll position and loaded pages are preserved. Only do a full refetch
  // when the cache was explicitly busted (e.g. compose discarded/sent and
  // called cacheDelete) — that signals the list is genuinely stale.
  const firstFocusRef = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocusRef.current) {
        firstFocusRef.current = false;
        return;
      }
      const cacheKey = `inbox:${folder}:${debouncedSearch}:${effectiveLabelId ?? ''}`;
      const cached = cacheGet(cacheKey);
      if (!cached) {
        loadFirstPage(true);
      } else {
        setThreads((prev) => applyLocalOverlays(prev));
      }
    }, [folder, debouncedSearch, loadFirstPage, applyLocalOverlays])
  );

  // Prefetch thread detail on press-in (fires ~100ms before onPress on native).
  // Stores the resolved data in the session cache so the detail screen reads
  // it immediately instead of waiting for a fresh network round-trip.
  function prefetchThread(threadId: string) {
    const key = `thread:${threadId}`;
    if (cacheGet(key)) return; // already cached this session
    gmailApi.getThread(threadId)
      .then((data) => cacheSet(key, data))
      .catch(() => { /* non-fatal — detail screen will fetch itself */ });
  }

  function openThread(thread: GmailThreadListItem) {
    // Drafts → open compose pre-filled so the user can continue editing
    if (folder === 'drafts' && thread.draftId) {
      router.push(`/(workspace)/inbox/compose?draftId=${encodeURIComponent(thread.draftId)}` as any);
      return;
    }
    // Mark locally-read for the session — applyLocalOverlays uses this set
    // on every cache hit and every fresh fetch, so the row never re-bolds
    // even if Gmail's UNREAD label hasn't propagated yet.
    markLocallyRead(thread.id);
    // Optimistic flip in current state
    setThreads((prev) => prev.map((t) => (t.id === thread.id ? { ...t, unread: false } : t)));
    // Fire mark-read directly to Gmail — no need to wait for the thread
    // detail screen to mount before telling Gmail.
    gmailApi.getGoogleToken()
      .then(({ accessToken }) => markThreadReadDirectly(accessToken, thread.id))
      .catch((e) => console.warn('[inbox] mark-read failed:', e?.message));
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
        {FOLDERS.map((f) => {
          const cid = f.key === 'inbox' ? 'INBOX' : f.key === 'sent' ? 'SENT' : 'DRAFT';
          const c = labelCounts[cid];
          const badge = f.key === 'inbox'
            ? (c?.unread && c.unread > 0 ? c.unread : null)
            : (c?.total && c.total > 0 ? c.total : null);
          return (
            <TouchableOpacity
              key={f.key}
              style={[styles.folderTab, folder === f.key && styles.folderTabActive]}
              onPress={() => setFolder(f.key)}
            >
              <Text style={[styles.folderTabText, folder === f.key && styles.folderTabTextActive]}>
                {f.label}
                {badge !== null && (
                  <Text style={styles.folderTabBadge}>  {badge > 999 ? `${Math.floor(badge / 1000)}k` : badge}</Text>
                )}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Category sub-tabs — only on Inbox and only when no user-label filter is set */}
      {folder === 'inbox' && !filterLabelId && (
        <View style={styles.categoryRow}>
          <FlatList
            data={[
              { key: 'primary' as CategoryKey, label: 'Primary', countId: 'CATEGORY_PERSONAL' },
              { key: 'promotions' as CategoryKey, label: 'Promotions', countId: 'CATEGORY_PROMOTIONS' },
              { key: 'social' as CategoryKey, label: 'Social', countId: 'CATEGORY_SOCIAL' },
              { key: 'updates' as CategoryKey, label: 'Updates', countId: 'CATEGORY_UPDATES' },
              { key: 'forums' as CategoryKey, label: 'Forums', countId: 'CATEGORY_FORUMS' },
            ]}
            keyExtractor={(t) => t.key}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingHorizontal: 12, gap: 6 }}
            renderItem={({ item: t }) => {
              const unread = labelCounts[t.countId]?.unread ?? 0;
              const active = category === t.key;
              return (
                <TouchableOpacity
                  onPress={() => setCategory(t.key)}
                  style={[styles.catChip, active && styles.catChipActive]}
                >
                  <Text style={[styles.catChipText, active && styles.catChipTextActive]}>{t.label}</Text>
                  {unread > 0 && (
                    <Text style={[styles.catChipBadge, active && { color: Colors.primary }]}>
                      {unread > 99 ? '99+' : unread}
                    </Text>
                  )}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      )}

      {/* Selection action bar — replaces the search bar when we're in selection mode */}
      {selection.size > 0 && (
        <View style={styles.selectionBar}>
          <TouchableOpacity onPress={() => setSelection(new Set())} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Ionicons name="close" size={20} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.selectionText}>{selection.size} selected</Text>
          <View style={styles.selectionActions}>
            {/* Star */}
            <SelectionActionBtn icon="star-outline" onPress={() => bulkAction('star')} />
            {/* Single read/unread toggle — if all selected are read, offer "mark unread"; otherwise offer "mark read" */}
            {Array.from(selection).every((id) => !threads.find((t) => t.id === id)?.unread) ? (
              <SelectionActionBtn icon="mail-unread-outline" onPress={() => bulkAction('markUnread')} />
            ) : (
              <SelectionActionBtn icon="mail-open-outline" onPress={() => bulkAction('markRead')} />
            )}
          </View>
        </View>
      )}

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

      {/* Label filter chips — only user labels, only for inbox/sent (not drafts) */}
      {folder !== 'drafts' && allLabels.some((l) => l.type === 'user') && (
        <View style={styles.labelFilterBar}>
          <TouchableOpacity
            onPress={() => setFilterLabelId(null)}
            style={[styles.labelFilterChip, filterLabelId === null && styles.labelFilterChipActive]}
          >
            <Text style={[styles.labelFilterChipText, filterLabelId === null && styles.labelFilterChipTextActive]}>
              All
            </Text>
          </TouchableOpacity>
          <FlatList
            data={allLabels.filter((l) => l.type === 'user')}
            keyExtractor={(l) => l.id}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 6 }}
            renderItem={({ item: l }) => {
              const unread = labelCounts[l.id]?.unread ?? 0;
              const active = filterLabelId === l.id;
              return (
                <TouchableOpacity
                  onPress={() => setFilterLabelId(active ? null : l.id)}
                  style={[styles.labelFilterChip, active && styles.labelFilterChipActive]}
                >
                  <Text style={[styles.labelFilterChipText, active && styles.labelFilterChipTextActive]} numberOfLines={1}>
                    {l.name}
                  </Text>
                  {unread > 0 && (
                    <View style={styles.labelFilterChipBadge}>
                      <Text style={styles.labelFilterChipBadgeText}>{unread > 99 ? '99+' : unread}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      )}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>
      ) : error && threads.length === 0 ? (
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
              labelsById={labelsById}
              selected={selection.has(item.id)}
              selectionMode={selection.size > 0}
              rowBusy={rowBusy.has(item.id)}
              onPressIn={() => { if (selection.size === 0 && folder !== 'drafts') prefetchThread(item.id); }}
              onPress={() => {
                if (selection.size > 0) toggleSelect(item.id);
                else openThread(item);
              }}
              onLongPress={() => toggleSelect(item.id)}
              onToggleStar={(next) => void toggleStar(item.id, next)}
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

function SelectionActionBtn({
  icon, onPress, disabled,
}: { icon: keyof typeof Ionicons.glyphMap; onPress: () => void; disabled?: boolean }) {
  return (
    <TouchableOpacity
      style={styles.selectionActionBtn}
      onPress={onPress}
      disabled={disabled}
      hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
    >
      <Ionicons name={icon} size={20} color={disabled ? Colors.textMuted : Colors.text} />
    </TouchableOpacity>
  );
}

function ThreadRow({
  thread,
  labelsById,
  selected,
  selectionMode,
  rowBusy,
  onPressIn,
  onPress,
  onLongPress,
  onToggleStar,
}: {
  thread: GmailThreadListItem;
  labelsById: Map<string, GmailLabel>;
  selected: boolean;
  selectionMode: boolean;
  rowBusy: boolean;
  onPressIn?: () => void;
  onPress: () => void;
  onLongPress: () => void;
  onToggleStar: (next: boolean) => void;
}) {
  const { name: fromName } = parseFromHeader(thread.from);
  const date = formatDate(thread.date);
  const initial = avatarInitial(fromName);
  const isUnread = Boolean(thread.unread);
  const isStarred = Boolean(thread.starred);
  const chips = (thread.labelIds ?? [])
    .map((id) => labelsById.get(id))
    .filter((l): l is GmailLabel => !!l && l.type === 'user')
    .slice(0, 3);
  return (
    <TouchableOpacity
      style={[
        styles.threadRow,
        isUnread && styles.threadRowUnread,
        selected && styles.threadRowSelected,
      ]}
      onPressIn={onPressIn}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      activeOpacity={0.7}
    >
      {/* Avatar / selection checkmark — in selection mode the avatar
          becomes a tick when selected. Tap the avatar to toggle. */}
      <TouchableOpacity
        onPress={onLongPress}
        activeOpacity={0.7}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        {selected ? (
          <View style={[styles.avatar, styles.avatarSelected]}>
            <Ionicons name="checkmark" size={18} color={Colors.surface} />
          </View>
        ) : (
          <View style={[styles.avatar, isUnread && styles.avatarUnread]}>
            <Text style={[styles.avatarText, isUnread && styles.avatarTextUnread]}>{initial}</Text>
          </View>
        )}
      </TouchableOpacity>

      <View style={styles.threadBody}>
        <View style={styles.threadTopRow}>
          <View style={styles.fromRow}>
            {isUnread ? <View style={styles.unreadDot} /> : null}
            <Text style={[styles.threadFrom, isUnread && styles.threadFromUnread]} numberOfLines={1}>
              {fromName}
            </Text>
          </View>
          {/* Right cluster: paperclip + date */}
          <View style={styles.rightCluster}>
            {thread.hasAttachments && (
              <Ionicons
                name="attach"
                size={12}
                color={isUnread ? Colors.text : Colors.textMuted}
                style={{ transform: [{ rotate: '45deg' }] }}
              />
            )}
            <Text style={[styles.threadDate, isUnread && styles.threadDateUnread]}>{date}</Text>
          </View>
        </View>
        <Text style={[styles.threadSubject, isUnread && styles.threadSubjectUnread]} numberOfLines={1}>
          {thread.subject || '(no subject)'}
        </Text>
        <Text style={styles.threadSnippet} numberOfLines={1}>{thread.snippet}</Text>
        {chips.length > 0 && (
          <View style={styles.threadChipsRow}>
            {chips.map((l) => (
              <LabelChip key={l.id} label={l} />
            ))}
          </View>
        )}
      </View>

      {/* Star — tap-to-toggle. Hidden in selection mode to avoid accidental taps. */}
      {!selectionMode && (
        <TouchableOpacity
          onPress={(e) => { e.stopPropagation(); onToggleStar(!isStarred); }}
          disabled={rowBusy}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.starBtn}
        >
          <Ionicons
            name={isStarred ? 'star' : 'star-outline'}
            size={18}
            color={isStarred ? '#F59E0B' : Colors.textMuted}
          />
        </TouchableOpacity>
      )}
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
  threadChipsRow: { flexDirection: 'row', gap: 4, flexWrap: 'wrap', marginTop: 4 },
  labelFilterBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingBottom: 8,
    backgroundColor: Colors.background,
  },
  labelFilterChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  labelFilterChipActive: {
    backgroundColor: Colors.primaryLight,
    borderColor: Colors.primary,
  },
  labelFilterChipText: { fontSize: 11, fontWeight: '600', color: Colors.textSecondary },
  labelFilterChipTextActive: { color: Colors.primary },
  footerLoader: { paddingVertical: 16, alignItems: 'center' },

  // Folder + category + selection bits (Inc5)
  folderTabBadge: { fontSize: 11, fontWeight: '600', color: Colors.textMuted, marginLeft: 4 },
  categoryRow: {
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingVertical: 8,
  },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: Colors.background,
  },
  catChipActive: { backgroundColor: Colors.primaryLight },
  catChipText: { fontSize: 12, fontWeight: '600', color: Colors.textMuted },
  catChipTextActive: { color: Colors.primary, fontWeight: '700' },
  catChipBadge: { fontSize: 10, fontWeight: '700', color: Colors.textMuted },

  labelFilterChipBadge: {
    backgroundColor: Colors.primary,
    borderRadius: 999,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginLeft: 4,
  },
  labelFilterChipBadgeText: { fontSize: 9, fontWeight: '700', color: Colors.surface },

  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: Colors.primaryLight,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  selectionText: { fontSize: 14, fontWeight: '700', color: Colors.text, flex: 1 },
  selectionActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  selectionActionBtn: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },

  threadRowSelected: { backgroundColor: Colors.primaryLight },
  avatarSelected: { backgroundColor: Colors.primary },
  rightCluster: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  starBtn: { padding: 4, marginLeft: 4 },
  errorText: { fontSize: 14, color: Colors.error, textAlign: 'center' },
  retryBtn: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 8, backgroundColor: Colors.primary, borderRadius: 8 },
  retryText: { color: Colors.surface, fontWeight: '600', fontSize: 14 },
});
