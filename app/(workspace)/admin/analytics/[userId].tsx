import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../../../hooks/useAuth';
import { adminApi, type AdminUserAnalytics } from '../../../../lib/api';
import { analyticsRangeEndingToday, ALL_TIME_RANGE } from '../../../../lib/analytics-range';
import { formatInr } from '../../../../lib/format-inr';
import { Colors } from '../../../../constants/colors';

const RANGES = [7, 14, 30, 'all'] as const;
type RangeKey = (typeof RANGES)[number];

export default function AdminMemberAnalyticsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { profile } = useAuth();
  const [rangeKey, setRangeKey] = useState<RangeKey>(14);
  const [user, setUser] = useState<AdminUserAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range = useMemo(
    () => (rangeKey === 'all' ? ALL_TIME_RANGE : analyticsRangeEndingToday(rangeKey)),
    [rangeKey]
  );

  const load = useCallback(async () => {
    if (!userId) return;
    setError(null);
    try {
      const data = await adminApi.getAnalytics(
        range.allTime
          ? { userId, allTime: true }
          : { userId, from: range.from, to: range.to }
      );
      setUser((data.users ?? [])[0] ?? null);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load analytics');
      setUser(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [userId, range.from, range.to]);

  useEffect(() => { void load(); }, [load]);

  if (profile?.role !== 'admin') {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Member Analytics</Text>
          <View style={styles.headerBtn} />
        </View>
        <Text style={styles.error}>Admin only</Text>
      </View>
    );
  }

  const title = user?.displayUsername || user?.email || 'Member Analytics';

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
        <View style={styles.headerBtn} />
      </View>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={Colors.primary} />}
        contentContainerStyle={styles.content}
      >
        {user ? (
          <Text style={styles.subtitle}>{user.email ?? '—'} · {user.role} · {range.label}</Text>
        ) : null}

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

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : !user ? (
          <Text style={styles.error}>Member not found</Text>
        ) : (
          <>
            <View style={styles.heroCard}>
              <Text style={styles.heroLabel}>Telephony total</Text>
              <Text style={styles.heroValue}>{formatInr(user.totals.costs.totalInr)}</Text>
            </View>

            <Text style={styles.sectionTitle}>Calls</Text>
            <View style={styles.grid}>
              <StatCard label="Total calls" value={String(user.totals.callsIn + user.totals.callsOut)} sub={`${user.totals.callsIn} in · ${user.totals.callsOut} out`} />
              <StatCard label="Billable min" value={String(user.totals.costs.callBillableMinutes)} sub={`${user.totals.talkMinutes} min actual talk`} />
              <StatCard label="Call cost" value={formatInr(user.totals.costs.callsInr)} sub="₹0.60/min, rounded up" accent="#1a73e8" />
              <StatCard label="Failed" value={String(user.totals.callsFailed)} />
            </View>

            <Text style={styles.sectionTitle}>WhatsApp</Text>
            <View style={styles.grid}>
              <StatCard label="Sent" value={String(user.totals.whatsappSent)} />
              <StatCard label="Received" value={String(user.totals.whatsappReceived)} />
              <StatCard label="WA cost" value={formatInr(user.totals.costs.whatsappInr)} accent="#25d366" />
              <StatCard
                label="Breakdown"
                value={`${user.totals.costs.whatsappUtilityMsgs + user.totals.costs.whatsappPromotionalMsgs + user.totals.costs.whatsappSessionMsgs} msgs`}
                sub={`${user.totals.costs.whatsappUtilityMsgs} utility · ${user.totals.costs.whatsappPromotionalMsgs} promo · ${user.totals.costs.whatsappSessionMsgs} session`}
              />
            </View>

            <Text style={styles.sectionTitle}>Other</Text>
            <View style={styles.grid}>
              <StatCard label="Emails" value={String(user.totals.emailsSent)} />
              <StatCard label="SMS" value={String(user.totals.smsSent)} />
              <StatCard label="AI cost" value={`$${user.totals.costUsd.toFixed(2)}`} sub="OpenAI extraction" />
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, accent ? { color: accent } : null]}>{value}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12,
  },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: Colors.text },
  content: { padding: 12, paddingBottom: 32, gap: 10 },
  center: { paddingVertical: 40, alignItems: 'center' },
  subtitle: { fontSize: 13, color: Colors.textSecondary },
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
  heroCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  heroLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, textTransform: 'uppercase' },
  heroValue: { fontSize: 30, fontWeight: '800', color: '#e37400' },
  sectionTitle: { fontSize: 14, fontWeight: '700', color: Colors.text, marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statCard: {
    width: '47%',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    gap: 4,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  statLabel: { fontSize: 11, fontWeight: '600', color: Colors.textMuted, textTransform: 'uppercase' },
  statValue: { fontSize: 18, fontWeight: '800', color: Colors.text },
  statSub: { fontSize: 11, color: Colors.textSecondary, lineHeight: 15 },
  error: { color: Colors.error, fontSize: 14, textAlign: 'center', padding: 16 },
});
