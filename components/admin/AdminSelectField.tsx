import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal, FlatList, Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';

export type SelectOption = { value: string; label: string };

type Props = {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
};

export function AdminSelectField({ label, value, options, onChange, placeholder }: Props) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <View style={styles.fieldGroup}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TouchableOpacity style={styles.selectBtn} onPress={() => setOpen(true)} activeOpacity={0.7}>
        <Text style={[styles.selectText, !selected && styles.placeholder]} numberOfLines={1}>
          {selected?.label ?? placeholder ?? 'Select…'}
        </Text>
        <Ionicons name="chevron-down" size={18} color={Colors.textSecondary} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{label || 'Select'}</Text>
            <FlatList
              data={options}
              keyExtractor={(item) => item.value || '__empty__'}
              renderItem={({ item }) => {
                const active = item.value === value;
                return (
                  <TouchableOpacity
                    style={[styles.optionRow, active && styles.optionRowActive]}
                    onPress={() => {
                      onChange(item.value);
                      setOpen(false);
                    }}
                  >
                    <Text style={[styles.optionText, active && styles.optionTextActive]} numberOfLines={2}>
                      {item.label}
                    </Text>
                    {active ? <Ionicons name="checkmark" size={18} color={Colors.primary} /> : null}
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  fieldGroup: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  selectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: Colors.surface,
  },
  selectText: { flex: 1, fontSize: 14, color: Colors.text, marginRight: 8 },
  placeholder: { color: Colors.textMuted },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 16,
    paddingBottom: 24,
    maxHeight: '60%',
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderLight,
  },
  optionRowActive: { backgroundColor: Colors.primaryLight },
  optionText: { flex: 1, fontSize: 15, color: Colors.text },
  optionTextActive: { fontWeight: '600', color: Colors.primary },
});
