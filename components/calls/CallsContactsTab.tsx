import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Modal,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import EmptyState from '../EmptyState';
import { CallsTheme } from '../../constants/callsTheme';
import { useContacts } from '../../hooks/useContacts';
import { normalisePhone } from '../../lib/call-utils';
import { formatWhatsAppPhone } from '../../lib/whatsapp-utils';
import type { WaContactRow } from '../../lib/wa-contacts-db';

type Props = {
  onCall: (number: string) => void;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '#';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function CallsContactsTab({ onCall }: Props) {
  const { contacts, loading, error, saveContact, removeContact } = useContacts();
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<{ peer: string; name: string; isNew: boolean } | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) => c.name.toLowerCase().includes(q) || c.peer_e164.includes(q)
    );
  }, [contacts, query]);

  function openNew() {
    setEditor({ peer: '', name: '', isNew: true });
    setNameInput('');
    setPhoneInput('');
  }

  function openEdit(c: WaContactRow) {
    setEditor({ peer: c.peer_e164, name: c.name, isNew: false });
    setNameInput(c.name);
    setPhoneInput(c.peer_e164);
  }

  async function handleSave() {
    const name = nameInput.trim();
    const phone = normalisePhone(phoneInput.trim());
    if (!name) {
      Alert.alert('Name required', 'Enter a contact name.');
      return;
    }
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
      Alert.alert('Invalid number', 'Enter a valid number with country code, e.g. +918056101540.');
      return;
    }
    setSaving(true);
    try {
      // If the phone changed on an existing contact, drop the old row first.
      if (editor && !editor.isNew && editor.peer && editor.peer !== phone) {
        await removeContact(editor.peer);
      }
      await saveContact(phone, name);
      setEditor(null);
    } catch (e: unknown) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  function handleDelete() {
    if (!editor || editor.isNew) return;
    Alert.alert('Delete contact', `Remove ${editor.name}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await removeContact(editor.peer);
            setEditor(null);
          } catch (e: unknown) {
            Alert.alert('Could not delete', e instanceof Error ? e.message : 'Something went wrong.');
          }
        },
      },
    ]);
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={CallsTheme.blue} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={CallsTheme.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search contacts"
          placeholderTextColor={CallsTheme.textMuted}
        />
        {query ? (
          <TouchableOpacity onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={18} color={CallsTheme.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.peer_e164}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.row} onPress={() => onCall(item.peer_e164)} activeOpacity={0.75}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(item.name)}</Text>
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.rowPeer} numberOfLines={1}>{formatWhatsAppPhone(item.peer_e164)}</Text>
            </View>
            <TouchableOpacity
              onPress={() => openEdit(item)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.rowAction}
            >
              <Ionicons name="create-outline" size={20} color={CallsTheme.textMuted} />
            </TouchableOpacity>
            <View style={styles.callBtn}>
              <Ionicons name="call" size={18} color={CallsTheme.green} />
            </View>
          </TouchableOpacity>
        )}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        contentContainerStyle={filtered.length === 0 ? { flex: 1 } : styles.listContent}
        ListEmptyComponent={
          <EmptyState
            icon="people-outline"
            title={query ? 'No matches' : 'No contacts yet'}
            subtitle={query ? 'Try a different search' : 'Add a contact — it syncs with WhatsApp and the web app'}
          />
        }
        keyboardShouldPersistTaps="handled"
      />

      <TouchableOpacity style={styles.addFab} onPress={openNew} activeOpacity={0.85}>
        <Ionicons name="person-add" size={22} color={CallsTheme.fabIcon} />
      </TouchableOpacity>

      <Modal visible={!!editor} transparent animationType="fade" onRequestClose={() => setEditor(null)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>{editor?.isNew ? 'New contact' : 'Edit contact'}</Text>
            <TextInput
              style={styles.input}
              value={nameInput}
              onChangeText={setNameInput}
              placeholder="Name"
              placeholderTextColor={CallsTheme.textMuted}
              autoFocus
            />
            <TextInput
              style={styles.input}
              value={phoneInput}
              onChangeText={setPhoneInput}
              placeholder="+91 80561 01540"
              placeholderTextColor={CallsTheme.textMuted}
              keyboardType="phone-pad"
            />
            <View style={styles.sheetActions}>
              {!editor?.isNew ? (
                <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
                  <Ionicons name="trash-outline" size={18} color={CallsTheme.red} />
                </TouchableOpacity>
              ) : null}
              <View style={{ flex: 1 }} />
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditor(null)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
                {saving ? (
                  <ActivityIndicator color={CallsTheme.fabIcon} size="small" />
                ) : (
                  <Text style={styles.saveText}>Save</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: CallsTheme.surface,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: CallsTheme.border,
  },
  searchInput: { flex: 1, fontSize: 15, color: CallsTheme.text, padding: 0 },
  errorText: { color: CallsTheme.red, fontSize: 13, marginHorizontal: 16, marginTop: 8 },
  listContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 120 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: CallsTheme.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: CallsTheme.border,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: CallsTheme.blueLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 15, fontWeight: '700', color: CallsTheme.blue },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 16, fontWeight: '500', color: CallsTheme.text },
  rowPeer: { fontSize: 13, color: CallsTheme.textSecondary, marginTop: 2 },
  rowAction: { padding: 6 },
  callBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: CallsTheme.greenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addFab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: CallsTheme.blue,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: CallsTheme.surface, borderRadius: 14, padding: 20, gap: 12 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: CallsTheme.text },
  input: {
    borderWidth: 1,
    borderColor: CallsTheme.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: CallsTheme.text,
  },
  sheetActions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  deleteBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: CallsTheme.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 12 },
  cancelText: { fontSize: 15, fontWeight: '600', color: CallsTheme.textSecondary },
  saveBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: CallsTheme.green,
    minWidth: 80,
    alignItems: 'center',
  },
  saveText: { fontSize: 15, fontWeight: '600', color: CallsTheme.fabIcon },
});
