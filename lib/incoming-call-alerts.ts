import { Platform } from 'react-native';
import { ensureCallNotificationChannels, getNotifications } from './expo-push-native';
import { phoneLookupVariants, phoneMatches } from './phone';
import { formatWhatsAppPhone } from './whatsapp-utils';

export type IncomingCallLogRow = {
  call_sid: string;
  from_number: string;
  to_number: string;
  agent_number: string;
  status: string;
  created_at: string;
};

/** Dedupe local alerts vs remote Expo push for the same Exotel call SID. */
export const incomingCallNotifiedSids = new Set<string>();

const RING_WINDOW_MS = 3 * 60 * 1000;

export function isIncomingRingingRow(
  row: IncomingCallLogRow,
  opts: { agentMobile?: string; virtualNumbers?: string[] }
): boolean {
  if (row.status !== 'in-progress') return false;

  const createdAt = new Date(row.created_at).getTime();
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > RING_WINDOW_MS) return false;

  const from = row.from_number?.trim() ?? '';
  const agent = row.agent_number?.trim() || row.to_number?.trim() || '';
  if (!from || !agent) return false;
  if (phoneMatches(from, agent)) return false;

  const virtuals = opts.virtualNumbers ?? [];
  if (virtuals.some((v) => phoneMatches(v, from))) return false;

  if (opts.agentMobile) {
    const ringsAgent =
      phoneMatches(row.to_number, opts.agentMobile) || phoneMatches(row.agent_number, opts.agentMobile);
    if (ringsAgent) return !phoneMatches(from, opts.agentMobile);
  }

  return true;
}

export function markIncomingCallNotified(callSid: string): void {
  const sid = callSid.trim();
  if (!sid) return;
  incomingCallNotifiedSids.add(sid);
  setTimeout(() => incomingCallNotifiedSids.delete(sid), RING_WINDOW_MS);
}

export function wasIncomingCallNotified(callSid: string): boolean {
  return incomingCallNotifiedSids.has(callSid.trim());
}

export async function showIncomingCallNotification(params: {
  callerE164: string;
  label: string;
  callSid: string;
}): Promise<void> {
  const callSid = params.callSid.trim();
  if (!callSid || wasIncomingCallNotified(callSid)) return;

  const Notifications = getNotifications();
  if (!Notifications) return;

  await ensureCallNotificationChannels();
  markIncomingCallNotified(callSid);

  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Incoming call — ${params.label}`,
      body: formatWhatsAppPhone(params.callerE164),
      sound: 'default',
      data: {
        type: 'incoming_call',
        peer: params.callerE164,
        callSid,
      },
      ...(Platform.OS === 'android' ? { channelId: 'calls' } : {}),
    },
    trigger: null,
  });
}

export async function contactLabelForCaller(
  userId: string,
  callerE164: string,
  lookup: (keys: string[]) => Promise<string | null>
): Promise<string> {
  const keys = phoneLookupVariants(callerE164);
  if (!keys.length) return formatWhatsAppPhone(callerE164);
  try {
    const name = (await lookup(keys))?.trim();
    return name || formatWhatsAppPhone(callerE164);
  } catch {
    return formatWhatsAppPhone(callerE164);
  }
}
