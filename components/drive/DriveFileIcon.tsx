import React from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getDriveMimeIcon } from '../../lib/drive-utils';
import { Colors } from '../../constants/colors';

/** Outline glyph for each filled-icon name, used by the flat table row style. */
const OUTLINE_NAME: Partial<Record<string, keyof typeof Ionicons.glyphMap>> = {
  folder: 'folder-outline',
  'document-text': 'document-text-outline',
  grid: 'grid-outline',
  easel: 'easel-outline',
  image: 'image-outline',
  videocam: 'videocam-outline',
  'musical-notes': 'musical-notes-outline',
  archive: 'archive-outline',
};

export function DriveFileIcon({
  mimeType,
  size = 'md',
  loading = false,
  variant = 'chip',
}: {
  mimeType: string;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  /** 'chip' = filled colored square (grid tiles). 'outline' = plain outline glyph (flat table rows). */
  variant?: 'chip' | 'outline';
}) {
  const icon = getDriveMimeIcon(mimeType);
  const dim = size === 'lg' ? 48 : size === 'sm' ? 36 : 40;
  const glyph = size === 'lg' ? 26 : size === 'sm' ? 18 : 22;

  if (variant === 'outline') {
    return (
      <View style={[styles.wrap, { width: dim, height: dim }]}>
        {loading ? (
          <ActivityIndicator size="small" color={Colors.copper} />
        ) : (
          <Ionicons name={OUTLINE_NAME[icon.name] ?? icon.name} size={glyph} color={icon.bg} />
        )}
      </View>
    );
  }

  return (
    <View style={[styles.wrap, { width: dim, height: dim, borderRadius: dim * 0.22, backgroundColor: icon.bg }]}>
      {loading ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <Ionicons name={icon.name} size={glyph} color={icon.color} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
});
