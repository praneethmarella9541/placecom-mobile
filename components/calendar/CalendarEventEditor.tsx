import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  addMinutes,
} from 'date-fns';
import { CalendarTheme, GOOGLE_CALENDAR_COLORS } from '../../constants/calendarTheme';
import { CalendarMonthGrid } from './CalendarMonthGrid';
import { TimeWheelPicker } from './TimeWheelPicker';
import type { CalendarEditorState, RecurrenceOption } from '../../lib/calendar-utils';
import {
  combineDateTime,
  RECURRENCE_LABELS,
} from '../../lib/calendar-utils';

type Contact = { email: string; displayName?: string };

const REMINDER_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'Default', value: null },
  { label: 'None', value: 0 },
  { label: '5 min', value: 5 },
  { label: '10 min', value: 10 },
  { label: '30 min', value: 30 },
  { label: '1 hour', value: 60 },
  { label: '1 day', value: 1440 },
];

const RECURRENCE_ORDER: RecurrenceOption[] = [
  'none',
  'daily',
  'weekdays',
  'weekly',
  'monthly',
  'yearly',
];

type Props = {
  editor: CalendarEditorState | null;
  saving: boolean;
  deleting: boolean;
  attendeeSuggestions: Contact[];
  onClose: () => void;
  onChange: (next: CalendarEditorState) => void;
  onPickAttendee: (contact: Contact) => void;
  onAttendeesChange: (raw: string) => void;
  onSave: () => void;
  onDelete: () => void;
  onJoinMeet?: () => void;
  onCopyMeet?: () => void;
};

export function CalendarEventEditor({
  editor,
  saving,
  deleting,
  attendeeSuggestions,
  onClose,
  onChange,
  onPickAttendee,
  onAttendeesChange,
  onSave,
  onDelete,
  onJoinMeet,
  onCopyMeet,
}: Props) {
  const insets = useSafeAreaInsets();
  const [showRecurrencePicker, setShowRecurrencePicker] = useState(false);
  const [showReminderPicker, setShowReminderPicker] = useState(false);
  const [startPickerOpen, setStartPickerOpen] = useState(false);
  const [endPickerOpen, setEndPickerOpen] = useState(false);
  const pickerScrollLocked = startPickerOpen || endPickerOpen;

  if (!editor) return null;

  const reminderLabel =
    REMINDER_OPTIONS.find((o) => o.value === editor.reminderMinutes)?.label ??
    `${editor.reminderMinutes} min`;

  const selectedColorHex = editor.colorId
    ? GOOGLE_CALENDAR_COLORS[editor.colorId]?.hex
    : undefined;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.overlay}
        keyboardVerticalOffset={0}
      >
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.card, { paddingBottom: Math.max(insets.bottom, 8) }]}>
          {/* Header */}
          <View style={styles.header}>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close" size={24} color={CalendarTheme.text} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>{editor.id ? 'Edit event' : 'New event'}</Text>
            <TouchableOpacity
              style={[styles.saveBtn, (saving || deleting) && { opacity: 0.5 }]}
              onPress={onSave}
              disabled={saving || deleting}
            >
              {saving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={styles.saveBtnText}>{editor.id ? 'Save' : 'Create'}</Text>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
            scrollEnabled={!pickerScrollLocked}
            nestedScrollEnabled
          >
            {/* ── Title ── */}
            <TextInput
              style={styles.titleInput}
              value={editor.summary}
              onChangeText={(v) => onChange({ ...editor, summary: v })}
              placeholder="Event Title"
              placeholderTextColor={CalendarTheme.textMuted}
              returnKeyType="done"
              autoFocus={!editor.id}
            />

            {/* ── Color bar indicator ── */}
            <View style={[styles.colorBar, { backgroundColor: selectedColorHex ?? CalendarTheme.blue }]} />

            {/* ── All-day toggle ── */}
            <Row icon="time-outline">
              <TouchableOpacity
                style={styles.allDayRow}
                onPress={() => onChange({ ...editor, allDay: !editor.allDay })}
                activeOpacity={0.7}
              >
                <Text style={styles.rowText}>All day</Text>
                <Toggle value={editor.allDay} onToggle={() => onChange({ ...editor, allDay: !editor.allDay })} />
              </TouchableOpacity>
            </Row>

            {/* ── Start datetime ── */}
            <Row icon="calendar-outline" topBorder={false}>
              <DateTimePickerRow
                label="Start"
                allDay={editor.allDay}
                date={editor.startDate}
                hour={editor.startHour}
                minute={editor.startMinute}
                onPickerOpenChange={setStartPickerOpen}
                onChange={(d, h, m) => {
                  const newStart = editor.allDay ? d : combineDateTime(d, h, m);
                  const newEnd = editor.allDay ? d : addMinutes(newStart, 60);
                  onChange({
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
            </Row>

            {/* ── End datetime ── */}
            <Row icon={null} topBorder={false}>
              <DateTimePickerRow
                label="End"
                allDay={editor.allDay}
                date={editor.endDate}
                hour={editor.endHour}
                minute={editor.endMinute}
                onPickerOpenChange={setEndPickerOpen}
                onChange={(d, h, m) => onChange({ ...editor, endDate: d, endHour: h, endMinute: m })}
              />
            </Row>

            {/* ── Recurrence ── */}
            <Row icon="repeat-outline">
              <TouchableOpacity
                style={styles.pickerRow}
                onPress={() => setShowRecurrencePicker((v) => !v)}
                activeOpacity={0.7}
              >
                <Text style={styles.rowText}>{RECURRENCE_LABELS[editor.recurrence]}</Text>
                <Ionicons name={showRecurrencePicker ? 'chevron-up' : 'chevron-down'} size={16} color={CalendarTheme.textSecondary} />
              </TouchableOpacity>
              {showRecurrencePicker && (
                <View style={styles.dropdownBox}>
                  {RECURRENCE_ORDER.map((opt) => (
                    <TouchableOpacity
                      key={opt}
                      style={[styles.dropdownItem, editor.recurrence === opt && styles.dropdownItemActive]}
                      onPress={() => {
                        onChange({ ...editor, recurrence: opt });
                        setShowRecurrencePicker(false);
                      }}
                    >
                      {editor.recurrence === opt && (
                        <Ionicons name="checkmark" size={16} color={CalendarTheme.blue} style={{ marginRight: 6 }} />
                      )}
                      <Text style={[styles.dropdownText, editor.recurrence === opt && { color: CalendarTheme.blue }]}>
                        {RECURRENCE_LABELS[opt]}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </Row>

            {/* ── Guests ── */}
            <Row icon="people-outline">
              <TextInput
                style={styles.inlineInput}
                value={editor.attendeesRaw}
                onChangeText={onAttendeesChange}
                placeholder="Add guests"
                placeholderTextColor={CalendarTheme.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                returnKeyType="done"
              />
              {attendeeSuggestions.length > 0 && (
                <View style={styles.suggestions}>
                  {attendeeSuggestions.map((c) => (
                    <TouchableOpacity
                      key={c.email}
                      style={styles.suggestionRow}
                      onPress={() => onPickAttendee(c)}
                    >
                      <Ionicons name="person-circle-outline" size={18} color={CalendarTheme.textSecondary} />
                      <Text style={styles.suggestionText} numberOfLines={1}>
                        {c.displayName ? `${c.displayName} · ${c.email}` : c.email}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </Row>

            {/* ── Google Meet ── */}
            <Row icon="videocam-outline">
              {editor.hasExistingMeet && editor.hangoutLink ? (
                <View style={styles.meetCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.meetTitle}>Google Meet</Text>
                    <Text style={styles.meetSub} numberOfLines={1}>
                      {editor.hangoutLink.replace(/^https?:\/\//, '')}
                    </Text>
                  </View>
                  {onJoinMeet && (
                    <TouchableOpacity style={styles.meetJoinBtn} onPress={onJoinMeet}>
                      <Text style={styles.meetJoinText}>Join</Text>
                    </TouchableOpacity>
                  )}
                  {onCopyMeet && (
                    <TouchableOpacity onPress={onCopyMeet} style={{ padding: 4 }}>
                      <Ionicons name="copy-outline" size={18} color={CalendarTheme.blue} />
                    </TouchableOpacity>
                  )}
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.pickerRow}
                  onPress={() => onChange({ ...editor, addMeet: !editor.addMeet })}
                  activeOpacity={0.7}
                >
                  <Text style={styles.rowText}>
                    {editor.addMeet ? 'Google Meet video call' : 'Add Google Meet'}
                  </Text>
                  <Toggle value={editor.addMeet} onToggle={() => onChange({ ...editor, addMeet: !editor.addMeet })} />
                </TouchableOpacity>
              )}
            </Row>

            {/* ── Location ── */}
            <Row icon="location-outline">
              <TextInput
                style={styles.inlineInput}
                value={editor.location}
                onChangeText={(v) => onChange({ ...editor, location: v })}
                placeholder="Add location or room"
                placeholderTextColor={CalendarTheme.textMuted}
                returnKeyType="done"
              />
            </Row>

            {/* ── Description ── */}
            <Row icon="document-text-outline">
              <TextInput
                style={[styles.inlineInput, styles.descInput]}
                value={editor.description}
                onChangeText={(v) => onChange({ ...editor, description: v })}
                placeholder="Add description"
                placeholderTextColor={CalendarTheme.textMuted}
                multiline
                textAlignVertical="top"
              />
            </Row>

            {/* ── Reminder ── */}
            <Row icon="notifications-outline">
              <TouchableOpacity
                style={styles.pickerRow}
                onPress={() => setShowReminderPicker((v) => !v)}
                activeOpacity={0.7}
              >
                <Text style={styles.rowText}>Notification · {reminderLabel}</Text>
                <Ionicons name={showReminderPicker ? 'chevron-up' : 'chevron-down'} size={16} color={CalendarTheme.textSecondary} />
              </TouchableOpacity>
              {showReminderPicker && (
                <View style={styles.dropdownBox}>
                  {REMINDER_OPTIONS.map((opt) => (
                    <TouchableOpacity
                      key={String(opt.value)}
                      style={[styles.dropdownItem, editor.reminderMinutes === opt.value && styles.dropdownItemActive]}
                      onPress={() => {
                        onChange({ ...editor, reminderMinutes: opt.value });
                        setShowReminderPicker(false);
                      }}
                    >
                      {editor.reminderMinutes === opt.value && (
                        <Ionicons name="checkmark" size={16} color={CalendarTheme.blue} style={{ marginRight: 6 }} />
                      )}
                      <Text style={[styles.dropdownText, editor.reminderMinutes === opt.value && { color: CalendarTheme.blue }]}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </Row>

            {/* ── Event color ── */}
            <Row icon="color-palette-outline">
              <Text style={[styles.rowText, { marginBottom: 10 }]}>Event color</Text>
              <View style={styles.colorPalette}>
                {/* Default option */}
                <TouchableOpacity
                  style={[
                    styles.colorSwatch,
                    { backgroundColor: CalendarTheme.blue },
                    !editor.colorId && styles.colorSwatchSelected,
                  ]}
                  onPress={() => onChange({ ...editor, colorId: undefined })}
                >
                  {!editor.colorId && <Ionicons name="checkmark" size={14} color="#fff" />}
                </TouchableOpacity>
                {Object.entries(GOOGLE_CALENDAR_COLORS).slice(0, 11).map(([id, { hex, name }]) => (
                  <TouchableOpacity
                    key={id}
                    style={[
                      styles.colorSwatch,
                      { backgroundColor: hex },
                      editor.colorId === id && styles.colorSwatchSelected,
                    ]}
                    onPress={() => onChange({ ...editor, colorId: id })}
                    accessibilityLabel={name}
                  >
                    {editor.colorId === id && <Ionicons name="checkmark" size={14} color="#fff" />}
                  </TouchableOpacity>
                ))}
              </View>
            </Row>

            {/* ── Delete button (edit mode) ── */}
            {editor.id ? (
              <TouchableOpacity
                style={styles.deleteBtn}
                onPress={onDelete}
                disabled={saving || deleting}
              >
                {deleting ? (
                  <ActivityIndicator size="small" color={CalendarTheme.red} />
                ) : (
                  <>
                    <Ionicons name="trash-outline" size={20} color={CalendarTheme.red} />
                    <Text style={styles.deleteBtnText}>Delete event</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}

            <View style={{ height: 40 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Toggle({ value, onToggle }: { value: boolean; onToggle: () => void }) {
  return (
    <TouchableOpacity
      onPress={onToggle}
      activeOpacity={0.8}
      style={[styles.toggleTrack, value && styles.toggleTrackOn]}
    >
      <View style={[styles.toggleThumb, value && styles.toggleThumbOn]} />
    </TouchableOpacity>
  );
}

function Row({
  icon,
  children,
  topBorder = true,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'] | null;
  children: React.ReactNode;
  topBorder?: boolean;
}) {
  return (
    <View style={[styles.rowContainer, topBorder && styles.rowTopBorder]}>
      <View style={styles.rowIcon}>
        {icon ? <Ionicons name={icon} size={20} color={CalendarTheme.textSecondary} /> : null}
      </View>
      <View style={styles.rowContent}>{children}</View>
    </View>
  );
}

function DateTimePickerRow({
  label,
  allDay,
  date,
  hour,
  minute,
  onChange,
  onPickerOpenChange,
}: {
  label: string;
  allDay: boolean;
  date: Date;
  hour: number;
  minute: number;
  onChange: (d: Date, h: number, m: number) => void;
  onPickerOpenChange?: (open: boolean) => void;
}) {
  const [showDate, setShowDate] = useState(false);
  const [showTime, setShowTime] = useState(false);

  function setPickerOpen(dateOpen: boolean, timeOpen: boolean) {
    setShowDate(dateOpen);
    setShowTime(timeOpen);
    onPickerOpenChange?.(dateOpen || timeOpen);
  }

  return (
    <View>
      <Text style={styles.dtLabel}>{label}</Text>
      <View style={styles.dtRow}>
        <TouchableOpacity
          style={[styles.dtPill, showDate && styles.dtPillActive]}
          onPress={() => setPickerOpen(!showDate, false)}
        >
          <Ionicons name="calendar-outline" size={14} color={showDate ? CalendarTheme.bg : CalendarTheme.blue} />
          <Text style={[styles.dtPillText, showDate && { color: CalendarTheme.bg }]}>
            {format(date, 'EEE, MMM d, yyyy')}
          </Text>
        </TouchableOpacity>
        {!allDay && (
          <TouchableOpacity
            style={[styles.dtPill, showTime && styles.dtPillActive]}
            onPress={() => setPickerOpen(false, !showTime)}
          >
            <Ionicons name="time-outline" size={14} color={showTime ? CalendarTheme.bg : CalendarTheme.blue} />
            <Text style={[styles.dtPillText, showTime && { color: CalendarTheme.bg }]}>
              {String(hour % 12 === 0 ? 12 : hour % 12).padStart(2, '0')}:
              {String(minute).padStart(2, '0')} {hour < 12 ? 'AM' : 'PM'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
      {showDate && (
        <InlineDatePicker
          date={date}
          onChange={(d) => {
            onChange(d, hour, minute);
            setPickerOpen(false, showTime);
          }}
        />
      )}
      {showTime && !allDay && (
        <InlineTimePicker
          hour={hour}
          minute={minute}
          onChange={(h, m) => onChange(date, h, m)}
          onDone={() => setPickerOpen(false, false)}
        />
      )}
    </View>
  );
}

function InlineDatePicker({ date, onChange }: { date: Date; onChange: (d: Date) => void }) {
  const [viewMonth, setViewMonth] = useState(new Date(date.getFullYear(), date.getMonth(), 1));
  const days = eachDayOfInterval({ start: startOfMonth(viewMonth), end: endOfMonth(viewMonth) });

  return (
    <View style={styles.pickerCard}>
      <View style={styles.pickerHeader}>
        <TouchableOpacity
          onPress={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={18} color={CalendarTheme.text} />
        </TouchableOpacity>
        <Text style={styles.pickerHeaderText}>{format(viewMonth, 'MMMM yyyy')}</Text>
        <TouchableOpacity
          onPress={() => setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-forward" size={18} color={CalendarTheme.text} />
        </TouchableOpacity>
      </View>
      <CalendarMonthGrid
        compact
        leadingEmptyCells={days[0].getDay()}
        days={days.map((day) => ({
          date: day,
          selected: isSameDay(day, date),
          today: isSameDay(day, new Date()),
        }))}
        onPressDay={onChange}
      />
    </View>
  );
}

function InlineTimePicker({
  hour,
  minute,
  onChange,
  onDone,
}: {
  hour: number;
  minute: number;
  onChange: (h: number, m: number) => void;
  onDone: () => void;
}) {
  return (
    <View style={styles.pickerCard}>
      <TimeWheelPicker hour={hour} minute={minute} onChange={onChange} />
      <TouchableOpacity style={styles.doneBtn} onPress={onDone}>
        <Text style={styles.doneBtnText}>Done</Text>
      </TouchableOpacity>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.5)' },
  card: {
    backgroundColor: CalendarTheme.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '94%',
    minHeight: 320,
    flexShrink: 1,
    width: '100%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: CalendarTheme.border,
    flexShrink: 0,
  },
  headerTitle: { fontSize: 17, fontWeight: '600', color: CalendarTheme.text },
  saveBtn: {
    backgroundColor: CalendarTheme.blue,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 20,
    minWidth: 70,
    alignItems: 'center',
  },
  saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  scroll: { flexShrink: 1, flexGrow: 1 },
  scrollContent: { paddingBottom: 20 },

  titleInput: {
    fontSize: 22,
    fontWeight: '400',
    color: CalendarTheme.text,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 2,
    borderBottomColor: CalendarTheme.blue,
  },
  colorBar: { height: 3, marginHorizontal: 16, borderRadius: 2, marginTop: -2 },

  // Row
  rowContainer: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12 },
  rowTopBorder: { borderTopWidth: 1, borderTopColor: CalendarTheme.divider },
  rowIcon: { width: 36, alignItems: 'center', paddingTop: 2 },
  rowContent: { flex: 1 },
  rowText: { fontSize: 15, color: CalendarTheme.text },

  // All-day / picker rows
  allDayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  // Toggle
  toggleTrack: {
    width: 40, height: 24, borderRadius: 12,
    backgroundColor: CalendarTheme.border, padding: 2,
  },
  toggleTrackOn: { backgroundColor: CalendarTheme.blue },
  toggleThumb: { width: 20, height: 20, borderRadius: 10, backgroundColor: CalendarTheme.bg },
  toggleThumbOn: { alignSelf: 'flex-end' },

  // Date/time
  dtLabel: { fontSize: 12, color: CalendarTheme.textSecondary, marginBottom: 6 },
  dtRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  dtPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 10, paddingVertical: 7,
    borderWidth: 1, borderColor: CalendarTheme.blue,
    borderRadius: 20, backgroundColor: CalendarTheme.blueLight,
  },
  dtPillActive: { backgroundColor: CalendarTheme.blue },
  dtPillText: { fontSize: 13, color: CalendarTheme.blue, fontWeight: '600' },

  // Inline input (guests, location, description)
  inlineInput: { fontSize: 15, color: CalendarTheme.text, padding: 0, minHeight: 24 },
  descInput: { minHeight: 64, textAlignVertical: 'top' },

  // Suggestions
  suggestions: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: CalendarTheme.border,
    borderRadius: 8,
    overflow: 'hidden',
  },
  suggestionRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    padding: 10,
    borderBottomWidth: 1, borderBottomColor: CalendarTheme.divider,
  },
  suggestionText: { fontSize: 14, color: CalendarTheme.text, flex: 1 },

  // Google Meet
  meetCard: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    padding: 10, backgroundColor: '#E6F4EA', borderRadius: 8,
  },
  meetTitle: { fontSize: 14, fontWeight: '600', color: CalendarTheme.meet },
  meetSub: { fontSize: 11, color: CalendarTheme.textSecondary, marginTop: 1 },
  meetJoinBtn: {
    backgroundColor: CalendarTheme.meet,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
  },
  meetJoinText: { color: '#fff', fontSize: 12, fontWeight: '700' },

  // Dropdown
  dropdownBox: {
    marginTop: 8,
    borderWidth: 1, borderColor: CalendarTheme.border,
    borderRadius: 8, overflow: 'hidden',
    backgroundColor: CalendarTheme.bg,
  },
  dropdownItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: CalendarTheme.divider,
  },
  dropdownItemActive: { backgroundColor: CalendarTheme.blueLight },
  dropdownText: { fontSize: 14, color: CalendarTheme.text, flex: 1 },

  // Color palette
  colorPalette: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  colorSwatch: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  colorSwatchSelected: {
    borderWidth: 2, borderColor: 'rgba(0,0,0,0.2)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3, shadowRadius: 2, elevation: 2,
  },

  // Delete
  deleteBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginHorizontal: 16, marginTop: 8,
    paddingVertical: 14, borderRadius: 12,
    borderWidth: 1, borderColor: CalendarTheme.red,
  },
  deleteBtnText: { color: CalendarTheme.red, fontSize: 15, fontWeight: '600' },

  // Inline date/time picker
  pickerCard: {
    marginTop: 8, backgroundColor: CalendarTheme.bgMuted,
    borderWidth: 1, borderColor: CalendarTheme.border,
    borderRadius: 10, padding: 12, gap: 8,
  },
  pickerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pickerHeaderText: { fontSize: 14, fontWeight: '600', color: CalendarTheme.text },
  doneBtn: {
    backgroundColor: CalendarTheme.blue, borderRadius: 8,
    padding: 10, alignItems: 'center',
  },
  doneBtnText: { color: CalendarTheme.fabIcon, fontWeight: '700' },
});
