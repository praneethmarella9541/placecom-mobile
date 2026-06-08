import React, { useCallback, useEffect, useState } from 'react';
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
import type { CallLog } from '../../../lib/types';

type CallsTab = 'history' | 'contacts';

const AGENT_PHONE_KEY = 'thenucleus:agent_phone';
const AGENT_PHONE_KEY_LEGACY = 'placecom:agent_phone';

export default function CallsScreen() {
  const router = useRouter();
  const { openDrawer } = useDrawer();
  const { profile } = useAuth();
  const { contacts } = useWhatsAppContacts();
  const insets = useSafeAreaInsets();
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
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

  const loadCalls = useCallback(async () => {
    setError(null);
    try {
      const data = await callsApi.list();
      setCalls(data.logs ?? []);
      if (data.telephony?.mobilePhone) {
        setAgentPhone(data.telephony.mobilePhone);
        setTelephonyFromServer(true);
      }
      if (data.telephony?.exotelVirtualNumber) {
        setVirtualNumber(data.telephony.exotelVirtualNumber);
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load calls');
      setCalls([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadCalls();
  }, [loadCalls]);

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

    let polls = 0;
    const timer = setInterval(async () => {
      polls++;
      await loadCalls();
      if (polls >= 36) clearInterval(timer);
    }, 5000);
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
            />
          )}
          renderSectionHeader={({ section: { title } }) => (
            <Text style={styles.sectionTitle}>{title}</Text>
          )}
          stickySectionHeadersEnabled={false}
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          SectionSeparatorComponent={() => <View style={{ height: 16 }} />}
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
  listContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 100 },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: CallsTheme.textSecondary,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: CallsTheme.green,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
});
