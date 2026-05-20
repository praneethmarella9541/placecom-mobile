import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '../constants/colors';

interface Props {
  label: string;
  color?: string;
  bgColor?: string;
  size?: 'sm' | 'md';
}

export default function Badge({ label, color = Colors.primary, bgColor = Colors.primaryLight, size = 'sm' }: Props) {
  return (
    <View style={[styles.badge, { backgroundColor: bgColor }, size === 'md' && styles.md]}>
      <Text style={[styles.label, { color }, size === 'md' && styles.labelMd]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  md: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  labelMd: {
    fontSize: 13,
  },
});
