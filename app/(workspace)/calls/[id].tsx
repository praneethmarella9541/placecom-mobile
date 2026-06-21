import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Slider from '@react-native-community/slider';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import { callsApi } from '../../../lib/api';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../hooks/useAuth';
import { useWhatsAppContacts } from '../../../hooks/useWhatsAppContacts';
import { CallsTheme } from '../../../constants/callsTheme';
import {
  callDisplayName,
  callDisplayStatus,
  callPeerNumber,
  callStatusStyle,
  callTalkSeconds,
  formatCallDuration,
  normalisePhone,
} from '../../../lib/call-utils';
import type { CallLog } from '../../../lib/types';

const AGENT_PHONE_KEY = 'thenucleus:agent_phone';
const AGENT_PHONE_KEY_LEGACY = 'placecom:agent_phone';

function WaveformDecor({ active }: { active: boolean }) {
  const heights = [10, 16, 8, 20, 12, 18, 9, 14, 11, 17, 8, 15];
  return (
    <View style={playerStyles.waveRow}>
      {heights.map((h, i) => (
        <View
          key={i}
          style={[
            playerStyles.waveBar,
            {
              height: h,
              opacity: active ? 0.55 + (i % 3) * 0.15 : 0.25,
              backgroundColor: active ? CallsTheme.blue : CallsTheme.border,
            },
          ]}
        />
      ))}
    </View>
  );
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

  const currentTime = seeking ? seekValue : (status.currentTime ?? 0);
  const duration = status.duration ?? 0;

  return (
    <View style={playerStyles.container}>
      <View style={playerStyles.header}>
        <View style={playerStyles.iconBadge}>
          <Ionicons name="mic" size={16} color={CallsTheme.blue} />
        </View>
        <View style={playerStyles.headerText}>
          <Text style={playerStyles.label}>Call recording</Text>
          <Text style={playerStyles.sub}>
            {duration > 0 ? formatCallDuration(Math.floor(duration)) : 'Loading…'}
          </Text>
        </View>
      </View>
      <WaveformDecor active={!!status.playing} />
      <View style={playerStyles.controls}>
        <TouchableOpacity
          style={playerStyles.playBtn}
          onPress={() => (status.playing ? player.pause() : player.play())}
          accessibilityLabel={status.playing ? 'Pause' : 'Play'}
        >
          <Ionicons
            name={status.playing ? 'pause' : 'play'}
            size={22}
            color={CallsTheme.fabIcon}
          />
        </TouchableOpacity>
        <View style={playerStyles.progress}>
          <Slider
            style={{ flex: 1, height: 32 }}
            minimumValue={0}
            maximumValue={duration > 0 ? duration : 1}
            value={currentTime}
            onValueChange={(v) => {
              setSeeking(true);
              setSeekValue(v);
            }}
            onSlidingComplete={(v) => {
              setSeeking(false);
              player.seekTo(v);
            }}
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
    borderRadius: 16,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: CallsTheme.border,
    shadowColor: '#1a2b4a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: CallsTheme.blueLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerText: { flex: 1, gap: 2 },
  label: { fontSize: 15, fontWeight: '700', color: CallsTheme.text, letterSpacing: -0.2 },
  sub: { fontSize: 12, color: CallsTheme.textMuted },
  waveRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    height: 22,
    paddingHorizontal: 4,
    gap: 3,
  },
  waveBar: { flex: 1, borderRadius: 2, maxWidth: 6 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  playBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: CallsTheme.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progress: { flex: 1, gap: 2 },
  times: { flexDirection: 'row', justifyContent: 'space-between' },
  time: { fontSize: 11, color: CallsTheme.textMuted, fontVariant: ['tabular-nums'] },
});

function TimelineRow({
  icon,
  label,
  value,
  last,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <View style={[styles.timelineRow, !last && styles.timelineRowBorder]}>
      <View style={styles.timelineIcon}>
        <Ionicons name={icon} size={16} color={CallsTheme.blue} />
      </View>
      <View style={styles.timelineBody}>
        <Text style={styles.timelineLabel}>{label}</Text>
        <Text style={styles.timelineValue} selectable numberOfLines={3}>
          {value}
        </Text>
      </View>
    </View>
  );
}

// Transcript feature is disabled for now: hide the tab/button and make no
// transcribe API calls. Code is kept intact so it can be re-enabled by flipping
// this flag back to true.
const TRANSCRIPT_ENABLED = false;

export default function CallDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile } = useAuth();
  const { contacts } = useWhatsAppContacts();
  const [call, setCall] = useState<CallLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'details' | 'transcript'>('details');
  const [transcribing, setTranscribing] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [agentPhone, setAgentPhone] = useState('');
  const [virtualNumber, setVirtualNumber] = useState(
    process.env.EXPO_PUBLIC_EXOTEL_VIRTUAL_NUMBER ?? ''
  );
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callRef = useRef<CallLog | null>(null);
  callRef.current = call;
  const recordingPollsRef = useRef(0);
  const MAX_RECORDING_POLLS = 12;

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setToken(data.session?.access_token ?? null));
  }, []);

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

  async function loadCall() {
    if (!id) return;
    const current = callRef.current;
    const isActive = current ? ['in-progress', 'pending'].includes(current.status) : false;
    const awaitingRecording =
      !!current &&
      !isActive &&
      !current.recording_sid &&
      recordingPollsRef.current < MAX_RECORDING_POLLS;

    if (isActive || awaitingRecording) {
      if (awaitingRecording) recordingPollsRef.current += 1;
      try {
        await callsApi.refresh(id);
      } catch {
        /* ignore */
      }
    }

    const { data } = await supabase.from('call_logs').select('*').eq('id', id).maybeSingle();
    setCall(data);
    setLoading(false);

    const terminal = data ? !['pending', 'in-progress'].includes(data.status) : false;
    const recordingResolved =
      !!data?.recording_sid || recordingPollsRef.current >= MAX_RECORDING_POLLS;
    if (terminal && recordingResolved) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
  }

  useEffect(() => {
    recordingPollsRef.current = 0;
    loadCall();
    pollRef.current = setInterval(loadCall, 5000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [id]);

  async function handleTranscribe() {
    if (!TRANSCRIPT_ENABLED) return;
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

  async function placeCallBack() {
    if (!call) return;
    const peer = callPeerNumber(call);
    if (!peer) return;
    const to = normalisePhone(peer.trim());
    if (!/^\+[1-9]\d{7,14}$/.test(to)) {
      Alert.alert('Invalid number', 'This contact has no valid phone number.');
      return;
    }
    if (!virtualNumber) {
      Alert.alert('No Exotel line', 'Ask your admin to assign you an Exotel number under Team.');
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
    await Linking.openURL(`tel:${virtualNumber}`);
  }

  if (loading) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={CallsTheme.blue} size="large" />
      </View>
    );
  }

  if (!call) {
    return (
      <View style={[styles.center, { paddingTop: insets.top }]}>
        <Ionicons name="call-outline" size={40} color={CallsTheme.textMuted} />
        <Text style={styles.muted}>Call not found</Text>
        <TouchableOpacity style={styles.backLink} onPress={() => router.back()}>
          <Text style={styles.backLinkText}>Go back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const status = callStatusStyle(callDisplayStatus(call));
  const isActive = ['pending', 'in-progress'].includes(call.status);
  const isIncoming = call.direction === 'incoming';
  const name = callDisplayName(call, contacts);
  const peer = callPeerNumber(call);
  const accent = isIncoming ? CallsTheme.green : CallsTheme.blue;
  const accentLight = isIncoming ? CallsTheme.greenLight : CallsTheme.blueLight;
  const talkSecs = callTalkSeconds(call);
  const canCallBack = !!peer && !isActive;

  const timelineRows: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }[] = [];
  if (isIncoming) {
    timelineRows.push({ icon: 'arrow-down-circle-outline', label: 'From', value: call.from_number });
    timelineRows.push({ icon: 'arrow-up-circle-outline', label: 'To', value: call.to_number });
  } else {
    timelineRows.push({ icon: 'arrow-up-circle-outline', label: 'To', value: call.to_number });
    timelineRows.push({ icon: 'arrow-down-circle-outline', label: 'From', value: call.from_number });
  }
  if (call.agent_number) {
    timelineRows.push({ icon: 'headset-outline', label: 'Agent line', value: call.agent_number });
  }
  if (call.started_at) {
    timelineRows.push({
      icon: 'play-circle-outline',
      label: 'Started',
      value: format(new Date(call.started_at), 'EEE, MMM d · h:mm a'),
    });
  }
  if (call.ended_at) {
    timelineRows.push({
      icon: 'stop-circle-outline',
      label: 'Ended',
      value: format(new Date(call.ended_at), 'EEE, MMM d · h:mm a'),
    });
  }

  return (
    <View style={styles.container}>
      <View style={[styles.hero, { paddingTop: insets.top + 8 }]}>
        <View style={[styles.heroBgTop, { backgroundColor: accentLight }]} />
        <View style={[styles.heroBgBottom, { backgroundColor: CallsTheme.bg }]} />

        <View style={styles.heroNav}>
          <TouchableOpacity onPress={() => router.back()} style={styles.navBtn}>
            <Ionicons name="arrow-back" size={24} color={CallsTheme.text} />
          </TouchableOpacity>
          <Text style={styles.navTitle} numberOfLines={1}>
            Call details
          </Text>
          <View style={styles.navBtn} />
        </View>

        <View style={styles.heroContent}>
          <View style={[styles.heroRing, { borderColor: accent }]}>
            <View style={[styles.heroAvatar, { backgroundColor: accentLight }]}>
              <Ionicons
                name={isIncoming ? 'arrow-down' : 'arrow-up'}
                size={30}
                color={accent}
              />
            </View>
          </View>
          <Text style={styles.heroName} numberOfLines={2}>
            {name}
          </Text>
          {peer && peer !== name ? (
            <Text style={styles.heroNumber}>{peer}</Text>
          ) : null}
          <View style={styles.heroMeta}>
            <View style={[styles.statusPill, { backgroundColor: status.bg }]}>
              <Text style={[styles.statusText, { color: status.text }]}>{status.label}</Text>
            </View>
            {talkSecs != null ? (
              <>
                <Text style={styles.heroDot}>·</Text>
                <Text style={styles.heroDuration}>{formatCallDuration(talkSecs)}</Text>
              </>
            ) : null}
            {call.recording_sid ? (
              <View style={styles.recChip}>
                <Ionicons name="mic" size={11} color={CallsTheme.blue} />
              </View>
            ) : null}
          </View>
          <Text style={styles.heroDate}>
            {call.created_at ? format(new Date(call.created_at), 'EEEE, MMM d · h:mm a') : ''}
          </Text>
        </View>
      </View>

      <View style={styles.tabPills}>
        {(TRANSCRIPT_ENABLED ? (['details', 'transcript'] as const) : (['details'] as const)).map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.tabPill, tab === t && styles.tabPillActive]}
            onPress={() => setTab(t)}
            activeOpacity={0.8}
          >
            <Ionicons
              name={t === 'details' ? 'information-circle-outline' : 'chatbubbles-outline'}
              size={16}
              color={tab === t ? CallsTheme.blue : CallsTheme.textSecondary}
            />
            <Text style={[styles.tabPillText, tab === t && styles.tabPillTextActive]}>
              {t === 'details' ? 'Details' : 'Transcript'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + (canCallBack ? 88 : 24) }]}
        showsVerticalScrollIndicator={false}
      >
        {tab === 'details' ? (
          <>
            <View style={styles.card}>
              {timelineRows.map((row, i) => (
                <TimelineRow
                  key={row.label}
                  icon={row.icon}
                  label={row.label}
                  value={row.value}
                  last={i === timelineRows.length - 1}
                />
              ))}
            </View>

            {call.recording_sid && token ? (
              <RecordingPlayer key={token} recordingSid={call.recording_sid} token={token} />
            ) : call.recording_sid ? (
              <View style={styles.loadingRec}>
                <ActivityIndicator color={CallsTheme.blue} />
                <Text style={styles.loadingRecText}>Loading recording…</Text>
              </View>
            ) : isActive ? (
              <View style={styles.hintCard}>
                <Ionicons name="radio-outline" size={20} color={CallsTheme.blue} />
                <Text style={styles.hintText}>Recording will appear when the call ends.</Text>
              </View>
            ) : null}

            {call.notes ? (
              <View style={styles.notesCard}>
                <View style={styles.notesHeader}>
                  <Ionicons name="document-text-outline" size={18} color={CallsTheme.textSecondary} />
                  <Text style={styles.notesLabel}>Notes</Text>
                </View>
                <Text style={styles.notesText}>{call.notes}</Text>
              </View>
            ) : null}
          </>
        ) : call.transcript ? (
          <View style={styles.transcriptWrap}>
            {call.transcript_segments?.length
              ? call.transcript_segments.map((seg, i) => (
                  <View
                    key={i}
                    style={[
                      styles.segBubble,
                      i % 2 === 0 ? styles.segBubbleA : styles.segBubbleB,
                    ]}
                  >
                    <Text style={styles.segSpeaker}>{seg.speaker ?? `Speaker ${i + 1}`}</Text>
                    <Text style={styles.segText}>{seg.text}</Text>
                  </View>
                ))
              : (
                <View style={styles.segBubble}>
                  <Text style={styles.segText}>{call.transcript}</Text>
                </View>
              )}
          </View>
        ) : (
          <View style={styles.emptyTranscript}>
            <View style={styles.emptyIcon}>
              <Ionicons name="document-text-outline" size={32} color={CallsTheme.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>No transcript yet</Text>
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
                  <>
                    <Ionicons name="sparkles-outline" size={18} color={CallsTheme.fabIcon} />
                    <Text style={styles.transcribeBtnText}>Generate transcript</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      </ScrollView>

      {canCallBack ? (
        <View style={[styles.callBackBar, { paddingBottom: insets.bottom + 12 }]}>
          <TouchableOpacity
            style={[styles.callBackBtn, placing && { opacity: 0.7 }]}
            onPress={() => void placeCallBack()}
            disabled={placing}
            activeOpacity={0.85}
          >
            {placing ? (
              <ActivityIndicator color={CallsTheme.fabIcon} size="small" />
            ) : (
              <>
                <Ionicons name="call" size={20} color={CallsTheme.fabIcon} />
                <Text style={styles.callBackText}>Call back {name}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: CallsTheme.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  muted: { color: CallsTheme.textSecondary, fontSize: 15 },
  backLink: {
    marginTop: 8,
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: CallsTheme.blue,
    borderRadius: 20,
  },
  backLinkText: { color: CallsTheme.fabIcon, fontWeight: '600', fontSize: 14 },

  hero: {
    position: 'relative',
    overflow: 'hidden',
    paddingBottom: 20,
  },
  heroBgTop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '55%',
    opacity: 0.55,
  },
  heroBgBottom: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '50%',
  },
  heroNav: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    zIndex: 1,
  },
  navBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  navTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: CallsTheme.text,
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  heroContent: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 8,
    gap: 6,
    zIndex: 1,
  },
  heroRing: {
    padding: 3,
    borderRadius: 40,
    borderWidth: 2,
    marginBottom: 4,
  },
  heroAvatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroName: {
    fontSize: 22,
    fontWeight: '700',
    color: CallsTheme.text,
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  heroNumber: { fontSize: 15, color: CallsTheme.textSecondary, fontVariant: ['tabular-nums'] },
  heroMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  statusPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  statusText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
  heroDot: { color: CallsTheme.textMuted },
  heroDuration: { fontSize: 14, fontWeight: '600', color: CallsTheme.textSecondary, fontVariant: ['tabular-nums'] },
  recChip: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: CallsTheme.blueLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroDate: { fontSize: 13, color: CallsTheme.textMuted, marginTop: 2, textAlign: 'center' },

  tabPills: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: CallsTheme.bg,
  },
  tabPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: CallsTheme.surface,
    borderWidth: 1,
    borderColor: CallsTheme.border,
  },
  tabPillActive: {
    backgroundColor: CallsTheme.blueLight,
    borderColor: 'rgba(26,115,232,0.25)',
  },
  tabPillText: { fontSize: 14, fontWeight: '600', color: CallsTheme.textSecondary },
  tabPillTextActive: { color: CallsTheme.blue },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 14 },

  card: {
    backgroundColor: CallsTheme.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CallsTheme.border,
    overflow: 'hidden',
    shadowColor: '#1a2b4a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  timelineRowBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: CallsTheme.divider },
  timelineIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: CallsTheme.blueLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineBody: { flex: 1, gap: 3, minWidth: 0 },
  timelineLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: CallsTheme.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  timelineValue: { fontSize: 15, color: CallsTheme.text, lineHeight: 21 },

  loadingRec: {
    padding: 28,
    alignItems: 'center',
    gap: 10,
    backgroundColor: CallsTheme.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: CallsTheme.border,
  },
  loadingRecText: { fontSize: 13, color: CallsTheme.textSecondary },
  hintCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    backgroundColor: CallsTheme.blueLight,
    borderWidth: 1,
    borderColor: 'rgba(26,115,232,0.12)',
  },
  hintText: { flex: 1, fontSize: 14, color: CallsTheme.text, lineHeight: 20 },

  notesCard: {
    backgroundColor: CallsTheme.surface,
    borderRadius: 16,
    padding: 16,
    gap: 10,
    borderWidth: 1,
    borderColor: CallsTheme.border,
  },
  notesHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  notesLabel: { fontSize: 13, fontWeight: '700', color: CallsTheme.textSecondary, textTransform: 'uppercase' },
  notesText: { fontSize: 15, color: CallsTheme.text, lineHeight: 22 },

  transcriptWrap: { gap: 10 },
  segBubble: {
    borderRadius: 14,
    padding: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: CallsTheme.border,
  },
  segBubbleA: { backgroundColor: CallsTheme.surface, marginRight: 24 },
  segBubbleB: { backgroundColor: CallsTheme.blueLight, marginLeft: 24, borderColor: 'rgba(26,115,232,0.12)' },
  segSpeaker: { fontSize: 12, fontWeight: '700', color: CallsTheme.blue },
  segText: { fontSize: 15, color: CallsTheme.text, lineHeight: 22 },

  emptyTranscript: { alignItems: 'center', paddingVertical: 48, gap: 10, paddingHorizontal: 24 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: CallsTheme.grayLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 17, fontWeight: '600', color: CallsTheme.text },
  emptySub: { fontSize: 14, color: CallsTheme.textSecondary, textAlign: 'center', lineHeight: 20 },
  transcribeBtn: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: CallsTheme.blue,
    paddingHorizontal: 22,
    paddingVertical: 13,
    borderRadius: 24,
    minWidth: 220,
    justifyContent: 'center',
  },
  transcribeBtnText: { color: CallsTheme.fabIcon, fontWeight: '600', fontSize: 15 },

  callBackBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    backgroundColor: 'rgba(246,248,252,0.96)',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: CallsTheme.border,
  },
  callBackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: CallsTheme.fab,
    paddingVertical: 15,
    borderRadius: 28,
    shadowColor: '#188038',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  callBackText: { color: CallsTheme.fabIcon, fontWeight: '700', fontSize: 16 },
});
