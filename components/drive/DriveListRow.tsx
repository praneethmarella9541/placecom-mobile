import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DriveFile } from '../../lib/types';
import { DriveTheme } from '../../constants/driveTheme';
import { formatDriveDate } from '../../lib/drive-utils';
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
  return (
    <TouchableOpacity
      style={styles.row}
      onPressIn={onPressIn}
      onPress={onPress}
      activeOpacity={0.65}
      disabled={loading}
    >
      <DriveFileIcon mimeType={file.mimeType} variant="outline" size="sm" loading={loading} />
      <View style={styles.nameCol}>
        <Text style={styles.name} numberOfLines={1}>
          {file.name}
        </Text>
        {(file.starred || file.shared) && (
          <View style={styles.badgeRow}>
            {file.starred && <Ionicons name="star" size={11} color={DriveTheme.yellow} style={styles.badgeIcon} />}
            {file.shared && <Ionicons name="people" size={11} color={DriveTheme.textMuted} style={styles.badgeIcon} />}
          </View>
        )}
      </View>
      <Text style={styles.modifiedCol} numberOfLines={1}>
        {formatDriveDate(file.modifiedTime)}
      </Text>
      <TouchableOpacity
        onPress={onMorePress}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        style={styles.moreBtn}
        disabled={loading}
      >
        <Ionicons name="ellipsis-vertical" size={18} color={DriveTheme.textSecondary} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 14,
    backgroundColor: DriveTheme.surface,
    borderWidth: 1,
    borderColor: DriveTheme.border,
    shadowColor: '#14120E',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  nameCol: { flex: 1, minWidth: 0, gap: 3 },
  name: { fontSize: 14, fontWeight: '500', color: DriveTheme.text },
  badgeRow: { flexDirection: 'row' },
  badgeIcon: { marginRight: 4 },
  modifiedCol: {
    fontSize: 12,
    color: DriveTheme.textMuted,
    fontFamily: 'monospace',
    textAlign: 'right',
  },
  moreBtn: { padding: 2 },
});
