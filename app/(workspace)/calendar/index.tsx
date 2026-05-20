import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Alert, Modal, TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay, isToday } from 'date-fns';
import ScreenHeader from '../../../components/ScreenHeader';
import EmptyState from '../../../components/EmptyState';
import { useDrawer } from '../_layout';
import { calendarApi } from '../../../lib/api';
import { Colors } from '../../../constants/colors';
import type { CalendarEvent } from '../../../lib/types';

export default function CalendarScreen() {
  const { openDrawer } = useDrawer();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [saving, setSaving] = useState(false);

  const loadEvents = useCallback(async () => {
    try {
      const start = startOfMonth(currentDate).toISOString();
      const end = endOfMonth(currentDate).toISOString();
      const data = await calendarApi.listEvents(start, end);
      setEvents(data.events ?? []);
    } catch {
      setEvents([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentDate]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  const days = eachDayOfInterval({ start: startOfMonth(currentDate), end: endOfMonth(currentDate) });
  const dayEvents = events.filter((e) => {
    const d = e.start.dateTime ?? e.start.date;
    return d && isSameDay(parseISO(d), selectedDay);
  });

  async function createEvent() {
    if (!newTitle.trim()) return;
    setSaving(true);
    try {
      await calendarApi.createEvent({
        summary: newTitle,
        description: newDesc,
        start: { dateTime: new Date(selectedDay.setHours(10, 0, 0, 0)).toISOString() },
        end: { dateTime: new Date(selectedDay.setHours(11, 0, 0, 0)).toISOString() },
      });
      setShowCreate(false);
      setNewTitle('');
      setNewDesc('');
      await loadEvents();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Calendar"
        onMenuPress={openDrawer}
        rightAction={{ icon: 'add-circle-outline', onPress: () => setShowCreate(true) }}
      />

      <View style={styles.calHeader}>
        <TouchableOpacity onPress={prevMonth}>
          <Ionicons name="chevron-back" size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.monthLabel}>{format(currentDate, 'MMMM yyyy')}</Text>
        <TouchableOpacity onPress={nextMonth}>
          <Ionicons name="chevron-forward" size={22} color={Colors.text} />
        </TouchableOpacity>
      </View>

      <View style={styles.dayHeaders}>
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
          <Text key={d} style={styles.dayHeaderText}>{d}</Text>
        ))}
      </View>

      <View style={styles.grid}>
        {Array(days[0].getDay()).fill(null).map((_, i) => <View key={`empty-${i}`} style={styles.dayCell} />)}
        {days.map((day) => {
          const hasEvents = events.some((e) => {
            const d = e.start.dateTime ?? e.start.date;
            return d && isSameDay(parseISO(d), day);
          });
          const selected = isSameDay(day, selectedDay);
          const today = isToday(day);
          return (
            <TouchableOpacity
              key={day.toISOString()}
              style={[styles.dayCell, selected && styles.dayCellSelected, today && !selected && styles.dayCellToday]}
              onPress={() => setSelectedDay(day)}
            >
              <Text style={[styles.dayText, selected && styles.dayTextSelected, today && !selected && styles.dayTextToday]}>
                {format(day, 'd')}
              </Text>
              {hasEvents && <View style={[styles.eventDot, selected && styles.eventDotSelected]} />}
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.eventsSection}>
        <Text style={styles.eventsTitle}>{format(selectedDay, 'EEEE, MMMM d')}</Text>
        {loading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: 16 }} />
        ) : dayEvents.length === 0 ? (
          <Text style={styles.noEvents}>No events scheduled</Text>
        ) : (
          <FlatList
            data={dayEvents}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <EventRow event={item} />}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadEvents(); }} tintColor={Colors.primary} />}
          />
        )}
      </View>

      <Modal visible={showCreate} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New Event</Text>
            <Text style={styles.modalDate}>{format(selectedDay, 'EEEE, MMMM d')}</Text>
            <TextInput style={styles.input} value={newTitle} onChangeText={setNewTitle} placeholder="Event title" placeholderTextColor={Colors.textMuted} />
            <TextInput style={[styles.input, styles.inputMulti]} value={newDesc} onChangeText={setNewDesc} placeholder="Description (optional)" placeholderTextColor={Colors.textMuted} multiline />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowCreate(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={createEvent} disabled={saving}>
                {saving ? <ActivityIndicator size="small" color={Colors.surface} /> : <Text style={styles.saveText}>Create</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function EventRow({ event }: { event: CalendarEvent }) {
  const start = event.start.dateTime ?? event.start.date ?? '';
  const end = event.end.dateTime ?? event.end.date ?? '';
  return (
    <View style={styles.eventRow}>
      <View style={styles.eventBar} />
      <View style={styles.eventInfo}>
        <Text style={styles.eventTitle}>{event.summary}</Text>
        {start && (
          <Text style={styles.eventTime}>
            {event.start.dateTime ? format(parseISO(start), 'h:mm a') : 'All day'}
            {event.end.dateTime ? ` – ${format(parseISO(end), 'h:mm a')}` : ''}
          </Text>
        )}
        {event.location && (
          <View style={styles.eventLocation}>
            <Ionicons name="location-outline" size={12} color={Colors.textMuted} />
            <Text style={styles.eventLocationText}>{event.location}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  calHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: Colors.surface },
  monthLabel: { fontSize: 16, fontWeight: '700', color: Colors.text },
  dayHeaders: { flexDirection: 'row', backgroundColor: Colors.surface, paddingBottom: 8 },
  dayHeaderText: { flex: 1, textAlign: 'center', fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  grid: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: Colors.surface, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: Colors.border },
  dayCell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 6, gap: 3 },
  dayCellSelected: { backgroundColor: Colors.primary, borderRadius: 999 },
  dayCellToday: { borderWidth: 1.5, borderColor: Colors.primary, borderRadius: 999 },
  dayText: { fontSize: 14, color: Colors.text },
  dayTextSelected: { color: Colors.surface, fontWeight: '700' },
  dayTextToday: { color: Colors.primary, fontWeight: '700' },
  eventDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: Colors.primary },
  eventDotSelected: { backgroundColor: Colors.surface },
  eventsSection: { flex: 1, padding: 16 },
  eventsTitle: { fontSize: 14, fontWeight: '700', color: Colors.textSecondary, marginBottom: 12 },
  noEvents: { fontSize: 14, color: Colors.textMuted, textAlign: 'center', marginTop: 16 },
  eventRow: { flexDirection: 'row', gap: 12, backgroundColor: Colors.surface, borderRadius: 10, padding: 12, marginBottom: 8 },
  eventBar: { width: 4, borderRadius: 2, backgroundColor: Colors.primary },
  eventInfo: { flex: 1, gap: 3 },
  eventTitle: { fontSize: 14, fontWeight: '600', color: Colors.text },
  eventTime: { fontSize: 12, color: Colors.textSecondary },
  eventLocation: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  eventLocationText: { fontSize: 12, color: Colors.textMuted },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 14 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  modalDate: { fontSize: 14, color: Colors.textSecondary },
  input: { borderWidth: 1, borderColor: Colors.border, borderRadius: 10, padding: 12, fontSize: 14, color: Colors.text },
  inputMulti: { minHeight: 80, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: 12 },
  cancelBtn: { flex: 1, padding: 13, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  cancelText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  saveBtn: { flex: 1, padding: 13, borderRadius: 10, backgroundColor: Colors.primary, alignItems: 'center' },
  saveText: { fontSize: 15, fontWeight: '700', color: Colors.surface },
});
