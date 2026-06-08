import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CalendarEvent } from '../../lib/types';
import { formatEventWhen } from '../../lib/calendar-utils';
import { CalendarTheme } from '../../constants/calendarTheme';

type Props = {
  event: CalendarEvent;
  onPress: () => void;
  onJoinMeet?: () => void;
  color?: string;
};

export function CalendarEventRow({ event, onPress, onJoinMeet, color }: Props) {
  const guestCount = event.attendees?.filter((a) => a.email).length ?? 0;
  const barColor = color ?? CalendarTheme.eventBar;

  return (
    <TouchableOpacity style={styles.row} onPress={onPress} activeOpacity={0.75}>
      <View style={[styles.bar, { backgroundColor: barColor }]} />
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>
          {event.summary || '(No title)'}
        </Text>
        <Text style={styles.when}>{formatEventWhen(event)}</Text>
        {event.location ? (
          <View style={styles.meta}>
            <Ionicons name="location-outline" size={13} color={CalendarTheme.textMuted} />
            <Text style={styles.metaText} numberOfLines={1}>
              {event.location}
            </Text>
          </View>
        ) : null}
        <View style={styles.badges}>
          {event.hangoutLink ? (
            <View style={styles.meetBadge}>
              <Ionicons name="videocam" size={12} color={CalendarTheme.meet} />
              <Text style={styles.meetText}>Google Meet</Text>
            </View>
          ) : null}
          {guestCount > 0 ? (
            <View style={styles.guestBadge}>
              <Ionicons name="people-outline" size={12} color={CalendarTheme.textSecondary} />
              <Text style={styles.guestText}>
                {guestCount} guest{guestCount !== 1 ? 's' : ''}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      {event.hangoutLink && onJoinMeet ? (
        <TouchableOpacity
          style={styles.joinBtn}
          onPress={onJoinMeet}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={styles.joinText}>Join</Text>
        </TouchableOpacity>
      ) : (
        <Ionicons name="chevron-forward" size={18} color={CalendarTheme.textMuted} />
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: CalendarTheme.bg,
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: CalendarTheme.border,
  },
  bar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  info: { flex: 1, gap: 4, minWidth: 0 },
  title: { fontSize: 15, fontWeight: '600', color: CalendarTheme.text },
  when: { fontSize: 13, color: CalendarTheme.textSecondary },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: CalendarTheme.textMuted, flex: 1 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  meetBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  meetText: { fontSize: 12, color: CalendarTheme.meet, fontWeight: '500' },
  guestBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  guestText: { fontSize: 12, color: CalendarTheme.textSecondary },
  joinBtn: {
    backgroundColor: CalendarTheme.blueLight,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  joinText: { fontSize: 13, fontWeight: '700', color: CalendarTheme.blue },
});
