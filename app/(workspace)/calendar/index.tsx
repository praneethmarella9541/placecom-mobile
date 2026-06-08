import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
  ScrollView,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isSameDay,
  isToday,
  startOfWeek,
  endOfWeek,
  addWeeks,
  subWeeks,
  addMonths,
  subMonths,
  addDays,
  subDays,
  isSameMonth,
  isBefore,
  startOfDay,
  endOfDay,
} from 'date-fns';
import { useDrawer } from '../_layout';
import {
  calendarApi,
  gmailApi,
  type CalendarEventInput,
  type CalendarSendUpdates,
} from '../../../lib/api';
import type { CalendarEvent } from '../../../lib/types';
import { CalendarTheme, getEventColor } from '../../../constants/calendarTheme';
import { CalendarEventRow } from '../../../components/calendar/CalendarEventRow';
import { CalendarEventDetailSheet } from '../../../components/calendar/CalendarEventDetailSheet';
import { CalendarEventEditor } from '../../../components/calendar/CalendarEventEditor';
import { CalendarNotifySheet } from '../../../components/calendar/CalendarNotifySheet';
import {
  parseEventDate,
  parseEventEnd,
  editorFromEvent,
  newEventEditor,
  buildEventPayload,
  validateEditor,
  attendeeCount,
  isAllDayEvent,
  type CalendarEditorState,
} from '../../../lib/calendar-utils';
import { copyText, joinGoogleMeet } from '../../../lib/calendar-actions';

type ViewMode = 'month' | 'week' | 'day' | 'list';
type NotifyMode = 'save' | 'delete' | null;
interface Contact { email: string; displayName?: string }

const HOUR_HEIGHT = 56;
const TIME_GUTTER = 46;
const SCREEN_W = Dimensions.get('window').width;
const WEEK_COL_W = (SCREEN_W - TIME_GUTTER) / 7;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function currentToken(raw: string): string {
  const parts = raw.split(/[,;]/);
  return (parts[parts.length - 1] ?? '').trim().toLowerCase();
}
function replaceLastToken(raw: string, chosen: string): string {
  const parts = raw.split(/[,;]/);
  parts[parts.length - 1] = ' ' + chosen;
  return parts.join(', ').replace(/^,\s*/, '') + ', ';
}
function eventsForDay(events: CalendarEvent[], day: Date): CalendarEvent[] {
  return events
    .filter((e) => { const d = parseEventDate(e); return d && isSameDay(d, day); })
    .sort((a, b) => (parseEventDate(a)?.getTime() ?? 0) - (parseEventDate(b)?.getTime() ?? 0));
}

// ─── TimeGrid — shared between Week and Day views ────────────────────────────

function TimeGrid({
  days,
  events,
  selectedDay,
  onSelectDay,
  onSelectEvent,
}: {
  days: Date[];
  events: CalendarEvent[];
  selectedDay: Date;
  onSelectDay: (d: Date) => void;
  onSelectEvent: (e: CalendarEvent) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const isDay = days.length === 1;

  useEffect(() => {
    const hour = Math.max(0, new Date().getHours() - 1);
    setTimeout(() => scrollRef.current?.scrollTo({ y: hour * HOUR_HEIGHT, animated: false }), 80);
  }, [days[0]?.toISOString()]);

  const now = new Date();
  const nowTop = (now.getHours() * 60 + now.getMinutes()) / 60 * HOUR_HEIGHT;

  const allDayForDays = days.map((day) =>
    events.filter((e) => isAllDayEvent(e) && parseEventDate(e) && isSameDay(parseEventDate(e)!, day))
  );
  const hasAllDay = allDayForDays.some((arr) => arr.length > 0);

  const colW = isDay ? SCREEN_W - TIME_GUTTER : WEEK_COL_W;

  return (
    <View style={{ flex: 1 }}>
      {/* Day header row */}
      <View style={styles.gridDayHeaderRow}>
        <View style={{ width: TIME_GUTTER }} />
        {days.map((day) => {
          const sel = isSameDay(day, selectedDay);
          const tod = isToday(day);
          return (
            <TouchableOpacity
              key={day.toISOString()}
              style={{ flex: 1, alignItems: 'center', paddingVertical: 4 }}
              onPress={() => onSelectDay(day)}
            >
              {!isDay && (
                <Text style={[styles.gridDayName, tod && { color: CalendarTheme.todayRed }]}>
                  {format(day, 'EEE')}
                </Text>
              )}
              <View style={[
                styles.gridDayCircle,
                sel && { backgroundColor: CalendarTheme.blue },
                tod && !sel && { backgroundColor: CalendarTheme.todayRed },
              ]}>
                <Text style={[
                  styles.gridDayNum,
                  (sel || tod) && { color: '#fff', fontWeight: '700' },
                ]}>
                  {isDay ? format(day, 'EEE d') : format(day, 'd')}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* All-day strip */}
      {hasAllDay && (
        <View style={styles.allDayStrip}>
          <View style={{ width: TIME_GUTTER }}>
            <Text style={styles.allDayLabel}>all{'\n'}day</Text>
          </View>
          {days.map((day, i) => (
            <View key={day.toISOString()} style={{ flex: 1, paddingHorizontal: 1, gap: 1 }}>
              {allDayForDays[i].slice(0, 2).map((e) => (
                <TouchableOpacity
                  key={e.id}
                  style={[styles.allDayChip, { backgroundColor: getEventColor(e) }]}
                  onPress={() => onSelectEvent(e)}
                >
                  <Text style={styles.allDayChipText} numberOfLines={1}>
                    {e.summary || '(No title)'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}
        </View>
      )}

      {/* Time grid */}
      <ScrollView ref={scrollRef} showsVerticalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', height: 24 * HOUR_HEIGHT }}>
          {/* Time gutter */}
          <View style={{ width: TIME_GUTTER }}>
            {Array.from({ length: 24 }, (_, h) => (
              <View key={h} style={[styles.timeGutterCell, { height: HOUR_HEIGHT }]}>
                {h > 0 && (
                  <Text style={styles.timeLabel}>
                    {h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`}
                  </Text>
                )}
              </View>
            ))}
          </View>

          {/* Day columns */}
          {days.map((day) => {
            const timedEvents = eventsForDay(events, day).filter((e) => !isAllDayEvent(e));
            const isCurDay = isToday(day);

            return (
              <View
                key={day.toISOString()}
                style={[
                  { width: colW, height: 24 * HOUR_HEIGHT, position: 'relative' },
                  // Vertical grid line between day columns (week view only).
                  !isDay && styles.dayColumnBorder,
                ]}
              >
                {/* Hour divider lines */}
                {Array.from({ length: 24 }, (_, h) => (
                  <View
                    key={h}
                    style={[
                      styles.hourLine,
                      { top: h * HOUR_HEIGHT },
                      isSameDay(day, selectedDay) && { backgroundColor: '#EAF1FD' },
                    ]}
                  />
                ))}

                {/* Timed events */}
                {timedEvents.map((e) => {
                  const start = parseEventDate(e);
                  if (!start) return null;
                  const end = parseEventEnd(e) ?? addDays(start, 0);
                  const startMin = start.getHours() * 60 + start.getMinutes();
                  const endMin = end.getHours() * 60 + end.getMinutes();
                  const top = (startMin / 60) * HOUR_HEIGHT;
                  const height = Math.max(((Math.max(endMin - startMin, 15)) / 60) * HOUR_HEIGHT, 22);
                  const color = getEventColor(e);
                  return (
                    <TouchableOpacity
                      key={e.id}
                      style={[
                        styles.gridEvent,
                        { top, height, backgroundColor: color + '22', borderLeftColor: color },
                        isDay && { left: 2, right: 2 },
                      ]}
                      onPress={() => onSelectEvent(e)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.gridEventTitle, { color }]} numberOfLines={2}>
                        {e.summary || '(No title)'}
                      </Text>
                      {height > 34 && (
                        <Text style={[styles.gridEventTime, { color }]} numberOfLines={1}>
                          {format(start, 'h:mm a')}
                          {end ? ` – ${format(end, 'h:mm a')}` : ''}
                        </Text>
                      )}
                    </TouchableOpacity>
                  );
                })}

                {/* Current time line */}
                {isCurDay && (
                  <>
                    <View style={[styles.nowLine, { top: nowTop - 1 }]} />
                    <View style={[styles.nowDot, { top: nowTop - 4 }]} />
                  </>
                )}
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

// ─── List (schedule) view ─────────────────────────────────────────────────────

function ListView({
  events,
  onSelectEvent,
  onJoinMeet,
  loading,
  onRefresh,
  refreshing,
}: {
  events: CalendarEvent[];
  onSelectEvent: (e: CalendarEvent) => void;
  onJoinMeet: (link: string) => void;
  loading: boolean;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const today = startOfDay(new Date());
  const sorted = [...events]
    .filter((e) => { const d = parseEventDate(e); return d && !isBefore(d, today); })
    .sort((a, b) => (parseEventDate(a)?.getTime() ?? 0) - (parseEventDate(b)?.getTime() ?? 0));

  const groups: { date: Date; items: CalendarEvent[] }[] = [];
  for (const e of sorted) {
    const d = parseEventDate(e);
    if (!d) continue;
    const last = groups[groups.length - 1];
    if (last && isSameDay(last.date, d)) last.items.push(e);
    else groups.push({ date: d, items: [e] });
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color={CalendarTheme.blue} /></View>;
  if (groups.length === 0) return (
    <View style={styles.center}>
      <Ionicons name="calendar-outline" size={44} color={CalendarTheme.border} />
      <Text style={styles.emptyText}>No upcoming events</Text>
    </View>
  );

  return (
    <FlatList
      data={groups}
      keyExtractor={(g) => g.date.toISOString()}
      contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 100 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={CalendarTheme.blue} />}
      renderItem={({ item: g }) => (
        <View style={styles.scheduleGroup}>
          <View style={styles.scheduleDateCol}>
            <Text style={[styles.schedWeekday, isToday(g.date) && { color: CalendarTheme.todayRed }]}>
              {isToday(g.date) ? 'TODAY' : format(g.date, 'EEE').toUpperCase()}
            </Text>
            <View style={[styles.schedDayCircle, isToday(g.date) && { backgroundColor: CalendarTheme.todayRed }]}>
              <Text style={[styles.schedDayNum, isToday(g.date) && { color: '#fff' }]}>
                {format(g.date, 'd')}
              </Text>
            </View>
          </View>
          <View style={{ flex: 1, gap: 6 }}>
            {g.items.map((e) => (
              <CalendarEventRow
                key={e.id}
                event={e}
                color={getEventColor(e)}
                onPress={() => onSelectEvent(e)}
                onJoinMeet={e.hangoutLink ? () => onJoinMeet(e.hangoutLink!) : undefined}
              />
            ))}
          </View>
        </View>
      )}
    />
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function CalendarScreen() {
  const { openDrawer } = useDrawer();
  const insets = useSafeAreaInsets();

  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [anchor, setAnchor] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState(new Date());

  const [detailEvent, setDetailEvent] = useState<CalendarEvent | null>(null);
  const [editor, setEditor] = useState<CalendarEditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<CalendarEventInput | null>(null);
  const [notifyMode, setNotifyMode] = useState<NotifyMode>(null);
  const [allContacts, setAllContacts] = useState<Contact[]>([]);
  const [attendeeSuggestions, setAttendeeSuggestions] = useState<Contact[]>([]);

  useEffect(() => {
    gmailApi.getContacts().then((r) => setAllContacts(r.contacts ?? [])).catch(() => {});
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      let start = startOfMonth(anchor).toISOString();
      let end = endOfMonth(anchor).toISOString();
      if (viewMode === 'week') {
        const ws = startOfWeek(anchor).toISOString();
        const we = endOfWeek(anchor).toISOString();
        start = ws < start ? ws : start;
        end = we > end ? we : end;
      } else if (viewMode === 'day') {
        start = startOfDay(anchor).toISOString();
        end = endOfDay(anchor).toISOString();
      }
      const data = await calendarApi.listEvents(start, end);
      setEvents((data.events as CalendarEvent[]) ?? []);
    } catch (e: unknown) {
      Alert.alert('Could not load calendar', e instanceof Error ? e.message : 'Unknown error');
      setEvents([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [anchor, viewMode]);

  useEffect(() => { setLoading(true); loadEvents(); }, [loadEvents]);

  // ── navigation ───────────────────────────────────────────────────────────
  function navPrev() {
    if (viewMode === 'week') setAnchor((a) => subWeeks(a, 1));
    else if (viewMode === 'day') setAnchor((a) => { const d = subDays(a, 1); setSelectedDay(d); return d; });
    else setAnchor((a) => subMonths(a, 1));
  }
  function navNext() {
    if (viewMode === 'week') setAnchor((a) => addWeeks(a, 1));
    else if (viewMode === 'day') setAnchor((a) => { const d = addDays(a, 1); setSelectedDay(d); return d; });
    else setAnchor((a) => addMonths(a, 1));
  }
  function goToday() {
    const t = new Date();
    setAnchor(t);
    setSelectedDay(t);
  }

  // ── month grid ───────────────────────────────────────────────────────────
  const monthDays = eachDayOfInterval({ start: startOfMonth(anchor), end: endOfMonth(anchor) });
  const dayEvents = eventsForDay(events, selectedDay);

  // ── attendee suggestions ─────────────────────────────────────────────────
  function computeAttendeeSuggestions(raw: string) {
    const token = currentToken(raw);
    if (token.length < 2) { setAttendeeSuggestions([]); return; }
    setAttendeeSuggestions(
      allContacts
        .filter((c) => c.email.toLowerCase().includes(token) || (c.displayName ?? '').toLowerCase().includes(token))
        .slice(0, 6)
    );
  }

  // ── editor actions ───────────────────────────────────────────────────────
  function openNewEvent() { setDetailEvent(null); setEditor(newEventEditor(selectedDay)); }
  function openDetail(e: CalendarEvent) { setDetailEvent(e); }
  function openEditFromDetail() {
    if (!detailEvent) return;
    setEditor(editorFromEvent(detailEvent, selectedDay));
    setDetailEvent(null);
  }

  async function doSave(payload: CalendarEventInput) {
    if (!editor) return;
    setSaving(true);
    try {
      if (editor.id) await calendarApi.updateEvent(editor.id, payload);
      else await calendarApi.createEvent(payload);
      setEditor(null);
      setAttendeeSuggestions([]);
      await loadEvents();
    } catch (e: unknown) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Unknown error');
    } finally { setSaving(false); setPendingPayload(null); }
  }

  function saveEvent() {
    if (!editor) return;
    const err = validateEditor(editor);
    if (err) { Alert.alert('Check event', err); return; }
    const payload = buildEventPayload(editor);
    if (attendeeCount(editor) === 0) { doSave(payload); return; }
    setPendingPayload(payload);
    setNotifyMode('save');
  }
  function onNotifySave(choice: CalendarSendUpdates) {
    if (!pendingPayload) return;
    doSave({ ...pendingPayload, sendUpdates: choice });
    setNotifyMode(null);
  }
  function confirmDelete() {
    if (!editor?.id) return;
    if (attendeeCount(editor) === 0) {
      Alert.alert('Delete event?', `"${editor.summary}" will be removed from Google Calendar.`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => doDelete() },
      ]);
      return;
    }
    setNotifyMode('delete');
  }
  function confirmDeleteFromDetail() {
    if (!detailEvent) return;
    setEditor(editorFromEvent(detailEvent, selectedDay));
    setDetailEvent(null);
    confirmDelete();
  }
  async function doDelete(sendUpdates?: CalendarSendUpdates) {
    const id = editor?.id;
    if (!id) return;
    setDeleting(true);
    try {
      await calendarApi.deleteEvent(id, sendUpdates ? { sendUpdates } : undefined);
      setEditor(null); setDetailEvent(null); setAttendeeSuggestions([]);
      await loadEvents();
    } catch (e: unknown) {
      Alert.alert('Could not delete', e instanceof Error ? e.message : 'Unknown error');
    } finally { setDeleting(false); setNotifyMode(null); }
  }

  const activeMeetLink = editor?.hangoutLink ?? detailEvent?.hangoutLink;

  // ── header label ─────────────────────────────────────────────────────────
  let headerLabel = '';
  if (viewMode === 'month' || viewMode === 'list') {
    headerLabel = format(anchor, 'MMMM yyyy');
  } else if (viewMode === 'week') {
    const ws = startOfWeek(anchor);
    const we = endOfWeek(anchor);
    headerLabel = isSameMonth(ws, we)
      ? `${format(ws, 'MMM d')} – ${format(we, 'd, yyyy')}`
      : `${format(ws, 'MMM d')} – ${format(we, 'MMM d, yyyy')}`;
  } else {
    headerLabel = format(anchor, 'EEE, MMM d, yyyy');
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <TouchableOpacity onPress={openDrawer} style={styles.menuBtn}>
          <Ionicons name="menu" size={24} color={CalendarTheme.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <TouchableOpacity onPress={navPrev} hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}>
            <Ionicons name="chevron-back" size={22} color={CalendarTheme.text} />
          </TouchableOpacity>
          <TouchableOpacity onPress={goToday} activeOpacity={0.7} style={{ minWidth: 160, alignItems: 'center' }}>
            <Text style={styles.headerLabel}>{headerLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={navNext} hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}>
            <Ionicons name="chevron-forward" size={22} color={CalendarTheme.text} />
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={goToday} style={styles.todayBtn}>
          <Text style={styles.todayBtnText}>Today</Text>
        </TouchableOpacity>
      </View>

      {/* ── View switcher ── */}
      <View style={styles.viewSwitcher}>
        {([
          ['month', 'Month'],
          ['week', 'Week'],
          ['day', 'Day'],
          ['list', 'List'],
        ] as [ViewMode, string][]).map(([v, label]) => (
          <TouchableOpacity
            key={v}
            style={[styles.viewTab, viewMode === v && styles.viewTabActive]}
            onPress={() => setViewMode(v)}
          >
            <Text style={[styles.viewTabText, viewMode === v && styles.viewTabTextActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Month view ── */}
      {viewMode === 'month' && (
        <View style={{ flex: 1 }}>
          <View style={styles.dayHeaders}>
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d, i) => (
              <Text key={`${d}-${i}`} style={styles.dayHeaderText}>{d}</Text>
            ))}
          </View>
          <View style={styles.monthGrid}>
            {Array(monthDays[0].getDay()).fill(null).map((_, i) => (
              <View key={`empty-${i}`} style={styles.dayCell} />
            ))}
            {monthDays.map((day) => {
              const dEvts = eventsForDay(events, day);
              const selected = isSameDay(day, selectedDay);
              const today = isToday(day);
              return (
                <TouchableOpacity
                  key={day.toISOString()}
                  style={styles.dayCell}
                  onPress={() => setSelectedDay(day)}
                  activeOpacity={0.7}
                >
                  <View style={[
                    styles.dayNumCircle,
                    selected && { backgroundColor: CalendarTheme.blue },
                    today && !selected && { backgroundColor: CalendarTheme.todayRed },
                  ]}>
                    <Text style={[
                      styles.dayText,
                      !isSameMonth(day, anchor) && { color: CalendarTheme.textMuted },
                      (selected || today) && { color: '#fff', fontWeight: '700' },
                    ]}>
                      {format(day, 'd')}
                    </Text>
                  </View>
                  {dEvts.slice(0, 2).map((e) => (
                    <View key={e.id} style={[styles.monthChip, { backgroundColor: getEventColor(e) }]}>
                      <Text style={styles.monthChipText} numberOfLines={1}>{e.summary || '·'}</Text>
                    </View>
                  ))}
                  {dEvts.length > 2 && (
                    <Text style={styles.moreText}>+{dEvts.length - 2}</Text>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
          {/* Selected day events */}
          <View style={styles.dayPanel}>
            <Text style={styles.dayPanelTitle}>
              {isToday(selectedDay) ? 'Today · ' : ''}{format(selectedDay, 'EEEE, MMM d')}
            </Text>
            {loading ? (
              <ActivityIndicator color={CalendarTheme.blue} style={{ marginTop: 20 }} />
            ) : dayEvents.length === 0 ? (
              <Text style={styles.noEvents}>No events</Text>
            ) : (
              <FlatList
                data={dayEvents}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <CalendarEventRow
                    event={item}
                    color={getEventColor(item)}
                    onPress={() => openDetail(item)}
                    onJoinMeet={item.hangoutLink ? () => joinGoogleMeet(item.hangoutLink!) : undefined}
                  />
                )}
                refreshControl={
                  <RefreshControl
                    refreshing={refreshing}
                    onRefresh={() => { setRefreshing(true); loadEvents(); }}
                    tintColor={CalendarTheme.blue}
                  />
                }
                contentContainerStyle={{ paddingBottom: 100 }}
              />
            )}
          </View>
        </View>
      )}

      {/* ── Week view ── */}
      {viewMode === 'week' && (
        <TimeGrid
          days={eachDayOfInterval({ start: startOfWeek(anchor), end: endOfWeek(anchor) })}
          events={events}
          selectedDay={selectedDay}
          onSelectDay={(d) => { setSelectedDay(d); setAnchor(d); }}
          onSelectEvent={openDetail}
        />
      )}

      {/* ── Day view ── */}
      {viewMode === 'day' && (
        <TimeGrid
          days={[anchor]}
          events={events}
          selectedDay={anchor}
          onSelectDay={(d) => { setSelectedDay(d); setAnchor(d); }}
          onSelectEvent={openDetail}
        />
      )}

      {/* ── List view ── */}
      {viewMode === 'list' && (
        <ListView
          events={events}
          loading={loading}
          refreshing={refreshing}
          onRefresh={() => { setRefreshing(true); loadEvents(); }}
          onSelectEvent={openDetail}
          onJoinMeet={joinGoogleMeet}
        />
      )}

      {/* ── FAB ── */}
      <TouchableOpacity
        style={[styles.fab, { bottom: insets.bottom + 20 }]}
        onPress={openNewEvent}
        activeOpacity={0.85}
      >
        <Ionicons name="add" size={24} color="#fff" />
        <Text style={styles.fabText}>New event</Text>
      </TouchableOpacity>

      {/* ── Sheets ── */}
      <CalendarEventDetailSheet
        event={detailEvent}
        visible={!!detailEvent}
        onClose={() => setDetailEvent(null)}
        onEdit={openEditFromDetail}
        onDelete={confirmDeleteFromDetail}
        onJoinMeet={() => detailEvent?.hangoutLink && joinGoogleMeet(detailEvent.hangoutLink)}
        onCopyMeet={() => detailEvent?.hangoutLink && copyText('Meet link', detailEvent.hangoutLink)}
      />
      <CalendarEventEditor
        editor={editor}
        saving={saving}
        deleting={deleting}
        attendeeSuggestions={attendeeSuggestions}
        onClose={() => { setEditor(null); setAttendeeSuggestions([]); }}
        onChange={setEditor}
        onPickAttendee={(c) => {
          if (!editor) return;
          setEditor({ ...editor, attendeesRaw: replaceLastToken(editor.attendeesRaw, c.email) });
          setAttendeeSuggestions([]);
        }}
        onAttendeesChange={(raw) => {
          if (!editor) return;
          setEditor({ ...editor, attendeesRaw: raw });
          computeAttendeeSuggestions(raw);
        }}
        onSave={saveEvent}
        onDelete={confirmDelete}
        onJoinMeet={activeMeetLink ? () => joinGoogleMeet(activeMeetLink) : undefined}
        onCopyMeet={activeMeetLink ? () => copyText('Meet link', activeMeetLink) : undefined}
      />
      <CalendarNotifySheet
        visible={notifyMode === 'save'}
        title={editor?.id ? 'Update event' : 'Send invitations?'}
        message={editor ? `Notify ${attendeeCount(editor)} guest${attendeeCount(editor) !== 1 ? 's' : ''}.` : ''}
        onClose={() => { setNotifyMode(null); setPendingPayload(null); }}
        onChoose={onNotifySave}
      />
      <CalendarNotifySheet
        visible={notifyMode === 'delete'}
        title="Delete event"
        message={editor ? `Notify ${attendeeCount(editor)} guest${attendeeCount(editor) !== 1 ? 's' : ''} about cancellation?` : ''}
        destructive
        onClose={() => setNotifyMode(null)}
        onChoose={doDelete}
      />
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: CalendarTheme.bg },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 8, paddingVertical: 8,
    backgroundColor: CalendarTheme.bg,
    borderBottomWidth: 1, borderBottomColor: CalendarTheme.border,
  },
  menuBtn: { width: 40, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2 },
  headerLabel: { fontSize: 16, fontWeight: '600', color: CalendarTheme.text, textAlign: 'center' },
  todayBtn: {
    paddingHorizontal: 10, paddingVertical: 5,
    borderRadius: 14, borderWidth: 1.5, borderColor: CalendarTheme.blue,
  },
  todayBtnText: { fontSize: 12, fontWeight: '700', color: CalendarTheme.blue },

  // View switcher
  viewSwitcher: {
    flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 6, gap: 6,
    backgroundColor: CalendarTheme.bg,
    borderBottomWidth: 1, borderBottomColor: CalendarTheme.border,
  },
  viewTab: {
    flex: 1, paddingVertical: 6, borderRadius: 20,
    alignItems: 'center', backgroundColor: CalendarTheme.bgMuted,
  },
  viewTabActive: { backgroundColor: CalendarTheme.blue },
  viewTabText: { fontSize: 12, fontWeight: '600', color: CalendarTheme.textSecondary },
  viewTabTextActive: { color: '#fff' },

  // Month grid
  dayHeaders: { flexDirection: 'row', paddingVertical: 4, backgroundColor: CalendarTheme.bg },
  dayHeaderText: {
    flex: 1, textAlign: 'center', fontSize: 11,
    fontWeight: '600', color: CalendarTheme.textSecondary,
  },
  monthGrid: {
    flexDirection: 'row', flexWrap: 'wrap',
    backgroundColor: CalendarTheme.bg,
    borderBottomWidth: 1, borderBottomColor: CalendarTheme.border,
  },
  dayCell: {
    width: `${100 / 7}%`, alignItems: 'center',
    paddingVertical: 4, paddingHorizontal: 1, minHeight: 72, gap: 1,
  },
  dayNumCircle: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  dayText: { fontSize: 13, color: CalendarTheme.text },
  monthChip: { width: '90%', borderRadius: 3, paddingHorizontal: 3, paddingVertical: 1 },
  monthChipText: { fontSize: 8.5, color: '#fff', fontWeight: '700' },
  moreText: { fontSize: 8.5, color: CalendarTheme.textMuted, fontWeight: '600' },

  // Day panel (month view bottom half)
  dayPanel: { flex: 1, paddingHorizontal: 16, paddingTop: 10 },
  dayPanelTitle: {
    fontSize: 12, fontWeight: '600', color: CalendarTheme.textSecondary,
    marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  noEvents: { fontSize: 14, color: CalendarTheme.textMuted, textAlign: 'center', marginTop: 20 },

  // TimeGrid
  gridDayHeaderRow: {
    flexDirection: 'row',
    backgroundColor: CalendarTheme.bg,
    borderBottomWidth: 1, borderBottomColor: CalendarTheme.border,
    paddingVertical: 4,
  },
  gridDayName: { fontSize: 10, fontWeight: '600', color: CalendarTheme.textSecondary },
  gridDayCircle: {
    minWidth: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4,
  },
  gridDayNum: { fontSize: 13, color: CalendarTheme.text },
  allDayStrip: {
    flexDirection: 'row', paddingVertical: 4,
    backgroundColor: CalendarTheme.bgMuted,
    borderBottomWidth: 1, borderBottomColor: CalendarTheme.border, minHeight: 28,
  },
  allDayLabel: {
    fontSize: 8, color: CalendarTheme.textMuted,
    textAlign: 'center', paddingTop: 2,
  },
  allDayChip: { borderRadius: 3, paddingHorizontal: 3, paddingVertical: 2, marginBottom: 1 },
  allDayChipText: { fontSize: 9, color: '#fff', fontWeight: '600' },
  timeGutterCell: { justifyContent: 'flex-start', alignItems: 'flex-end', paddingRight: 6 },
  timeLabel: { fontSize: 9, color: CalendarTheme.textSecondary, marginTop: -5 },
  hourLine: {
    position: 'absolute', left: 0, right: 0,
    height: StyleSheet.hairlineWidth, backgroundColor: CalendarTheme.hourLine,
  },
  dayColumnBorder: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: CalendarTheme.hourLine,
  },
  gridEvent: {
    position: 'absolute', left: 1, right: 1,
    borderLeftWidth: 3, borderRadius: 3,
    padding: 2, overflow: 'hidden',
  },
  gridEventTitle: { fontSize: 10, fontWeight: '700', lineHeight: 13 },
  gridEventTime: { fontSize: 9, lineHeight: 12, opacity: 0.85 },

  // Current time indicator — two separate absolutely positioned views
  nowLine: {
    position: 'absolute', left: 0, right: 0,
    height: 2, backgroundColor: CalendarTheme.todayRed, zIndex: 10,
  },
  nowDot: {
    position: 'absolute', left: -3,
    width: 8, height: 8, borderRadius: 4,
    backgroundColor: CalendarTheme.todayRed, zIndex: 11,
  },

  // Schedule / list view
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  emptyText: { fontSize: 15, color: CalendarTheme.textMuted },
  scheduleGroup: { flexDirection: 'row', gap: 12, marginBottom: 12 },
  scheduleDateCol: { width: 40, alignItems: 'center', paddingTop: 2 },
  schedWeekday: { fontSize: 10, fontWeight: '700', color: CalendarTheme.textSecondary },
  schedDayCircle: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center', marginTop: 2,
  },
  schedDayNum: { fontSize: 16, fontWeight: '400', color: CalendarTheme.text },

  // FAB
  fab: {
    position: 'absolute', right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: CalendarTheme.blue, borderRadius: 28,
    paddingHorizontal: 20, paddingVertical: 14,
    elevation: 4, shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 4,
  },
  fabText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
