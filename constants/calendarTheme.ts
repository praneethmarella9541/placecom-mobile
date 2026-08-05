/** Google Calendar–inspired palette. */
export const CalendarTheme = {
  blue: '#C45C1A',
  blueLight: 'rgba(196, 92, 26, 0.10)',
  green: '#188038',
  red: '#D93025',
  bg: '#F5F3EF',
  bgMuted: '#EDE9E1',
  text: '#1A1612',
  textSecondary: '#4A443C',
  textMuted: '#8C857B',
  border: 'rgba(20, 18, 14, 0.09)',
  divider: 'rgba(20, 18, 14, 0.09)',
  fab: '#C45C1A',
  fabIcon: '#FFFFFF',
  eventBar: '#C45C1A',
  meet: '#188038',
  todayRed: '#EA4335',
  hourLine: 'rgba(20, 18, 14, 0.09)',
};

/**
 * Google Calendar official color IDs mapped to their hex colors.
 * https://developers.google.com/calendar/api/v3/reference/colors
 */
export const GOOGLE_CALENDAR_COLORS: Record<string, { hex: string; name: string }> = {
  '1':  { hex: '#7986CB', name: 'Lavender' },
  '2':  { hex: '#33B679', name: 'Sage' },
  '3':  { hex: '#8E24AA', name: 'Grape' },
  '4':  { hex: '#E67C73', name: 'Flamingo' },
  '5':  { hex: '#F6BF26', name: 'Banana' },
  '6':  { hex: '#F4511E', name: 'Tangerine' },
  '7':  { hex: '#039BE5', name: 'Peacock' },
  '8':  { hex: '#3F51B5', name: 'Blueberry' },
  '9':  { hex: '#0B8043', name: 'Basil' },
  '10': { hex: '#D50000', name: 'Tomato' },
  '11': { hex: '#F4511E', name: 'Flamingo' },
};

/** Fallback palette for events with no colorId — cycle by hashing event ID. */
export const EVENT_COLORS = [
  '#4285F4', // Blueberry
  '#0B8043', // Basil
  '#E67C73', // Flamingo
  '#F6BF26', // Banana
  '#33B679', // Sage
  '#8E24AA', // Grape
  '#039BE5', // Peacock
  '#F4511E', // Tangerine
  '#7986CB', // Lavender
  '#D50000', // Tomato
  '#009688', // Teal
  '#795548', // Graphite
];

export function eventColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return EVENT_COLORS[h % EVENT_COLORS.length];
}

/** Returns the correct display color for a calendar event, using colorId if present. */
export function getEventColor(event: { id: string; colorId?: string }): string {
  if (event.colorId && GOOGLE_CALENDAR_COLORS[event.colorId]) {
    return GOOGLE_CALENDAR_COLORS[event.colorId].hex;
  }
  return eventColor(event.id);
}
