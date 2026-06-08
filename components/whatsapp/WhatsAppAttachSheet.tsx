import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../constants/colors';

type Option = {
  id: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onPickGallery: () => void;
  onPickCamera: () => void;
  onPickDocument: () => void;
};

export function WhatsAppAttachSheet({
  visible,
  onClose,
  onPickGallery,
  onPickCamera,
  onPickDocument,
}: Props) {
  const insets = useSafeAreaInsets();

  const options: Option[] = [
    {
      id: 'gallery',
      label: 'Gallery',
      icon: 'images-outline',
      onPress: () => {
        onClose();
        onPickGallery();
      },
    },
    {
      id: 'camera',
      label: 'Camera',
      icon: 'camera-outline',
      onPress: () => {
        onClose();
        onPickCamera();
      },
    },
    {
      id: 'document',
      label: 'Document',
      icon: 'document-text-outline',
      onPress: () => {
        onClose();
        onPickDocument();
      },
    },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 12) }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />
          <Text style={styles.title}>Attach</Text>
          {options.map((opt) => (
            <TouchableOpacity key={opt.id} style={styles.row} onPress={opt.onPress}>
              <View style={styles.iconWrap}>
                <Ionicons name={opt.icon} size={24} color="#075E54" />
              </View>
              <Text style={styles.rowLabel}>{opt.label}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
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
