import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatDistanceToNow } from 'date-fns';
import type { CallLog } from '../../lib/types';
import {
  callDisplayName,
  callDisplayStatus,
  callPeerNumber,
  callStatusStyle,
  callTalkSeconds,
  formatCallDuration,
  isUnansweredCall,
} from '../../lib/call-utils';
import { CallsTheme } from '../../constants/callsTheme';

type Props = {
  call: CallLog;
  contacts?: Record<string, string>;
  onPress: () => void;
  onCallBack?: (peerNumber: string) => void;
};

export function CallListRow({ call, contacts, onPress, onCallBack }: Props) {
  const isIncoming = call.direction === 'incoming';
  const status = callStatusStyle(callDisplayStatus(call));
  const name = callDisplayName(call, contacts);
  const peer = callPeerNumber(call);
  const showPeer = peer && name !== peer;
  const canCallBack = !!peer && !!onCallBack;
  const unanswered = isUnansweredCall(call);
  const talkSecs = callTalkSeconds(call);
  const accent = unanswered ? CallsTheme.red : isIncoming ? CallsTheme.green : CallsTheme.blue;
  const avatarBg = unanswered ? CallsTheme.redLight : isIncoming ? CallsTheme.greenLight : CallsTheme.blueLight;

  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.82}>
      <View style={[styles.accent, { backgroundColor: accent }]} />
      <View style={[styles.avatar, { backgroundColor: avatarBg }]}>
        <Ionicons
          name={isIncoming ? 'arrow-down' : 'arrow-up'}
          size={17}
          color={accent}
        />
      </View>
      <View style={styles.body}>
        <View style={styles.top}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          <Text style={styles.time}>
            {call.created_at ? formatDistanceToNow(new Date(call.created_at), { addSuffix: true }) : ''}
          </Text>
        </View>
        {showPeer ? (
          <Text style={styles.peer} numberOfLines={1}>
            {peer}
          </Text>
        ) : null}
        <View style={styles.meta}>
          <View style={[styles.statusPill, { backgroundColor: status.bg }]}>
            <Text style={[styles.statusText, { color: status.text }]}>{status.label}</Text>
          </View>
          {call.recording_sid ? (
            <View style={styles.recRow}>
              <View style={styles.recBadge}>
                <Ionicons name="mic" size={11} color={CallsTheme.blue} />
              </View>
              {talkSecs != null ? (
                <Text style={styles.duration}>{formatCallDuration(talkSecs)}</Text>
              ) : null}
            </View>
          ) : talkSecs != null ? (
            <Text style={styles.duration}>{formatCallDuration(talkSecs)}</Text>
          ) : null}
        </View>
      </View>
      {canCallBack ? (
        <TouchableOpacity
          style={styles.callBtn}
          onPress={() => onCallBack(peer)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel={`Call back ${name}`}
        >
          <Ionicons name="call" size={18} color={CallsTheme.green} />
        </TouchableOpacity>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: CallsTheme.surface,
    borderRadius: 16,
    marginHorizontal: 16,
    paddingVertical: 14,
    paddingRight: 12,
    paddingLeft: 0,
    gap: 12,
    borderWidth: 1,
    borderColor: CallsTheme.border,
    shadowColor: '#1a2b4a',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
    overflow: 'hidden',
  },
  accent: {
    width: 4,
    alignSelf: 'stretch',
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 3, minWidth: 0 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { flex: 1, fontSize: 16, fontWeight: '600', color: CallsTheme.text, letterSpacing: -0.2 },
  time: { fontSize: 12, color: CallsTheme.textMuted },
  peer: { fontSize: 13, color: CallsTheme.textSecondary, fontVariant: ['tabular-nums'] },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  recRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  statusText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
  duration: { fontSize: 12, color: CallsTheme.textSecondary, fontVariant: ['tabular-nums'] },
  recBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: CallsTheme.blueLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: CallsTheme.greenLight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(24,128,56,0.15)',
  },
});
