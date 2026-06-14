import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, TextInput, ActivityIndicator, Alert, Pressable, AppState, ScrollView,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format, isToday, isYesterday } from 'date-fns';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useKeyboardHeight } from '../../../hooks/useKeyboardHeight';
import EmptyState from '../../../components/EmptyState';
import { useDrawer, useMailView } from '../_layout';
import { useAuth } from '../../../hooks/useAuth';
import { gmailApi, type GmailLabel, type GmailThreadListItem } from '../../../lib/api';
import { markThreadReadDirectly } from '../../../lib/gmail-send-direct';
import { Colors } from '../../../constants/colors';
import { Gmail, avatarColorForName } from '../../../constants/gmailTheme';
import {
  buildMailListCacheKey,
  clearMailListSessionCache,
  fetchMailListPage,
  getMailListCache,
  getMailListLastMutationAt,
  invalidateMailListLabel,
  isWithinMailMutationCooldown,
  MAIL_LIST_PAGE_SIZE,
  mutateAllMailListCaches,
  setMailListCache,
  syncLabelBucketCaches,
  touchMailListMutation,
} from '../../../lib/inbox-list-prefetch';
import {
  prefetchMailThreadIntent,
  startMailListAndBodyPrefetchWarm,
} from '../../../lib/mail-thread-prefetch';
import {
  decrementSessionInboxUnread,
  mergeInboxUnread,
} from '../../../lib/inbox-unread-session';
import { getCacheWriteGeneration } from '../../../lib/session-cache-core';
import { ingestCorrespondentThreads } from '../../../lib/correspondent-rank';
import { isPendingDelete, markLocallyRead, isLocallyRead } from '../../../lib/pending-deletes';
import { LabelChip } from '../../../components/LabelChip';
import { labelDisplayName } from '../../../lib/gmail-labels';
import { GmailSearchChips } from '../../../components/inbox/GmailSearchChips';
import { loadMailboxLabelCounts } from '../../../lib/gmail-label-counts';
import {
  CATEGORIES,
  type CategoryKey,
  mailViewLabel,
  resolveMailListQuery,
  type MailViewKey,
} from '../../../lib/mail-views';

type FilterChipItem =
  | { kind: 'category'; key: CategoryKey; label: string }
  | { kind: 'divider' }
  | { kind: 'label'; id: string; name: string };

const PAGE_SIZE = MAIL_LIST_PAGE_SIZE;

export default function InboxScreen() {
  const router = useRouter();
  const { openDrawer } = useDrawer();
  const {
    mailView, setMailView,
    setLabelCounts: setContextLabelCounts,
    setUserLabels: setContextUserLabels,
    filterLabelId, setFilterLabelId: setContextFilterLabelId,
    mailInboxBackRef,
  } = useMailView();
  const { session, user } = useAuth();
  const userId = user?.id ?? '';
  const insets = useSafeAreaInsets();
  const searchRef = useRef<TextInput>(null);
  const searchBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  // filterLabelId is owned by MailViewContext so the drawer can set it too.
  const setFilterLabelId = setContextFilterLabelId;

  const [category, setCategory] = useState<CategoryKey>('primary');
  const { apiFolder, effectiveLabelId } = React.useMemo(
    () => resolveMailListQuery(mailView, category, filterLabelId),
    [mailView, category, filterLabelId]
  );

  // Multi-select via long-press. selection.size > 0 means we're in
  // "selection mode" and the top bar swaps to bulk actions.
  const [selection, setSelection] = useState<Set<string>>(new Set());
  // bulkBusy removed — actions are fire-and-forget with instant optimistic UI
  // Per-row busy (for the optimistic star toggle)
  const [rowBusy, setRowBusy] = useState<Set<string>>(new Set());

  // Label picker modal state
  const [labelPickerOpen, setLabelPickerOpen] = useState(false);

  useEffect(() => {
    mailInboxBackRef.current = () => {
      if (selection.size > 0) {
        setSelection(new Set());
        return true;
      }
      if (search.trim() || searchFocused) {
        setSearch('');
        setSearchFocused(false);
        return true;
      }
      if (chipMenuOpen) {
        setChipMenuOpen(false);
        return true;
      }
      if (labelPickerOpen) {
        setLabelPickerOpen(false);
        return true;
      }

      const onMainInbox =
        mailView === 'inbox' && !filterLabelId && category === 'primary';
      if (!onMainInbox) {
        if (filterLabelId) setFilterLabelId(null);
        if (category !== 'primary') setCategory('primary');
        if (mailView !== 'inbox') setMailView('inbox');
        return true;
      }

      return false;
    };
    return () => {
      mailInboxBackRef.current = null;
    };
  }, [
    mailInboxBackRef,
    selection,
    search,
    searchFocused,
    chipMenuOpen,
    labelPickerOpen,
    mailView,
    filterLabelId,
    category,
    setFilterLabelId,
    setMailView,
  ]);

  // Folder + label counts
  const [labelCounts, setLabelCounts] = useState<Record<string, { total: number; unread: number }>>({});

  useEffect(() => {
    gmailApi.listLabels()
      .then((r) => setAllLabels(r.labels ?? []))
      .catch(() => {});
  }, []);

  const labelCountsInFlightRef = useRef(false);
  const labelCountsLastAtRef = useRef(0);
  const LABEL_COUNTS_MIN_INTERVAL_MS = 20_000;

  const refreshLabelCounts = useCallback(async (force = false) => {
    if (!session) return;
    const now = Date.now();
    if (!force) {
      if (labelCountsInFlightRef.current) return;
      if (now - labelCountsLastAtRef.current < LABEL_COUNTS_MIN_INTERVAL_MS) return;
    }
    labelCountsInFlightRef.current = true;
    const fetchStartedAt = Date.now();
    try {
      const counts = await loadMailboxLabelCounts({
        getGoogleToken: () => gmailApi.getGoogleToken(),
        folderCounts: (ids) => gmailApi.folderCounts(ids),
        extraLabelIds: allLabels.filter((l) => l.type === 'user').map((l) => l.id),
      });

      // Drop stale response: a new mutation happened after this fetch was issued.
      if (!force && getMailListLastMutationAt() > fetchStartedAt) return;

      // During mutation cooldown: merge — never let server raise a count back up.
      if (!force && isWithinMailMutationCooldown()) {
        setLabelCounts((prev) => {
          const merged: Record<string, { total: number; unread: number }> = { ...counts };
          for (const id of Object.keys(prev)) {
            if (!merged[id]) continue;
            merged[id] = {
              total: merged[id].total,
              unread: Math.min(merged[id].unread, prev[id].unread),
            };
          }
          if (merged['INBOX']) {
            merged['INBOX'] = { ...merged['INBOX'], unread: mergeInboxUnread(merged['INBOX'].unread) };
          }
          return merged;
        });
        return;
      }

      // Outside cooldown: adopt server, still apply session inbox guard.
      const final = { ...counts };
      if (final['INBOX']) {
        final['INBOX'] = { ...final['INBOX'], unread: mergeInboxUnread(final['INBOX'].unread) };
      }
      setLabelCounts(final);
    } catch (e: unknown) {
      console.warn('[inbox] label counts failed:', (e as Error)?.message);
    } finally {
      labelCountsInFlightRef.current = false;
      labelCountsLastAtRef.current = Date.now();
    }
  }, [session, allLabels]);

  /**
   * Staggered count refresh: fires at 0 ms, 800 ms, and 2500 ms.
   * Matches Placecom web scheduleCountRefresh() — handles Gmail propagation lag
   * so badge counts converge to the correct value within ~3 seconds of any action.
   */
  const scheduleCountRefresh = useCallback(() => {
    countRefreshTimersRef.current.forEach(clearTimeout);
    countRefreshTimersRef.current = [];
    void refreshLabelCounts(true);
    countRefreshTimersRef.current.push(
      setTimeout(() => void refreshLabelCounts(true), 800)
    );
    countRefreshTimersRef.current.push(
      setTimeout(() => void refreshLabelCounts(true), 2500)
    );
  }, [refreshLabelCounts]);

  useEffect(() => {
    void refreshLabelCounts();
  }, [refreshLabelCounts]);

  // Poll while this screen is focused so badges stay aligned with Gmail.
  useFocusEffect(
    useCallback(() => {
      const timer = setInterval(() => void refreshLabelCounts(), 60_000);
      return () => clearInterval(timer);
    }, [refreshLabelCounts])
  );

  // Clear selection when the visible list changes underneath us.
  useEffect(() => { setSelection(new Set()); }, [mailView, debouncedSearch, effectiveLabelId]);

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
    const thread = threads.find((t) => t.id === threadId);
    mutateThreads((rows) => rows.map((r) => (r.id === threadId ? { ...r, starred: nextStarred } : r)));
    // Sync Starred bucket cache so navigating to Starred is instant.
    if (thread) {
      const updated = { ...thread, starred: nextStarred };
      syncLabelBucketCaches([updated], nextStarred ? ['STARRED'] : [], nextStarred ? [] : ['STARRED']);
    }
    try {
      await gmailApi.modifyThreadLabels(threadId, nextStarred ? { add: ['STARRED'] } : { remove: ['STARRED'] });
    } catch (e: any) {
      setThreads(prev);
      mutateAllMailListCaches((rows) =>
        rows.map((r) => prev.find((p) => p.id === r.id) ?? r)
      );
      invalidateMailListLabel('STARRED');
      Alert.alert('Could not update star', e?.message ?? 'Try again');
    } finally {
      setRowBusy((s) => { const n = new Set(s); n.delete(threadId); return n; });
    }
  }

  /** Instantly adjust a single label's count in local state (context synced via useEffect below). */
  const adjustLabelCount = useCallback((labelId: string, deltaTotal: number, deltaUnread: number) => {
    setLabelCounts((prev) => {
      const cur = prev[labelId] ?? { total: 0, unread: 0 };
      return {
        ...prev,
        [labelId]: {
          total: Math.max(0, cur.total + deltaTotal),
          unread: Math.max(0, cur.unread + deltaUnread),
        },
      };
    });
  }, []);

  // Keep drawer in sync — runs after each render where labelCounts changed.
  useEffect(() => {
    setContextLabelCounts(labelCounts);
  }, [labelCounts, setContextLabelCounts]);

  // Keep drawer label list in sync.
  useEffect(() => {
    setContextUserLabels(userLabels);
  }, [userLabels, setContextUserLabels]);

  function bulkAction(action: 'markRead' | 'markUnread' | 'star') {
    const ids = Array.from(selection);
    if (ids.length === 0) return;

    const prev = threads;
    const sel = new Set(selection);
    const selectedThreads = threads.filter((t) => sel.has(t.id));

    if (action === 'markRead' || action === 'markUnread') {
      mutateThreads((rows) =>
        rows.map((r) => (sel.has(r.id) ? { ...r, unread: action === 'markUnread' } : r))
      );
      const unreadSelected = selectedThreads.filter((t) => t.unread).length;
      const readSelected = selectedThreads.filter((t) => !t.unread).length;
      if (action === 'markRead' && unreadSelected > 0) {
        decrementSessionInboxUnread(unreadSelected);
        adjustLabelCount('INBOX', 0, -unreadSelected);
        selectedThreads.forEach((t) => {
          if (t.unread) (t.labelIds ?? []).forEach((lid) => adjustLabelCount(lid, 0, -1));
        });
      } else if (action === 'markUnread' && readSelected > 0) {
        adjustLabelCount('INBOX', 0, readSelected);
      }
    } else if (action === 'star') {
      const unstarred = selectedThreads.filter((t) => !t.starred);
      mutateThreads((rows) => rows.map((r) => (sel.has(r.id) ? { ...r, starred: true } : r)));
      if (unstarred.length > 0) {
        adjustLabelCount('STARRED', unstarred.length, 0);
        // Sync Starred bucket cache so it's instant when user switches to Starred view.
        syncLabelBucketCaches(
          unstarred.map((t) => ({ ...t, starred: true })),
          ['STARRED'],
          []
        );
      }
    }

    setSelection(new Set());

    const body =
      action === 'markRead'   ? { remove: ['UNREAD'] } :
      action === 'markUnread' ? { add: ['UNREAD'] }    :
                                { add: ['STARRED'] };
    gmailApi.batchModifyThreads(ids, body)
      .then(() => scheduleCountRefresh())
      .catch(() => {
        setThreads(prev);
        mutateAllMailListCaches((rows) =>
          rows.map((r) => prev.find((p) => p.id === r.id) ?? r)
        );
        if (action === 'star') invalidateMailListLabel('STARRED');
        void refreshLabelCounts();
      });
  }

  /** Apply/remove a set of user labels to all currently selected threads. */
  function bulkLabelAction(toAdd: string[], toRemove: string[]) {
    const ids = Array.from(selection);
    if (ids.length === 0 || (toAdd.length === 0 && toRemove.length === 0)) return;

    const prev = threads;
    const sel = new Set(selection);
    mutateThreads((rows) =>
      rows.map((r) => {
        if (!sel.has(r.id)) return r;
        const cur = new Set(r.labelIds ?? []);
        for (const lid of toAdd) cur.add(lid);
        for (const lid of toRemove) cur.delete(lid);
        return { ...r, labelIds: Array.from(cur) };
      })
    );

    // Instant count adjustments
    for (const lid of toAdd)    adjustLabelCount(lid, ids.length, 0);
    for (const lid of toRemove) adjustLabelCount(lid, -ids.length, 0);

    // Sync label bucket caches so switching to a label view is instant.
    const updatedSelectedThreads = threads.filter((t) => sel.has(t.id)).map((t) => {
      const cur = new Set(t.labelIds ?? []);
      for (const lid of toAdd) cur.add(lid);
      for (const lid of toRemove) cur.delete(lid);
      return { ...t, labelIds: Array.from(cur) };
    });
    syncLabelBucketCaches(updatedSelectedThreads, toAdd, toRemove);

    setSelection(new Set());
    setLabelPickerOpen(false);

    gmailApi.batchModifyThreads(ids, {
      add: toAdd.length > 0 ? toAdd : undefined,
      remove: toRemove.length > 0 ? toRemove : undefined,
    }).then(() => {
      scheduleCountRefresh();
    }).catch(() => {
      setThreads(prev);
      mutateAllMailListCaches((rows) =>
        rows.map((r) => prev.find((p) => p.id === r.id) ?? r)
      );
      [...toAdd, ...toRemove].forEach((lid) => invalidateMailListLabel(lid));
      void refreshLabelCounts();
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
    // Category tabs only on Inbox — labels live in the sidebar; other folders have no top strip.
    if (mailView !== 'inbox') return [];
    return CATEGORIES.map((c) => ({ kind: 'category' as const, key: c.key, label: c.label }));
  }, [mailView]);

  const activeFilterName = React.useMemo(() => {
    if (filterLabelId) return labelsById.get(filterLabelId)?.name ?? 'Label';
    if (mailView === 'inbox') {
      return CATEGORIES.find((c) => c.key === category)?.label ?? 'Primary';
    }
    return null;
  }, [filterLabelId, mailView, category, labelsById]);

  function selectMailView(next: MailViewKey) {
    setMailView(next);
    if (next === 'drafts') setFilterLabelId(null);
    if (next !== 'inbox') setFilterLabelId(null);
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

  const listCacheKey = buildMailListCacheKey(apiFolder, effectiveLabelId, debouncedSearch);
  const activeListCacheKey = useRef(listCacheKey);
  const loadIdRef = useRef(0);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const warmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const historyIdRef = useRef<string | null>(null);
  const dwellTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const fetchStartedAtRef = useRef(0);
  const writeGenAtFetchRef = useRef(0);
  const countRefreshTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const mutateThreads = useCallback(
    (transform: (rows: GmailThreadListItem[]) => GmailThreadListItem[]) => {
      touchMailListMutation();
      setThreads((prev) => applyLocalOverlays(transform(prev)));
      mutateAllMailListCaches((rows) => applyLocalOverlays(transform(rows)));
    },
    [applyLocalOverlays]
  );

  const loadFirstPage = useCallback(async (force = false, viewLoadId?: number) => {
    if (!userId || !session) return;
    const cacheKey = buildMailListCacheKey(apiFolder, effectiveLabelId, debouncedSearch);
    const thisLoadId = viewLoadId ?? ++loadIdRef.current;
    activeListCacheKey.current = cacheKey;
    setError(null);

    const cached = getMailListCache(cacheKey);
    const hadCache = !!cached;
    if (cached && !force) {
      setThreads(applyLocalOverlays(cached.threads));
      setNextPageToken(cached.nextPageToken);
      setLoading(false);
      if (isWithinMailMutationCooldown()) {
        setRefreshing(false);
        return;
      }
    } else if (!cached) {
      setLoading(true);
    } else if (force) {
      setLoading(false);
    }

    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    fetchStartedAtRef.current = Date.now();
    writeGenAtFetchRef.current = getCacheWriteGeneration();
    const mutationAtStart = getMailListLastMutationAt();

    try {
      const page = await fetchMailListPage(
        {
          folder: apiFolder,
          labelId: effectiveLabelId ?? undefined,
          search: debouncedSearch || undefined,
        },
        { signal: controller.signal }
      );

      if (thisLoadId !== loadIdRef.current) return;
      if (activeListCacheKey.current !== cacheKey) return;
      if (writeGenAtFetchRef.current !== getCacheWriteGeneration()) return;
      if (!force && getMailListLastMutationAt() > fetchStartedAtRef.current) return;
      if (!force && mutationAtStart !== getMailListLastMutationAt()) return;

      const threads = applyLocalOverlays(page.threads);
      setMailListCache(cacheKey, { threads, nextPageToken: page.nextPageToken });
      setThreads(threads);
      ingestCorrespondentThreads(threads, apiFolder);
      setNextPageToken(page.nextPageToken);
      void refreshLabelCounts();

      if (warmTimerRef.current) clearTimeout(warmTimerRef.current);
      warmTimerRef.current = setTimeout(() => {
        startMailListAndBodyPrefetchWarm(userId, {
          skipKeys: new Set([cacheKey]),
          listConcurrency: 3,
          bodyConcurrency: 2,
        });
      }, 400);
    } catch (e: any) {
      if (controller.signal.aborted) return;
      console.error('[inbox] load failed:', e?.message);
      if (!hadCache) {
        setError(e?.message ?? 'Failed to load emails');
        setThreads([]);
        setNextPageToken(undefined);
      }
    } finally {
      if (thisLoadId === loadIdRef.current && activeListCacheKey.current === cacheKey) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [
    userId,
    session,
    apiFolder,
    effectiveLabelId,
    debouncedSearch,
    applyLocalOverlays,
    refreshLabelCounts,
  ]);

  const loadMore = useCallback(async () => {
    if (!nextPageToken || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await gmailApi.listThreads(apiFolder, {
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
        const cacheKey = buildMailListCacheKey(apiFolder, effectiveLabelId, debouncedSearch);
        setMailListCache(cacheKey, { threads: merged, nextPageToken: data.nextPageToken });
        ingestCorrespondentThreads(merged, apiFolder);
        return merged;
      });
      setNextPageToken(data.nextPageToken);
    } catch (e: any) {
      console.error('[inbox] loadMore failed:', e?.message);
    } finally {
      setLoadingMore(false);
    }
  }, [apiFolder, effectiveLabelId, debouncedSearch, nextPageToken, loadingMore, applyLocalOverlays]);

  // Paint from session cache before first frame on folder/tab/search changes.
  useLayoutEffect(() => {
    if (!session || !userId) return;
    activeListCacheKey.current = listCacheKey;
    const loadId = ++loadIdRef.current;
    const cached = getMailListCache(listCacheKey);
    if (cached) {
      setThreads(applyLocalOverlays(cached.threads));
      setNextPageToken(cached.nextPageToken);
      setLoading(false);
      setError(null);
    } else {
      setLoading(true);
    }
    void loadFirstPage(false, loadId);
  }, [listCacheKey, session, userId, applyLocalOverlays, loadFirstPage]);

  useFocusEffect(
    useCallback(() => {
      setThreads((prev) => applyLocalOverlays(prev));
      void refreshLabelCounts();
    }, [applyLocalOverlays, refreshLabelCounts])
  );

  // Gmail History API poll + foreground refresh (bypasses mutation cooldown).
  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    const bootstrapHistory = async () => {
      try {
        const res = await gmailApi.getHistory();
        if (!cancelled && res.historyId) historyIdRef.current = res.historyId;
      } catch {
        /* non-fatal */
      }
    };
    void bootstrapHistory();

    const pollHistory = async () => {
      const since = historyIdRef.current;
      if (!since) return;
      try {
        const res = await gmailApi.getHistory(since);
        if (res.historyId) historyIdRef.current = res.historyId;
        if (res.hasChanges || res.expired) {
          scheduleCountRefresh();
          void loadFirstPage(true);
        }
      } catch {
        /* non-fatal */
      }
    };

    const interval = setInterval(() => void pollHistory(), 30_000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void pollHistory();
    });

    return () => {
      cancelled = true;
      clearInterval(interval);
      sub.remove();
    };
  }, [session, loadFirstPage, refreshLabelCounts]);

  function onThreadPressIn(threadId: string) {
    if (!userId || selection.size > 0 || mailView === 'drafts') return;
    if (dwellTimersRef.current.has(threadId)) return;
    const timer = setTimeout(() => {
      dwellTimersRef.current.delete(threadId);
      prefetchMailThreadIntent(userId, threadId);
    }, 100);
    dwellTimersRef.current.set(threadId, timer);
  }

  function onThreadPressOut(threadId: string) {
    const timer = dwellTimersRef.current.get(threadId);
    if (timer) {
      clearTimeout(timer);
      dwellTimersRef.current.delete(threadId);
    }
  }

  function openThread(thread: GmailThreadListItem) {
    // Drafts → open compose pre-filled so the user can continue editing
    if (mailView === 'drafts' && thread.draftId) {
      router.push(`/(workspace)/inbox/compose?draftId=${encodeURIComponent(thread.draftId)}` as any);
      return;
    }
    prefetchMailThreadIntent(userId, thread.id);
    markLocallyRead(thread.id);
    mutateThreads((rows) => rows.map((t) => (t.id === thread.id ? { ...t, unread: false } : t)));
    // Instant count: if the thread was unread, decrement before the server responds
    if (thread.unread) {
      decrementSessionInboxUnread(1);
      adjustLabelCount('INBOX', 0, -1);
      for (const lid of thread.labelIds ?? []) adjustLabelCount(lid, 0, -1);
    }
    scheduleCountRefresh();
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

  const inSearchMode =
    searchFocused || chipMenuOpen || search.length > 0 || debouncedSearch.length > 0;
  const headerTitle = inSearchMode ? 'Search mail' : mailViewLabel(mailView);
  const showFilterChips = !inSearchMode && mailView === 'inbox' && filterChipItems.length > 0;

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
        folder={apiFolder}
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

      {/* Category / label tab strip — shown below search bar when in inbox, like Gmail */}
      {!inSearchMode && showFilterChips && (
        <View style={styles.filterPanel}>
          {filterLabelId && (
            <View style={styles.filterContextRow}>
              <Text style={styles.filterContextText} numberOfLines={1}>
                <Text style={styles.filterContextDim}>Filtering by label: </Text>{activeFilterName}
              </Text>
              <TouchableOpacity onPress={clearLabelFilter} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.clearFilterText}>Clear</Text>
              </TouchableOpacity>
            </View>
          )}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipTabRow}
            keyboardShouldPersistTaps="handled"
          >
            {filterChipItems.map((item, i) => {
              if (item.kind === 'divider') {
                return <View key={`div-${i}`} style={styles.chipDivider} />;
              }
              if (item.kind === 'category') {
                const active = !filterLabelId && category === item.key;
                return (
                  <TouchableOpacity
                    key={item.key}
                    onPress={() => selectCategory(item.key)}
                    style={[styles.chipTab, active && styles.chipTabActive]}
                  >
                    <Text style={[styles.chipTabText, active && styles.chipTabTextActive]}>
                      {item.label}
                    </Text>
                    {active && <View style={styles.chipTabIndicator} />}
                  </TouchableOpacity>
                );
              }
              const unread = labelCounts[item.id]?.unread ?? 0;
              const active = filterLabelId === item.id;
              return (
                <TouchableOpacity
                  key={`${item.id}-${i}`}
                  onPress={() => selectLabel(item.id)}
                  style={[styles.chipTab, active && styles.chipTabActive]}
                >
                  <Ionicons name="pricetag" size={11} color={active ? Gmail.blue : Gmail.textMuted} style={{ marginRight: 3 }} />
                  <Text style={[styles.chipTabText, active && styles.chipTabTextActive]} numberOfLines={1}>
                    {item.name}
                  </Text>
                  {unread > 0 && (
                    <Text style={[styles.filterChipCount, active && styles.filterChipCountActive]}>
                      {unread}
                    </Text>
                  )}
                  {active && <View style={styles.chipTabIndicator} />}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Selection action bar — Gmail-style top bar when selecting */}
      {selection.size > 0 && (
        <View style={styles.selectionBar}>
          <TouchableOpacity onPress={() => setSelection(new Set())} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Ionicons name="close" size={22} color={Gmail.text} />
          </TouchableOpacity>
          <Text style={styles.selectionText}>{selection.size} selected</Text>
          <View style={styles.selectionActions}>
            <SelectionActionBtn icon="star-outline" onPress={() => bulkAction('star')} />
            {userLabels.length > 0 && (
              <SelectionActionBtn icon="pricetag-outline" onPress={() => setLabelPickerOpen(true)} />
            )}
            {Array.from(selection).every((id) => !threads.find((t) => t.id === id)?.unread) ? (
              <SelectionActionBtn icon="mail-unread-outline" onPress={() => bulkAction('markUnread')} />
            ) : (
              <SelectionActionBtn icon="mail-open-outline" onPress={() => bulkAction('markRead')} />
            )}
          </View>
        </View>
      )}

      {/* Label picker modal */}
      {labelPickerOpen && (
        <LabelPickerModal
          labels={userLabels}
          selectedThreads={threads.filter((t) => selection.has(t.id))}
          onApply={bulkLabelAction}
          onClose={() => setLabelPickerOpen(false)}
          onLabelCreated={(label) => {
            // Instantly add to sidebar — background refresh will fill in any missing fields.
            setAllLabels((prev) => {
              if (prev.some((l) => l.id === label.id)) return prev;
              return [...prev, label];
            });
            void gmailApi.listLabels()
              .then((r) => setAllLabels(r.labels ?? []))
              .catch(() => {});
          }}
        />
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
              onPressIn={() => onThreadPressIn(item.id)}
              onPressOut={() => onThreadPressOut(item.id)}
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
              onRefresh={() => {
                setRefreshing(true);
                clearMailListSessionCache();
                void loadFirstPage(true);
                startMailListAndBodyPrefetchWarm(userId, {
                  skipKeys: new Set([listCacheKey]),
                  listConcurrency: 3,
                  bodyConcurrency: 2,
                  force: true,
                });
              }}
              tintColor={Colors.primary}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="mail-outline"
              title={debouncedSearch ? 'No matches' : 'No emails'}
              subtitle={debouncedSearch ? 'Try a different search' : `${mailViewLabel(mailView)} is empty`}
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

/** Gmail-style label picker bottom sheet for bulk labeling. */
function LabelPickerModal({
  labels,
  selectedThreads,
  onApply,
  onClose,
  onLabelCreated,
}: {
  labels: GmailLabel[];
  selectedThreads: GmailThreadListItem[];
  onApply: (toAdd: string[], toRemove: string[]) => void;
  onClose: () => void;
  onLabelCreated?: (label: GmailLabel) => void;
}) {
  const kbHeight = useKeyboardHeight();
  // Compute initial state: a label is "on" if ALL selected threads have it,
  // "mixed" if some do, "off" if none do.
  const initialChecked = React.useMemo(() => {
    const m = new Map<string, boolean | 'mixed'>();
    for (const l of labels) {
      const count = selectedThreads.filter((t) => (t.labelIds ?? []).includes(l.id)).length;
      m.set(l.id, count === 0 ? false : count === selectedThreads.length ? true : 'mixed');
    }
    return m;
  }, [labels, selectedThreads]);

  const [checked, setChecked] = useState<Map<string, boolean | 'mixed'>>(initialChecked);
  const [newLabelText, setNewLabelText] = useState('');
  const [creating, setCreating] = useState(false);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Map(prev);
      const cur = next.get(id);
      // mixed → true, true → false, false → true
      next.set(id, cur === false ? true : false);
      return next;
    });
  }

  function apply() {
    const toAdd: string[] = [];
    const toRemove: string[] = [];
    for (const l of labels) {
      const next = checked.get(l.id);
      const orig = initialChecked.get(l.id);
      if (next === true && orig !== true) toAdd.push(l.id);
      if (next === false && orig !== false) toRemove.push(l.id);
    }
    onApply(toAdd, toRemove);
  }

  async function createAndApply() {
    const name = newLabelText.trim();
    if (!name) return;
    setCreating(true);
    try {
      const res = await gmailApi.createLabel(name);
      const newLabel = res.label;
      setChecked((prev) => new Map(prev).set(newLabel.id, true));
      setNewLabelText('');
      // Add new label to sidebar immediately.
      onLabelCreated?.(newLabel);
      // Apply all checked labels (including the new one).
      const toAdd: string[] = [newLabel.id];
      const toRemove: string[] = [];
      for (const l of labels) {
        const next = checked.get(l.id);
        const orig = initialChecked.get(l.id);
        if (next === true && orig !== true) toAdd.push(l.id);
        if (next === false && orig !== false) toRemove.push(l.id);
      }
      onApply(toAdd, toRemove);
    } catch (e: any) {
      Alert.alert('Could not create label', e?.message ?? 'Try again');
    } finally {
      setCreating(false);
    }
  }

  return (
    <View style={styles.pickerOverlay}>
      <TouchableOpacity style={StyleSheet.absoluteFillObject} onPress={onClose} activeOpacity={1} />
      <View style={[styles.pickerSheet, kbHeight > 0 && { paddingBottom: kbHeight + 8 }]}>
        <View style={styles.pickerHeader}>
          <Text style={styles.pickerTitle}>Label as</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close" size={22} color={Gmail.textSecondary} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.pickerList} keyboardShouldPersistTaps="handled">
          {labels.map((l) => {
            const state = checked.get(l.id);
            const isOn = state === true;
            const isMixed = state === 'mixed';
            return (
              <TouchableOpacity key={l.id} style={styles.pickerRow} onPress={() => toggle(l.id)} activeOpacity={0.7}>
                <View style={[styles.pickerCheckbox, (isOn || isMixed) && styles.pickerCheckboxOn]}>
                  {isOn && <Ionicons name="checkmark" size={14} color="#fff" />}
                  {isMixed && <View style={styles.pickerCheckboxMixed} />}
                </View>
                <Text style={styles.pickerLabel} numberOfLines={1}>{labelDisplayName(l)}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Create new label */}
        <View style={styles.pickerCreateRow}>
          <TextInput
            style={styles.pickerCreateInput}
            value={newLabelText}
            onChangeText={setNewLabelText}
            placeholder="New label name"
            placeholderTextColor={Gmail.textMuted}
            returnKeyType="done"
            onSubmitEditing={createAndApply}
          />
          <TouchableOpacity
            onPress={createAndApply}
            disabled={!newLabelText.trim() || creating}
            style={[styles.pickerCreateBtn, (!newLabelText.trim() || creating) && { opacity: 0.4 }]}
          >
            {creating
              ? <ActivityIndicator size="small" color="#fff" />
              : <Text style={styles.pickerCreateBtnText}>Create</Text>}
          </TouchableOpacity>
        </View>

        <View style={styles.pickerFooter}>
          <TouchableOpacity onPress={onClose} style={styles.pickerCancelBtn}>
            <Text style={styles.pickerCancelText}>Cancel</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={apply} style={styles.pickerApplyBtn}>
            <Text style={styles.pickerApplyText}>Apply</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
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

function threadListPreviewLine(subject: string | undefined, snippet: string | undefined): string {
  const subj = subject?.trim() || '(no subject)';
  const snip = snippet?.trim();
  if (!snip || snip === subj) return subj;
  return `${subj} — ${snip}`;
}

function ThreadRow({
  thread,
  labelsById,
  selected,
  selectionMode,
  rowBusy,
  onPressIn,
  onPressOut,
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
  onPressOut?: () => void;
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
  const previewLine = threadListPreviewLine(thread.subject, thread.snippet);
  const chips = (thread.labelIds ?? [])
    .map((id) => labelsById.get(id))
    .filter((l): l is GmailLabel => !!l && l.type === 'user')
    .slice(0, 2);

  return (
    <TouchableOpacity
      style={[styles.threadRow, selected && styles.threadRowSelected]}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
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
  },
  // Fixed tab bar (row) — equal-width tabs, no scroll
  folderTabBar: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Gmail.border,
  },
  folderTabBarSecondary: {
    backgroundColor: Gmail.bgMuted,
  },
  folderTab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    gap: 3,
    position: 'relative',
  },
  folderTabActive: {
    backgroundColor: Gmail.blueLight,
  },
  folderTabText: {
    fontSize: 11,
    fontWeight: '500',
    color: Gmail.textSecondary,
    textAlign: 'center',
  },
  folderTabTextSmall: {
    fontSize: 10,
  },
  folderTabTextActive: {
    color: Gmail.blue,
    fontWeight: '700',
  },
  folderTabBadge: {
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: Gmail.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderTabBadgeActive: { backgroundColor: Gmail.red },
  folderTabBadgeText: { fontSize: 9, fontWeight: '700', color: Gmail.textSecondary },
  folderTabBadgeTextActive: { color: '#fff' },
  folderTabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 8,
    right: 8,
    height: 3,
    borderRadius: 2,
    backgroundColor: Gmail.blue,
  },
  // Gmail-style underline category/label tabs
  chipTabRow: {
    paddingHorizontal: 8,
    alignItems: 'flex-end',
  },
  chipTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    position: 'relative',
    gap: 3,
  },
  chipTabActive: {},
  chipTabText: { fontSize: 13, fontWeight: '500', color: Gmail.textSecondary },
  chipTabTextActive: { color: Gmail.blue, fontWeight: '700' },
  chipTabIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 6,
    right: 6,
    height: 3,
    borderRadius: 2,
    backgroundColor: Gmail.blue,
  },
  filterContextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 6,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Gmail.border,
  },
  filterContextText: { flex: 1, fontSize: 12, fontWeight: '400', color: Gmail.textSecondary },
  filterContextDim: { fontWeight: '500', color: Gmail.textSecondary },
  clearFilterText: { fontSize: 12, fontWeight: '600', color: Gmail.blue },
  filterChipCount: { fontSize: 11, fontWeight: '700', color: Gmail.textMuted, marginLeft: 4 },
  filterChipCountActive: { color: Gmail.blue },
  chipDivider: {
    width: 1,
    height: 20,
    backgroundColor: Gmail.border,
    marginHorizontal: 4,
    alignSelf: 'center',
  },
  // Label picker modal
  pickerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
    zIndex: 100,
  },
  pickerSheet: {
    backgroundColor: Gmail.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '70%',
    paddingBottom: 24,
  },
  pickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Gmail.border,
  },
  pickerTitle: { fontSize: 17, fontWeight: '600', color: Gmail.text },
  pickerList: { maxHeight: 320 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Gmail.divider,
  },
  pickerCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: Gmail.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerCheckboxOn: {
    backgroundColor: Gmail.blue,
    borderColor: Gmail.blue,
  },
  pickerCheckboxMixed: {
    width: 10,
    height: 2,
    backgroundColor: Gmail.blue,
    borderRadius: 1,
  },
  pickerLabel: { flex: 1, fontSize: 15, color: Gmail.text },
  pickerCreateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Gmail.border,
  },
  pickerCreateInput: {
    flex: 1,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Gmail.border,
    paddingHorizontal: 12,
    fontSize: 14,
    color: Gmail.text,
    backgroundColor: Gmail.bgMuted,
  },
  pickerCreateBtn: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: Gmail.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickerCreateBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  pickerFooter: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  pickerCancelBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Gmail.border,
  },
  pickerCancelText: { fontSize: 14, fontWeight: '600', color: Gmail.textSecondary },
  pickerApplyBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: Gmail.blue,
  },
  pickerApplyText: { fontSize: 14, fontWeight: '600', color: '#fff' },
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
