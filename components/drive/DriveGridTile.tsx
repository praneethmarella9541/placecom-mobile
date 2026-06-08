import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { DriveFile } from '../../lib/types';
import { DriveTheme } from '../../constants/driveTheme';
import { formatDriveDate, isDriveFolder } from '../../lib/drive-utils';
import { DriveFileIcon } from './DriveFileIcon';

export function DriveGridTile({
  file,
  onPress,
  onMorePress,
  loading = false,
}: {
  file: DriveFile;
  onPress: () => void;
  onMorePress: () => void;
  loading?: boolean;
}) {
  const folder = isDriveFolder(file);

  return (
    <TouchableOpacity style={styles.tile} onPress={onPress} activeOpacity={0.7} disabled={loading}>
      <TouchableOpacity
        style={styles.more}
        onPress={onMorePress}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        disabled={loading}
      >
        <Ionicons name="ellipsis-vertical" size={18} color={DriveTheme.textSecondary} />
      </TouchableOpacity>
      {file.starred && (
        <Ionicons name="star" size={14} color={DriveTheme.yellow} style={styles.starBadge} />
      )}
      <View style={styles.iconWrap}>
        <DriveFileIcon mimeType={file.mimeType} size="lg" loading={loading} />
      </View>
      <Text style={styles.name} numberOfLines={2}>
        {file.name}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {folder ? 'Folder' : formatDriveDate(file.modifiedTime)}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    margin: 6,
    padding: 12,
    paddingTop: 10,
    borderRadius: 12,
    backgroundColor: DriveTheme.bg,
    borderWidth: 1,
    borderColor: DriveTheme.border,
    minHeight: 148,
  },
  more: { position: 'absolute', top: 8, right: 8, zIndex: 2, padding: 2 },
  starBadge: { position: 'absolute', top: 10, left: 10, zIndex: 2 },
  iconWrap: { alignItems: 'center', marginTop: 8, marginBottom: 10 },
  name: {
    fontSize: 13,
    fontWeight: '500',
    color: DriveTheme.text,
    textAlign: 'center',
    lineHeight: 18,
  },
  meta: { fontSize: 11, color: DriveTheme.textMuted, textAlign: 'center', marginTop: 4 },
});
