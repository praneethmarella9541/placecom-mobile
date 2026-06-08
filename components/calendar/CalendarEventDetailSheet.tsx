import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Pressable,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { CalendarEvent } from '../../lib/types';
import { formatEventWhen } from '../../lib/calendar-utils';
import { CalendarTheme } from '../../constants/calendarTheme';

const RSVP_LABEL: Record<string, string> = {
  accepted: 'Yes',
  declined: 'No',
  tentative: 'Maybe',
  needsAction: 'Awaiting',
};

type Props = {
  event: CalendarEvent | null;
  visible: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onJoinMeet: () => void;
  onCopyMeet: () => void;
};

export function CalendarEventDetailSheet({
  event,
  visible,
  onClose,
  onEdit,
  onDelete,
  onJoinMeet,
  onCopyMeet,
}: Props) {
  if (!event) return null;

  const guests = (event.attendees ?? []).filter((a) => a.email);

  const actions: {
    key: string;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
    primary?: boolean;
    destructive?: boolean;
  }[] = [];

  if (event.hangoutLink) {
    actions.push({
      key: 'join',
      label: 'Join with Google Meet',
      icon: 'videocam',
      onPress: () => {
        onClose();
        onJoinMeet();
      },
      primary: true,
    });
    actions.push({
      key: 'copy-meet',
      label: 'Copy Meet link',
      icon: 'copy-outline',
      onPress: () => {
        onClose();
        onCopyMeet();
      },
    });
  }
  actions.push({
    key: 'edit',
    label: 'Edit event',
    icon: 'create-outline',
    onPress: () => {
      onClose();
      onEdit();
    },
  });
  actions.push({
    key: 'delete',
    label: 'Delete event',
    icon: 'trash-outline',
    onPress: () => {
      onClose();
      onDelete();
    },
    destructive: true,
  });

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.handle} />
          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            <Text style={styles.title}>{event.summary || '(No title)'}</Text>
            <View style={styles.whenRow}>
              <Ionicons name="time-outline" size={18} color={CalendarTheme.blue} />
              <Text style={styles.whenText}>{formatEventWhen(event)}</Text>
            </View>
            {event.location ? (
              <View style={styles.metaRow}>
                <Ionicons name="location-outline" size={18} color={CalendarTheme.textSecondary} />
                <Text style={styles.metaText}>{event.location}</Text>
              </View>
            ) : null}
            {event.description ? (
              <View style={styles.descBlock}>
                <Text style={styles.descLabel}>Description</Text>
                <Text style={styles.descText}>{event.description}</Text>
              </View>
            ) : null}
            {guests.length > 0 ? (
              <View style={styles.guestBlock}>
                <Text style={styles.descLabel}>
                  Guests ({guests.length})
                </Text>
                {guests.map((g) => (
                  <View key={g.email} style={styles.guestRow}>
                    <View style={styles.guestAvatar}>
                      <Text style={styles.guestAvatarText}>
                        {(g.displayName ?? g.email ?? '?').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      {g.displayName ? (
                        <Text style={styles.guestName} numberOfLines={1}>
                          {g.displayName}
                        </Text>
                      ) : null}
                      <Text style={styles.guestEmail} numberOfLines={1}>
                        {g.email}
                      </Text>
                    </View>
                    {g.responseStatus ? (
                      <Text style={styles.rsvp}>
                        {RSVP_LABEL[g.responseStatus] ?? g.responseStatus}
                      </Text>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}
          </ScrollView>
          {actions.map((a) => (
            <TouchableOpacity
              key={a.key}
              style={[styles.actionRow, a.primary && styles.actionPrimary]}
              onPress={a.onPress}
              activeOpacity={0.7}
            >
              <Ionicons
                name={a.icon}
                size={22}
                color={a.destructive ? CalendarTheme.red : a.primary ? CalendarTheme.blue : CalendarTheme.textSecondary}
              />
              <Text
                style={[
                  styles.actionLabel,
                  a.destructive && styles.destructive,
                  a.primary && styles.primaryLabel,
                ]}
              >
                {a.label}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.cancel} onPress={onClose}>
            <Text style={styles.cancelText}>Close</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: CalendarTheme.bg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    maxHeight: '88%',
    paddingBottom: 24,
  },
  handle: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: CalendarTheme.border,
    marginTop: 10,
    marginBottom: 8,
  },
  scroll: { paddingHorizontal: 20, maxHeight: 280 },
  title: { fontSize: 22, fontWeight: '400', color: CalendarTheme.text, marginBottom: 12 },
  whenRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 10 },
  whenText: { flex: 1, fontSize: 15, color: CalendarTheme.text, lineHeight: 22 },
  metaRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  metaText: { flex: 1, fontSize: 15, color: CalendarTheme.textSecondary },
  descBlock: { marginBottom: 14 },
  descLabel: { fontSize: 12, fontWeight: '600', color: CalendarTheme.textSecondary, marginBottom: 6 },
  descText: { fontSize: 14, color: CalendarTheme.text, lineHeight: 20 },
  guestBlock: { marginBottom: 8 },
  guestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: CalendarTheme.divider,
  },
  guestAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: CalendarTheme.blueLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guestAvatarText: { fontSize: 13, fontWeight: '700', color: CalendarTheme.blue },
  guestName: { fontSize: 14, fontWeight: '500', color: CalendarTheme.text },
  guestEmail: { fontSize: 12, color: CalendarTheme.textMuted },
  rsvp: { fontSize: 12, color: CalendarTheme.textSecondary, fontWeight: '500' },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: CalendarTheme.divider,
  },
  actionPrimary: { backgroundColor: CalendarTheme.blueLight },
  actionLabel: { fontSize: 16, color: CalendarTheme.text },
  primaryLabel: { color: CalendarTheme.blue, fontWeight: '600' },
  destructive: { color: CalendarTheme.red },
  cancel: {
    marginTop: 8,
    marginHorizontal: 16,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: CalendarTheme.bgMuted,
    borderRadius: 12,
  },
  cancelText: { fontSize: 16, fontWeight: '600', color: CalendarTheme.textSecondary },
});
