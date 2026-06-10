import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DriveFile } from '../../lib/types';
import { DriveTheme } from '../../constants/driveTheme';
import { formatDriveDate, formatDriveSize, isDriveFolder } from '../../lib/drive-utils';
import { DriveFileIcon } from './DriveFileIcon';

export function DriveListRow({
  file,
  onPress,
  onPressIn,
  onMorePress,
  loading = false,
}: {
  file: DriveFile;
  onPress: () => void;
  onPressIn?: () => void;
  onMorePress: () => void;
  loading?: boolean;
}) {
  const folder = isDriveFolder(file);

  return (
    <TouchableOpacity
      style={styles.row}
      onPressIn={onPressIn}
      onPress={onPress}
      activeOpacity={0.65}
      disabled={loading}
    >
      <DriveFileIcon mimeType={file.mimeType} loading={loading} />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={2}>
          {file.name}
        </Text>
        <View style={styles.metaRow}>
          {file.starred && <Ionicons name="star" size={12} color={DriveTheme.yellow} style={styles.star} />}
          {file.shared && (
            <Ionicons name="people" size={12} color={DriveTheme.textMuted} style={styles.star} />
          )}
          <Text style={styles.meta} numberOfLines={1}>
            {[folder ? 'Folder' : formatDriveSize(file.size), formatDriveDate(file.modifiedTime)]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
      </View>
      <TouchableOpacity
        onPress={onMorePress}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={styles.moreBtn}
        disabled={loading}
      >
        <Ionicons name="ellipsis-vertical" size={20} color={DriveTheme.textSecondary} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: DriveTheme.bg,
  },
  body: { flex: 1, gap: 3 },
  name: { fontSize: 15, fontWeight: '500', color: DriveTheme.text, lineHeight: 20 },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  star: { marginRight: 4 },
  meta: { fontSize: 13, color: DriveTheme.textSecondary, flexShrink: 1 },
  moreBtn: { padding: 4 },
});
