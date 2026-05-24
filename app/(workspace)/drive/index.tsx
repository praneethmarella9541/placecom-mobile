import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Alert, TextInput,
  Modal, SafeAreaView, Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import WebView from 'react-native-webview';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import { supabase } from '../../../lib/supabase';
import ScreenHeader from '../../../components/ScreenHeader';
import EmptyState from '../../../components/EmptyState';
import { useDrawer } from '../_layout';
import { driveApi } from '../../../lib/api';
import { Colors } from '../../../constants/colors';
import { cacheGet, cacheSet, cacheIsStale } from '../../../lib/cache';
import type { DriveFile } from '../../../lib/types';

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

const MIME_ICONS: Record<string, { name: any; color: string }> = {
  'application/vnd.google-apps.folder': { name: 'folder', color: '#F59E0B' },
  'application/pdf': { name: 'document-text', color: '#EF4444' },
  'image/jpeg': { name: 'image', color: '#3B82F6' },
  'image/png': { name: 'image', color: '#3B82F6' },
  'image/gif': { name: 'image', color: '#3B82F6' },
  'image/webp': { name: 'image', color: '#3B82F6' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { name: 'grid', color: '#10B981' },
  'application/vnd.google-apps.spreadsheet': { name: 'grid', color: '#10B981' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { name: 'document', color: '#3B82F6' },
  'application/vnd.google-apps.document': { name: 'document', color: '#3B82F6' },
  'application/vnd.google-apps.presentation': { name: 'easel', color: '#F97316' },
};

function getIcon(mime: string) {
  return MIME_ICONS[mime] ?? { name: 'document-outline', color: Colors.textSecondary };
}

function formatSize(size: string | null | undefined) {
  if (!size) return '';
  const n = parseInt(size, 10);
  if (Number.isNaN(n)) return '';
  if (n > 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n > 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

// Sanitise a filename so it can be used as a cache file name
function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

async function getBearerToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

/**
 * Downloads a Drive file through the authenticated backend proxy and returns
 * a local file:// URI suitable for WebView preview or expo-sharing.
 */
async function fetchFileToCache(fileId: string, fileName: string, mode: 'preview' | 'download'): Promise<string> {
  const token = await getBearerToken();
  if (!token) throw new Error('Not signed in');

  const remoteUrl = `${BASE_URL}/api/drive/file/${encodeURIComponent(fileId)}?mode=${mode}`;
  const destFile = new File(Paths.cache, `drive_${safeName(fileName)}`);
  if (destFile.exists) destFile.delete();

  const downloaded = await File.downloadFileAsync(remoteUrl, destFile, {
    headers: { Authorization: `Bearer ${token}` },
  });

  return downloaded.uri;
}

// ─── Skeleton shimmer ────────────────────────────────────────────────────────

function SkeletonBox({ width, height, style }: { width: number | string; height: number; style?: object }) {
  const anim = React.useRef(new Animated.Value(0)).current;
  React.useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 900, useNativeDriver: true }),
      ])
    ).start();
  }, [anim]);
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.7] });
  return (
    <Animated.View
      style={[{ width: width as any, height, borderRadius: 6, backgroundColor: Colors.border, opacity }, style]}
    />
  );
}

function FileRowSkeleton() {
  return (
    <View style={styles.row}>
      <SkeletonBox width={44} height={44} style={{ borderRadius: 10 }} />
      <View style={{ flex: 1, gap: 8 }}>
        <SkeletonBox width="75%" height={13} />
        <SkeletonBox width="40%" height={11} />
      </View>
      <SkeletonBox width={18} height={18} style={{ borderRadius: 4 }} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function DriveScreen() {
  const { openDrawer } = useDrawer();
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [folderStack, setFolderStack] = useState<{ id: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [nextPageToken, setNextPageToken] = useState<string | undefined>();
  const [loadingMore, setLoadingMore] = useState(false);
  // Preview state: local file:// URI shown in the modal WebView
  const [previewLocalUri, setPreviewLocalUri] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState('');
  const [fileActionLoading, setFileActionLoading] = useState<string | null>(null); // fileId

  const currentFolderId = folderStack.length > 0 ? folderStack[folderStack.length - 1].id : undefined;

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 400);
    return () => clearTimeout(t);
  }, [search]);

  const loadFiles = useCallback(async () => {
    setError(null);
    const cacheKey = `drive:${currentFolderId ?? 'root'}:${debouncedSearch}`;

    type CachedPage = { files: DriveFile[]; nextPageToken?: string };
    const cached = cacheGet<CachedPage>(cacheKey);
    if (cached) {
      setFiles(cached.files);
      setNextPageToken(cached.nextPageToken);
      setLoading(false);
      if (!cacheIsStale(cacheKey)) {
        setRefreshing(false);
        return;
      }
    } else {
      setLoading(true);
    }

    try {
      const data = await driveApi.listFiles(currentFolderId, {
        search: debouncedSearch || undefined,
        pageSize: 20,
      });
      cacheSet(cacheKey, { files: data.files ?? [], nextPageToken: data.nextPageToken });
      // Replace with fresh first page — deduplicate in case loadMore already appended
      setFiles((prev) => {
        const freshIds = new Set((data.files ?? []).map((f) => f.id));
        const extra = prev.filter((f) => !freshIds.has(f.id));
        return [...(data.files ?? []), ...extra];
      });
      setNextPageToken(data.nextPageToken);
    } catch (e: any) {
      console.error('[drive] load failed:', e?.message);
      if (!cached) {
        setError(e?.message ?? 'Failed to load Drive files');
        setFiles([]);
        setNextPageToken(undefined);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentFolderId, debouncedSearch]);

  useEffect(() => {
    setFiles([]);
    setNextPageToken(undefined);
    loadFiles();
  }, [loadFiles]);

  async function loadMore() {
    if (!nextPageToken || loadingMore) return;
    setLoadingMore(true);
    try {
      const data = await driveApi.listFiles(currentFolderId, {
        pageToken: nextPageToken,
        search: debouncedSearch || undefined,
        pageSize: 50,
      });
      setFiles((prev) => {
        const existingIds = new Set(prev.map((f) => f.id));
        const fresh = (data.files ?? []).filter((f) => !existingIds.has(f.id));
        return [...prev, ...fresh];
      });
      setNextPageToken(data.nextPageToken);
    } catch {}
    finally { setLoadingMore(false); }
  }

  async function handleFilePress(file: DriveFile) {
    if (file.mimeType === 'application/vnd.google-apps.folder') {
      setFolderStack((prev) => [...prev, { id: file.id, name: file.name }]);
      setSearch('');
      return;
    }
    setFileActionLoading(file.id);
    try {
      const localUri = await fetchFileToCache(file.id, file.name, 'preview');
      setPreviewName(file.name);
      setPreviewLocalUri(localUri);
    } catch (e: any) {
      Alert.alert('Preview failed', e?.message ?? 'Could not load file');
    } finally {
      setFileActionLoading(null);
    }
  }

  async function handleDownload(file: DriveFile) {
    setFileActionLoading(file.id);
    try {
      const localUri = await fetchFileToCache(file.id, file.name, 'download');
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(localUri, {
          dialogTitle: `Save "${file.name}"`,
          UTI: file.mimeType,
          mimeType: file.mimeType,
        });
      } else {
        Alert.alert('Saved', `File saved to app cache: ${file.name}`);
      }
    } catch (e: any) {
      Alert.alert('Download failed', e?.message ?? 'Could not download file');
    } finally {
      setFileActionLoading(null);
    }
  }

  function goBack() {
    setFolderStack((prev) => prev.slice(0, -1));
    setSearch('');
  }

  async function uploadFile() {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (result.canceled) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', { uri: asset.uri, name: asset.name, type: asset.mimeType ?? 'application/octet-stream' } as any);
      if (currentFolderId) formData.append('parent', currentFolderId);
      await driveApi.uploadFile(formData);
      await loadFiles();
      Alert.alert('Uploaded', `${asset.name} uploaded to Drive.`);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Drive"
        onMenuPress={openDrawer}
        rightAction={{ icon: 'cloud-upload-outline', onPress: uploadFile }}
      />

      {folderStack.length > 0 && (
        <View style={styles.breadcrumb}>
          <TouchableOpacity onPress={goBack} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={16} color={Colors.primary} />
            <Text style={styles.backText}>
              {folderStack.length > 1 ? folderStack[folderStack.length - 2].name : 'My Drive'}
            </Text>
          </TouchableOpacity>
          <Ionicons name="chevron-forward" size={14} color={Colors.textMuted} />
          <Text style={styles.currentFolder} numberOfLines={1}>
            {folderStack[folderStack.length - 1].name}
          </Text>
        </View>
      )}

      <View style={styles.searchBar}>
        <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search files..."
          placeholderTextColor={Colors.textMuted}
          returnKeyType="search"
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {uploading && (
        <View style={styles.uploadBanner}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.uploadText}>Uploading file...</Text>
        </View>
      )}

      {loading ? (
        <View style={{ flex: 1 }}>
          {[...Array(10)].map((_, i) => <FileRowSkeleton key={i} />)}
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="warning-outline" size={32} color={Colors.error} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); loadFiles(); }}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={files}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <FileRow
              file={item}
              onPress={() => handleFilePress(item)}
              onDownload={() => handleDownload(item)}
              actionLoading={fileActionLoading === item.id}
            />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); loadFiles(); }}
              tintColor={Colors.primary}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="cloud-outline"
              title={debouncedSearch ? 'No matches' : 'No files'}
              subtitle={debouncedSearch ? 'Try a different search' : 'This folder is empty'}
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
          contentContainerStyle={files.length === 0 ? { flex: 1 } : { paddingBottom: 16 }}
        />
      )}

      {/* Preview modal — renders local file:// URI so no auth needed */}
      <Modal
        visible={!!previewLocalUri}
        animationType="slide"
        onRequestClose={() => setPreviewLocalUri(null)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: '#000' }}>
          <View style={styles.previewHeader}>
            <TouchableOpacity onPress={() => setPreviewLocalUri(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={26} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.previewTitle} numberOfLines={1}>{previewName}</Text>
            <TouchableOpacity
              onPress={async () => {
                if (!previewLocalUri) return;
                const canShare = await Sharing.isAvailableAsync();
                if (canShare) await Sharing.shareAsync(previewLocalUri, { dialogTitle: `Save "${previewName}"` });
              }}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="download-outline" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
          {previewLocalUri && (
            <WebView
              source={{ uri: previewLocalUri }}
              style={{ flex: 1, backgroundColor: '#fff' }}
              originWhitelist={['*', 'file://']}
              allowFileAccess
              allowUniversalAccessFromFileURLs
              allowFileAccessFromFileURLs
              startInLoadingState
              renderLoading={() => (
                <View style={[styles.center, { backgroundColor: '#fff' }]}>
                  <ActivityIndicator color={Colors.primary} />
                </View>
              )}
            />
          )}
        </SafeAreaView>
      </Modal>
    </View>
  );
}

function FileRow({
  file, onPress, onDownload, actionLoading,
}: {
  file: DriveFile;
  onPress: () => void;
  onDownload: () => void;
  actionLoading: boolean;
}) {
  const icon = getIcon(file.mimeType);
  const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7} disabled={actionLoading}>
      <View style={[styles.fileIcon, { backgroundColor: icon.color + '20' }]}>
        {actionLoading
          ? <ActivityIndicator size="small" color={icon.color} />
          : <Ionicons name={icon.name} size={22} color={icon.color} />
        }
      </View>
      <View style={styles.rowBody}>
        <Text style={styles.fileName} numberOfLines={1}>{file.name}</Text>
        <View style={styles.fileMeta}>
          {!isFolder && file.size && <Text style={styles.fileSize}>{formatSize(file.size)}</Text>}
          <Text style={styles.fileDate}>
            {file.modifiedTime ? new Date(file.modifiedTime).toLocaleDateString() : ''}
          </Text>
        </View>
      </View>
      {isFolder ? (
        <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
      ) : (
        <TouchableOpacity onPress={onDownload} disabled={actionLoading} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          {actionLoading
            ? <ActivityIndicator size="small" color={Colors.primary} />
            : <Ionicons name="download-outline" size={18} color={Colors.primary} />
          }
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { fontSize: 13, color: Colors.primary },
  currentFolder: { flex: 1, fontSize: 13, fontWeight: '600', color: Colors.text },
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
  uploadBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    backgroundColor: Colors.primaryLight,
    justifyContent: 'center',
  },
  uploadText: { fontSize: 13, color: Colors.primary },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  fileIcon: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, gap: 3 },
  fileName: { fontSize: 14, fontWeight: '500', color: Colors.text },
  fileMeta: { flexDirection: 'row', gap: 8 },
  fileSize: { fontSize: 12, color: Colors.textMuted },
  fileDate: { fontSize: 12, color: Colors.textMuted },
  footerLoader: { paddingVertical: 16, alignItems: 'center' },
  errorText: { fontSize: 14, color: Colors.error, textAlign: 'center', marginTop: 8 },
  retryBtn: { marginTop: 12, paddingHorizontal: 20, paddingVertical: 8, backgroundColor: Colors.primary, borderRadius: 8 },
  retryText: { color: Colors.surface, fontWeight: '600', fontSize: 14 },
  previewHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#111',
  },
  previewTitle: { flex: 1, fontSize: 15, fontWeight: '600', color: '#fff', marginHorizontal: 12 },
});
