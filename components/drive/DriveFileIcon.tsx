import React from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getDriveMimeIcon } from '../../lib/drive-utils';

export function DriveFileIcon({
  mimeType,
  size = 'md',
  loading = false,
}: {
  mimeType: string;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
}) {
  const icon = getDriveMimeIcon(mimeType);
  const dim = size === 'lg' ? 48 : size === 'sm' ? 36 : 40;
  const glyph = size === 'lg' ? 26 : size === 'sm' ? 18 : 22;

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
