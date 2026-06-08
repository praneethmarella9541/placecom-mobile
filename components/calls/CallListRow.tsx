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
} from '../../lib/call-utils';
import { CallsTheme } from '../../constants/callsTheme';

type Props = {
  call: CallLog;
  contacts?: Record<string, string>;
  onPress: () => void;
};

export function CallListRow({ call, contacts, onPress }: Props) {
  const isIncoming = call.direction === 'incoming';
  const status = callStatusStyle(callDisplayStatus(call));
  const name = callDisplayName(call, contacts);
  const peer = callPeerNumber(call);
  const showPeer = peer && name !== peer;

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.75}>
      <View style={[styles.avatar, { backgroundColor: isIncoming ? CallsTheme.greenLight : CallsTheme.blueLight }]}>
        <Ionicons
          name={isIncoming ? 'arrow-down' : 'arrow-up'}
          size={18}
          color={isIncoming ? CallsTheme.green : CallsTheme.blue}
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
          <Text style={styles.metaDot}>·</Text>
          <Text style={styles.duration}>{formatCallDuration(callTalkSeconds(call))}</Text>
          {call.recording_sid ? (
            <>
              <Text style={styles.metaDot}>·</Text>
              <Ionicons name="mic" size={12} color={CallsTheme.blue} />
            </>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: CallsTheme.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: CallsTheme.border,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, gap: 4, minWidth: 0 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  name: { flex: 1, fontSize: 16, fontWeight: '500', color: CallsTheme.text },
  time: { fontSize: 12, color: CallsTheme.textMuted },
  peer: { fontSize: 13, color: CallsTheme.textSecondary },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 4 },
  statusText: { fontSize: 11, fontWeight: '600' },
  metaDot: { fontSize: 12, color: CallsTheme.textMuted },
  duration: { fontSize: 12, color: CallsTheme.textSecondary },
});
