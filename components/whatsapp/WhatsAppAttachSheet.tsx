import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../constants/colors';

export type AttachPickerKind = 'gallery' | 'camera' | 'audio' | 'document';

type Option = {
  id: AttachPickerKind;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onSelect: (kind: AttachPickerKind) => void;
};

const OPTIONS: Option[] = [
  { id: 'gallery', label: 'Photos & Videos', icon: 'images-outline' },
  { id: 'camera', label: 'Camera', icon: 'camera-outline' },
  { id: 'audio', label: 'Audio', icon: 'musical-notes-outline' },
  { id: 'document', label: 'Document', icon: 'document-text-outline' },
];

/** Inline bottom sheet — avoids React Native Modal, which blocks native pickers on Android. */
export function WhatsAppAttachSheet({ visible, onClose, onSelect }: Props) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  if (!visible) return null;

  return (
    <View style={[styles.overlay, { height: windowHeight }]} pointerEvents="box-none">
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={styles.handle} />
        <Text style={styles.title}>Attach</Text>
        {OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.id}
            style={styles.row}
            onPress={() => onSelect(opt.id)}
          >
            <View style={styles.iconWrap}>
              <Ionicons name={opt.icon} size={24} color="#075E54" />
            </View>
            <Text style={styles.rowLabel}>{opt.label}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    elevation: 1000,
    justifyContent: 'flex-end',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 8,
    paddingHorizontal: 16,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    marginBottom: 12,
  },
  title: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.textMuted,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 14,
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#E7F8EF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: { fontSize: 17, color: Colors.text, fontWeight: '500' },
  cancelBtn: {
    marginTop: 8,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelText: { fontSize: 16, color: Colors.textSecondary, fontWeight: '600' },
});
