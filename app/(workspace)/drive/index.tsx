import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import ScreenHeader from '../../../components/ScreenHeader';
import EmptyState from '../../../components/EmptyState';
import { useDrawer } from '../_layout';
import { driveApi } from '../../../lib/api';
import { Colors } from '../../../constants/colors';
import type { DriveFile } from '../../../lib/types';

const MIME_ICONS: Record<string, { name: any; color: string }> = {
  'application/vnd.google-apps.folder': { name: 'folder', color: '#F59E0B' },
  'application/pdf': { name: 'document-text', color: '#EF4444' },
  'image/jpeg': { name: 'image', color: '#3B82F6' },
  'image/png': { name: 'image', color: '#3B82F6' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { name: 'grid', color: '#10B981' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { name: 'document', color: '#3B82F6' },
};

function getIcon(mime: string) {
  return MIME_ICONS[mime] ?? { name: 'document-outline', color: Colors.textSecondary };
}

function formatSize(size: string | null) {
  if (!size) return '';
  const n = parseInt(size);
  if (n > 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  if (n > 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${n} B`;
}

export default function DriveScreen() {
  const { openDrawer } = useDrawer();
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [folderStack, setFolderStack] = useState<{ id: string; name: string }[]>([]);
  const [uploading, setUploading] = useState(false);

  const currentFolderId = folderStack.length > 0 ? folderStack[folderStack.length - 1].id : undefined;

  const loadFiles = useCallback(async () => {
    try {
      const data = await driveApi.listFiles(currentFolderId);
      setFiles(data.files ?? []);
    } catch {
      setFiles([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentFolderId]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  function openFolder(file: DriveFile) {
    if (file.mimeType === 'application/vnd.google-apps.folder') {
      setFolderStack((prev) => [...prev, { id: file.id, name: file.name }]);
    }
  }

  function goBack() {
    setFolderStack((prev) => prev.slice(0, -1));
  }

  async function uploadFile() {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (result.canceled) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', { uri: asset.uri, name: asset.name, type: asset.mimeType ?? 'application/octet-stream' } as any);
      if (currentFolderId) formData.append('folderId', currentFolderId);
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
            <Text style={styles.backText}>{folderStack.length > 1 ? folderStack[folderStack.length - 2].name : 'My Drive'}</Text>
          </TouchableOpacity>
          <Text style={styles.currentFolder}>{folderStack[folderStack.length - 1].name}</Text>
        </View>
      )}

      {uploading && (
        <View style={styles.uploadBanner}>
          <ActivityIndicator size="small" color={Colors.primary} />
          <Text style={styles.uploadText}>Uploading file...</Text>
        </View>
      )}

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>
      ) : (
        <FlatList
          data={files}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <FileRow file={item} onPress={() => openFolder(item)} />
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadFiles(); }} tintColor={Colors.primary} />}
          ListEmptyComponent={<EmptyState icon="cloud-outline" title="No files" subtitle="This folder is empty" />}
          contentContainerStyle={files.length === 0 ? { flex: 1 } : { paddingBottom: 16 }}
        />
      )}
    </View>
  );
}

function FileRow({ file, onPress }: { file: DriveFile; onPress: () => void }) {
  const icon = getIcon(file.mimeType);
  const isFolder = file.mimeType === 'application/vnd.google-apps.folder';
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.fileIcon, { backgroundColor: icon.color + '20' }]}>
        <Ionicons name={icon.name} size={22} color={icon.color} />
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
      <Ionicons name={isFolder ? 'chevron-forward' : 'download-outline'} size={16} color={Colors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  backText: { fontSize: 13, color: Colors.primary },
  currentFolder: { fontSize: 13, fontWeight: '600', color: Colors.text },
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
});
