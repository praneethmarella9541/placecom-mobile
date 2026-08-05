import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Pressable,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DriveFile } from '../../lib/types';
import { DriveTheme } from '../../constants/driveTheme';
import { driveApi } from '../../lib/api';
import { isDriveFolder } from '../../lib/drive-utils';
import { DriveFileIcon } from './DriveFileIcon';
import { getDriveFileParents, moveDriveFile } from '../../lib/drive-file-actions';

export function DriveMoveSheet({
  file,
  visible,
  onClose,
  onMoved,
}: {
  file: DriveFile | null;
  visible: boolean;
  onClose: () => void;
  onMoved: () => void;
}) {
  const [folderStack, setFolderStack] = useState<{ id: string; name: string }[]>([]);
  const [folders, setFolders] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [moving, setMoving] = useState(false);

  const currentParentId = folderStack.length > 0 ? folderStack[folderStack.length - 1].id : undefined;

  const loadFolders = useCallback(async () => {
    setLoading(true);
    try {
      const data = await driveApi.listFiles(currentParentId, { pageSize: 100, view: 'folder' });
      const list = (data.files ?? []).filter((f: DriveFile) => isDriveFolder(f));
      setFolders(list);
    } catch {
      setFolders([]);
    } finally {
      setLoading(false);
    }
  }, [currentParentId]);

  useEffect(() => {
    if (!visible || !file) return;
    setFolderStack([]);
  }, [visible, file?.id]);

  useEffect(() => {
    if (visible && file) loadFolders();
  }, [visible, file, loadFolders]);

  async function moveHere() {
    if (!file || moving) return;
    const destId = currentParentId ?? 'root';
    setMoving(true);
    try {
      const parents = await getDriveFileParents(file.id);
      await moveDriveFile(file.id, destId, parents);
      onClose();
      onMoved();
    } catch (e: any) {
      Alert.alert('Move failed', e?.message ?? 'Try again');
    } finally {
      setMoving(false);
    }
  }

  function enterFolder(folder: DriveFile) {
    setFolderStack((prev) => [...prev, { id: folder.id, name: folder.name }]);
  }

  function goBack() {
    setFolderStack((prev) => prev.slice(0, -1));
  }

  if (!file) return null;

  const locationLabel =
    folderStack.length === 0 ? 'My Drive' : folderStack[folderStack.length - 1].name;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <Text style={styles.title}>Move &ldquo;{file.name}&rdquo;</Text>
          <View style={styles.locationRow}>
            {folderStack.length > 0 && (
              <TouchableOpacity onPress={goBack} style={styles.backBtn}>
                <Ionicons name="arrow-back" size={20} color={DriveTheme.blue} />
              </TouchableOpacity>
            )}
            <Text style={styles.locationText} numberOfLines={1}>
              {locationLabel}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.moveHereBtn}
            onPress={moveHere}
            disabled={moving}
          >
            {moving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
                <Text style={styles.moveHereText}>Move here</Text>
              </>
            )}
          </TouchableOpacity>

          {loading ? (
            <ActivityIndicator style={{ padding: 24 }} color={DriveTheme.blue} />
          ) : (
            <FlatList
              data={folders}
              keyExtractor={(item) => item.id}
              style={styles.list}
              ListEmptyComponent={
                <Text style={styles.empty}>No subfolders — use Move here for this location</Text>
              }
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.folderRow} onPress={() => enterFolder(item)}>
                  <DriveFileIcon mimeType={item.mimeType} size="sm" variant="outline" />
                  <Text style={styles.folderName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={DriveTheme.textMuted} />
                </TouchableOpacity>
              )}
            />
          )}

          <TouchableOpacity style={styles.cancelRow} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: DriveTheme.sheet,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '70%',
    paddingBottom: 24,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: DriveTheme.border,
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 8,
  },
  title: {
    fontSize: 17,
    fontWeight: '600',
    color: DriveTheme.text,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  backBtn: { padding: 4 },
  locationText: { flex: 1, fontSize: 15, color: DriveTheme.blue, fontWeight: '500' },
  moveHereBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 12,
    paddingVertical: 12,
    borderRadius: 24,
    backgroundColor: DriveTheme.blue,
  },
  moveHereText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  list: { maxHeight: 280 },
  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: DriveTheme.divider,
  },
  folderName: { flex: 1, fontSize: 15, color: DriveTheme.text },
  empty: {
    padding: 20,
    textAlign: 'center',
    color: DriveTheme.textSecondary,
    fontSize: 14,
  },
  cancelRow: {
    marginTop: 8,
    marginHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: DriveTheme.bgMuted,
    borderRadius: 12,
  },
  cancelText: { fontSize: 16, fontWeight: '600', color: DriveTheme.textSecondary },
});
