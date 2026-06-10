import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  subscribeAppToast,
  type AppToastState,
  type AppToastTone,
} from '../lib/app-toast';

function toneIcon(tone: AppToastTone): keyof typeof Ionicons.glyphMap {
  if (tone === 'success') return 'checkmark-circle';
  if (tone === 'error') return 'alert-circle';
  return 'mail-outline';
}

export default function AppToastHost() {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<AppToastState | null>(null);

  useEffect(() => subscribeAppToast(setToast), []);

  if (!toast) return null;

  const bg =
    toast.tone === 'success'
      ? '#1e3a2f'
      : toast.tone === 'error'
        ? '#3f1d24'
        : '#1f2937';

  return (
    <View pointerEvents="none" style={[styles.host, { bottom: insets.bottom + 20 }]}>
      <View style={[styles.toast, { backgroundColor: bg }]}>
        <Ionicons name={toneIcon(toast.tone)} size={18} color="#fff" />
        <Text style={styles.text} numberOfLines={2}>
          {toast.message}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9999,
    elevation: 20,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  text: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
