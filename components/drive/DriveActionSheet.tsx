import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DriveFile } from '../../lib/types';
import { DriveTheme } from '../../constants/driveTheme';
import { DriveFileIcon } from './DriveFileIcon';
import { formatDriveDate, formatDriveSize, isDriveFolder } from '../../lib/drive-utils';

type Action = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  destructive?: boolean;
};

export function DriveActionSheet({
  file,
  ownerName = 'Me',
  visible,
  onClose,
  onOpen,
  onDownload,
  onCopyLink,
  onShare,
  onMove,
}: {
  file: DriveFile | null;
  ownerName?: string;
  visible: boolean;
  onClose: () => void;
  onOpen: () => void;
  onDownload: () => void;
  onCopyLink: () => void;
  onShare: () => void;
  onMove: () => void;
}) {
  if (!file) return null;

  const folder = isDriveFolder(file);

  const actions: Action[] = folder
    ? [
        { key: 'copy', label: 'Copy link', icon: 'link-outline', onPress: () => { onClose(); onCopyLink(); } },
        { key: 'share', label: 'Share', icon: 'share-outline', onPress: () => { onClose(); onShare(); } },
        { key: 'move', label: 'Move', icon: 'folder-outline', onPress: () => { onClose(); onMove(); } },
      ]
    : [
        { key: 'open', label: 'Preview', icon: 'eye-outline', onPress: () => { onClose(); onOpen(); } },
        { key: 'copy', label: 'Copy link', icon: 'link-outline', onPress: () => { onClose(); onCopyLink(); } },
        { key: 'share', label: 'Share', icon: 'share-outline', onPress: () => { onClose(); onShare(); } },
        { key: 'download', label: 'Download', icon: 'download-outline', onPress: () => { onClose(); onDownload(); } },
        { key: 'move', label: 'Move', icon: 'folder-outline', onPress: () => { onClose(); onMove(); } },
      ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <View style={styles.fileHeader}>
            <DriveFileIcon mimeType={file.mimeType} size="md" variant="outline" />
            <Text style={styles.fileName} numberOfLines={2}>
              {file.name}
            </Text>
          </View>
          <View style={styles.detailsSection}>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Owner</Text>
              <Text style={styles.detailValue} numberOfLines={1}>{ownerName}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Modified</Text>
              <Text style={styles.detailValue} numberOfLines={1}>{formatDriveDate(file.modifiedTime) || '—'}</Text>
            </View>
            {!folder && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Size</Text>
                <Text style={styles.detailValue} numberOfLines={1}>{formatDriveSize(file.size) || '—'}</Text>
              </View>
            )}
          </View>
          {actions.map((a) => (
            <TouchableOpacity key={a.key} style={styles.actionRow} onPress={a.onPress} activeOpacity={0.7}>
              <Ionicons name={a.icon} size={22} color={a.destructive ? DriveTheme.red : DriveTheme.textSecondary} />
              <Text style={[styles.actionLabel, a.destructive && styles.destructive]}>{a.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.cancelRow} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: DriveTheme.sheet,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
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
  fileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: DriveTheme.divider,
  },
  fileName: { flex: 1, fontSize: 16, fontWeight: '600', color: DriveTheme.text },
  detailsSection: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: DriveTheme.divider,
  },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  detailLabel: { fontSize: 13, color: DriveTheme.textMuted },
  detailValue: { fontSize: 13, color: DriveTheme.text, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  actionLabel: { fontSize: 16, color: DriveTheme.text },
  destructive: { color: DriveTheme.red },
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
