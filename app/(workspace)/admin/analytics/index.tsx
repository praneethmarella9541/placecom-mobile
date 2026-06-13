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
import { useAuth } from '../../../../hooks/useAuth';
import { adminApi, type AdminUserAnalytics } from '../../../../lib/api';
import { analyticsRangeEndingToday, ALL_TIME_RANGE } from '../../../../lib/analytics-range';
import { formatInr } from '../../../../lib/format-inr';
import { Colors } from '../../../../constants/colors';

const RANGES = [7, 14, 30, 'all'] as const;
type RangeKey = (typeof RANGES)[number];

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
  }, [range.from, range.to]);

  useEffect(() => { void load(); }, [load]);

  const sorted = useMemo(
    () => [...users].sort((a, b) => b.totals.costs.totalInr - a.totals.costs.totalInr),
    [users]
  );

  if (profile?.role !== 'admin') {
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
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={Colors.primary} />}
        contentContainerStyle={styles.content}
      >
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

        <View style={styles.summaryCard}>
          <Text style={styles.summaryLabel}>Telephony cost · {range.label}</Text>
          <Text style={styles.summaryValue}>{formatInr(accountTotalInr)}</Text>
          <Text style={styles.summaryHint}>Calls ₹0.60/min (rounded up) · WA utility ₹0.11 · promo ₹0.86 · session ₹0.06</Text>
        </View>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : sorted.length === 0 ? (
          <EmptyState icon="people-outline" title="No team data" subtitle="Add team members to see usage." />
        ) : (
          sorted.map((u) => (
            <TouchableOpacity
              key={u.userId}
              style={styles.memberCard}
              onPress={() => router.push(`/(workspace)/admin/analytics/${u.userId}` as any)}
              activeOpacity={0.85}
            >
              <View style={styles.memberTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.memberName}>{u.displayUsername || u.email || u.userId.slice(0, 8)}</Text>
                  <Text style={styles.memberSub}>{u.email ?? '—'} · {u.role}</Text>
                </View>
                <Text style={styles.memberTotal}>{formatInr(u.totals.costs.totalInr)}</Text>
                <Ionicons name="chevron-forward" size={18} color={Colors.textMuted} />
              </View>
              <View style={styles.statsGrid}>
                <MiniStat label="Calls" value={`${u.totals.callsIn + u.totals.callsOut}`} sub={formatInr(u.totals.costs.callsInr)} />
                <MiniStat label="WA sent" value={String(u.totals.whatsappSent)} sub={formatInr(u.totals.costs.whatsappInr)} />
                <MiniStat label="WA recv" value={String(u.totals.whatsappReceived)} />
                <MiniStat label="Talk min" value={String(u.totals.costs.callBillableMinutes)} />
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </View>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.miniStat}>
      <Text style={styles.miniLabel}>{label}</Text>
      <Text style={styles.miniValue}>{value}</Text>
      {sub ? <Text style={styles.miniSub}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 12, paddingBottom: 32, gap: 10 },
  center: { paddingVertical: 40, alignItems: 'center' },
  rangeRow: { flexDirection: 'row', gap: 8 },
  rangeBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  rangeBtnActive: { backgroundColor: Colors.primaryLight, borderColor: Colors.primary },
  rangeBtnText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  rangeBtnTextActive: { color: Colors.primary },
  summaryCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  summaryLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  summaryValue: { fontSize: 28, fontWeight: '800', color: Colors.text },
  summaryHint: { fontSize: 11, color: Colors.textMuted, lineHeight: 16 },
  error: { color: Colors.error, fontSize: 14, textAlign: 'center', padding: 16 },
  memberCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  memberTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  memberName: { fontSize: 15, fontWeight: '700', color: Colors.text },
  memberSub: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  memberTotal: { fontSize: 16, fontWeight: '800', color: '#e37400' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  miniStat: {
    width: '47%',
    backgroundColor: Colors.background,
    borderRadius: 10,
    padding: 10,
    gap: 2,
  },
  miniLabel: { fontSize: 10, fontWeight: '600', color: Colors.textMuted, textTransform: 'uppercase' },
  miniValue: { fontSize: 16, fontWeight: '700', color: Colors.text },
  miniSub: { fontSize: 11, color: Colors.textSecondary },
});
