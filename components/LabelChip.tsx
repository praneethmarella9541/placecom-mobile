import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import type { GmailLabel } from '../lib/api';
import { labelDisplayName as formatLabelDisplayName } from '../lib/gmail-labels';

export function labelDisplayName(label: GmailLabel): string {
  return formatLabelDisplayName(label);
}

/** Deterministic pastel hue from the label id. */
function hueFor(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Returns CSS color strings; RN can render HSL via 'hsl()' literals. */
function colorsFor(label: GmailLabel): { bg: string; fg: string; border: string } {
  if (label.color?.backgroundColor) {
    return {
      bg: label.color.backgroundColor,
      fg: label.color.textColor ?? '#fff',
      border: label.color.backgroundColor,
    };
  }
  const h = hueFor(label.id);
  return {
    bg: `hsl(${h}, 80%, 92%)`,
    fg: `hsl(${h}, 50%, 25%)`,
    border: `hsl(${h}, 60%, 80%)`,
  };
}

export function LabelChip({
  label,
  onRemove,
  size = 'sm',
}: {
  label: GmailLabel;
  onRemove?: () => void;
  size?: 'sm' | 'md';
}) {
  const { bg, fg, border } = colorsFor(label);
  const pillStyle = size === 'md' ? styles.pillMd : styles.pillSm;
  const textStyle = size === 'md' ? styles.textMd : styles.textSm;
  return (
    <View style={[pillStyle, { backgroundColor: bg, borderColor: border }]}>
      <Text style={[textStyle, { color: fg }]} numberOfLines={1}>
        {labelDisplayName(label)}
      </Text>
      {onRemove && (
        <TouchableOpacity onPress={onRemove} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
          <Ionicons name="close" size={size === 'md' ? 12 : 10} color={fg} />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pillSm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: 140,
  },
  pillMd: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: 180,
  },
  textSm: { fontSize: 10, fontWeight: '600' },
  textMd: { fontSize: 12, fontWeight: '600' },
});
