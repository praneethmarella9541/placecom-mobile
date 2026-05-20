import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Alert, Modal, TextInput,
  KeyboardAvoidingView, Platform, Linking,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { formatDistanceToNow } from 'date-fns';
import ScreenHeader from '../../../components/ScreenHeader';
import EmptyState from '../../../components/EmptyState';
import Badge from '../../../components/Badge';
import { useDrawer } from '../_layout';
import { callsApi } from '../../../lib/api';
import { Colors } from '../../../constants/colors';

const VIRTUAL_NUMBER = process.env.EXPO_PUBLIC_EXOTEL_VIRTUAL_NUMBER ?? '';

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  completed: { bg: '#D1FAE5', text: '#065F46' },
  'no-answer': { bg: '#FEE2E2', text: '#991B1B' },
  busy: { bg: '#FEF3C7', text: '#92400E' },
  failed: { bg: '#FEE2E2', text: '#991B1B' },
  'in-progress': { bg: '#DBEAFE', text: '#1E40AF' },
};

export default function CallsScreen() {
  const router = useRouter();
  const { openDrawer } = useDrawer();
  const [calls, setCalls] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [dialerOpen, setDialerOpen] = useState(false);
  const [destination, setDestination] = useState('');
  const [registering, setRegistering] = useState(false);

  const loadCalls = useCallback(async () => {
    try {
      const data = await callsApi.list();
      setCalls(data.calls ?? []);
    } catch {
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
    const to = destination.trim();
    if (!to) {
      Alert.alert('Enter a number', 'Type the number you want to call.');
      return;
    }
    if (!VIRTUAL_NUMBER) {
      Alert.alert('Not configured', 'Set EXPO_PUBLIC_EXOTEL_VIRTUAL_NUMBER in .env.local');
      return;
    }

    setRegistering(true);
    try {
      // Register destination with backend so Exotel webhook knows where to route
      await callsApi.makeCall(to);
    } catch (e: any) {
      setRegistering(false);
      Alert.alert('Failed to register call', e?.message ?? 'Check your backend.');
      return;
    }
    setRegistering(false);
    setDialerOpen(false);

    // Open native dial pad pre-filled with the Exotel virtual number
    await Linking.openURL(`tel:${VIRTUAL_NUMBER}`);
    loadCalls();
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
      ) : (
        <FlatList
          data={calls}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <CallRow call={item} onPress={() => router.push(`/(workspace)/calls/${item.id}` as any)} />
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadCalls(); }} tintColor={Colors.primary} />}
          ListEmptyComponent={<EmptyState icon="call-outline" title="No calls yet" subtitle="Your call history will appear here" />}
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
              Enter the number you want to call. Your dial pad will open — call the virtual number and Exotel connects you.
            </Text>

            <TextInput
              style={styles.input}
              value={destination}
              onChangeText={setDestination}
              placeholder="+91 98765 43210"
              placeholderTextColor={Colors.textMuted}
              keyboardType="phone-pad"
              autoFocus
            />

            <Text style={styles.viaText}>
              via {VIRTUAL_NUMBER || '— set EXPO_PUBLIC_EXOTEL_VIRTUAL_NUMBER —'}
            </Text>

            <View style={styles.actions}>
              <TouchableOpacity style={[styles.btn, styles.btnCancel]} onPress={() => setDialerOpen(false)}>
                <Text style={styles.btnCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnCall, registering && { opacity: 0.6 }]}
                onPress={placeCall}
                disabled={registering}
              >
                {registering
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

function CallRow({ call, onPress }: { call: any; onPress: () => void }) {
  const statusColor = STATUS_COLORS[call.status] ?? { bg: Colors.border, text: Colors.textSecondary };
  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.7}>
      <View style={[styles.callIcon, { backgroundColor: statusColor.bg }]}>
        <Ionicons name="call-outline" size={18} color={statusColor.text} />
      </View>
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={styles.company} numberOfLines={1}>{call.company ?? call.to_number}</Text>
          <Text style={styles.time}>
            {call.created_at ? formatDistanceToNow(new Date(call.created_at), { addSuffix: true }) : ''}
          </Text>
        </View>
        <Text style={styles.number}>{call.to_number}</Text>
        <View style={styles.rowBottom}>
          <Badge label={call.status} bgColor={statusColor.bg} color={statusColor.text} />
          <Text style={styles.duration}><Ionicons name="time-outline" size={12} /> {formatDuration(call.duration)}</Text>
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
  number: { fontSize: 12, color: Colors.textSecondary },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  duration: { fontSize: 12, color: Colors.textSecondary },
  recBadge: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  recText: { fontSize: 11, color: Colors.primary, fontWeight: '700' },

  // Modal
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
