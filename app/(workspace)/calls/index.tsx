import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Alert, Modal, TextInput,
  KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { formatDistanceToNow } from 'date-fns';
import AsyncStorage from '@react-native-async-storage/async-storage';
import ScreenHeader from '../../../components/ScreenHeader';
import EmptyState from '../../../components/EmptyState';
import Badge from '../../../components/Badge';
import { useDrawer } from '../_layout';
import { callsApi } from '../../../lib/api';
import { Colors } from '../../../constants/colors';
import type { CallLog } from '../../../lib/types';

const VIRTUAL_NUMBER = process.env.EXPO_PUBLIC_EXOTEL_VIRTUAL_NUMBER ?? '';
const AGENT_PHONE_KEY = 'placecom:agent_phone';

function normalisePhone(raw: string): string {
  // Strip spaces, dashes, parentheses
  const cleaned = raw.replace(/[\s\-().]/g, '');
  if (cleaned.startsWith('+')) return cleaned;
  // Bare 10-digit Indian number → prepend +91
  if (/^\d{10}$/.test(cleaned)) return `+91${cleaned}`;
  // Has country code digits but missing +
  if (/^\d{11,14}$/.test(cleaned)) return `+${cleaned}`;
  return cleaned;
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  completed:    { bg: '#D1FAE5', text: '#065F46' },
  'no-answer':  { bg: '#FEE2E2', text: '#991B1B' },
  busy:         { bg: '#FEF3C7', text: '#92400E' },
  failed:       { bg: '#FEE2E2', text: '#991B1B' },
  'in-progress':{ bg: '#DBEAFE', text: '#1E40AF' },
  pending:      { bg: '#F3F4F6', text: '#6B7280' },
};

export default function CallsScreen() {
  const router = useRouter();
  const { openDrawer } = useDrawer();
  const [calls, setCalls] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dialerOpen, setDialerOpen] = useState(false);
  const [destination, setDestination] = useState('');
  const [placing, setPlacing] = useState(false);
  // The phone the user dials FROM (their own SIM number). Required so Exotel's
  // connect webhook can match the right pending row. Persisted locally.
  const [agentPhone, setAgentPhone] = useState('');
  const [editingAgentPhone, setEditingAgentPhone] = useState(false);
  const [agentPhoneDraft, setAgentPhoneDraft] = useState('');

  // Load saved agent phone on mount
  useEffect(() => {
    AsyncStorage.getItem(AGENT_PHONE_KEY)
      .then((v) => { if (v) setAgentPhone(v); })
      .catch(() => {});
  }, []);

  async function saveAgentPhone(raw: string) {
    const normalized = normalisePhone(raw.trim());
    if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
      Alert.alert('Invalid number', 'Enter your phone with country code, e.g. +918056101540.');
      return;
    }
    await AsyncStorage.setItem(AGENT_PHONE_KEY, normalized);
    setAgentPhone(normalized);
    setEditingAgentPhone(false);
  }

  const loadCalls = useCallback(async () => {
    setError(null);
    try {
      const data = await callsApi.list();
      setCalls(data.logs ?? []);
    } catch (e: any) {
      console.error('[calls] load failed:', e?.message);
      setError(e?.message ?? 'Failed to load calls');
      setCalls([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadCalls(); }, [loadCalls]);

  function openDialer() {
    setDestination('');
    setDialerOpen(true);
  }

  async function placeCall() {
    const to = normalisePhone(destination.trim());
    if (!to) {
      Alert.alert('Enter a number', 'Type the number you want to call.');
      return;
    }
    if (!/^\+[1-9]\d{7,14}$/.test(to)) {
      Alert.alert('Invalid number', 'Enter a valid number with country code, e.g. +91 98765 43210 or a 10-digit mobile number.');
      return;
    }
    if (!VIRTUAL_NUMBER) {
      Alert.alert('Not configured', 'Set EXPO_PUBLIC_EXOTEL_VIRTUAL_NUMBER in .env.local');
      return;
    }
    if (!agentPhone) {
      Alert.alert(
        'Set your phone first',
        'Tap "From" to set the phone number you call from. This is needed so the webhook can match this call to your dial.',
      );
      return;
    }

    setPlacing(true);
    try {
      // Register the destination in the DB so Exotel's connect webhook can route to it
      await callsApi.makeCall(to, agentPhone);
    } catch (e: any) {
      setPlacing(false);
      Alert.alert('Failed to register call', e?.message ?? 'Check your backend connection.');
      return;
    }
    setPlacing(false);
    setDialerOpen(false);

    // Open native dialler pre-filled with the Exotel virtual number.
    await Linking.openURL(`tel:${VIRTUAL_NUMBER}`);
    // Poll every 5s for up to 3 minutes until call reaches a terminal status
    let polls = 0;
    const timer = setInterval(async () => {
      polls++;
      await loadCalls();
      if (polls >= 36) clearInterval(timer); // stop after 3 min
    }, 5000);
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Calls"
        onMenuPress={openDrawer}
        rightAction={{ icon: 'call-outline', onPress: openDialer }}
      />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="warning-outline" size={32} color={Colors.error} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => { setLoading(true); loadCalls(); }}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={calls}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <CallRow call={item} onPress={() => router.push(`/(workspace)/calls/${item.id}` as any)} />
          )}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); loadCalls(); }}
              tintColor={Colors.primary}
            />
          }
          ListEmptyComponent={
            <EmptyState icon="call-outline" title="No calls yet" subtitle="Your call history will appear here" />
          }
          contentContainerStyle={calls.length === 0 ? { flex: 1 } : { paddingBottom: 16 }}
        />
      )}

      <Modal visible={dialerOpen} transparent animationType="fade" onRequestClose={() => setDialerOpen(false)}>
        <KeyboardAvoidingView
          style={styles.backdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setDialerOpen(false)} />
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardIcon}>
                <Ionicons name="call-outline" size={20} color={Colors.primary} />
              </View>
              <Text style={styles.cardTitle}>New Call</Text>
            </View>

            <Text style={styles.hint}>
              Enter the destination number. Your dialler will open — call the virtual number and Exotel connects you to the destination.
            </Text>

            {/* From: this device's phone — required so the webhook can match this call. */}
            {editingAgentPhone ? (
              <View style={styles.fromRow}>
                <Text style={styles.fromLabel}>From</Text>
                <TextInput
                  style={[styles.input, { flex: 1, marginVertical: 0 }]}
                  value={agentPhoneDraft}
                  onChangeText={setAgentPhoneDraft}
                  placeholder="+918056101540"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="phone-pad"
                  autoFocus
                />
                <TouchableOpacity onPress={() => saveAgentPhone(agentPhoneDraft)} style={styles.fromBtn}>
                  <Ionicons name="checkmark" size={18} color={Colors.primary} />
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.fromRow}
                onPress={() => { setAgentPhoneDraft(agentPhone); setEditingAgentPhone(true); }}
                activeOpacity={0.7}
              >
                <Text style={styles.fromLabel}>From</Text>
                <Text style={[styles.fromValue, !agentPhone && { color: Colors.textMuted }]}>
                  {agentPhone || 'Tap to set your phone'}
                </Text>
                <Ionicons name="pencil" size={14} color={Colors.textMuted} />
              </TouchableOpacity>
            )}

            <TextInput
              style={styles.input}
              value={destination}
              onChangeText={setDestination}
              placeholder="98765 43210 or +91 98765 43210"
              placeholderTextColor={Colors.textMuted}
              keyboardType="phone-pad"
              autoFocus={!!agentPhone}
            />

            <Text style={styles.viaText}>
              via {VIRTUAL_NUMBER || '— set EXPO_PUBLIC_EXOTEL_VIRTUAL_NUMBER —'}
            </Text>

            <View style={styles.actions}>
              <TouchableOpacity style={[styles.btn, styles.btnCancel]} onPress={() => setDialerOpen(false)}>
                <Text style={styles.btnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnCall, placing && { opacity: 0.6 }]}
                onPress={placeCall}
                disabled={placing}
              >
                {placing
                  ? <ActivityIndicator color={Colors.surface} />
                  : <><Ionicons name="call" size={16} color={Colors.surface} /><Text style={styles.btnCallText}>Call</Text></>
                }
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

function formatDuration(seconds: number | null) {
  if (!seconds) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function CallRow({ call, onPress }: { call: CallLog; onPress: () => void }) {
  const statusColor = STATUS_COLORS[call.status] ?? { bg: Colors.border, text: Colors.textSecondary };
  const isIncoming = call.direction === 'incoming';
  const peer = call.peer_number ?? (isIncoming ? call.from_number : call.to_number);
  const dirIcon: keyof typeof Ionicons.glyphMap = isIncoming ? 'arrow-down-outline' : 'arrow-up-outline';
  const dirColor = isIncoming ? Colors.success : Colors.primary;
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.callIcon, { backgroundColor: statusColor.bg }]}>
        <Ionicons name={isIncoming ? 'call' : 'call-outline'} size={18} color={statusColor.text} />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.company} numberOfLines={1}>{call.company_name ?? peer}</Text>
          <Text style={styles.time}>
            {call.created_at ? formatDistanceToNow(new Date(call.created_at), { addSuffix: true }) : ''}
          </Text>
        </View>
        <View style={styles.dirLine}>
          <Ionicons name={dirIcon} size={12} color={dirColor} />
          <Text style={[styles.dirText, { color: dirColor }]}>
            {isIncoming ? 'Incoming' : 'Outgoing'}
          </Text>
          <Text style={styles.number} numberOfLines={1}>· {peer}</Text>
        </View>
        <View style={styles.rowBottom}>
          <Badge label={call.status} bgColor={statusColor.bg} color={statusColor.text} />
          <Text style={styles.duration}>
            <Ionicons name="time-outline" size={12} /> {formatDuration(call.duration_seconds)}
          </Text>
          {call.recording_sid && (
            <View style={styles.recBadge}>
              <Ionicons name="mic-outline" size={12} color={Colors.primary} />
              <Text style={styles.recText}>REC</Text>
            </View>
          )}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  callIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  rowBody: { flex: 1, gap: 3 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between' },
  company: { fontSize: 14, fontWeight: '600', color: Colors.text, flex: 1 },
  time: { fontSize: 11, color: Colors.textMuted },
  number: { fontSize: 12, color: Colors.textSecondary, flex: 1 },
  dirLine: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dirText: { fontSize: 11, fontWeight: '700' },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  duration: { fontSize: 12, color: Colors.textSecondary },
  recBadge: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  recText: { fontSize: 11, color: Colors.primary, fontWeight: '700' },
  errorText: { fontSize: 14, color: Colors.error, textAlign: 'center', marginTop: 8, paddingHorizontal: 24 },
  retryBtn: { marginTop: 12, paddingHorizontal: 20, paddingVertical: 8, backgroundColor: Colors.primary, borderRadius: 8 },
  retryText: { color: Colors.surface, fontWeight: '600', fontSize: 14 },

  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center', padding: 20,
  },
  card: {
    backgroundColor: Colors.surface, borderRadius: 20,
    padding: 22, gap: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2, shadowRadius: 16, elevation: 10,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardIcon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: '#E0E7FF', alignItems: 'center', justifyContent: 'center',
  },
  cardTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  hint: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  input: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, color: Colors.text, backgroundColor: Colors.background,
  },
  viaText: { fontSize: 11, color: Colors.textMuted },
  fromRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    backgroundColor: Colors.background,
  },
  fromLabel: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary },
  fromValue: { flex: 1, fontSize: 14, color: Colors.text },
  fromBtn: { padding: 4 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 4 },
  btn: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 10, minHeight: 44,
  },
  btnCancel: { backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border },
  btnCancelText: { color: Colors.textSecondary, fontWeight: '600', fontSize: 14 },
  btnCall: { backgroundColor: Colors.primary },
  btnCallText: { color: Colors.surface, fontWeight: '700', fontSize: 14 },
});
