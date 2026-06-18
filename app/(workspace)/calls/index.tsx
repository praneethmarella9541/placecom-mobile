import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Linking,
  AppState,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import EmptyState from '../../../components/EmptyState';
import { useDrawer } from '../_layout';
import { callsApi } from '../../../lib/api';
import { useAuth } from '../../../hooks/useAuth';
import { useWhatsAppContacts } from '../../../hooks/useWhatsAppContacts';
import { CallsTheme } from '../../../constants/callsTheme';
import { CallListRow } from '../../../components/calls/CallListRow';
import { CallsDialerSheet } from '../../../components/calls/CallsDialerSheet';
import { CallsContactsTab } from '../../../components/calls/CallsContactsTab';
import { groupCallsByDate, normalisePhone } from '../../../lib/call-utils';
import { supabase } from '../../../lib/supabase';
import {
  bindCallsPrefetchUser,
  loadPersistedCallsList,
  peekCallsPrefetchCache,
  prefetchCallsList,
  setCallsPrefetchCache,
} from '../../../lib/calls-list-prefetch';
import type { CallLog } from '../../../lib/types';

type CallsTab = 'history' | 'contacts';

const AGENT_PHONE_KEY = 'thenucleus:agent_phone';
const AGENT_PHONE_KEY_LEGACY = 'placecom:agent_phone';

export default function CallsScreen() {
  const router = useRouter();
  const { openDrawer } = useDrawer();
  const { profile, user } = useAuth();
  const userId = user?.id ?? '';
  const { contacts } = useWhatsAppContacts();
  const insets = useSafeAreaInsets();
  const initialCache = peekCallsPrefetchCache();
  const [calls, setCalls] = useState<CallLog[]>(() => initialCache?.logs ?? []);
  const [loading, setLoading] = useState(() => !initialCache);
  const awaitingReturnRef = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialerOpen, setDialerOpen] = useState(false);
  const [dialerPrefill, setDialerPrefill] = useState<string | undefined>();
  const [tab, setTab] = useState<CallsTab>('history');
  const [placing, setPlacing] = useState(false);
  const [agentPhone, setAgentPhone] = useState('');
  const [virtualNumber, setVirtualNumber] = useState(
    process.env.EXPO_PUBLIC_EXOTEL_VIRTUAL_NUMBER ?? ''
  );
  const [telephonyFromServer, setTelephonyFromServer] = useState(false);

  useEffect(() => {
    const fromProfile = profile?.mobile_phone?.trim() ?? '';
    const exotelFromProfile = profile?.exotel_virtual_number?.trim() ?? '';
    if (fromProfile) setAgentPhone(fromProfile);
    if (exotelFromProfile) setVirtualNumber(exotelFromProfile);
  }, [profile?.mobile_phone, profile?.exotel_virtual_number]);

  useEffect(() => {
    if (agentPhone) return;
    (async () => {
      try {
        let v = await AsyncStorage.getItem(AGENT_PHONE_KEY);
        if (!v) v = await AsyncStorage.getItem(AGENT_PHONE_KEY_LEGACY);
        if (v) setAgentPhone(v);
      } catch {
        /* ignore */
      }
    })();
  }, [agentPhone]);

  async function saveAgentPhone(raw: string) {
    const normalized = normalisePhone(raw.trim());
    if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
      Alert.alert('Invalid number', 'Use country code, e.g. +918056101540.');
      return;
    }
    if (!telephonyFromServer) {
      await AsyncStorage.setItem(AGENT_PHONE_KEY, normalized);
    }
    setAgentPhone(normalized);
    if (telephonyFromServer) {
      Alert.alert(
        'Ask your admin',
        'Your mobile number is set by your admin under Team. Contact them to change it.'
      );
    }
  }

  const applyCallsPayload = useCallback(
    (data: {
      logs?: CallLog[];
      telephony?: { mobilePhone: string | null; exotelVirtualNumber: string | null };
    }) => {
      const logs = (data.logs ?? []) as CallLog[];
      setCalls(logs);
      setCallsPrefetchCache(
        {
          logs,
          telephony: data.telephony
            ? {
                mobilePhone: data.telephony.mobilePhone ?? null,
                exotelVirtualNumber: data.telephony.exotelVirtualNumber ?? null,
              }
            : null,
        },
        { userId: userId || undefined }
      );
      if (data.telephony?.mobilePhone) {
        setAgentPhone(data.telephony.mobilePhone);
        setTelephonyFromServer(true);
      }
      if (data.telephony?.exotelVirtualNumber) {
        setVirtualNumber(data.telephony.exotelVirtualNumber);
      }
    },
    [userId]
  );

  const loadCalls = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!opts?.silent) setLoading(true);
      setError(null);
      try {
        const data = await callsApi.list();
        applyCallsPayload(data);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Failed to load calls');
        if (!peekCallsPrefetchCache()) setCalls([]);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [applyCallsPayload]
  );

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && awaitingReturnRef.current) {
        awaitingReturnRef.current = false;
        void loadCalls({ silent: true });
      }
    });
    return () => sub.remove();
  }, [loadCalls]);

  // Refresh the list in real-time whenever a call log is inserted or its
  // status is updated (e.g. Exotel webhook fires after call ends).
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`call-logs-status-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'call_logs', filter: `user_id=eq.${userId}` },
        () => { void loadCalls({ silent: true }); }
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [userId, loadCalls]);

  useEffect(() => {
    if (!userId) return;
    bindCallsPrefetchUser(userId);

    const mem = peekCallsPrefetchCache();
    if (mem) {
      applyCallsPayload({
        logs: mem.logs,
        telephony: mem.telephony ?? undefined,
      });
      setLoading(false);
      void loadCalls({ silent: true });
      return;
    }

    let cancelled = false;
    void (async () => {
      const disk = await loadPersistedCallsList(userId);
      if (cancelled) return;
      if (disk) {
        setCallsPrefetchCache(
          { logs: disk.logs, telephony: disk.telephony },
          { userId, fetchedAt: disk.fetchedAt }
        );
        applyCallsPayload({
          logs: disk.logs,
          telephony: disk.telephony ?? undefined,
        });
        setLoading(false);
      }

      const entry = await prefetchCallsList();
      if (cancelled) return;
      if (entry) {
        applyCallsPayload({
          logs: entry.logs,
          telephony: entry.telephony ?? undefined,
        });
        setLoading(false);
      }

      void loadCalls({ silent: !!(disk || entry) });
    })();

    return () => {
      cancelled = true;
    };
  }, [applyCallsPayload, loadCalls, userId]);

  async function placeCall(destinationRaw: string) {
    const to = normalisePhone(destinationRaw.trim());
    if (!to) {
      Alert.alert('Enter a number', 'Type the number you want to call.');
      return;
    }
    if (!/^\+[1-9]\d{7,14}$/.test(to)) {
      Alert.alert('Invalid number', 'Enter a valid number with country code.');
      return;
    }
    if (!virtualNumber) {
      Alert.alert(
        'No Exotel line',
        'Ask your admin to assign you an Exotel number under Team.'
      );
      return;
    }
    if (!agentPhone) {
      Alert.alert(
        'No mobile number',
        'Ask your admin to add your personal mobile under Team so calls can reach you.'
      );
      return;
    }

    setPlacing(true);
    try {
      await callsApi.makeCall(to, agentPhone);
    } catch (e: unknown) {
      setPlacing(false);
      Alert.alert('Failed to register call', e instanceof Error ? e.message : 'Check your connection.');
      return;
    }
    setPlacing(false);
    setDialerOpen(false);
    await Linking.openURL(`tel:${virtualNumber}`);

    awaitingReturnRef.current = true;
  }

  const sections = groupCallsByDate(calls);

  function openDialer(prefill?: string) {
    setDialerPrefill(prefill);
    setDialerOpen(true);
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 4 }]}>
        <TouchableOpacity onPress={openDrawer} style={styles.headerBtn} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="menu" size={24} color={CallsTheme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Calls</Text>
        <View style={styles.headerBtn} />
      </View>

      <View style={styles.tabs}>
        {([['history', 'Call history'], ['contacts', 'Contacts']] as const).map(([key, label]) => (
          <TouchableOpacity
            key={key}
            style={[styles.tab, tab === key && styles.tabActive]}
            onPress={() => setTab(key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'contacts' ? (
        <CallsContactsTab onCall={(number) => openDialer(number)} />
      ) : (
      <>
      {!agentPhone && !loading ? (
        <TouchableOpacity
          style={styles.setupBanner}
          onPress={() => setDialerOpen(true)}
          activeOpacity={0.8}
        >
          <Ionicons name="information-circle-outline" size={20} color={CallsTheme.blue} />
          <Text style={styles.setupBannerText}>
            Ask your admin to set your mobile and Exotel number under Team
          </Text>
          <Ionicons name="chevron-forward" size={18} color={CallsTheme.textMuted} />
        </TouchableOpacity>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={CallsTheme.blue} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="warning-outline" size={32} color={CallsTheme.red} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); loadCalls(); }}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <CallListRow
              call={item}
              contacts={contacts}
              onPress={() => router.push(`/(workspace)/calls/${item.id}` as any)}
              onCallBack={(number) => void placeCall(number)}
            />
          )}
          renderSectionHeader={({ section: { title } }) => (
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{title}</Text>
            </View>
          )}
          stickySectionHeadersEnabled={false}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          SectionSeparatorComponent={() => <View style={{ height: 8 }} />}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); loadCalls(); }}
              tintColor={CallsTheme.blue}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="call-outline"
              title="No calls yet"
              subtitle="Tap the phone button to place your first call"
            />
          }
          contentContainerStyle={calls.length === 0 ? { flex: 1 } : styles.listContent}
        />
      )}

      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 20 }]}
        onPress={() => openDialer()}
        activeOpacity={0.85}
      >
        <Ionicons name="call" size={26} color={CallsTheme.fabIcon} />
      </TouchableOpacity>
      </>
      )}

      <CallsDialerSheet
        visible={dialerOpen}
        agentPhone={agentPhone}
        virtualNumber={virtualNumber}
        agentPhoneReadOnly={telephonyFromServer}
        placing={placing}
        initialDestination={dialerPrefill}
        onClose={() => { setDialerOpen(false); setDialerPrefill(undefined); }}
        onSaveAgentPhone={saveAgentPhone}
        onPlaceCall={placeCall}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: CallsTheme.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingBottom: 8,
    backgroundColor: CallsTheme.surface,
    borderBottomWidth: 1,
    borderBottomColor: CallsTheme.border,
  },
  headerBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 22, fontWeight: '400', color: CallsTheme.text, textAlign: 'center' },
  tabs: {
    flexDirection: 'row',
    backgroundColor: CallsTheme.surface,
    borderBottomWidth: 1,
    borderBottomColor: CallsTheme.border,
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 3, borderBottomColor: CallsTheme.blue },
  tabText: { fontSize: 14, fontWeight: '500', color: CallsTheme.textSecondary },
  tabTextActive: { color: CallsTheme.blue, fontWeight: '600' },
  setupBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    backgroundColor: CallsTheme.blueLight,
    borderRadius: 10,
  },
  setupBannerText: { flex: 1, fontSize: 14, color: CallsTheme.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { fontSize: 14, color: CallsTheme.red, textAlign: 'center', marginTop: 8 },
  retryBtn: {
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: CallsTheme.blue,
    borderRadius: 20,
  },
  retryText: { color: CallsTheme.fabIcon, fontWeight: '600', fontSize: 14 },
  listContent: { paddingTop: 8, paddingBottom: 100 },
  sectionHeader: {
    marginHorizontal: 16,
    marginBottom: 8,
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: CallsTheme.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    backgroundColor: CallsTheme.divider,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    overflow: 'hidden',
  },
  fab: {
    position: 'absolute',
    right: 20,
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: CallsTheme.fab,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
});
