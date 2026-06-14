import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../../components/ScreenHeader';
import EmptyState from '../../../../components/EmptyState';
import { useDrawer } from '../../_layout';
import { isAdminUser } from '../../../../lib/user-role';
import { useAuth } from '../../../../hooks/useAuth';
import { adminApi, type AdminUserAnalytics } from '../../../../lib/api';
import { analyticsRangeEndingToday, ALL_TIME_RANGE } from '../../../../lib/analytics-range';
import { formatInr } from '../../../../lib/format-inr';
import { AnalyticsTheme as T } from '../../../../constants/analyticsTheme';

const RANGES = [7, 14, 30, 'all'] as const;
type RangeKey = (typeof RANGES)[number];

function memberInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || '?';
}

export default function AdminAnalyticsScreen() {
  const router = useRouter();
  const { openDrawer } = useDrawer();
  const { profile } = useAuth();
  const [rangeKey, setRangeKey] = useState<RangeKey>(14);
  const [users, setUsers] = useState<AdminUserAnalytics[]>([]);
  const [accountTotalInr, setAccountTotalInr] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(
    () => (rangeKey === 'all' ? ALL_TIME_RANGE : analyticsRangeEndingToday(rangeKey)),
    [rangeKey]
  );

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await adminApi.getAnalytics(
        range.allTime ? { allTime: true } : { from: range.from, to: range.to }
      );
      setUsers(data.users ?? []);
      setAccountTotalInr(data.accountTotals?.costs?.totalInr ?? 0);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load analytics');
      setUsers([]);
      setAccountTotalInr(0);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [range.from, range.to, range.allTime]);

  useEffect(() => { void load(); }, [load]);

  const sorted = useMemo(
    () => [...users].sort((a, b) => b.totals.costs.totalInr - a.totals.costs.totalInr),
    [users]
  );

  if (!isAdminUser(profile?.role)) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Analytics" onMenuPress={openDrawer} />
        <EmptyState icon="lock-closed-outline" title="Admin only" subtitle="Team analytics are available to admins." />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Team Analytics" onMenuPress={openDrawer} />
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={T.copper} />}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>Admin · Usage</Text>

        <View style={styles.rangeRow}>
          {RANGES.map((d) => (
            <TouchableOpacity
              key={String(d)}
              style={[styles.rangeBtn, rangeKey === d && styles.rangeBtnActive]}
              onPress={() => { setLoading(true); setRangeKey(d); }}
            >
              <Text style={[styles.rangeBtnText, rangeKey === d && styles.rangeBtnTextActive]}>
                {d === 'all' ? 'All' : `${d}d`}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.heroCard}>
          <View style={styles.heroGlow} />
          <Text style={styles.heroEyebrow}>Telephony spend · {range.label}</Text>
          <Text style={styles.heroValue}>{formatInr(accountTotalInr)}</Text>
          <Text style={styles.heroHint}>Calls ₹0.60/min · WA utility ₹0.11 · promo ₹0.86 · session ₹0.06</Text>
        </View>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={T.copper} /></View>
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : sorted.length === 0 ? (
          <EmptyState icon="people-outline" title="No team data" subtitle="Add team members to see usage." />
        ) : (
          <>
            <Text style={styles.sectionLabel}>Team members · by spend</Text>
            {sorted.map((u, idx) => {
              const name = u.displayUsername || u.email || u.userId.slice(0, 8);
              return (
                <TouchableOpacity
                  key={u.userId}
                  style={styles.memberCard}
                  onPress={() => router.push(`/(workspace)/admin/analytics/${u.userId}` as any)}
                  activeOpacity={0.88}
                >
                  <View style={styles.memberTop}>
                    <View style={[styles.rankBadge, idx === 0 && styles.rankBadgeFirst]}>
                      <Text style={[styles.rankText, idx === 0 && styles.rankTextFirst]}>{idx + 1}</Text>
                    </View>
                    <View style={[styles.avatar, idx === 0 && styles.avatarFirst]}>
                      <Text style={styles.avatarText}>{memberInitial(name)}</Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.memberName} numberOfLines={1}>{name}</Text>
                      <Text style={styles.memberSub} numberOfLines={1}>{u.email ?? '—'} · {u.role}</Text>
                    </View>
                    <Text style={styles.memberTotal}>{formatInr(u.totals.costs.totalInr)}</Text>
                    <Ionicons name="chevron-forward" size={16} color={T.muted} />
                  </View>
                  <View style={styles.statsGrid}>
                    <MiniStat label="Calls" value={`${u.totals.callsIn + u.totals.callsOut}`} sub={formatInr(u.totals.costs.callsInr)} accent={T.callBlue} />
                    <MiniStat label="WA sent" value={String(u.totals.whatsappSent)} sub={formatInr(u.totals.costs.whatsappInr)} accent={T.waGreen} />
                    <MiniStat label="WA recv" value={String(u.totals.whatsappReceived)} accent={T.waGreen} />
                    <MiniStat label="Talk min" value={String(u.totals.costs.callBillableMinutes)} accent={T.callBlue} />
                  </View>
                </TouchableOpacity>
              );
            })}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function MiniStat({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <View style={styles.miniStat}>
      <View style={[styles.miniAccent, { backgroundColor: accent ?? T.border }]} />
      <Text style={styles.miniLabel}>{label}</Text>
      <Text style={styles.miniValue}>{value}</Text>
      {sub ? <Text style={styles.miniSub}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  content: { padding: 16, paddingBottom: 36, gap: 12 },
  center: { paddingVertical: 48, alignItems: 'center' },
  eyebrow: {
    fontSize: 10,
    fontWeight: '800',
    color: T.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.6,
  },
  rangeRow: { flexDirection: 'row', gap: 8 },
  rangeBtn: {
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: T.surface,
    borderWidth: 1,
    borderColor: T.border,
  },
  rangeBtnActive: { backgroundColor: T.copperLight, borderColor: T.copper },
  rangeBtnText: { fontSize: 13, fontWeight: '700', color: T.muted },
  rangeBtnTextActive: { color: T.copperDark },
  heroCard: {
    backgroundColor: T.copperLight,
    borderRadius: 18,
    padding: 20,
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(196,92,26,0.18)',
    overflow: 'hidden',
  },
  heroGlow: {
    position: 'absolute',
    right: -24,
    top: -24,
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(196,92,26,0.12)',
  },
  heroEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    color: T.copperDark,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
  },
  heroValue: { fontSize: 36, fontWeight: '900', color: T.copper, letterSpacing: -0.5 },
  heroHint: { fontSize: 11, color: T.inkSoft, lineHeight: 16 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    color: T.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginTop: 4,
  },
  error: { color: '#DC2626', fontSize: 14, textAlign: 'center', padding: 16 },
  memberCard: {
    backgroundColor: T.surface,
    borderRadius: 16,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: T.border,
    shadowColor: '#1A1612',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  memberTop: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'nowrap' },
  rankBadge: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: T.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankBadgeFirst: { backgroundColor: T.copperLight },
  rankText: { fontSize: 11, fontWeight: '800', color: T.muted },
  rankTextFirst: { color: T.copper },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: T.inkSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFirst: { backgroundColor: T.copper },
  avatarText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  memberName: { fontSize: 15, fontWeight: '700', color: T.ink },
  memberSub: { fontSize: 11, color: T.muted, marginTop: 2 },
  memberTotal: { fontSize: 15, fontWeight: '800', color: T.copper, flexShrink: 0 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  miniStat: {
    width: '47%',
    backgroundColor: T.bg,
    borderRadius: 12,
    padding: 10,
    paddingLeft: 12,
    gap: 2,
    overflow: 'hidden',
  },
  miniAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
    borderTopLeftRadius: 12,
    borderBottomLeftRadius: 12,
  },
  miniLabel: { fontSize: 10, fontWeight: '700', color: T.muted, textTransform: 'uppercase' },
  miniValue: { fontSize: 16, fontWeight: '800', color: T.ink },
  miniSub: { fontSize: 11, color: T.inkSoft },
});
