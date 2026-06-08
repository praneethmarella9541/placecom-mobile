import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Slider from '@react-native-community/slider';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import { callsApi } from '../../../lib/api';
import { supabase } from '../../../lib/supabase';
import { useWhatsAppContacts } from '../../../hooks/useWhatsAppContacts';
import { CallsTheme } from '../../../constants/callsTheme';
import {
  callDisplayName,
  callDisplayStatus,
  callPeerNumber,
  callStatusStyle,
  callTalkSeconds,
  formatCallDuration,
} from '../../../lib/call-utils';
import type { CallLog } from '../../../lib/types';

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

  const currentTime = seeking ? seekValue : (status.currentTime ?? 0);
  const duration = status.duration ?? 0;

  return (
    <View style={playerStyles.container}>
      <View style={playerStyles.header}>
        <Ionicons name="mic-outline" size={18} color={CallsTheme.blue} />
        <Text style={playerStyles.label}>Recording</Text>
      </View>
      <View style={playerStyles.controls}>
        <TouchableOpacity onPress={() => (status.playing ? player.pause() : player.play())}>
          <Ionicons
            name={status.playing ? 'pause-circle' : 'play-circle'}
            size={44}
            color={CallsTheme.blue}
          />
        </TouchableOpacity>
        <View style={playerStyles.progress}>
          <Slider
            style={{ flex: 1, height: 32 }}
            minimumValue={0}
            maximumValue={duration > 0 ? duration : 1}
            value={currentTime}
            onValueChange={(v) => { setSeeking(true); setSeekValue(v); }}
            onSlidingComplete={(v) => { setSeeking(false); player.seekTo(v); }}
            minimumTrackTintColor={CallsTheme.blue}
            maximumTrackTintColor={CallsTheme.border}
            thumbTintColor={CallsTheme.blue}
            disabled={duration === 0}
          />
          <View style={playerStyles.times}>
            <Text style={playerStyles.time}>{formatCallDuration(Math.floor(currentTime))}</Text>
            <Text style={playerStyles.time}>
              {duration > 0 ? formatCallDuration(Math.floor(duration)) : '--:--'}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const playerStyles = StyleSheet.create({
  container: {
    backgroundColor: CallsTheme.surface,
    borderRadius: 12,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: CallsTheme.border,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontSize: 14, fontWeight: '600', color: CallsTheme.text },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  progress: { flex: 1, gap: 2 },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { fontSize: 11, color: CallsTheme.textMuted },
});

export default function CallDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { contacts } = useWhatsAppContacts();
  const [call, setCall] = useState<CallLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'details' | 'transcript'>('details');
  const [transcribing, setTranscribing] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Mirror of `call` so the polling closure always sees the latest row instead
  // of the value captured when the interval was created.
  const callRef = useRef<CallLog | null>(null);
  callRef.current = call;
  // Exotel publishes recordings a little while AFTER a call ends, so a row can
  // be terminal (completed/failed) yet still have a null recording_sid. We keep
  // asking the backend to refresh — which pulls the recording from Exotel — for
  // a bounded number of attempts so a finished call eventually gets its audio.
  const recordingPollsRef = useRef(0);
  const MAX_RECORDING_POLLS = 12; // ~1 min at the 5s interval

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setToken(data.session?.access_token ?? null));
  }, []);

  async function loadCall() {
    if (!id) return;
    const current = callRef.current;
    const isActive = current ? ['in-progress', 'pending'].includes(current.status) : false;
    // A finished call that still has no recording is worth refreshing — the
    // recording may have just become available on Exotel after the call ended.
    const awaitingRecording =
      !!current && !isActive && !current.recording_sid &&
      recordingPollsRef.current < MAX_RECORDING_POLLS;

    if (isActive || awaitingRecording) {
      if (awaitingRecording) recordingPollsRef.current += 1;
      try { await callsApi.refresh(id); } catch { /* ignore */ }
    }

    const { data } = await supabase.from('call_logs').select('*').eq('id', id).maybeSingle();
    setCall(data);
    setLoading(false);

    // Stop polling once the call is terminal AND either we have the recording
    // or we've exhausted the recording-fetch attempts.
    const terminal = data ? !['pending', 'in-progress'].includes(data.status) : false;
    const recordingResolved =
      !!data?.recording_sid || recordingPollsRef.current >= MAX_RECORDING_POLLS;
    if (terminal && recordingResolved) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
  }

  useEffect(() => {
    recordingPollsRef.current = 0;
    loadCall();
    pollRef.current = setInterval(loadCall, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [id]);

  async function handleTranscribe() {
    if (!call) return;
    setTranscribing(true);
    try {
      const result = await callsApi.transcribe(call.id);
      if (result?.transcript) {
        setCall((prev) =>
          prev
            ? {
                ...prev,
                transcript: result.transcript,
                transcript_segments: result.transcript_segments ?? null,
              }
            : prev
        );
        setTab('transcript');
      } else {
        Alert.alert('Transcription failed', result?.error ?? 'No text was produced.');
      }
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Failed to transcribe.');
    } finally {
      setTranscribing(false);
    }
  }

  if (loading) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={CallsTheme.blue} />
      </View>
    );
  }

  if (!call) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.muted}>Call not found</Text>
      </View>
    );
  }

  const status = callStatusStyle(callDisplayStatus(call));
  const isActive = ['pending', 'in-progress'].includes(call.status);
  const isIncoming = call.direction === 'incoming';
  const name = callDisplayName(call, contacts);
  const peer = callPeerNumber(call);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={24} color={CallsTheme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {name}
        </Text>
        {isActive ? <ActivityIndicator size="small" color={CallsTheme.blue} /> : <View style={styles.backBtn} />}
      </View>

      <View style={styles.hero}>
        <View style={[styles.heroAvatar, { backgroundColor: isIncoming ? CallsTheme.greenLight : CallsTheme.blueLight }]}>
          <Ionicons
            name={isIncoming ? 'arrow-down' : 'arrow-up'}
            size={28}
            color={isIncoming ? CallsTheme.green : CallsTheme.blue}
          />
        </View>
        {peer && peer !== name ? <Text style={styles.heroNumber}>{peer}</Text> : null}
        <View style={styles.heroMeta}>
          <View style={[styles.statusPill, { backgroundColor: status.bg }]}>
            <Text style={[styles.statusText, { color: status.text }]}>{status.label}</Text>
          </View>
          <Text style={styles.heroDot}>·</Text>
          <Text style={styles.heroDuration}>{formatCallDuration(callTalkSeconds(call))}</Text>
        </View>
        <Text style={styles.heroDate}>
          {call.created_at ? format(new Date(call.created_at), 'EEE, MMM d · h:mm a') : ''}
        </Text>
      </View>

      <View style={styles.tabs}>
        {(['details', 'transcript'] as const).map((t) => (
          <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'details' ? 'Details' : 'Transcript'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {tab === 'details' ? (
          <>
            <View style={styles.card}>
              {isIncoming ? (
                <>
                  <InfoRow label="From" value={call.from_number} />
                  <InfoRow label="To" value={call.to_number} divider />
                </>
              ) : (
                <>
                  <InfoRow label="To" value={call.to_number} />
                  <InfoRow label="From" value={call.from_number} divider />
                </>
              )}
              {call.agent_number ? <InfoRow label="Agent" value={call.agent_number} divider /> : null}
              {call.started_at ? (
                <InfoRow label="Started" value={format(new Date(call.started_at), 'MMM d, h:mm a')} divider />
              ) : null}
              {call.ended_at ? (
                <InfoRow label="Ended" value={format(new Date(call.ended_at), 'MMM d, h:mm a')} />
              ) : null}
            </View>

            {call.recording_sid && token ? (
              <RecordingPlayer key={token} recordingSid={call.recording_sid} token={token} />
            ) : call.recording_sid ? (
              <View style={styles.loadingRec}>
                <ActivityIndicator color={CallsTheme.blue} />
              </View>
            ) : null}

            {call.notes ? (
              <View style={styles.notesCard}>
                <Text style={styles.notesLabel}>Notes</Text>
                <Text style={styles.notesText}>{call.notes}</Text>
              </View>
            ) : null}
          </>
        ) : call.transcript ? (
          <View style={styles.card}>
            {call.transcript_segments?.length
              ? call.transcript_segments.map((seg, i) => (
                  <View key={i} style={[styles.segment, i > 0 && styles.segmentBorder]}>
                    <Text style={styles.segSpeaker}>{seg.speaker ?? `Speaker ${i + 1}`}</Text>
                    <Text style={styles.segText}>{seg.text}</Text>
                  </View>
                ))
              : (
                <Text style={styles.transcriptPlain}>{call.transcript}</Text>
              )}
          </View>
        ) : (
          <View style={styles.emptyTranscript}>
            <Ionicons name="document-text-outline" size={40} color={CallsTheme.textMuted} />
            <Text style={styles.emptyTitle}>No transcript</Text>
            <Text style={styles.emptySub}>
              {call.recording_sid
                ? 'Generate a transcript from the call recording.'
                : isActive
                  ? 'Available after the call ends.'
                  : 'No recording for this call.'}
            </Text>
            {call.recording_sid ? (
              <TouchableOpacity
                style={[styles.transcribeBtn, transcribing && { opacity: 0.6 }]}
                onPress={handleTranscribe}
                disabled={transcribing}
              >
                {transcribing ? (
                  <ActivityIndicator color={CallsTheme.fabIcon} size="small" />
                ) : (
                  <Text style={styles.transcribeBtnText}>Generate transcript</Text>
                )}
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function InfoRow({ label, value, divider }: { label: string; value: string; divider?: boolean }) {
  return (
    <View style={[styles.infoRow, divider && styles.infoRowBorder]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} selectable numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: CallsTheme.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  muted: { color: CallsTheme.textSecondary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: CallsTheme.surface,
    borderBottomWidth: 1,
    borderBottomColor: CallsTheme.border,
    gap: 8,
  },
  backBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '500', color: CallsTheme.text, textAlign: 'center' },
  hero: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
    backgroundColor: CallsTheme.surface,
    borderBottomWidth: 1,
    borderBottomColor: CallsTheme.border,
    gap: 8,
  },
  heroAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroNumber: { fontSize: 16, color: CallsTheme.textSecondary },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  statusText: { fontSize: 12, fontWeight: '600' },
  heroDot: { color: CallsTheme.textMuted },
  heroDuration: { fontSize: 14, color: CallsTheme.textSecondary },
  heroDate: { fontSize: 13, color: CallsTheme.textMuted, marginTop: 4 },
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
  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 12, paddingBottom: 32 },
  card: {
    backgroundColor: CallsTheme.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: CallsTheme.border,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  infoRowBorder: { borderTopWidth: 1, borderTopColor: CallsTheme.divider },
  infoLabel: { fontSize: 14, color: CallsTheme.textSecondary, width: 72 },
  infoValue: { flex: 1, fontSize: 14, color: CallsTheme.text, textAlign: 'right' },
  loadingRec: { padding: 24, alignItems: 'center' },
  notesCard: {
    backgroundColor: CallsTheme.surface,
    borderRadius: 12,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: CallsTheme.border,
  },
  notesLabel: { fontSize: 12, fontWeight: '600', color: CallsTheme.textSecondary, textTransform: 'uppercase' },
  notesText: { fontSize: 15, color: CallsTheme.text, lineHeight: 22 },
  segment: { padding: 16, gap: 6 },
  segmentBorder: { borderTopWidth: 1, borderTopColor: CallsTheme.divider },
  segSpeaker: { fontSize: 12, fontWeight: '700', color: CallsTheme.blue },
  segText: { fontSize: 15, color: CallsTheme.text, lineHeight: 22 },
  transcriptPlain: { fontSize: 15, color: CallsTheme.text, lineHeight: 22, padding: 16 },
  emptyTranscript: { alignItems: 'center', paddingVertical: 48, gap: 10, paddingHorizontal: 24 },
  emptyTitle: { fontSize: 16, fontWeight: '500', color: CallsTheme.text },
  emptySub: { fontSize: 14, color: CallsTheme.textSecondary, textAlign: 'center', lineHeight: 20 },
  transcribeBtn: {
    marginTop: 8,
    backgroundColor: CallsTheme.blue,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 24,
    minWidth: 200,
    alignItems: 'center',
  },
  transcribeBtnText: { color: CallsTheme.fabIcon, fontWeight: '600', fontSize: 15 },
});
