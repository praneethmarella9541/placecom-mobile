import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Alert, Modal, TextInput,
  ScrollView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  format, parseISO, startOfMonth, endOfMonth, eachDayOfInterval,
  isSameDay, isToday, addMinutes,
} from 'date-fns';
import ScreenHeader from '../../../components/ScreenHeader';
import { useDrawer } from '../_layout';
import { calendarApi, type CalendarEventInput } from '../../../lib/api';
import { Colors } from '../../../constants/colors';
import type { CalendarEvent } from '../../../lib/types';

const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

function combineDateTime(date: Date, hours: number, minutes: number): Date {
  const d = new Date(date);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

function parseEventDate(e: CalendarEvent): Date | null {
  const s = e.start.dateTime ?? e.start.date;
  if (!s) return null;
  try { return parseISO(s); } catch { return null; }
}

type EditorState = {
  id?: string;
  summary: string;
  location: string;
  description: string;
  startDate: Date;
  startHour: number;
  startMinute: number;
  endDate: Date;
  endHour: number;
  endMinute: number;
  attendeesRaw: string;
};

export default function CalendarScreen() {
  const { openDrawer } = useDrawer();
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date>(new Date());
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const loadEvents = useCallback(async () => {
    try {
      const start = startOfMonth(currentDate).toISOString();
      const end = endOfMonth(currentDate).toISOString();
      const data = await calendarApi.listEvents(start, end);
      setEvents((data.events as CalendarEvent[]) ?? []);
    } catch (e: any) {
      Alert.alert('Could not load calendar', e?.message ?? 'Unknown error');
      setEvents([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentDate]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  const days = eachDayOfInterval({ start: startOfMonth(currentDate), end: endOfMonth(currentDate) });
  const dayEvents = events
    .filter((e) => {
      const d = parseEventDate(e);
      return d && isSameDay(d, selectedDay);
    })
    .sort((a, b) => {
      const da = parseEventDate(a)?.getTime() ?? 0;
      const db = parseEventDate(b)?.getTime() ?? 0;
      return da - db;
    });

  function openNewEvent() {
    const now = new Date();
    const start = combineDateTime(selectedDay, now.getHours() + 1, 0);
    const end = addMinutes(start, 60);
    setEditor({
      summary: '',
      location: '',
      description: '',
      startDate: start,
      startHour: start.getHours(),
      startMinute: 0,
      endDate: end,
      endHour: end.getHours(),
      endMinute: 0,
      attendeesRaw: '',
    });
  }

  function openExistingEvent(e: CalendarEvent) {
    const start = parseEventDate(e) ?? selectedDay;
    const endRaw = e.end.dateTime ?? e.end.date;
    let end: Date;
    try { end = endRaw ? parseISO(endRaw) : addMinutes(start, 60); }
    catch { end = addMinutes(start, 60); }
    const attendees = (e.attendees ?? [])
      .map((a) => a.email)
      .filter((x): x is string => !!x)
      .join(', ');
    setEditor({
      id: e.id,
      summary: e.summary ?? '',
      location: e.location ?? '',
      description: e.description ?? '',
      startDate: start,
      startHour: start.getHours(),
      startMinute: start.getMinutes(),
      endDate: end,
      endHour: end.getHours(),
      endMinute: end.getMinutes(),
      attendeesRaw: attendees,
    });
  }

  async function saveEvent() {
    if (!editor) return;
    if (!editor.summary.trim()) {
      Alert.alert('Title required', 'Please enter an event title.');
      return;
    }
    const start = combineDateTime(editor.startDate, editor.startHour, editor.startMinute);
    const end = combineDateTime(editor.endDate, editor.endHour, editor.endMinute);
    if (end <= start) {
      Alert.alert('Invalid time', 'End time must be after start time.');
      return;
    }

    const attendees = editor.attendeesRaw
      .split(/[,;\n]/)
      .map((s) => s.trim())
      .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
      .map((email) => ({ email }));

    const payload: CalendarEventInput = {
      summary: editor.summary.trim(),
      description: editor.description.trim() || undefined,
      location: editor.location.trim() || undefined,
      start: { dateTime: start.toISOString(), timeZone: LOCAL_TZ },
      end: { dateTime: end.toISOString(), timeZone: LOCAL_TZ },
      attendees: attendees.length > 0 ? attendees : undefined,
    };

    setSaving(true);
    try {
      if (editor.id) {
        await calendarApi.updateEvent(editor.id, payload);
      } else {
        await calendarApi.createEvent(payload);
      }
      setEditor(null);
      await loadEvents();
    } catch (e: any) {
      Alert.alert('Could not save', e?.message ?? 'Unknown error');
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    if (!editor?.id) return;
    Alert.alert(
      'Delete event?',
      `"${editor.summary}" will be removed from your Google Calendar.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: deleteEvent },
      ]
    );
  }

  async function deleteEvent() {
    if (!editor?.id) return;
    setDeleting(true);
    try {
      await calendarApi.deleteEvent(editor.id);
      setEditor(null);
      await loadEvents();
    } catch (e: any) {
      Alert.alert('Could not delete', e?.message ?? 'Unknown error');
    } finally {
      setDeleting(false);
    }
  }

  const prevMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Calendar"
        onMenuPress={openDrawer}
        rightAction={{ icon: 'add-circle-outline', onPress: openNewEvent }}
      />

      <View style={styles.calHeader}>
        <TouchableOpacity onPress={prevMonth} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="chevron-back" size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.monthLabel}>{format(currentDate, 'MMMM yyyy')}</Text>
        <TouchableOpacity onPress={nextMonth} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
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
            const d = parseEventDate(e);
            return d && isSameDay(d, day);
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
        <View style={styles.eventsHeader}>
          <Text style={styles.eventsTitle}>{format(selectedDay, 'EEEE, MMMM d')}</Text>
          <TouchableOpacity onPress={openNewEvent} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.addLink}>+ Add</Text>
          </TouchableOpacity>
        </View>
        {loading ? (
          <ActivityIndicator color={Colors.primary} style={{ marginTop: 16 }} />
        ) : dayEvents.length === 0 ? (
          <Text style={styles.noEvents}>No events scheduled. Tap + to create one.</Text>
        ) : (
          <FlatList
            data={dayEvents}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <EventRow event={item} onPress={() => openExistingEvent(item)} />
            )}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => { setRefreshing(true); loadEvents(); }}
                tintColor={Colors.primary}
              />
            }
          />
        )}
      </View>

      <Modal visible={!!editor} transparent animationType="slide" onRequestClose={() => setEditor(null)}>
        {editor && (
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.modalOverlay}
          >
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{editor.id ? 'Edit Event' : 'New Event'}</Text>
                <TouchableOpacity onPress={() => setEditor(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Ionicons name="close" size={22} color={Colors.text} />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ maxHeight: 480 }} contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
                <FieldLabel label="Title" />
                <TextInput
                  style={styles.input}
                  value={editor.summary}
                  onChangeText={(v) => setEditor({ ...editor, summary: v })}
                  placeholder="Event title"
                  placeholderTextColor={Colors.textMuted}
                />

                <FieldLabel label="Start" />
                <DateTimePickerRow
                  date={editor.startDate}
                  hour={editor.startHour}
                  minute={editor.startMinute}
                  onChange={(d, h, m) => {
                    const newStart = combineDateTime(d, h, m);
                    const newEnd = addMinutes(newStart, 60);
                    setEditor({
                      ...editor,
                      startDate: d,
                      startHour: h,
                      startMinute: m,
                      endDate: newEnd,
                      endHour: newEnd.getHours(),
                      endMinute: newEnd.getMinutes(),
                    });
                  }}
                />

                <FieldLabel label="End" />
                <DateTimePickerRow
                  date={editor.endDate}
                  hour={editor.endHour}
                  minute={editor.endMinute}
                  onChange={(d, h, m) => setEditor({ ...editor, endDate: d, endHour: h, endMinute: m })}
                />

                <FieldLabel label="Location (optional)" />
                <TextInput
                  style={styles.input}
                  value={editor.location}
                  onChangeText={(v) => setEditor({ ...editor, location: v })}
                  placeholder="Location or meeting link"
                  placeholderTextColor={Colors.textMuted}
                />

                <FieldLabel label="Attendees (optional)" />
                <TextInput
                  style={styles.input}
                  value={editor.attendeesRaw}
                  onChangeText={(v) => setEditor({ ...editor, attendeesRaw: v })}
                  placeholder="email1@co.com, email2@co.com"
                  placeholderTextColor={Colors.textMuted}
                  autoCapitalize="none"
                  autoCorrect={false}
                />

                <FieldLabel label="Description (optional)" />
                <TextInput
                  style={[styles.input, styles.inputMulti]}
                  value={editor.description}
                  onChangeText={(v) => setEditor({ ...editor, description: v })}
                  placeholder="Notes / agenda"
                  placeholderTextColor={Colors.textMuted}
                  multiline
                />
              </ScrollView>

              <View style={styles.modalActions}>
                {editor.id && (
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={confirmDelete}
                    disabled={saving || deleting}
                  >
                    {deleting
                      ? <ActivityIndicator size="small" color={Colors.error} />
                      : <Ionicons name="trash-outline" size={20} color={Colors.error} />
                    }
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditor(null)} disabled={saving || deleting}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveBtn} onPress={saveEvent} disabled={saving || deleting}>
                  {saving
                    ? <ActivityIndicator size="small" color={Colors.surface} />
                    : <Text style={styles.saveText}>{editor.id ? 'Save' : 'Create'}</Text>
                  }
                </TouchableOpacity>
              </View>
            </View>
          </KeyboardAvoidingView>
        )}
      </Modal>
    </View>
  );
}

function FieldLabel({ label }: { label: string }) {
  return <Text style={styles.fieldLabel}>{label}</Text>;
}

function DateTimePickerRow({
  date, hour, minute, onChange,
}: {
  date: Date;
  hour: number;
  minute: number;
  onChange: (d: Date, h: number, m: number) => void;
}) {
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);

  return (
    <>
      <View style={styles.dtRow}>
        <TouchableOpacity style={styles.dtPill} onPress={() => { setShowDate(!showDate); setShowTime(false); }}>
          <Ionicons name="calendar-outline" size={14} color={Colors.primary} />
          <Text style={styles.dtPillText}>{format(date, 'EEE, MMM d')}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dtPill} onPress={() => { setShowTime(!showTime); setShowDate(false); }}>
          <Ionicons name="time-outline" size={14} color={Colors.primary} />
          <Text style={styles.dtPillText}>
            {String(hour % 12 === 0 ? 12 : hour % 12).padStart(2, '0')}:
            {String(minute).padStart(2, '0')} {hour < 12 ? 'AM' : 'PM'}
          </Text>
        </TouchableOpacity>
      </View>
      {showDate && (
        <InlineDatePicker
          date={date}
          onChange={(d) => { onChange(d, hour, minute); setShowDate(false); }}
        />
      )}
      {showTime && (
        <InlineTimePicker
          hour={hour}
          minute={minute}
          onChange={(h, m) => onChange(date, h, m)}
          onDone={() => setShowTime(false)}
        />
      )}
    </>
  );
}

/** Tiny inline date picker: month nav + day grid */
function InlineDatePicker({ date, onChange }: { date: Date; onChange: (d: Date) => void }) {
  const [viewMonth, setViewMonth] = useState(new Date(date.getFullYear(), date.getMonth(), 1));
  const days = eachDayOfInterval({ start: startOfMonth(viewMonth), end: endOfMonth(viewMonth) });
  return (
    <View style={styles.pickerCard}>
      <View style={styles.pickerHeader}>
        <TouchableOpacity onPress={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}>
          <Ionicons name="chevron-back" size={18} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.pickerHeaderText}>{format(viewMonth, 'MMMM yyyy')}</Text>
        <TouchableOpacity onPress={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}>
          <Ionicons name="chevron-forward" size={18} color={Colors.text} />
        </TouchableOpacity>
      </View>
      <View style={styles.miniDayHeaders}>
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => (
          <Text key={d} style={styles.miniDayHeaderText}>{d}</Text>
        ))}
      </View>
      <View style={styles.miniGrid}>
        {Array(days[0].getDay()).fill(null).map((_, i) => <View key={`e-${i}`} style={styles.miniDayCell} />)}
        {days.map((day) => {
          const selected = isSameDay(day, date);
          return (
            <TouchableOpacity
              key={day.toISOString()}
              style={[styles.miniDayCell, selected && styles.miniDayCellSelected]}
              onPress={() => onChange(day)}
            >
              <Text style={[styles.miniDayText, selected && styles.miniDayTextSelected]}>{format(day, 'd')}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

/** Tiny inline time picker: hour and minute wheels (15-min increments) */
function InlineTimePicker({
  hour, minute, onChange, onDone,
}: {
  hour: number;
  minute: number;
  onChange: (h: number, m: number) => void;
  onDone: () => void;
}) {
  const minutes = [0, 15, 30, 45];
  return (
    <View style={styles.pickerCard}>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text style={styles.timeColLabel}>Hour</Text>
          <ScrollView style={styles.timeCol} showsVerticalScrollIndicator={false}>
            {Array.from({ length: 24 }, (_, h) => (
              <TouchableOpacity
                key={h}
                style={[styles.timeOption, h === hour && styles.timeOptionSelected]}
                onPress={() => onChange(h, minute)}
              >
                <Text style={[styles.timeOptionText, h === hour && styles.timeOptionTextSelected]}>
                  {String(h).padStart(2, '0')} ({h % 12 === 0 ? 12 : h % 12}{h < 12 ? ' AM' : ' PM'})
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.timeColLabel}>Minute</Text>
          <View style={styles.timeCol}>
            {minutes.map((m) => (
              <TouchableOpacity
                key={m}
                style={[styles.timeOption, m === minute && styles.timeOptionSelected]}
                onPress={() => onChange(hour, m)}
              >
                <Text style={[styles.timeOptionText, m === minute && styles.timeOptionTextSelected]}>
                  :{String(m).padStart(2, '0')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>
      <TouchableOpacity style={styles.doneBtn} onPress={onDone}>
        <Text style={styles.doneBtnText}>Done</Text>
      </TouchableOpacity>
    </View>
  );
}

function EventRow({ event, onPress }: { event: CalendarEvent; onPress: () => void }) {
  const start = event.start.dateTime ?? event.start.date ?? '';
  const end = event.end.dateTime ?? event.end.date ?? '';
  return (
    <TouchableOpacity style={styles.eventRow} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.eventBar} />
      <View style={styles.eventInfo}>
        <Text style={styles.eventTitle} numberOfLines={1}>{event.summary || '(no title)'}</Text>
        {start && (
          <Text style={styles.eventTime}>
            {event.start.dateTime ? format(parseISO(start), 'h:mm a') : 'All day'}
            {event.end.dateTime ? ` – ${format(parseISO(end), 'h:mm a')}` : ''}
          </Text>
        )}
        {event.location && (
          <View style={styles.eventLocation}>
            <Ionicons name="location-outline" size={12} color={Colors.textMuted} />
            <Text style={styles.eventLocationText} numberOfLines={1}>{event.location}</Text>
          </View>
        )}
        {event.hangoutLink && (
          <View style={styles.eventLocation}>
            <Ionicons name="videocam-outline" size={12} color={Colors.primary} />
            <Text style={[styles.eventLocationText, { color: Colors.primary }]} numberOfLines={1}>Google Meet</Text>
          </View>
        )}
      </View>
      <Ionicons name="chevron-forward" size={16} color={Colors.textMuted} />
    </TouchableOpacity>
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
  eventsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  eventsTitle: { fontSize: 14, fontWeight: '700', color: Colors.textSecondary },
  addLink: { fontSize: 14, fontWeight: '700', color: Colors.primary },
  noEvents: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', marginTop: 16 },
  eventRow: { flexDirection: 'row', gap: 12, alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 10, padding: 12, marginBottom: 8 },
  eventBar: { width: 4, height: 36, borderRadius: 2, backgroundColor: Colors.primary },
  eventInfo: { flex: 1, gap: 3 },
  eventTitle: { fontSize: 14, fontWeight: '600', color: Colors.text },
  eventTime: { fontSize: 12, color: Colors.textSecondary },
  eventLocation: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  eventLocationText: { fontSize: 12, color: Colors.textMuted, flex: 1 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 28, gap: 12, maxHeight: '92%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginTop: 4 },
  input: { borderWidth: 1, borderColor: Colors.border, borderRadius: 10, padding: 12, fontSize: 14, color: Colors.text, backgroundColor: Colors.background },
  inputMulti: { minHeight: 70, textAlignVertical: 'top' },

  dtRow: { flexDirection: 'row', gap: 8 },
  dtPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    backgroundColor: Colors.background,
  },
  dtPillText: { fontSize: 13, color: Colors.text, fontWeight: '500' },

  pickerCard: { backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border, borderRadius: 10, padding: 12, gap: 8 },
  pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pickerHeaderText: { fontSize: 14, fontWeight: '700', color: Colors.text },
  miniDayHeaders: { flexDirection: 'row' },
  miniDayHeaderText: { flex: 1, textAlign: 'center', fontSize: 10, fontWeight: '600', color: Colors.textSecondary },
  miniGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  miniDayCell: { width: `${100 / 7}%`, alignItems: 'center', paddingVertical: 6 },
  miniDayCellSelected: { backgroundColor: Colors.primary, borderRadius: 999 },
  miniDayText: { fontSize: 12, color: Colors.text },
  miniDayTextSelected: { color: Colors.surface, fontWeight: '700' },

  timeColLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginBottom: 4, textAlign: 'center' },
  timeCol: { maxHeight: 180 },
  timeOption: { paddingVertical: 8, paddingHorizontal: 8, borderRadius: 6, alignItems: 'center' },
  timeOptionSelected: { backgroundColor: Colors.primary },
  timeOptionText: { fontSize: 13, color: Colors.text },
  timeOptionTextSelected: { color: Colors.surface, fontWeight: '700' },
  doneBtn: { backgroundColor: Colors.primary, borderRadius: 8, padding: 10, alignItems: 'center' },
  doneBtnText: { color: Colors.surface, fontWeight: '700' },

  modalActions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  deleteBtn: { padding: 13, borderRadius: 10, borderWidth: 1, borderColor: Colors.error, alignItems: 'center', justifyContent: 'center', width: 50 },
  cancelBtn: { flex: 1, padding: 13, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  cancelText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  saveBtn: { flex: 1, padding: 13, borderRadius: 10, backgroundColor: Colors.primary, alignItems: 'center' },
  saveText: { fontSize: 15, fontWeight: '700', color: Colors.surface },
});
