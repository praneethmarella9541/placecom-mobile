import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../components/ScreenHeader';
import EmptyState from '../../../components/EmptyState';
import { useDrawer } from '../_layout';
import { Colors } from '../../../constants/colors';
import { useContacts } from '../../../hooks/useContacts';
import { normalisePhone } from '../../../lib/call-utils';
import { formatWhatsAppPhone } from '../../../lib/whatsapp-utils';
import { contactsApi, type GoogleContact } from '../../../lib/api';
import type { WaContactRow } from '../../../lib/wa-contacts-db';

type Tab = 'mine' | 'google';

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '#';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function ContactsScreen() {
  const { openDrawer } = useDrawer();
  const [tab, setTab] = useState<Tab>('mine');

  return (
    <View style={styles.container}>
      <ScreenHeader title="Contacts" onMenuPress={openDrawer} />
      <View style={styles.tabRow}>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'mine' && styles.tabBtnActive]}
          onPress={() => setTab('mine')}
        >
          <Text style={[styles.tabBtnText, tab === 'mine' && styles.tabBtnTextActive]}>My Contacts</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabBtn, tab === 'google' && styles.tabBtnActive]}
          onPress={() => setTab('google')}
        >
          <Text style={[styles.tabBtnText, tab === 'google' && styles.tabBtnTextActive]}>Google Contacts</Text>
        </TouchableOpacity>
      </View>
      {tab === 'mine' ? <MyContactsTab /> : <GoogleContactsTab />}
    </View>
  );
}

function MyContactsTab() {
  const router = useRouter();
  const { contacts, loading, error, saveContact, removeContact } = useContacts();
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<{ peer: string; name: string; isNew: boolean } | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((c) => c.name.toLowerCase().includes(q) || c.peer_e164.includes(q));
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
        <ActivityIndicator color={Colors.copper} />
      </View>
    );
  }

  return (
    <View style={styles.tabContent}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={Colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search contacts"
          placeholderTextColor={Colors.textMuted}
        />
        {query ? (
          <TouchableOpacity onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <FlatList
        data={filtered}
        keyExtractor={(item) => item.peer_e164}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.row}
            onPress={() => router.push(`/(workspace)/whatsapp/${encodeURIComponent(item.peer_e164)}` as any)}
            activeOpacity={0.75}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials(item.name)}</Text>
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
              <Text style={styles.rowSub} numberOfLines={1}>{formatWhatsAppPhone(item.peer_e164)}</Text>
            </View>
            <TouchableOpacity
              onPress={() => openEdit(item)}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.rowAction}
            >
              <Ionicons name="create-outline" size={20} color={Colors.textMuted} />
            </TouchableOpacity>
            <View style={styles.waBtn}>
              <Ionicons name="logo-whatsapp" size={18} color="#25D366" />
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
        <Ionicons name="person-add" size={22} color={Colors.surface} />
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
              placeholderTextColor={Colors.textMuted}
              autoFocus
            />
            <TextInput
              style={styles.input}
              value={phoneInput}
              onChangeText={setPhoneInput}
              placeholder="+91 80561 01540"
              placeholderTextColor={Colors.textMuted}
              keyboardType="phone-pad"
            />
            <View style={styles.sheetActions}>
              {!editor?.isNew ? (
                <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
                  <Ionicons name="trash-outline" size={18} color={Colors.error} />
                </TouchableOpacity>
              ) : null}
              <View style={{ flex: 1 }} />
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditor(null)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={saving}>
                {saving ? (
                  <ActivityIndicator color={Colors.surface} size="small" />
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

function GoogleContactsTab() {
  const router = useRouter();
  const [contacts, setContacts] = useState<GoogleContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await contactsApi.getGoogleDirectory();
      if (data.error) throw new Error(data.error);
      setContacts(data.contacts ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load Google contacts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.emails.some((e) => e.toLowerCase().includes(q)) ||
        c.phones.some((p) => p.includes(q))
    );
  }, [contacts, query]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.copper} />
      </View>
    );
  }

  return (
    <View style={styles.tabContent}>
      <View style={styles.searchBar}>
        <Ionicons name="search" size={18} color={Colors.textMuted} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search directory"
          placeholderTextColor={Colors.textMuted}
        />
        {query ? (
          <TouchableOpacity onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={18} color={Colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <FlatList
        data={filtered}
        keyExtractor={(item, idx) => `${item.name}-${idx}`}
        renderItem={({ item }) => {
          const email = item.emails[0];
          const phone = item.phones[0];
          return (
            <View style={styles.row}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{initials(item.name)}</Text>
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowName} numberOfLines={1}>{item.name}</Text>
                <Text style={styles.rowSub} numberOfLines={1}>{email || phone || ''}</Text>
              </View>
              {phone ? (
                <TouchableOpacity
                  onPress={() => router.push(`/(workspace)/whatsapp/${encodeURIComponent(phone)}` as any)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={styles.rowAction}
                >
                  <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
                </TouchableOpacity>
              ) : null}
              {email ? (
                <TouchableOpacity
                  onPress={() => router.push(`/(workspace)/inbox/compose?to=${encodeURIComponent(email)}` as any)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  style={styles.rowAction}
                >
                  <Ionicons name="mail-outline" size={20} color={Colors.copper} />
                </TouchableOpacity>
              ) : null}
            </View>
          );
        }}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        contentContainerStyle={filtered.length === 0 ? { flex: 1 } : styles.listContent}
        ListEmptyComponent={
          <EmptyState
            icon="people-outline"
            title={query ? 'No matches' : 'No Google contacts found'}
            subtitle={query ? 'Try a different search' : 'Contacts from the connected Google account will appear here'}
          />
        }
        keyboardShouldPersistTaps="handled"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabContent: { flex: 1 },
  tabRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  tabBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  tabBtnActive: { backgroundColor: Colors.copperTint, borderColor: Colors.copper },
  tabBtnText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  tabBtnTextActive: { color: Colors.copper, fontWeight: '700' },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.surface,
    marginHorizontal: 16,
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: { flex: 1, fontSize: 15, color: Colors.text, padding: 0 },
  errorText: { color: Colors.error, fontSize: 13, marginHorizontal: 16, marginTop: 8 },
  listContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 120 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.copperTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 15, fontWeight: '700', color: Colors.copper },
  rowBody: { flex: 1, minWidth: 0 },
  rowName: { fontSize: 16, fontWeight: '500', color: Colors.text },
  rowSub: { fontSize: 13, color: Colors.textSecondary, marginTop: 2 },
  rowAction: { padding: 6 },
  waBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#E7F9EF',
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
    backgroundColor: Colors.copper,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: Colors.surface, borderRadius: 14, padding: 20, gap: 12 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: Colors.text,
  },
  sheetActions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  deleteBtn: {
    width: 44,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 12 },
  cancelText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  saveBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.copper,
    minWidth: 80,
    alignItems: 'center',
  },
  saveText: { fontSize: 15, fontWeight: '600', color: Colors.surface },
});
