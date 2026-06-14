import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
  TextInput,
  Pressable,
  ScrollView,
  BackHandler,
} from 'react-native';
import { useFocusEffect, useNavigation } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import EmptyState from '../../../components/EmptyState';
import { useDrawer } from '../_layout';
import { driveApi } from '../../../lib/api';
import { fetchDriveFileToCache } from '../../../lib/drive-download';
import { shareCachedAttachment } from '../../../lib/share-attachment';
import {
  applyDriveMoveOverrides,
  syncDriveMoveAcrossCaches,
} from '../../../lib/drive-move-session-sync';
import { applyDriveStarOverrides } from '../../../lib/drive-star-session-sync';
import {
  buildDriveListCacheKey,
  clearDriveListSessionCache,
  fetchDriveListPage,
  getDriveListCache,
  getDriveListMutationEpoch,
  prefetchDriveFolderChildren,
  setDriveListCache,
  startDriveListPrefetchWarm,
  syncDriveListCache,
  type DriveListContext,
  type DriveTabKey,
} from '../../../lib/drive-list-prefetch';
import { getCacheWriteGeneration } from '../../../lib/session-cache-core';
import { sortDriveFiles, type DriveSortKey, isDriveFolder } from '../../../lib/drive-utils';
import type { DriveFile } from '../../../lib/types';
import { DriveTheme } from '../../../constants/driveTheme';
import { DriveListRow } from '../../../components/drive/DriveListRow';
import { DriveGridTile } from '../../../components/drive/DriveGridTile';
import { DriveListSkeleton, DriveGridSkeleton } from '../../../components/drive/DriveSkeleton';
import { DrivePreviewModal } from '../../../components/drive/DrivePreviewModal';
import { DriveActionSheet } from '../../../components/drive/DriveActionSheet';
import { DriveMoveSheet } from '../../../components/drive/DriveMoveSheet';
import { normalizeUploadFilename } from '../../../lib/filename-utils';
import { DriveCreateSheet } from '../../../components/drive/DriveCreateSheet';

type LayoutMode = 'list' | 'grid';
const TABS: { key: DriveTabKey; label: string; view: DriveListContext['view'] }[] = [
  { key: 'my-drive', label: 'My Drive', view: 'folder' },
  { key: 'starred', label: 'Starred', view: 'starred' },
  { key: 'recent', label: 'Recent', view: 'recent' },
  { key: 'shared', label: 'Shared', view: 'shared' },
];

const SORT_OPTIONS: { key: DriveSortKey; label: string }[] = [
  { key: 'modified', label: 'Last modified' },
  { key: 'name', label: 'Name' },
  { key: 'size', label: 'Size' },
];

function applyDriveDisplayOverrides(files: DriveFile[]): DriveFile[] {
  return applyDriveStarOverrides(applyDriveMoveOverrides(files));
}

export default function DriveScreen() {
  const { openDrawer } = useDrawer();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folderStack, setFolderStack] = useState<{ id: string; name: string }[]>([]);
  const [tab, setTab] = useState<DriveTabKey>('my-drive');
  const [layout, setLayout] = useState<LayoutMode>('list');
  const [sortBy, setSortBy] = useState<DriveSortKey>('modified');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);
  const [fileActionLoading, setFileActionLoading] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewFile, setPreviewFile] = useState<DriveFile | null>(null);
  const [actionFile, setActionFile] = useState<DriveFile | null>(null);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [moveFile, setMoveFile] = useState<DriveFile | null>(null);

  const currentFolderId = folderStack.length > 0 ? folderStack[folderStack.length - 1].id : undefined;
  const activeTab = TABS.find((t) => t.key === tab)!;
  const inFolderBrowse = !debouncedSearch && (tab === 'my-drive' || folderStack.length > 0);

  const listContext = useMemo((): DriveListContext => ({
    view: activeTab.view,
    tab,
    parentId: currentFolderId,
    search: debouncedSearch || undefined,
    pathDepth: folderStack.length,
  }), [activeTab.view, tab, currentFolderId, debouncedSearch, folderStack.length]);

  const listCacheKey = buildDriveListCacheKey(listContext);
  const activeListCacheKey = useRef(listCacheKey);
  const loadIdRef = useRef(0);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const warmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchStartedAtRef = useRef(0);
  const epochAtFetchRef = useRef(0);
  const writeGenAtFetchRef = useRef(0);
  const prefetchedFoldersRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => clearTimeout(t);
  }, [search]);

  const sortedFiles = useMemo(() => sortDriveFiles(files, sortBy), [files, sortBy]);

  const loadFiles = useCallback(async (force = false, viewLoadId?: number) => {
    const cacheKey = buildDriveListCacheKey(listContext);
    const thisLoadId = viewLoadId ?? ++loadIdRef.current;
    activeListCacheKey.current = cacheKey;
    setError(null);

    const cached = getDriveListCache(cacheKey);
    const hadCache = !!cached;
    if (cached && !force) {
      setFiles(applyDriveDisplayOverrides(cached.files));
      setNextPageToken(cached.nextPageToken);
      setLoading(false);
    } else if (!cached) {
      setLoading(true);
    }

    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;
    fetchStartedAtRef.current = Date.now();
    epochAtFetchRef.current = getDriveListMutationEpoch();
    writeGenAtFetchRef.current = getCacheWriteGeneration();

    try {
      const page = await fetchDriveListPage(listContext, {
        pageSize: 30,
        signal: controller.signal,
        skipCache: force,
      });

      if (thisLoadId !== loadIdRef.current) return;
      if (activeListCacheKey.current !== cacheKey) return;
      if (epochAtFetchRef.current !== getDriveListMutationEpoch()) return;
      if (writeGenAtFetchRef.current !== getCacheWriteGeneration()) return;

      const displayFiles = applyDriveDisplayOverrides(page.files);
      setDriveListCache(cacheKey, { files: displayFiles, nextPageToken: page.nextPageToken });
      setFiles(displayFiles);
      setNextPageToken(page.nextPageToken);

      if (warmTimerRef.current) clearTimeout(warmTimerRef.current);
      warmTimerRef.current = setTimeout(() => {
        startDriveListPrefetchWarm({ skipKeys: new Set([cacheKey]), concurrency: 2 });
      }, 400);
    } catch (e: any) {
      if (controller.signal.aborted) return;
      console.error('[drive] load failed:', e?.message);
      if (!hadCache) {
        setError(e?.message ?? 'Failed to load Drive');
        setFiles([]);
        setNextPageToken(undefined);
      }
    } finally {
      if (thisLoadId === loadIdRef.current && activeListCacheKey.current === cacheKey) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [listContext]);

  useLayoutEffect(() => {
    activeListCacheKey.current = listCacheKey;
    const loadId = ++loadIdRef.current;
    const cached = getDriveListCache(listCacheKey);
    if (cached) {
      setFiles(applyDriveDisplayOverrides(cached.files));
      setNextPageToken(cached.nextPageToken);
      setLoading(false);
      setError(null);
    } else {
      setLoading(true);
    }
    void loadFiles(false, loadId);
  }, [listCacheKey, loadFiles]);

  useEffect(() => {
    if (loading || debouncedSearch) return;
    const folders = sortedFiles.filter(isDriveFolder).slice(0, 8);
    for (const folder of folders) {
      if (prefetchedFoldersRef.current.has(folder.id)) continue;
      prefetchedFoldersRef.current.add(folder.id);
      prefetchDriveFolderChildren(folder.id, tab, folderStack.length);
    }
  }, [loading, sortedFiles, debouncedSearch, tab, folderStack.length]);

  async function loadMore() {
    if (!nextPageToken || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchDriveListPage(listContext, {
        pageToken: nextPageToken,
        pageSize: 50,
        skipCache: true,
      });
      setFiles((prev) => {
        const ids = new Set(prev.map((f) => f.id));
        const merged = [...prev, ...applyDriveDisplayOverrides(page.files).filter((f) => !ids.has(f.id))];
        syncDriveListCache(listCacheKey, (cur) => ({
          files: merged,
          nextPageToken: page.nextPageToken ?? cur?.nextPageToken,
        }));
        return merged;
      });
      setNextPageToken(page.nextPageToken);
    } catch {
      /* ignore */
    } finally {
      setLoadingMore(false);
    }
  }

  function selectTab(next: DriveTabKey) {
    setTab(next);
    setFolderStack([]);
    setSearch('');
    setSortMenuOpen(false);
  }

  function navigateToFolder(file: DriveFile) {
    prefetchDriveFolderChildren(file.id, tab, folderStack.length);
    setFolderStack((prev) => [...prev, { id: file.id, name: file.name }]);
    setSearch('');
  }

  function onFolderPressIn(file: DriveFile) {
    if (!isDriveFolder(file)) return;
    prefetchDriveFolderChildren(file.id, tab, folderStack.length);
  }

  function navigateToBreadcrumb(index: number) {
    if (index < 0) {
      setFolderStack([]);
    } else {
      setFolderStack((prev) => prev.slice(0, index + 1));
    }
    setSearch('');
  }

  function popFolderLevel() {
    setFolderStack((prev) => (prev.length > 0 ? prev.slice(0, -1) : prev));
    setSearch('');
  }

  /** Consume back gesture / hardware back one level (folder, sheet, preview) before leaving Drive. */
  const goBackOneStep = useCallback(() => {
    if (previewOpen) {
      setPreviewOpen(false);
      setPreviewFile(null);
      return true;
    }
    if (moveFile) {
      setMoveFile(null);
      return true;
    }
    if (actionFile) {
      setActionFile(null);
      return true;
    }
    if (createMenuOpen) {
      setCreateMenuOpen(false);
      return true;
    }
    if (sortMenuOpen) {
      setSortMenuOpen(false);
      return true;
    }
    if (searchExpanded) {
      setSearchExpanded(false);
      if (search) setSearch('');
      return true;
    }
    if (folderStack.length > 0) {
      popFolderLevel();
      return true;
    }
    return false;
  }, [
    previewOpen,
    moveFile,
    actionFile,
    createMenuOpen,
    sortMenuOpen,
    searchExpanded,
    search,
    folderStack.length,
  ]);

  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => goBackOneStep());
      return () => sub.remove();
    }, [goBackOneStep])
  );

  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (goBackOneStep()) {
        e.preventDefault();
      }
    });
    return unsubscribe;
  }, [navigation, goBackOneStep]);

  function openFile(file: DriveFile) {
    if (isDriveFolder(file)) {
      navigateToFolder(file);
      return;
    }
    setPreviewFile(file);
    setPreviewOpen(true);
  }

  async function downloadFile(file: DriveFile) {
    setFileActionLoading(file.id);
    try {
      const localUri = await fetchDriveFileToCache(file.id, file.name, 'download', file.mimeType);
      await shareCachedAttachment(localUri, file.name, file.mimeType);
    } catch (e: any) {
      Alert.alert('Download failed', e?.message ?? 'Could not download');
    } finally {
      setFileActionLoading(null);
    }
  }

  async function uploadAssets(assets: { uri: string; name: string; mimeType?: string | null }[]) {
    if (assets.length === 0) return;
    setUploading(true);
    try {
      for (const asset of assets) {
        await driveApi.uploadFile({
          uri: asset.uri,
          name: normalizeUploadFilename(asset.name),
          mimeType: asset.mimeType ?? 'application/octet-stream',
          parent: currentFolderId && tab === 'my-drive' ? currentFolderId : undefined,
        });
      }
      await loadFiles();
    } catch (e: any) {
      Alert.alert('Upload failed', e?.message ?? 'Try again');
    } finally {
      setUploading(false);
    }
  }

  async function pickAndUploadFiles(multiple: boolean) {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
      multiple,
    });
    if (result.canceled) return;
    await uploadAssets(result.assets);
  }

  async function createFolder(name: string) {
    if (tab !== 'my-drive') {
      Alert.alert('My Drive only', 'Switch to My Drive to create folders.');
      return;
    }
    setUploading(true);
    try {
      await driveApi.createFolder(name, currentFolderId);
      await loadFiles();
    } catch (e: any) {
      Alert.alert('Could not create folder', e?.message ?? 'Try again');
    } finally {
      setUploading(false);
    }
  }

  const breadcrumbItems = useMemo(() => {
    const rootLabel =
      tab === 'starred' ? 'Starred' : tab === 'shared' ? 'Shared' : tab === 'recent' ? 'Recent' : 'My Drive';
    const items: { label: string; index: number }[] = [{ label: rootLabel, index: -1 }];
    folderStack.forEach((f, i) => items.push({ label: f.name, index: i }));
    return items;
  }, [folderStack, tab]);

  const emptySubtitle = debouncedSearch
    ? 'Try a different search term'
    : tab === 'starred'
      ? 'Star files in Google Drive to see them here'
      : tab === 'shared'
        ? 'Files shared with you (same as Google Drive “Shared with me”)'
        : tab === 'recent'
          ? 'Recently modified files will show here'
          : 'Upload files with the + button';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header — Gmail / Drive style */}
      <View style={styles.header}>
        {folderStack.length > 0 ? (
          <TouchableOpacity
            onPress={popFolderLevel}
            style={styles.headerBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="arrow-back" size={24} color={DriveTheme.text} />
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={openDrawer} style={styles.headerBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="menu" size={24} color={DriveTheme.text} />
          </TouchableOpacity>
        )}
        <Text style={styles.headerTitle} numberOfLines={1}>
          {folderStack.length > 0 ? folderStack[folderStack.length - 1].name : 'Drive'}
        </Text>
        <TouchableOpacity
          onPress={() => setSearchExpanded((v) => !v)}
          style={styles.headerBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name={searchExpanded ? 'close' : 'search'} size={24} color={DriveTheme.text} />
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => setLayout((m) => (m === 'list' ? 'grid' : 'list'))}
          style={styles.headerBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons
            name={layout === 'list' ? 'grid-outline' : 'list-outline'}
            size={24}
            color={DriveTheme.text}
          />
        </TouchableOpacity>
      </View>

      {searchExpanded && (
        <View style={styles.searchPill}>
          <Ionicons name="search" size={20} color={DriveTheme.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search in Drive"
            placeholderTextColor={DriveTheme.textMuted}
            returnKeyType="search"
            autoCorrect={false}
            autoCapitalize="none"
            autoFocus
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={20} color={DriveTheme.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Location tabs */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabsScroll}
        contentContainerStyle={styles.tabsContent}
      >
        {TABS.map((item) => {
          const active = tab === item.key;
          return (
            <TouchableOpacity
              key={item.key}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => selectTab(item.key)}
              activeOpacity={0.8}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{item.label}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {debouncedSearch ? (
        <View style={styles.searchBanner}>
          <Ionicons name="search" size={14} color={DriveTheme.textSecondary} />
          <Text style={styles.searchBannerText} numberOfLines={1}>
            Results for <Text style={styles.searchTerm}>&ldquo;{debouncedSearch}&rdquo;</Text>
          </Text>
        </View>
      ) : null}

      {inFolderBrowse && folderStack.length > 0 && (
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={breadcrumbItems}
          keyExtractor={(_, i) => `bc-${i}`}
          style={styles.breadcrumbList}
          contentContainerStyle={styles.breadcrumbContent}
          renderItem={({ item, index }) => {
            const isLast = index === breadcrumbItems.length - 1;
            return (
              <View style={styles.breadcrumbItem}>
                {index > 0 && (
                  <Ionicons name="chevron-forward" size={14} color={DriveTheme.textMuted} style={{ marginRight: 4 }} />
                )}
                <TouchableOpacity
                  onPress={() => navigateToBreadcrumb(item.index)}
                  disabled={isLast}
                >
                  <Text
                    style={[styles.breadcrumbText, isLast && styles.breadcrumbTextActive]}
                    numberOfLines={1}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          }}
        />
      )}

      {/* Sort row */}
      <View style={styles.sortRow}>
        <Pressable style={styles.sortBtn} onPress={() => setSortMenuOpen((v) => !v)}>
          <Text style={styles.sortLabel}>
            {SORT_OPTIONS.find((s) => s.key === sortBy)?.label ?? 'Sort'}
          </Text>
          <Ionicons name={sortMenuOpen ? 'chevron-up' : 'chevron-down'} size={16} color={DriveTheme.textSecondary} />
        </Pressable>
        {!loading && (
          <Text style={styles.fileCount}>
            {sortedFiles.length} item{sortedFiles.length === 1 ? '' : 's'}
          </Text>
        )}
      </View>

      {sortMenuOpen && (
        <View style={styles.sortMenu}>
          {SORT_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.key}
              style={styles.sortOption}
              onPress={() => {
                setSortBy(opt.key);
                setSortMenuOpen(false);
              }}
            >
              <Text style={[styles.sortOptionText, sortBy === opt.key && styles.sortOptionActive]}>
                {opt.label}
              </Text>
              {sortBy === opt.key && <Ionicons name="checkmark" size={18} color={DriveTheme.blue} />}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {uploading && (
        <View style={styles.uploadBanner}>
          <ActivityIndicator size="small" color={DriveTheme.blue} />
          <Text style={styles.uploadText}>Uploading…</Text>
        </View>
      )}

      {loading ? (
        <View style={layout === 'grid' ? styles.gridSkeletonWrap : undefined}>
          {[...Array(8)].map((_, i) =>
            layout === 'grid' ? <DriveGridSkeleton key={i} /> : <DriveListSkeleton key={i} />
          )}
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={40} color={DriveTheme.textMuted} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); loadFiles(); }}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          key={layout}
          data={sortedFiles}
          keyExtractor={(item) => item.id}
          numColumns={layout === 'grid' ? 2 : 1}
          columnWrapperStyle={layout === 'grid' ? styles.gridRow : undefined}
          renderItem={({ item }) =>
            layout === 'list' ? (
              <DriveListRow
                file={item}
                loading={fileActionLoading === item.id}
                onPress={() => openFile(item)}
                onPressIn={() => onFolderPressIn(item)}
                onMorePress={() => setActionFile(item)}
              />
            ) : (
              <DriveGridTile
                file={item}
                loading={fileActionLoading === item.id}
                onPress={() => openFile(item)}
                onMorePress={() => setActionFile(item)}
              />
            )
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                clearDriveListSessionCache();
                prefetchedFoldersRef.current.clear();
                void loadFiles(true);
                startDriveListPrefetchWarm({ skipKeys: new Set([listCacheKey]), concurrency: 2 });
              }}
              tintColor={DriveTheme.blue}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="folder-open-outline"
              title={debouncedSearch ? 'No results' : 'This folder is empty'}
              subtitle={emptySubtitle}
            />
          }
          onEndReached={loadMore}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footerLoader}>
                <ActivityIndicator color={DriveTheme.blue} size="small" />
              </View>
            ) : null
          }
          contentContainerStyle={[
            sortedFiles.length === 0 && styles.listEmpty,
            { paddingBottom: insets.bottom + 88 },
          ]}
          ItemSeparatorComponent={layout === 'list' ? () => <View style={styles.separator} /> : undefined}
        />
      )}

      {/* FAB — create menu (upload / new folder) */}
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 20 }]}
        onPress={() => setCreateMenuOpen(true)}
        activeOpacity={0.85}
        disabled={uploading}
      >
        <Ionicons name="add" size={28} color={DriveTheme.fabIcon} />
      </TouchableOpacity>

      <DriveCreateSheet
        visible={createMenuOpen}
        onClose={() => setCreateMenuOpen(false)}
        onUploadFiles={() => pickAndUploadFiles(false)}
        onUploadFolder={() => pickAndUploadFiles(true)}
        onCreateFolder={createFolder}
      />

      <DrivePreviewModal
        visible={previewOpen}
        file={previewFile}
        downloading={!!previewFile && fileActionLoading === previewFile.id}
        onClose={() => {
          setPreviewOpen(false);
          setPreviewFile(null);
        }}
        onDownload={() => previewFile && downloadFile(previewFile)}
      />

      <DriveActionSheet
        file={actionFile}
        visible={!!actionFile}
        onClose={() => setActionFile(null)}
        onOpen={() => actionFile && openFile(actionFile)}
        onDownload={() => actionFile && downloadFile(actionFile)}
        onCopyLink={() => actionFile && copyDriveFileLink(actionFile)}
        onShare={() => actionFile && shareDriveFileLink(actionFile)}
        onMove={() => {
          if (actionFile) {
            setMoveFile(actionFile);
            setActionFile(null);
          }
        }}
      />

      <DriveMoveSheet
        file={moveFile}
        visible={!!moveFile}
        onClose={() => setMoveFile(null)}
        onMoved={() => {
          if (moveFile) syncDriveMoveAcrossCaches(moveFile.id);
          setFiles((prev) => prev.filter((f) => f.id !== moveFile?.id));
          setMoveFile(null);
        }}
      />

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: DriveTheme.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 8,
    gap: 4,
  },
  headerBtn: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    flex: 1,
    fontSize: 22,
    fontWeight: '400',
    color: DriveTheme.text,
    letterSpacing: -0.2,
  },
  searchPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: DriveTheme.searchBg,
    borderRadius: 28,
  },
  searchInput: { flex: 1, fontSize: 16, color: DriveTheme.text, padding: 0 },
  tabsScroll: { flexGrow: 0, marginBottom: 8 },
  tabsContent: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 8,
    alignItems: 'center',
    flexDirection: 'row',
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: DriveTheme.bgMuted,
    justifyContent: 'center',
    minHeight: 40,
  },
  tabActive: { backgroundColor: DriveTheme.blueLight },
  tabText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '500',
    color: DriveTheme.textSecondary,
    includeFontPadding: false,
  },
  tabTextActive: { color: DriveTheme.blue, fontWeight: '600' },
  searchBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: DriveTheme.blueLight,
  },
  searchBannerText: { fontSize: 13, color: DriveTheme.textSecondary, flex: 1 },
  searchTerm: { fontWeight: '700', color: DriveTheme.text },
  breadcrumbList: { maxHeight: 40 },
  breadcrumbContent: { paddingHorizontal: 16, alignItems: 'center' },
  breadcrumbItem: { flexDirection: 'row', alignItems: 'center', maxWidth: 160 },
  breadcrumbText: { fontSize: 14, color: DriveTheme.blue, fontWeight: '500' },
  breadcrumbTextActive: { color: DriveTheme.text, fontWeight: '600' },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: DriveTheme.divider,
  },
  sortBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sortLabel: { fontSize: 14, fontWeight: '500', color: DriveTheme.textSecondary },
  fileCount: { fontSize: 13, color: DriveTheme.textMuted },
  sortMenu: {
    marginHorizontal: 16,
    marginBottom: 8,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: DriveTheme.border,
    backgroundColor: DriveTheme.bg,
    overflow: 'hidden',
  },
  sortOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: DriveTheme.divider,
  },
  sortOptionText: { fontSize: 15, color: DriveTheme.text },
  sortOptionActive: { color: DriveTheme.blue, fontWeight: '600' },
  uploadBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 8,
    backgroundColor: DriveTheme.blueLight,
  },
  uploadText: { fontSize: 13, color: DriveTheme.blue, fontWeight: '500' },
  gridSkeletonWrap: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 10,
    alignContent: 'flex-start',
  },
  gridRow: { paddingHorizontal: 10 },
  separator: { height: 1, backgroundColor: DriveTheme.divider, marginLeft: 70 },
  listEmpty: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { fontSize: 15, color: DriveTheme.textSecondary, textAlign: 'center', marginTop: 12 },
  retryBtn: {
    marginTop: 16,
    paddingHorizontal: 24,
    paddingVertical: 10,
    backgroundColor: DriveTheme.blue,
    borderRadius: 24,
  },
  retryText: { color: '#fff', fontWeight: '600', fontSize: 15 },
  footerLoader: { paddingVertical: 20, alignItems: 'center' },
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: DriveTheme.fab,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
  },
});
