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
import { AnalyticsTheme as T } from '../../../../constants/analyticsTheme';

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
  }, [userId, range.from, range.to, range.allTime]);

  useEffect(() => { void load(); }, [load]);

  const title = user?.displayUsername || user?.email || 'Member Analytics';
  const initial = title.charAt(0).toUpperCase();

  if (profile?.role !== 'admin') {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
            <Ionicons name="arrow-back" size={24} color={T.ink} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Member Analytics</Text>
          <View style={styles.headerBtn} />
        </View>
        <Text style={styles.error}>Admin only</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={22} color={T.ink} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
          {user ? (
            <Text style={styles.headerSub} numberOfLines={1}>{user.email ?? '—'} · {range.label}</Text>
          ) : null}
        </View>
        <View style={[styles.headerAvatar, { backgroundColor: T.copper }]}>
          <Text style={styles.headerAvatarText}>{initial}</Text>
        </View>
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={T.copper} />}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
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

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={T.copper} /></View>
        ) : error ? (
          <Text style={styles.error}>{error}</Text>
        ) : !user ? (
          <Text style={styles.error}>Member not found</Text>
        ) : (
          <>
            <View style={styles.heroCard}>
              <Text style={styles.heroEyebrow}>Telephony total</Text>
              <Text style={styles.heroValue}>{formatInr(user.totals.costs.totalInr)}</Text>
              <Text style={styles.heroSub}>
                Calls {formatInr(user.totals.costs.callsInr)} · WA {formatInr(user.totals.costs.whatsappInr)}
              </Text>
            </View>

            <Section title="Calls" icon="call-outline">
              <View style={styles.grid}>
                <StatCard label="Total calls" value={String(user.totals.callsIn + user.totals.callsOut)} sub={`${user.totals.callsIn} in · ${user.totals.callsOut} out`} accent={T.callBlue} />
                <StatCard label="Billable min" value={String(user.totals.costs.callBillableMinutes)} accent={T.callBlue} />
                <StatCard label="Call cost" value={formatInr(user.totals.costs.callsInr)} sub="₹0.60/min" accent={T.callBlue} />
                <StatCard label="Failed" value={String(user.totals.callsFailed)} accent="#DC2626" />
              </View>
            </Section>

            <Section title="WhatsApp" icon="logo-whatsapp">
              <View style={styles.grid}>
                <StatCard label="Sent" value={String(user.totals.whatsappSent)} accent={T.waGreen} />
                <StatCard label="Received" value={String(user.totals.whatsappReceived)} accent={T.waGreen} />
                <StatCard label="WA cost" value={formatInr(user.totals.costs.whatsappInr)} accent={T.waGreen} />
                <StatCard
                  label="Breakdown"
                  value={`${user.totals.costs.whatsappUtilityMsgs + user.totals.costs.whatsappPromotionalMsgs + user.totals.costs.whatsappSessionMsgs}`}
                  sub={`${user.totals.costs.whatsappUtilityMsgs} util · ${user.totals.costs.whatsappPromotionalMsgs} promo · ${user.totals.costs.whatsappSessionMsgs} session`}
                  accent={T.waGreen}
                />
              </View>
            </Section>

            <Section title="AI usage" icon="sparkles-outline">
              <View style={styles.grid}>
                <StatCard label="AI cost" value={`$${user.totals.costUsd.toFixed(2)}`} sub="OpenAI extraction" accent={T.aiRed} />
              </View>
            </Section>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Section({ title, icon, children }: { title: string; icon: keyof typeof Ionicons.glyphMap; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Ionicons name={icon} size={14} color={T.muted} />
        <Text style={styles.sectionTitle}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  const color = accent ?? T.ink;
  return (
    <View style={styles.statCard}>
      <View style={[styles.statAccent, { backgroundColor: color }]} />
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: T.surface,
    paddingHorizontal: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: T.border,
    gap: 10,
  },
  headerBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, gap: 2 },
  headerTitle: { fontSize: 17, fontWeight: '800', color: T.ink },
  headerSub: { fontSize: 11, color: T.muted },
  headerAvatar: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerAvatarText: { fontSize: 15, fontWeight: '800', color: '#fff' },
  content: { padding: 16, paddingBottom: 36, gap: 14 },
  center: { paddingVertical: 48, alignItems: 'center' },
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
  },
  heroEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    color: T.copperDark,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
  },
  heroValue: { fontSize: 34, fontWeight: '900', color: T.copper, letterSpacing: -0.5 },
  heroSub: { fontSize: 12, color: T.inkSoft },
  section: { gap: 10 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: T.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statCard: {
    width: '47%',
    backgroundColor: T.surface,
    borderRadius: 14,
    padding: 12,
    paddingLeft: 14,
    gap: 4,
    borderWidth: 1,
    borderColor: T.border,
    overflow: 'hidden',
  },
  statAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 3,
  },
  statLabel: { fontSize: 10, fontWeight: '700', color: T.muted, textTransform: 'uppercase' },
  statValue: { fontSize: 18, fontWeight: '800', color: T.ink },
  statSub: { fontSize: 11, color: T.inkSoft, lineHeight: 15 },
  error: { color: '#DC2626', fontSize: 14, textAlign: 'center', padding: 16 },
});
