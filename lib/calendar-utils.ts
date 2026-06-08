import { addDays, addMinutes, format, parseISO } from 'date-fns';
import type { CalendarEventInput, CalendarSendUpdates } from './api';
import type { CalendarEvent } from './types';

export const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export type RecurrenceOption = 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'yearly';

export const RECURRENCE_LABELS: Record<RecurrenceOption, string> = {
  none: 'Does not repeat',
  daily: 'Every day',
  weekdays: 'Every weekday (Mon–Fri)',
  weekly: 'Every week',
  monthly: 'Every month',
  yearly: 'Every year',
};

export const RECURRENCE_RRULES: Record<RecurrenceOption, string | null> = {
  none: null,
  daily: 'RRULE:FREQ=DAILY',
  weekdays: 'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
  weekly: 'RRULE:FREQ=WEEKLY',
  monthly: 'RRULE:FREQ=MONTHLY',
  yearly: 'RRULE:FREQ=YEARLY',
};

export function rruleToOption(recurrence?: string[]): RecurrenceOption {
  const rule = (recurrence ?? []).find((r) => r.startsWith('RRULE:'));
  if (!rule) return 'none';
  if (rule.includes('BYDAY=MO,TU,WE,TH,FR')) return 'weekdays';
  if (rule.includes('FREQ=DAILY')) return 'daily';
  if (rule.includes('FREQ=WEEKLY')) return 'weekly';
  if (rule.includes('FREQ=MONTHLY')) return 'monthly';
  if (rule.includes('FREQ=YEARLY')) return 'yearly';
  return 'none';
}

export type CalendarEditorState = {
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
  allDay: boolean;
  addMeet: boolean;
  hasExistingMeet: boolean;
  hangoutLink?: string;
  htmlLink?: string;
  /** Google Calendar colorId (1–11), or undefined for default calendar color. */
  colorId?: string;
  recurrence: RecurrenceOption;
  /**
   * null  = use calendar default reminder
   * 0     = no reminder
   * N>0   = popup N minutes before
   */
  reminderMinutes: number | null;
};

export function combineDateTime(date: Date, hours: number, minutes: number): Date {
  const d = new Date(date);
  d.setHours(hours, minutes, 0, 0);
  return d;
}

export function parseEventDate(e: CalendarEvent): Date | null {
  const s = e.start.dateTime ?? e.start.date;
  if (!s) return null;
  try {
    return parseISO(s);
  } catch {
    return null;
  }
}

export function parseEventEnd(e: CalendarEvent): Date | null {
  const s = e.end.dateTime ?? e.end.date;
  if (!s) return null;
  try {
    return parseISO(s);
  } catch {
    return null;
  }
}

export function isAllDayEvent(e: CalendarEvent): boolean {
  return !e.start.dateTime && !!e.start.date;
}

export function formatEventWhen(e: CalendarEvent): string {
  if (isAllDayEvent(e)) {
    const start = e.start.date ? parseISO(e.start.date) : null;
    const endEx = e.end.date ? parseISO(e.end.date) : null;
    if (start && endEx) {
      const endIncl = addDays(endEx, -1);
      if (format(start, 'yyyy-MM-dd') === format(endIncl, 'yyyy-MM-dd')) {
        return `All day · ${format(start, 'EEE, MMM d')}`;
      }
      return `All day · ${format(start, 'MMM d')} – ${format(endIncl, 'MMM d')}`;
    }
    return 'All day';
  }
  const start = e.start.dateTime ? parseISO(e.start.dateTime) : null;
  const end = e.end.dateTime ? parseISO(e.end.dateTime) : null;
  if (!start) return '';
  if (end) return `${format(start, 'h:mm a')} – ${format(end, 'h:mm a')}`;
  return format(start, 'h:mm a');
}

export function parseAttendeeEmails(raw: string): { email: string }[] {
  return raw
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))
    .map((email) => ({ email }));
}

export function editorFromEvent(e: CalendarEvent, fallbackDay: Date): CalendarEditorState {
  const allDay = isAllDayEvent(e);
  const start = parseEventDate(e) ?? fallbackDay;
  let end: Date;
  if (allDay && e.end.date) {
    try {
      end = addDays(parseISO(e.end.date), -1);
    } catch {
      end = start;
    }
  } else {
    const endRaw = e.end.dateTime ?? e.end.date;
    try {
      end = endRaw ? parseISO(endRaw) : addMinutes(start, 60);
    } catch {
      end = addMinutes(start, 60);
    }
  }
  const attendees = (e.attendees ?? [])
    .map((a) => a.email)
    .filter((x): x is string => !!x)
    .join(', ');

  return {
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
    allDay,
    addMeet: false,
    hasExistingMeet: !!e.hangoutLink,
    hangoutLink: e.hangoutLink,
    htmlLink: e.htmlLink,
    colorId: e.colorId,
    recurrence: rruleToOption(e.recurrence),
    reminderMinutes: null,
  };
}

export function newEventEditor(selectedDay: Date): CalendarEditorState {
  const now = new Date();
  const start = combineDateTime(selectedDay, now.getHours() + 1, 0);
  const end = addMinutes(start, 60);
  return {
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
    allDay: false,
    addMeet: true,
    hasExistingMeet: false,
    colorId: undefined,
    recurrence: 'none',
    reminderMinutes: null,
  };
}

export function buildEventPayload(editor: CalendarEditorState): CalendarEventInput {
  const attendees = parseAttendeeEmails(editor.attendeesRaw);

  const rrule = RECURRENCE_RRULES[editor.recurrence];

  let reminders: CalendarEventInput['reminders'];
  if (editor.reminderMinutes === null) {
    reminders = { useDefault: true };
  } else if (editor.reminderMinutes === 0) {
    reminders = { useDefault: false, overrides: [] };
  } else {
    reminders = {
      useDefault: false,
      overrides: [{ method: 'popup', minutes: editor.reminderMinutes }],
    };
  }

  const base: CalendarEventInput = {
    summary: editor.summary.trim(),
    description: editor.description.trim() || undefined,
    location: editor.location.trim() || undefined,
    attendees: attendees.length > 0 ? attendees : undefined,
    addMeet: editor.addMeet && !editor.hasExistingMeet,
    colorId: editor.colorId,
    recurrence: rrule ? [rrule] : undefined,
    reminders,
  };

  if (editor.allDay) {
    return {
      ...base,
      start: { date: format(editor.startDate, 'yyyy-MM-dd') },
      end: { date: format(addDays(editor.endDate, 1), 'yyyy-MM-dd') },
    };
  }

  const start = combineDateTime(editor.startDate, editor.startHour, editor.startMinute);
  const end = combineDateTime(editor.endDate, editor.endHour, editor.endMinute);
  return {
    ...base,
    start: { dateTime: start.toISOString(), timeZone: LOCAL_TZ },
    end: { dateTime: end.toISOString(), timeZone: LOCAL_TZ },
  };
}

export function validateEditor(editor: CalendarEditorState): string | null {
  if (!editor.summary.trim()) return 'Please enter an event title.';
  if (editor.allDay) {
    if (editor.endDate < editor.startDate) return 'End date must be on or after start date.';
    return null;
  }
  const start = combineDateTime(editor.startDate, editor.startHour, editor.startMinute);
  const end = combineDateTime(editor.endDate, editor.endHour, editor.endMinute);
  if (end <= start) return 'End time must be after start time.';
  return null;
}

export function attendeeCount(editor: CalendarEditorState): number {
  return parseAttendeeEmails(editor.attendeesRaw).length;
}

export type NotifyChoice = CalendarSendUpdates | 'cancel';
