import React from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CalendarTheme } from '../../constants/calendarTheme';
import type { CalendarSendUpdates } from '../../lib/api';

type Props = {
  visible: boolean;
  title: string;
  message: string;
  destructive?: boolean;
  onClose: () => void;
  onChoose: (choice: CalendarSendUpdates) => void;
};

export function CalendarNotifySheet({
  visible,
  title,
  message,
  destructive,
  onClose,
  onChoose,
}: Props) {
  const options: { key: CalendarSendUpdates; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'all', label: 'Notify all guests', icon: 'mail-outline' },
    { key: 'externalOnly', label: 'Notify external guests only', icon: 'people-outline' },
    { key: 'none', label: "Don't notify", icon: 'notifications-off-outline' },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>
          {options.map((o) => (
            <TouchableOpacity
              key={o.key}
              style={styles.row}
              onPress={() => {
                onClose();
                onChoose(o.key);
              }}
              activeOpacity={0.7}
            >
              <Ionicons
                name={o.icon}
                size={22}
                color={destructive && o.key === 'all' ? CalendarTheme.red : CalendarTheme.textSecondary}
              />
              <Text style={[styles.rowLabel, destructive && o.key === 'all' && styles.destructive]}>
                {o.label}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.cancel} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: CalendarTheme.bg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 28,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: CalendarTheme.border,
    marginTop: 10,
    marginBottom: 12,
  },
  title: { fontSize: 18, fontWeight: '600', color: CalendarTheme.text, paddingHorizontal: 20, marginBottom: 6 },
  message: { fontSize: 14, color: CalendarTheme.textSecondary, paddingHorizontal: 20, marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  rowLabel: { fontSize: 16, color: CalendarTheme.text },
  destructive: { color: CalendarTheme.red },
  cancel: {
    marginTop: 8,
    marginHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: CalendarTheme.bgMuted,
    borderRadius: 12,
  },
  cancelText: { fontSize: 16, fontWeight: '600', color: CalendarTheme.textSecondary },
});
