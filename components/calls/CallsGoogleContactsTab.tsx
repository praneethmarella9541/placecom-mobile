import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Image,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import EmptyState from '../EmptyState';
import { CallsTheme } from '../../constants/callsTheme';
import { callsApi } from '../../lib/api';
import { formatWhatsAppPhone } from '../../lib/whatsapp-utils';
import { isValidE164, normalizePhone } from '../../lib/phone';

type Props = {
  onCall: (number: string) => void;
};

type GoogleContact = {
  name: string;
  emails: string[];
  phones: string[];
  photoUrl?: string;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '#';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function CallsGoogleContactsTab({ onCall }: Props) {
  const router = useRouter();
  const [contacts, setContacts] = useState<GoogleContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const reqRef = useRef(0);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    const reqId = ++reqRef.current;
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      const data = await callsApi.googleContacts();
      if (reqRef.current !== reqId) return;
      // A call screen can only act on contacts that have a phone number.
      setContacts((data.contacts ?? []).filter((c) => c.phones.length > 0));
      setHint(data.hint ?? null);
    } catch (e: unknown) {
      if (reqRef.current !== reqId) return;
      setError(e instanceof Error ? e.message : 'Failed to load Google contacts');
    } finally {
      if (reqRef.current === reqId) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.phones.some((p) => p.toLowerCase().includes(q)) ||
        c.emails.some((e) => e.includes(q))
    );
  }, [contacts, query]);

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
          placeholder="Search Google contacts"
          placeholderTextColor={CallsTheme.textMuted}
        />
        {query ? (
          <TouchableOpacity onPress={() => setQuery('')}>
            <Ionicons name="close-circle" size={18} color={CallsTheme.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      {hint ? (
        <View style={styles.hintBanner}>
          <Ionicons name="information-circle-outline" size={18} color={CallsTheme.blue} />
          <Text style={styles.hintText}>{hint}</Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.center}>
          <Ionicons name="warning-outline" size={32} color={CallsTheme.red} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => void load()}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item, i) => `${item.name}-${item.phones[0] ?? ''}-${i}`}
          renderItem={({ item }) => {
            const phone = item.phones[0];
            const waPhone = normalizePhone(phone);
            const canWhatsApp = isValidE164(waPhone);
            return (
              <TouchableOpacity
                style={styles.row}
                onPress={() => onCall(phone)}
                activeOpacity={0.75}
              >
                {item.photoUrl ? (
                  <Image source={{ uri: item.photoUrl }} style={styles.avatar} />
                ) : (
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials(item.name)}</Text>
                  </View>
                )}
                <View style={styles.rowBody}>
                  <Text style={styles.rowName} numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text style={styles.rowPeer} numberOfLines={1}>
                    {formatWhatsAppPhone(phone)}
                  </Text>
                </View>
                {canWhatsApp ? (
                  <TouchableOpacity
                    style={styles.waBtn}
                    onPress={() =>
                      router.push(`/(workspace)/whatsapp/${encodeURIComponent(waPhone)}` as never)
                    }
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    accessibilityLabel={`Open WhatsApp chat with ${item.name}`}
                  >
                    <Ionicons name="logo-whatsapp" size={20} color="#25D366" />
                  </TouchableOpacity>
                ) : null}
                <View style={styles.callBtn}>
                  <Ionicons name="call" size={18} color={CallsTheme.green} />
                </View>
              </TouchableOpacity>
            );
          }}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          contentContainerStyle={filtered.length === 0 ? { flex: 1 } : styles.listContent}
          ListEmptyComponent={
            <EmptyState
              icon="people-outline"
              title={query ? 'No matches' : 'No Google contacts'}
              subtitle={
                query
                  ? 'Try a different search'
                  : 'Contacts with a phone number from your Google account will appear here'
              }
            />
          }
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load({ silent: true });
              }}
              tintColor={CallsTheme.blue}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
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
  hintBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    padding: 10,
    backgroundColor: CallsTheme.blueLight,
    borderRadius: 10,
  },
  hintText: { flex: 1, fontSize: 13, color: CallsTheme.text },
  errorText: { fontSize: 14, color: CallsTheme.red, textAlign: 'center', marginTop: 8 },
  retryBtn: {
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: CallsTheme.blue,
    borderRadius: 20,
  },
  retryText: { color: CallsTheme.fabIcon, fontWeight: '600', fontSize: 14 },
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
  callBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: CallsTheme.greenLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  waBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(37,211,102,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
