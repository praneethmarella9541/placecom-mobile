import { useEffect } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import {
  contactLabelForCaller,
  incomingCallNotifiedSids,
  isIncomingRingingRow,
  showIncomingCallNotification,
  type IncomingCallLogRow,
} from '../lib/incoming-call-alerts';
import { useAuth } from './useAuth';

const POLL_MS = 2000;

async function lookupWaContactName(userId: string, keys: string[]): Promise<string | null> {
  const { data } = await supabase
    .from('wa_contacts')
    .select('name')
    .eq('user_id', userId)
    .in('peer_e164', keys)
    .limit(1);
  return (data?.[0]?.name as string | undefined) ?? null;
}

async function notifyForRow(
  userId: string,
  row: IncomingCallLogRow,
  agentMobile: string,
  virtualNumbers: string[]
): Promise<void> {
  if (!isIncomingRingingRow(row, { agentMobile, virtualNumbers })) return;
  if (incomingCallNotifiedSids.has(row.call_sid)) return;

  const label = await contactLabelForCaller(userId, row.from_number, (keys) =>
    lookupWaContactName(userId, keys)
  );
  await showIncomingCallNotification({
    callerE164: row.from_number,
    label,
    callSid: row.call_sid,
  });
}

export function useIncomingCallAlerts(session: Session | null) {
  const { profile } = useAuth();

  useEffect(() => {
    if (!session?.user?.id) return;

    const userId = session.user.id;
    const agentMobile = profile?.mobile_phone?.trim() ?? '';
    const virtualNumbers = [
      profile?.exotel_virtual_number?.trim(),
      process.env.EXPO_PUBLIC_EXOTEL_VIRTUAL_NUMBER?.trim(),
    ].filter((v): v is string => Boolean(v));

    let cancelled = false;

    async function scanRecentInProgress(): Promise<void> {
      const since = new Date(Date.now() - 3 * 60 * 1000).toISOString();
      const { data, error } = await supabase
        .from('call_logs')
        .select('call_sid, from_number, to_number, agent_number, status, created_at')
        .eq('user_id', userId)
        .eq('status', 'in-progress')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(5);

      if (cancelled || error || !data?.length) return;

      for (const row of data as IncomingCallLogRow[]) {
        await notifyForRow(userId, row, agentMobile, virtualNumbers);
      }
    }

    void scanRecentInProgress();
    const poll = setInterval(() => {
      void scanRecentInProgress();
    }, POLL_MS);

    const channel = supabase
      .channel(`incoming-calls-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'call_logs',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as IncomingCallLogRow;
          void notifyForRow(userId, row, agentMobile, virtualNumbers);
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [
    session?.user?.id,
    profile?.mobile_phone,
    profile?.exotel_virtual_number,
  ]);
}
