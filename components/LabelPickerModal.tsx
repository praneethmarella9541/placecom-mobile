import React, { useMemo, useState } from 'react';
import {
  Modal, View, Text, TextInput, ScrollView, TouchableOpacity,
  StyleSheet, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { filterSearchableLabels, labelDisplayName } from '../lib/gmail-labels';
import type { GmailLabel } from '../lib/api';

/**
 * Bottom-sheet modal that lists all surfaced labels with checkboxes,
 * a search box at the top, and a "Create new" affordance when the
 * search term doesn't match any existing user label.
 */
export function LabelPickerModal({
  visible,
  allLabels,
  selected,
  onToggle,
  onCreate,
  onClose,
  busy = false,
}: {
  visible: boolean;
  allLabels: GmailLabel[];
  selected: Set<string>;
  onToggle: (labelId: string, nextChecked: boolean) => void;
  onCreate: (name: string) => Promise<void>;
  onClose: () => void;
  busy?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pickable = filterSearchableLabels(allLabels);
    if (!q) return pickable;
    return pickable.filter((l) => labelDisplayName(l).toLowerCase().includes(q));
  }, [allLabels, query]);

  const showCreate =
    query.trim().length > 0 &&
    !allLabels.some(
      (l) => l.type === 'user' && l.name.toLowerCase() === query.trim().toLowerCase()
    );

  async function handleCreate() {
    const name = query.trim();
    if (!name || creating) return;
    setCreating(true);
    try {
      await onCreate(name);
      setQuery('');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title}>Labels</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={22} color={Colors.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.searchRow}>
            <Ionicons name="search-outline" size={16} color={Colors.textMuted} />
            <TextInput
              autoFocus
              style={styles.search}
              value={query}
              onChangeText={setQuery}
              placeholder="Label as…"
              placeholderTextColor={Colors.textMuted}
              autoCapitalize="none"
            />
          </View>

          <ScrollView
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            automaticallyAdjustKeyboardInsets
            keyboardDismissMode="on-drag"
          >
            {filtered.length === 0 ? (
              <Text style={styles.empty}>No matching labels.</Text>
            ) : (
              filtered.map((l) => {
                const checked = selected.has(l.id);
                return (
                  <TouchableOpacity
                    key={l.id}
                    style={styles.row}
                    activeOpacity={0.7}
                    onPress={() => !busy && onToggle(l.id, !checked)}
                  >
                    <View style={[styles.checkbox, checked && styles.checkboxOn]}>
                      {checked && <Ionicons name="checkmark" size={14} color={Colors.surface} />}
                    </View>
                    <Text style={styles.rowText} numberOfLines={1}>
                      {labelDisplayName(l)}
                    </Text>
                    {l.type === 'system' && <Text style={styles.systemTag}>SYSTEM</Text>}
                  </TouchableOpacity>
                );
              })
            )}
          </ScrollView>

          {showCreate && (
            <TouchableOpacity
              style={styles.createBtn}
              onPress={() => void handleCreate()}
              disabled={creating}
            >
              {creating ? (
                <ActivityIndicator size="small" color={Colors.primary} />
              ) : (
                <Ionicons name="add" size={16} color={Colors.primary} />
              )}
              <Text style={styles.createText}>
                {creating ? 'Creating…' : `Create label "${query.trim()}"`}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingTop: 16,
    paddingHorizontal: 16,
    paddingBottom: 24,
    maxHeight: '78%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  title: { fontSize: 16, fontWeight: '700', color: Colors.text },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: Colors.background,
  },
  search: { flex: 1, fontSize: 14, color: Colors.text, padding: 0 },
  list: { marginTop: 10, maxHeight: 360 },
  empty: { fontSize: 13, color: Colors.textMuted, paddingVertical: 14, textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  rowText: { flex: 1, fontSize: 14, color: Colors.text },
  systemTag: { fontSize: 10, color: Colors.textMuted, fontWeight: '600' },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  createText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
});
