import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, TextInput, ActivityIndicator, Alert, Pressable,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format, isToday, isYesterday } from 'date-fns';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import EmptyState from '../../../components/EmptyState';
import { useDrawer } from '../_layout';
import { useAuth } from '../../../hooks/useAuth';
import { gmailApi, type GmailFolder, type GmailLabel, type GmailThreadListItem } from '../../../lib/api';
import { markThreadReadDirectly } from '../../../lib/gmail-send-direct';
import { Colors } from '../../../constants/colors';
import { Gmail, avatarColorForName } from '../../../constants/gmailTheme';
import { cacheGet, cacheSet, cacheIsStale } from '../../../lib/cache';
import { ingestCorrespondentThreads } from '../../../lib/correspondent-rank';
import { isPendingDelete, markLocallyRead, isLocallyRead } from '../../../lib/pending-deletes';
import { LabelChip } from '../../../components/LabelChip';
import { labelDisplayName } from '../../../lib/gmail-labels';
import { GmailSearchChips } from '../../../components/inbox/GmailSearchChips';
import { folderSegmentBadge, loadMailboxLabelCounts } from '../../../lib/gmail-label-counts';

const FOLDERS: { key: GmailFolder; label: string }[] = [
  { key: 'inbox', label: 'Inbox' },
  { key: 'sent', label: 'Sent' },
  { key: 'drafts', label: 'Drafts' },
];

type CategoryKey = 'primary' | 'promotions' | 'social' | 'updates' | 'forums';

const CATEGORIES: { key: CategoryKey; label: string }[] = [
  { key: 'primary', label: 'Primary' },
  { key: 'promotions', label: 'Promotions' },
  { key: 'social', label: 'Social' },
  { key: 'updates', label: 'Updates' },
  { key: 'forums', label: 'Forums' },
];

type FilterChipItem =
  | { kind: 'category'; key: CategoryKey; label: string }
  | { kind: 'divider' }
  | { kind: 'label'; id: string; name: string };

const PAGE_SIZE = 15;

export default function InboxScreen() {
  const router = useRouter();
  const { openDrawer } = useDrawer();
  const { session, user } = useAuth();
  const userId = user?.id ?? '';
  const insets = useSafeAreaInsets();
  const searchRef = useRef<TextInput>(null);
  const searchBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [folder, setFolder] = useState<GmailFolder>('inbox');
  const [threads, setThreads] = useState<GmailThreadListItem[]>([]);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [chipMenuOpen, setChipMenuOpen] = useState(false);
  const chipMenuOpenRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    chipMenuOpenRef.current = chipMenuOpen;
  }, [chipMenuOpen]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  // Labels — loaded once, used for chip rendering on rows + filtering.
  const [allLabels, setAllLabels] = useState<GmailLabel[]>([]);
  const [filterLabelId, setFilterLabelId] = useState<string | null>(null);

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

  const refreshLabelCounts = useCallback(async () => {
    if (!session) return;
    try {
      const counts = await loadMailboxLabelCounts({
        getGoogleToken: () => gmailApi.getGoogleToken(),
        folderCounts: (ids) => gmailApi.folderCounts(ids),
        extraLabelIds: allLabels.filter((l) => l.type === 'user').map((l) => l.id),
      });
      setLabelCounts(counts);
    } catch (e: unknown) {
      console.warn('[inbox] label counts failed:', (e as Error)?.message);
    }
  }, [session, allLabels]);

  useEffect(() => {
    void refreshLabelCounts();
  }, [refreshLabelCounts]);

  // Poll while this screen is focused so badges stay aligned with Gmail.
  useFocusEffect(
    useCallback(() => {
      const timer = setInterval(() => void refreshLabelCounts(), 45_000);
      return () => clearInterval(timer);
    }, [refreshLabelCounts])
  );

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

  const userLabels = React.useMemo(
    () => allLabels.filter((l) => l.type === 'user'),
    [allLabels]
  );

  const filterChipItems = React.useMemo((): FilterChipItem[] => {
    if (folder === 'drafts') return [];
    const items: FilterChipItem[] = [];
    if (folder === 'inbox') {
      for (const c of CATEGORIES) {
        items.push({ kind: 'category', key: c.key, label: c.label });
      }
    }
    if (userLabels.length > 0) {
      if (items.length > 0) items.push({ kind: 'divider' });
      for (const l of userLabels) {
        items.push({ kind: 'label', id: l.id, name: labelDisplayName(l) });
      }
    }
    return items;
  }, [folder, userLabels]);

  const activeFilterName = React.useMemo(() => {
    if (filterLabelId) return labelsById.get(filterLabelId)?.name ?? 'Label';
    if (folder === 'inbox') {
      return CATEGORIES.find((c) => c.key === category)?.label ?? 'Primary';
    }
    return null;
  }, [filterLabelId, folder, category, labelsById]);

  function selectFolder(next: GmailFolder) {
    setFolder(next);
    if (next === 'drafts') setFilterLabelId(null);
  }

  function selectCategory(key: CategoryKey) {
    setFilterLabelId(null);
    setCategory(key);
  }

  function selectLabel(id: string) {
    setFilterLabelId((cur) => (cur === id ? null : id));
  }

  function clearLabelFilter() {
    setFilterLabelId(null);
  }

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

  const inboxCacheKey = useCallback(
    () => `inbox:${userId}:${folder}:${debouncedSearch}:${effectiveLabelId ?? ''}`,
    [userId, folder, debouncedSearch, effectiveLabelId]
  );

  const loadFirstPage = useCallback(async (force = false) => {
    if (!userId) return;
    setError(null);
    const cacheKey = inboxCacheKey();

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
      ingestCorrespondentThreads(threads, folder);
      setNextPageToken(data.nextPageToken);
      void refreshLabelCounts();
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
  }, [userId, inboxCacheKey, applyLocalOverlays, refreshLabelCounts]);

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
        const cacheKey = inboxCacheKey();
        cacheSet(cacheKey, { threads: merged, nextPageToken: data.nextPageToken });
        ingestCorrespondentThreads(merged, folder);
        return merged;
      });
      setNextPageToken(data.nextPageToken);
    } catch (e: any) {
      console.error('[inbox] loadMore failed:', e?.message);
    } finally {
      setLoadingMore(false);
    }
  }, [inboxCacheKey, nextPageToken, loadingMore, applyLocalOverlays]);

  // Wait for the Supabase session to be restored from SecureStore before
  // firing the first API call. Without this guard the call races the session
  // restore on cold-start and the server receives an unauthenticated request,
  // returning "Not signed in" even though the user is logged in.
  useEffect(() => {
    if (!session || !userId) return;
    setLoading(true);
    setThreads([]);
    setNextPageToken(undefined);
    loadFirstPage(true);
  }, [session, userId, loadFirstPage]);

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
      const cacheKey = inboxCacheKey();
      const cached = cacheGet(cacheKey);
      if (!cached) {
        loadFirstPage(true);
      } else {
        setThreads((prev) => applyLocalOverlays(prev));
      }
      void refreshLabelCounts();
    }, [inboxCacheKey, loadFirstPage, applyLocalOverlays, refreshLabelCounts])
  );

  // Prefetch thread detail on press-in (fires ~100ms before onPress on native).
  // Stores the resolved data in the session cache so the detail screen reads
  // it immediately instead of waiting for a fresh network round-trip.
  function prefetchThread(threadId: string) {
    if (!userId) return;
    const key = `thread:${userId}:${threadId}`;
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
    prefetchThread(thread.id);
    markLocallyRead(thread.id);
    setThreads((prev) => prev.map((t) => (t.id === thread.id ? { ...t, unread: false } : t)));
    void refreshLabelCounts();
    router.push({
      pathname: '/(workspace)/inbox/[id]',
      params: {
        id: thread.id,
        previewSubject: thread.subject ?? '',
        previewFrom: thread.from ?? '',
      },
    } as any);
    // Mark read in Gmail after navigation — don't block opening the thread.
    setTimeout(() => {
      gmailApi.getGoogleToken()
        .then(({ accessToken }) => markThreadReadDirectly(accessToken, thread.id))
        .catch((e) => console.warn('[inbox] mark-read failed:', e?.message));
    }, 0);
  }

  const headerTitle = 'Inbox';
  const inSearchMode =
    searchFocused || chipMenuOpen || search.length > 0 || debouncedSearch.length > 0;
  const showFilterChips = !inSearchMode && filterChipItems.length > 0;

  return (
    <View style={styles.container}>
      {/* Gmail-style app bar */}
      <View style={[styles.gmailHeader, { paddingTop: insets.top + 4 }]}>
        <TouchableOpacity onPress={openDrawer} style={styles.headerIconBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="menu" size={24} color={Gmail.text} />
        </TouchableOpacity>
        <Text style={styles.gmailHeaderTitle}>{headerTitle}</Text>
      </View>

      <Pressable style={styles.searchPill} onPress={() => searchRef.current?.focus()}>
        <Ionicons name="search" size={20} color={Gmail.textSecondary} />
        <TextInput
          ref={searchRef}
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search in mail"
          placeholderTextColor={Gmail.textMuted}
          returnKeyType="search"
          onFocus={() => {
            if (searchBlurTimer.current) clearTimeout(searchBlurTimer.current);
            setSearchFocused(true);
          }}
          onBlur={() => {
            searchBlurTimer.current = setTimeout(() => {
              if (!chipMenuOpenRef.current) setSearchFocused(false);
            }, 250);
          }}
        />
        {search.length > 0 && (
          <TouchableOpacity
            onPress={() => {
              setSearch('');
              searchRef.current?.focus();
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="close-circle" size={20} color={Gmail.textMuted} />
          </TouchableOpacity>
        )}
      </Pressable>

      <GmailSearchChips
        visible={inSearchMode}
        search={search}
        onChangeSearch={setSearch}
        userLabels={allLabels}
        folder={folder}
        threads={threads}
        inputRef={searchRef}
        onChipMenuOpenChange={(open) => {
          chipMenuOpenRef.current = open;
          setChipMenuOpen(open);
        }}
        onMenuSearchFocus={() => {
          if (searchBlurTimer.current) clearTimeout(searchBlurTimer.current);
        }}
        onDismissKeyboard={() => {
          if (searchBlurTimer.current) clearTimeout(searchBlurTimer.current);
          setSearchFocused(false);
          setChipMenuOpen(false);
        }}
      />

      {/* Mailbox + category filters (hidden while searching, like Gmail) */}
      <View style={styles.filterPanel}>
        <View style={styles.mailboxSegment}>
          {FOLDERS.map((f) => {
            const badge = folderSegmentBadge(f.key, labelCounts);
            const active = folder === f.key;
            return (
              <TouchableOpacity
                key={f.key}
                style={[styles.segment, active && styles.segmentActive]}
                onPress={() => selectFolder(f.key)}
                activeOpacity={0.8}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]} numberOfLines={1}>
                  {f.label}
                </Text>
                {badge !== null && (
                  <View style={[styles.segmentBadge, active && styles.segmentBadgeActive]}>
                    <Text style={[styles.segmentBadgeText, active && styles.segmentBadgeTextActive]}>
                      {badge}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {showFilterChips && (
          <>
            <View style={styles.filterContextRow}>
              <Text style={styles.filterContextText} numberOfLines={1}>
                {folder === 'inbox' ? 'Inbox' : 'Sent'}
                {activeFilterName ? (
                  <Text style={styles.filterContextDim}> · {activeFilterName}</Text>
                ) : null}
              </Text>
              {filterLabelId ? (
                <TouchableOpacity onPress={clearLabelFilter} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.clearFilterText}>Clear label</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <FlatList
              data={filterChipItems}
              keyExtractor={(item, i) =>
                item.kind === 'divider' ? 'div' : item.kind === 'category' ? item.key : `label-${item.id}-${i}`
              }
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterChipsContent}
              renderItem={({ item }) => {
                if (item.kind === 'divider') {
                  return <View style={styles.chipDivider} />;
                }
                if (item.kind === 'category') {
                  const active = !filterLabelId && category === item.key;
                  return (
                    <TouchableOpacity
                      onPress={() => selectCategory(item.key)}
                      style={[styles.filterChip, active && styles.filterChipActive]}
                    >
                      <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                        {item.label}
                      </Text>
                    </TouchableOpacity>
                  );
                }
                const unread = labelCounts[item.id]?.unread ?? 0;
                const active = filterLabelId === item.id;
                return (
                  <TouchableOpacity
                    onPress={() => selectLabel(item.id)}
                    style={[styles.filterChip, styles.filterChipLabel, active && styles.filterChipActive]}
                  >
                    <Ionicons
                      name="pricetag"
                      size={12}
                      color={active ? Gmail.blue : Gmail.textMuted}
                      style={{ marginRight: 4 }}
                    />
                    <Text style={[styles.filterChipText, active && styles.filterChipTextActive]} numberOfLines={1}>
                      {item.name}
                    </Text>
                    {unread > 0 && (
                      <Text style={[styles.filterChipCount, active && styles.filterChipCountActive]}>
                        {unread}
                      </Text>
                    )}
                  </TouchableOpacity>
                );
              }}
            />
          </>
        )}
      </View>

      {/* Selection action bar — Gmail-style top bar when selecting */}
      {selection.size > 0 && (
        <View style={styles.selectionBar}>
          <TouchableOpacity onPress={() => setSelection(new Set())} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Ionicons name="close" size={22} color={Gmail.text} />
          </TouchableOpacity>
          <Text style={styles.selectionText}>{selection.size} selected</Text>
          <View style={styles.selectionActions}>
            <SelectionActionBtn icon="star-outline" onPress={() => bulkAction('star')} />
            {Array.from(selection).every((id) => !threads.find((t) => t.id === id)?.unread) ? (
              <SelectionActionBtn icon="mail-unread-outline" onPress={() => bulkAction('markUnread')} />
            ) : (
              <SelectionActionBtn icon="mail-open-outline" onPress={() => bulkAction('markRead')} />
            )}
          </View>
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
              onPressIn={() => {
                if (selection.size === 0 && folder !== 'drafts') prefetchThread(item.id);
              }}
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
          contentContainerStyle={threads.length === 0 ? { flex: 1 } : { paddingBottom: 88 }}
        />
      )}

      {/* Gmail-style compose FAB */}
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 20 }]}
        onPress={() => router.push('/(workspace)/inbox/compose' as any)}
        activeOpacity={0.85}
      >
        <Ionicons name="create-outline" size={26} color={Gmail.fabIcon} />
      </TouchableOpacity>
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
  const avatarBg = avatarColorForName(fromName);
  const isUnread = Boolean(thread.unread);
  const isStarred = Boolean(thread.starred);
  const subject = thread.subject || '(no subject)';
  const previewLine = thread.snippet ? `${subject} — ${thread.snippet}` : subject;
  const chips = (thread.labelIds ?? [])
    .map((id) => labelsById.get(id))
    .filter((l): l is GmailLabel => !!l && l.type === 'user')
    .slice(0, 2);

  return (
    <TouchableOpacity
      style={[styles.threadRow, selected && styles.threadRowSelected]}
      onPressIn={onPressIn}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      activeOpacity={0.65}
    >
      <TouchableOpacity
        onPress={onLongPress}
        activeOpacity={0.7}
        hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
      >
        {selected ? (
          <View style={[styles.avatar, styles.avatarSelected]}>
            <Ionicons name="checkmark" size={20} color="#fff" />
          </View>
        ) : (
          <View style={[styles.avatar, { backgroundColor: avatarBg }]}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
        )}
      </TouchableOpacity>

      <View style={styles.threadBody}>
        <View style={styles.threadTopRow}>
          <Text style={[styles.threadFrom, isUnread && styles.textBold]} numberOfLines={1}>
            {fromName}
          </Text>
          <View style={styles.rightCluster}>
            {thread.hasAttachments && (
              <Ionicons name="attach" size={14} color={Gmail.textMuted} style={{ transform: [{ rotate: '45deg' }] }} />
            )}
            <Text style={[styles.threadDate, isUnread && styles.textBold]}>{date}</Text>
          </View>
        </View>
        <Text
          style={[styles.threadPreview, isUnread && styles.textBold]}
          numberOfLines={2}
        >
          {previewLine}
        </Text>
        {chips.length > 0 && (
          <View style={styles.threadChipsRow}>
            {chips.map((l) => (
              <LabelChip key={l.id} label={l} />
            ))}
          </View>
        )}
      </View>

      {!selectionMode && (
        <TouchableOpacity
          onPress={() => onToggleStar(!isStarred)}
          disabled={rowBusy}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={styles.starBtn}
        >
          <Ionicons
            name={isStarred ? 'star' : 'star-outline'}
            size={20}
            color={isStarred ? Gmail.star : Gmail.textMuted}
          />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Gmail.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8, backgroundColor: Gmail.bg },
  gmailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 4,
    paddingBottom: 4,
    backgroundColor: Gmail.bg,
  },
  gmailHeaderTitle: {
    flex: 1,
    fontSize: 22,
    fontWeight: '400',
    color: Gmail.text,
    marginLeft: 4,
  },
  headerIconBtn: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Gmail.searchBg,
    borderRadius: 28,
  },
  searchInput: { flex: 1, fontSize: 16, color: Gmail.text, padding: 0 },
  filterPanel: {
    backgroundColor: Gmail.bg,
    borderBottomWidth: 1,
    borderBottomColor: Gmail.border,
    paddingBottom: 10,
  },
  mailboxSegment: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 10,
    padding: 4,
    backgroundColor: Gmail.bgMuted,
    borderRadius: 12,
    gap: 4,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  segmentActive: {
    backgroundColor: Gmail.bg,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  segmentText: { fontSize: 14, fontWeight: '500', color: Gmail.textSecondary },
  segmentTextActive: { color: Gmail.text, fontWeight: '600' },
  segmentBadge: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: Gmail.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segmentBadgeActive: { backgroundColor: Gmail.red },
  segmentBadgeText: { fontSize: 11, fontWeight: '700', color: Gmail.textSecondary },
  segmentBadgeTextActive: { color: '#fff' },
  filterContextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginBottom: 8,
    gap: 8,
  },
  filterContextText: { flex: 1, fontSize: 13, fontWeight: '600', color: Gmail.text },
  filterContextDim: { fontWeight: '500', color: Gmail.textSecondary },
  clearFilterText: { fontSize: 13, fontWeight: '600', color: Gmail.blue },
  filterChipsContent: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: 'center',
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Gmail.border,
    backgroundColor: Gmail.bg,
    maxWidth: 160,
  },
  filterChipLabel: {
    backgroundColor: Gmail.bgMuted,
  },
  filterChipActive: {
    borderColor: Gmail.blue,
    backgroundColor: Gmail.blueLight,
  },
  filterChipText: { fontSize: 13, fontWeight: '500', color: Gmail.textSecondary },
  filterChipTextActive: { color: Gmail.blue, fontWeight: '600' },
  filterChipCount: { fontSize: 11, fontWeight: '700', color: Gmail.textMuted, marginLeft: 6 },
  filterChipCountActive: { color: Gmail.blue },
  chipDivider: {
    width: 1,
    height: 24,
    backgroundColor: Gmail.border,
    marginHorizontal: 4,
  },
  threadRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: Gmail.bg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Gmail.divider,
  },
  threadRowSelected: { backgroundColor: Gmail.blueLight },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  avatarSelected: { backgroundColor: Gmail.blue },
  avatarText: { fontSize: 17, fontWeight: '500', color: '#fff' },
  threadBody: { flex: 1, gap: 4, minWidth: 0 },
  threadTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  threadFrom: { fontSize: 15, color: Gmail.text, flex: 1, fontWeight: '400' },
  threadDate: { fontSize: 13, color: Gmail.textSecondary, fontWeight: '400' },
  threadPreview: { fontSize: 14, lineHeight: 20, color: Gmail.textSecondary, fontWeight: '400' },
  textBold: { fontWeight: '700', color: Gmail.text },
  threadChipsRow: { flexDirection: 'row', gap: 4, flexWrap: 'wrap', marginTop: 2 },
  footerLoader: { paddingVertical: 16, alignItems: 'center' },
  selectionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Gmail.blueLight,
    borderBottomWidth: 1,
    borderBottomColor: Gmail.border,
  },
  selectionText: { fontSize: 16, fontWeight: '500', color: Gmail.text, flex: 1 },
  selectionActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  selectionActionBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rightCluster: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  starBtn: { paddingTop: 4, paddingLeft: 4 },
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: Gmail.fab,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  errorText: { fontSize: 14, color: Colors.error, textAlign: 'center' },
  retryBtn: { marginTop: 8, paddingHorizontal: 20, paddingVertical: 8, backgroundColor: Gmail.blue, borderRadius: 20 },
  retryText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});
