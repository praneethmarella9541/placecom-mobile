import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { callsApi } from '../../../lib/api';
import { Colors } from '../../../constants/colors';
import Badge from '../../../components/Badge';

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  completed: { bg: '#D1FAE5', text: '#065F46' },
  'no-answer': { bg: '#FEE2E2', text: '#991B1B' },
  busy: { bg: '#FEF3C7', text: '#92400E' },
  failed: { bg: '#FEE2E2', text: '#991B1B' },
};

export default function CallDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [call, setCall] = useState<any>(null);
  const [transcript, setTranscript] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'details' | 'transcript'>('details');

  useEffect(() => {
    if (!id) return;
    Promise.all([
      callsApi.list().then((d) => d.calls?.find((c: any) => c.id === id)),
      callsApi.getTranscript(id).catch(() => null),
    ]).then(([callData, transcriptData]) => {
      setCall(callData);
      setTranscript(transcriptData);
      setLoading(false);
    });
  }, [id]);

  if (loading) return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;
  if (!call) return (
    <View style={styles.center}>
      <Text style={{ color: Colors.textSecondary }}>Call not found</Text>
    </View>
  );

  const sc = STATUS_COLORS[call.status] ?? { bg: Colors.border, text: Colors.textSecondary };
  const mins = call.duration ? Math.floor(call.duration / 60) : 0;
  const secs = call.duration ? call.duration % 60 : 0;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Call Details</Text>
        <View style={{ width: 24 }} />
      </View>

      <View style={styles.callCard}>
        <View style={[styles.callAvatar, { backgroundColor: sc.bg }]}>
          <Ionicons name="call" size={28} color={sc.text} />
        </View>
        <Text style={styles.callCompany}>{call.company ?? call.to_number}</Text>
        <Text style={styles.callNumber}>{call.to_number}</Text>
        <View style={styles.callMeta}>
          <Badge label={call.status} bgColor={sc.bg} color={sc.text} size="md" />
          <Text style={styles.metaDot}>·</Text>
          <Text style={styles.callDuration}>{mins}:{secs.toString().padStart(2, '0')}</Text>
        </View>
        <Text style={styles.callDate}>
          {call.created_at ? format(new Date(call.created_at), 'MMM d, yyyy h:mm a') : ''}
        </Text>
      </View>

      <View style={styles.tabs}>
        {(['details', 'transcript'] as const).map((t) => (
          <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{ padding: 16, gap: 12 }}>
        {tab === 'details' ? (
          <>
            <InfoRow label="From" value={call.from_number} />
            <InfoRow label="To" value={call.to_number} />
            <InfoRow label="Agent Number" value={call.agent_number ?? '—'} />
            <InfoRow label="Call SID" value={call.call_sid} />
            {call.recording_sid && <InfoRow label="Recording SID" value={call.recording_sid} />}
            {call.notes && (
              <View style={styles.notes}>
                <Text style={styles.notesLabel}>Notes</Text>
                <Text style={styles.notesText}>{call.notes}</Text>
              </View>
            )}
          </>
        ) : (
          <>
            {transcript?.transcript ? (
              <>
                <Text style={styles.transcriptText}>{transcript.transcript}</Text>
                {(transcript.segments ?? []).map((seg: any, i: number) => (
                  <View key={i} style={styles.segment}>
                    <Text style={styles.segSpeaker}>{seg.speaker ?? `Speaker ${i + 1}`}</Text>
                    <Text style={styles.segText}>{seg.text}</Text>
                  </View>
                ))}
              </>
            ) : (
              <Text style={{ color: Colors.textSecondary, textAlign: 'center', marginTop: 24 }}>
                No transcript available for this call.
              </Text>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  callCard: {
    alignItems: 'center',
    padding: 24,
    backgroundColor: Colors.surface,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  callAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  callCompany: { fontSize: 18, fontWeight: '700', color: Colors.text },
  callNumber: { fontSize: 14, color: Colors.textSecondary },
  callMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  metaDot: { color: Colors.textMuted },
  callDuration: { fontSize: 14, color: Colors.textSecondary },
  callDate: { fontSize: 13, color: Colors.textMuted },
  tabs: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: Colors.primary },
  tabText: { fontSize: 14, color: Colors.textSecondary },
  tabTextActive: { color: Colors.primary, fontWeight: '700' },
  content: { flex: 1 },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    padding: 12,
    borderRadius: 8,
    gap: 8,
  },
  infoLabel: { fontSize: 13, color: Colors.textSecondary, fontWeight: '600' },
  infoValue: { fontSize: 13, color: Colors.text, flex: 1, textAlign: 'right' },
  notes: { backgroundColor: Colors.surface, padding: 12, borderRadius: 8, gap: 6 },
  notesLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  notesText: { fontSize: 14, color: Colors.text, lineHeight: 20 },
  transcriptText: { fontSize: 14, color: Colors.text, lineHeight: 22 },
  segment: {
    backgroundColor: Colors.surface,
    borderRadius: 8,
    padding: 12,
    gap: 4,
  },
  segSpeaker: { fontSize: 12, fontWeight: '700', color: Colors.primary },
  segText: { fontSize: 14, color: Colors.text, lineHeight: 20 },
});
