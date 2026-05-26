import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import { callsApi } from '../../../lib/api';
import { supabase } from '../../../lib/supabase';
import { Colors } from '../../../constants/colors';
import Badge from '../../../components/Badge';
import type { CallLog } from '../../../lib/types';

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  completed:    { bg: '#D1FAE5', text: '#065F46' },
  'no-answer':  { bg: '#FEE2E2', text: '#991B1B' },
  busy:         { bg: '#FEF3C7', text: '#92400E' },
  failed:       { bg: '#FEE2E2', text: '#991B1B' },
  'in-progress':{ bg: '#DBEAFE', text: '#1E40AF' },
  pending:      { bg: '#F3F4F6', text: '#6B7280' },
};

function formatDur(seconds: number): string {
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}

function RecordingPlayer({ recordingSid, token }: { recordingSid: string; token: string | null }) {
  const url = callsApi.recordingUrl(recordingSid);
  const source = { uri: url, headers: token ? { Authorization: `Bearer ${token}` } : {} };

  const player = useAudioPlayer(source);
  const status = useAudioPlayerStatus(player);
  const [seeking, setSeeking] = useState(false);
  const [seekValue, setSeekValue] = useState(0);

  useEffect(() => {
    setAudioModeAsync({ playsInSilentModeIOS: true }).catch(() => {});
  }, []);

  function togglePlay() {
    if (status.playing) {
      player.pause();
    } else {
      player.play();
    }
  }

  const currentTime = seeking ? seekValue : (status.currentTime ?? 0);
  const duration = status.duration ?? 0;

  return (
    <View style={playerStyles.container}>
      <View style={playerStyles.row}>
        <Ionicons name="mic" size={16} color={Colors.primary} />
        <Text style={playerStyles.label}>Recording</Text>
      </View>
      <View style={playerStyles.controls}>
        <TouchableOpacity onPress={togglePlay}>
          <Ionicons
            name={status.playing ? 'pause-circle' : 'play-circle'}
            size={40}
            color={Colors.primary}
          />
        </TouchableOpacity>
        <View style={playerStyles.progress}>
          <Slider
            style={{ flex: 1 }}
            minimumValue={0}
            maximumValue={duration > 0 ? duration : 1}
            value={currentTime}
            onValueChange={(v) => { setSeeking(true); setSeekValue(v); }}
            onSlidingComplete={(v) => { setSeeking(false); player.seekTo(v); }}
            minimumTrackTintColor={Colors.primary}
            maximumTrackTintColor={Colors.border}
            thumbTintColor={Colors.primary}
            disabled={duration === 0}
          />
          <View style={playerStyles.times}>
            <Text style={playerStyles.time}>{formatDur(currentTime)}</Text>
            <Text style={playerStyles.time}>{duration > 0 ? formatDur(duration) : '--:--'}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const playerStyles = StyleSheet.create({
  container: {
    backgroundColor: Colors.surface, borderRadius: 10,
    padding: 14, gap: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progress: { flex: 1, gap: 2 },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { fontSize: 11, color: Colors.textMuted },
  error: { fontSize: 12, color: Colors.error },
});

export default function CallDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [call, setCall] = useState<CallLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'details' | 'transcript'>('details');
  const [transcribing, setTranscribing] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setToken(data.session?.access_token ?? null));
  }, []);

  async function loadCall() {
    if (!id) return;
    // If we already know this call is in-progress, ask the backend to refresh from Exotel first
    if (call && ['in-progress', 'pending'].includes(call.status)) {
      try { await callsApi.refresh(id); } catch (e: any) { console.log('[call] refresh failed:', e?.message); }
    }
    const { data } = await supabase
      .from('call_logs')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    setCall(data);
    setLoading(false);
    if (data && !['pending', 'in-progress'].includes(data.status)) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
  }

  useEffect(() => {
    loadCall();
    // Poll every 5s while call is active
    pollRef.current = setInterval(loadCall, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [id]);

  async function handleTranscribe() {
    if (!call) return;
    setTranscribing(true);
    try {
      const result = await callsApi.transcribe(call.id);
      if (result?.transcript) {
        setCall((prev) => prev ? {
          ...prev,
          transcript: result.transcript,
          transcript_segments: result.transcript_segments ?? null,
        } : prev);
        setTab('transcript');
      } else {
        Alert.alert('Transcription failed', result?.error ?? 'No text was produced.');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message ?? 'Failed to transcribe call.');
    } finally {
      setTranscribing(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  if (!call) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Text style={{ color: Colors.textSecondary }}>Call not found</Text>
      </View>
    );
  }

  const sc = STATUS_COLORS[call.status] ?? { bg: Colors.border, text: Colors.textSecondary };
  const duration = call.duration_seconds ?? 0;
  const mins = Math.floor(duration / 60);
  const secs = duration % 60;
  const isActive = ['pending', 'in-progress'].includes(call.status);
  const isIncoming = call.direction === 'incoming';

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Call Details</Text>
        {isActive ? (
          <ActivityIndicator size="small" color={Colors.primary} />
        ) : (
          <View style={{ width: 24 }} />
        )}
      </View>

      <View style={styles.callCard}>
        <View style={[styles.callAvatar, { backgroundColor: sc.bg }]}>
          <Ionicons name="call" size={28} color={sc.text} />
        </View>
        <Text style={styles.callCompany}>{call.company_name ?? (isIncoming ? call.from_number : call.to_number)}</Text>
        <Text style={styles.callNumber}>{isIncoming ? call.from_number : call.to_number}</Text>
        <View style={styles.callMeta}>
          <Ionicons
            name={isIncoming ? 'arrow-down' : 'arrow-up'}
            size={12}
            color={isIncoming ? Colors.success : Colors.primary}
          />
          <Text style={[styles.callDirText, { color: isIncoming ? Colors.success : Colors.primary }]}>
            {isIncoming ? 'Incoming' : 'Outgoing'}
          </Text>
          <Text style={styles.metaDot}>·</Text>
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
            {isIncoming ? (
              <>
                <InfoRow label="Caller" value={call.from_number} />
                <InfoRow label="Received on" value={call.to_number} />
              </>
            ) : (
              <>
                <InfoRow label="To" value={call.to_number} />
                <InfoRow label="From" value={call.from_number} />
              </>
            )}
            {call.agent_number ? <InfoRow label="Agent" value={call.agent_number} /> : null}
            <InfoRow label="Call SID" value={call.call_sid} />
            {call.started_at ? (
              <InfoRow label="Started" value={format(new Date(call.started_at), 'MMM d, yyyy h:mm a')} />
            ) : null}
            {call.ended_at ? (
              <InfoRow label="Ended" value={format(new Date(call.ended_at), 'MMM d, yyyy h:mm a')} />
            ) : null}
            {call.recording_sid && token ? (
              <RecordingPlayer key={token} recordingSid={call.recording_sid} token={token} />
            ) : call.recording_sid ? (
              <View style={{ padding: 14, alignItems: 'center' }}>
                <ActivityIndicator color={Colors.primary} />
              </View>
            ) : null}
            {call.notes ? (
              <View style={styles.notes}>
                <Text style={styles.notesLabel}>Notes</Text>
                <Text style={styles.notesText}>{call.notes}</Text>
              </View>
            ) : null}
          </>
        ) : (
          <>
            {call.transcript ? (
              <>
                {call.transcript_segments?.length ? (
                  call.transcript_segments.map((seg, i) => (
                    <View key={i} style={styles.segment}>
                      <Text style={styles.segSpeaker}>{seg.speaker ?? `Speaker ${i + 1}`}</Text>
                      <Text style={styles.segText}>{seg.text}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.transcriptText}>{call.transcript}</Text>
                )}
              </>
            ) : (
              <View style={styles.noTranscript}>
                <Ionicons name="mic-off-outline" size={32} color={Colors.textMuted} />
                <Text style={styles.noTranscriptText}>No transcript yet</Text>
                {call.recording_sid ? (
                  <TouchableOpacity
                    style={[styles.transcribeBtn, transcribing && { opacity: 0.6 }]}
                    onPress={handleTranscribe}
                    disabled={transcribing}
                  >
                    {transcribing
                      ? <ActivityIndicator color={Colors.surface} size="small" />
                      : <Text style={styles.transcribeBtnText}>Generate Transcript</Text>
                    }
                  </TouchableOpacity>
                ) : (
                  <Text style={styles.noRecordingText}>
                    {isActive ? 'Recording will be available after the call ends.' : 'No recording for this call.'}
                  </Text>
                )}
              </View>
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
      <Text style={styles.infoValue} selectable>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    padding: 16, backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  headerTitle: { fontSize: 16, fontWeight: '700', color: Colors.text },
  callCard: {
    alignItems: 'center', padding: 24, backgroundColor: Colors.surface, gap: 8,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  callAvatar: {
    width: 64, height: 64, borderRadius: 32,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  callCompany: { fontSize: 18, fontWeight: '700', color: Colors.text },
  callNumber: { fontSize: 14, color: Colors.textSecondary },
  callMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'center' },
  metaDot: { color: Colors.textMuted },
  callDuration: { fontSize: 14, color: Colors.textSecondary },
  callDirText: { fontSize: 12, fontWeight: '700', marginLeft: 2 },
  callDate: { fontSize: 13, color: Colors.textMuted },
  tabs: {
    flexDirection: 'row', backgroundColor: Colors.surface,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: Colors.primary },
  tabText: { fontSize: 14, color: Colors.textSecondary },
  tabTextActive: { color: Colors.primary, fontWeight: '700' },
  content: { flex: 1 },
  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    backgroundColor: Colors.surface, padding: 12, borderRadius: 8, gap: 8,
  },
  infoLabel: { fontSize: 13, color: Colors.textSecondary, fontWeight: '600' },
  infoValue: { fontSize: 13, color: Colors.text, flex: 1, textAlign: 'right' },
  notes: { backgroundColor: Colors.surface, padding: 12, borderRadius: 8, gap: 6 },
  notesLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  notesText: { fontSize: 14, color: Colors.text, lineHeight: 20 },
  transcriptText: { fontSize: 14, color: Colors.text, lineHeight: 22 },
  segment: { backgroundColor: Colors.surface, borderRadius: 8, padding: 12, gap: 4 },
  segSpeaker: { fontSize: 12, fontWeight: '700', color: Colors.primary },
  segText: { fontSize: 14, color: Colors.text, lineHeight: 20 },
  noTranscript: { alignItems: 'center', gap: 12, paddingVertical: 32 },
  noTranscriptText: { fontSize: 14, color: Colors.textSecondary },
  transcribeBtn: {
    backgroundColor: Colors.primary, paddingHorizontal: 20, paddingVertical: 10,
    borderRadius: 8, minWidth: 180, alignItems: 'center',
  },
  transcribeBtnText: { color: Colors.surface, fontWeight: '700', fontSize: 14 },
  noRecordingText: { fontSize: 13, color: Colors.textMuted, textAlign: 'center' },
});
