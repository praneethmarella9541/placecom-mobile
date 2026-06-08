import { format, isToday, isYesterday, isThisWeek } from 'date-fns';
import { CallsTheme } from '../constants/callsTheme';
import { lookupContactName } from './whatsapp-utils';
import type { CallLog } from './types';

export type CallStatusStyle = { bg: string; text: string; label: string };

const STATUS_MAP: Record<string, CallStatusStyle> = {
  completed: { bg: CallsTheme.greenLight, text: CallsTheme.green, label: 'Completed' },
  'no-answer': { bg: CallsTheme.redLight, text: CallsTheme.red, label: 'No answer' },
  missed: { bg: CallsTheme.redLight, text: CallsTheme.red, label: 'Missed' },
  busy: { bg: CallsTheme.amberLight, text: '#E37400', label: 'Busy' },
  failed: { bg: CallsTheme.redLight, text: CallsTheme.red, label: 'Failed' },
  'in-progress': { bg: CallsTheme.blueLight, text: CallsTheme.blue, label: 'In progress' },
  pending: { bg: CallsTheme.grayLight, text: CallsTheme.gray, label: 'Pending' },
};

export function callStatusStyle(status: string): CallStatusStyle {
  return STATUS_MAP[status] ?? { bg: CallsTheme.grayLight, text: CallsTheme.gray, label: status };
}

// Terminal statuses where the call clearly ended (so a missing recording is
// meaningful, not just "still in progress").
const TERMINAL_STATUSES = new Set([
  'completed', 'no-answer', 'missed', 'busy', 'failed', 'canceled', 'cancelled',
]);

/**
 * The status to actually display. The backend currently mislabels some
 * unanswered calls (e.g. caller hung up while ringing) as "completed". A
 * terminal "completed" call with no recording was not really answered, so we
 * correct it client-side to "missed" (incoming) / "no-answer" (outbound) until
 * the backend fix is deployed.
 */
export function callDisplayStatus(call: CallLog): string {
  if (call.status === 'completed' && TERMINAL_STATUSES.has(call.status) && !isAnsweredCall(call)) {
    return call.direction === 'incoming' ? 'missed' : 'no-answer';
  }
  return call.status;
}

export function formatCallDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds < 0) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Statuses that mean the call was never picked up — no talk time exists.
const UNANSWERED_STATUSES = new Set(['no-answer', 'missed', 'busy', 'failed', 'canceled', 'cancelled']);

/**
 * Whether the call was actually answered (someone talked). A recording or a
 * positive recording duration is proof of an answer. We treat a call with NO
 * recording as unanswered even if the backend mislabelled it "completed" — an
 * answered call always produces a recording in this setup. Explicit
 * unanswered statuses are always unanswered.
 */
export function isAnsweredCall(call: CallLog): boolean {
  if (UNANSWERED_STATUSES.has(call.status)) return false;
  if (call.recording_sid) return true;
  if (call.recording_duration_seconds && call.recording_duration_seconds > 0) return true;
  // No recording + a "completed"-ish status from the (currently buggy) backend
  // is not trustworthy → not answered.
  return false;
}

/**
 * Talk time for a call — the duration from when it was ANSWERED, not from when
 * it started ringing. Returns null for calls that were never answered so the UI
 * shows no duration. Exotel's recording only spans the answered portion, so
 * `recording_duration_seconds` is the most accurate "from answer" figure.
 */
export function callTalkSeconds(call: CallLog): number | null {
  if (!isAnsweredCall(call)) return null;
  if (call.recording_duration_seconds && call.recording_duration_seconds > 0) {
    return Math.round(call.recording_duration_seconds);
  }
  if (call.started_at && call.ended_at) {
    const secs = (new Date(call.ended_at).getTime() - new Date(call.started_at).getTime()) / 1000;
    if (secs >= 0) return Math.round(secs);
  }
  return call.duration_seconds ?? null;
}

export function callDisplayName(
  call: CallLog,
  contacts?: Record<string, string>
): string {
  const isIncoming = call.direction === 'incoming';
  const peer = call.peer_number ?? (isIncoming ? call.from_number : call.to_number);
  // A name the user saved (shared with WhatsApp + web via wa_contacts) takes
  // priority, then a CRM company name, then the raw number.
  const saved = peer && contacts ? lookupContactName(peer, contacts) : undefined;
  return saved || call.company_name?.trim() || peer || 'Unknown';
}

export function callPeerNumber(call: CallLog): string {
  const isIncoming = call.direction === 'incoming';
  return call.peer_number ?? (isIncoming ? call.from_number : call.to_number) ?? '';
}

export function groupCallsByDate(calls: CallLog[]): { title: string; data: CallLog[] }[] {
  const buckets = new Map<string, CallLog[]>();
  const order: string[] = [];

  for (const call of calls) {
    const d = call.created_at ? new Date(call.created_at) : new Date();
    let title = 'Older';
    if (isToday(d)) title = 'Today';
    else if (isYesterday(d)) title = 'Yesterday';
    else if (isThisWeek(d, { weekStartsOn: 1 })) title = 'This week';
    else title = format(d, 'MMMM yyyy');

    if (!buckets.has(title)) {
      buckets.set(title, []);
      order.push(title);
    }
    buckets.get(title)!.push(call);
  }

  return order.map((title) => ({ title, data: buckets.get(title)! }));
}

export function normalisePhone(raw: string): string {
  const cleaned = raw.replace(/[\s\-().]/g, '');
  if (cleaned.startsWith('+')) return cleaned;
  if (/^\d{10}$/.test(cleaned)) return `+91${cleaned}`;
  if (/^\d{11,14}$/.test(cleaned)) return `+${cleaned}`;
  return cleaned;
}
