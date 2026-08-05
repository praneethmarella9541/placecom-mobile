import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import ScreenHeader from '../../../components/ScreenHeader';
import EmptyState from '../../../components/EmptyState';
import Badge from '../../../components/Badge';
import { useDrawer } from '../_layout';
import { extractApi } from '../../../lib/api';
import { AnalyticsTheme as T } from '../../../constants/analyticsTheme';

const STATUS_COLORS: Record<string, { bg: string; text: string; accent: string }> = {
  completed: { bg: '#D1FAE5', text: '#065F46', accent: '#10B981' },
  running: { bg: '#DBEAFE', text: '#1E40AF', accent: '#2563EB' },
  pending: { bg: '#FEF3C7', text: '#92400E', accent: '#D97706' },
  failed: { bg: '#FEE2E2', text: '#991B1B', accent: '#DC2626' },
};

const STAT_ACCENTS = ['#2563EB', '#128C7E', '#C45C1A'] as const;

export default function DashboardScreen() {
  const { openDrawer } = useDrawer();
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedJob, setSelectedJob] = useState<any | null>(null);
  const [contacts, setContacts] = useState<any[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [starting, setStarting] = useState(false);

  const loadJobs = useCallback(async () => {
    try {
      const data = await extractApi.listJobs();
      setJobs(data.jobs ?? []);
    } catch {
      setJobs([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  async function startExtraction() {
    Alert.alert(
      'Start Extraction',
      'This will use OpenAI to extract contacts from your recent Gmail emails. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start',
          onPress: async () => {
            setStarting(true);
            try {
              await extractApi.startExtraction({ max_emails: 50 });
              await loadJobs();
              Alert.alert('Started', 'Extraction job started. Refresh to see progress.');
            } catch (e: any) {
              Alert.alert('Error', e.message);
            } finally {
              setStarting(false);
            }
          },
        },
      ]
    );
  }

  async function viewResults(job: any) {
    setSelectedJob(job);
    setLoadingContacts(true);
    try {
      const data = await extractApi.getResults(job.id);
      setContacts(data.contacts ?? []);
    } catch {
      setContacts([]);
    } finally {
      setLoadingContacts(false);
    }
  }

  if (selectedJob) {
    return (
      <View style={styles.container}>
        <View style={styles.subHeader}>
          <TouchableOpacity onPress={() => setSelectedJob(null)} style={styles.backBtn}>
            <Ionicons name="arrow-back" size={22} color={T.ink} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.subHeaderTitle}>Extracted Contacts</Text>
            <Text style={styles.subHeaderSub}>{contacts.length} contacts</Text>
          </View>
        </View>
        {loadingContacts ? (
          <View style={styles.center}><ActivityIndicator color={T.copper} /></View>
        ) : (
          <FlatList
            data={contacts}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <ContactRow contact={item} />}
            ListEmptyComponent={<EmptyState icon="person-outline" title="No contacts extracted" />}
            contentContainerStyle={contacts.length === 0 ? { flex: 1 } : { padding: 16, gap: 10 }}
          />
        )}
      </View>
    );
  }

  const totalExtracted = jobs.reduce((sum: number, j: any) => sum + (j.extracted_count ?? 0), 0);
  const totalCost = jobs.reduce((sum: number, j: any) => sum + (j.estimated_cost ?? 0), 0);

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Extraction"
        onMenuPress={openDrawer}
        rightAction={{ icon: 'play-circle-outline', onPress: startExtraction }}
      />
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadJobs(); }} tintColor={T.copper} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <View style={styles.heroOrb} />
          <Text style={styles.heroEyebrow}>Gmail Intelligence</Text>
          <Text style={styles.heroTitle}>Contact Extraction</Text>
          <Text style={styles.heroSub}>
            Pull names, phones, and emails from your inbox with AI.
          </Text>
          <View style={styles.heroPills}>
            <View style={styles.pill}><Text style={styles.pillText}>{jobs.length} jobs</Text></View>
            <View style={styles.pill}><Text style={styles.pillText}>{totalExtracted} contacts</Text></View>
          </View>
        </View>

        <View style={styles.statsRow}>
          <StatCard label="Total Jobs" value={String(jobs.length)} icon="briefcase-outline" accent={STAT_ACCENTS[0]} />
          <StatCard label="Extracted" value={String(totalExtracted)} icon="people-outline" accent={STAT_ACCENTS[1]} />
          <StatCard label="AI Cost" value={`$${totalCost.toFixed(3)}`} icon="sparkles-outline" accent={STAT_ACCENTS[2]} />
        </View>

        {starting && (
          <View style={styles.startingBanner}>
            <ActivityIndicator size="small" color={T.copper} />
            <Text style={styles.startingText}>Starting extraction job…</Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>Recent Jobs</Text>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={T.copper} /></View>
        ) : jobs.length === 0 ? (
          <EmptyState
            icon="analytics-outline"
            title="No extraction jobs yet"
            subtitle="Tap the play button to start extracting contacts from Gmail"
          />
        ) : (
          jobs.map((job) => {
            const sc = STATUS_COLORS[job.status] ?? { bg: T.bg, text: T.inkSoft, accent: T.muted };
            return (
              <TouchableOpacity
                key={job.id}
                style={[styles.jobCard, { borderLeftColor: sc.accent }]}
                onPress={() => viewResults(job)}
                activeOpacity={0.88}
              >
                <View style={styles.jobCardHeader}>
                  <Badge label={job.status} bgColor={sc.bg} color={sc.text} size="md" />
                  <Text style={styles.jobDate}>
                    {job.created_at ? format(new Date(job.created_at), 'MMM d, h:mm a') : ''}
                  </Text>
                </View>
                <View style={styles.jobStats}>
                  <JobStat value={job.email_count ?? 0} label="Emails" />
                  <JobStat value={job.extracted_count ?? 0} label="Extracted" />
                  <JobStat value={(job.total_tokens ?? 0).toLocaleString()} label="Tokens" />
                  <JobStat value={`$${(job.estimated_cost ?? 0).toFixed(3)}`} label="Cost" />
                </View>
                {job.status === 'completed' && (
                  <View style={styles.viewResults}>
                    <Text style={styles.viewResultsText}>View contacts</Text>
                    <Ionicons name="chevron-forward" size={14} color={T.copper} />
                  </View>
                )}
              </TouchableOpacity>
            );
          })
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

function StatCard({ label, value, icon, accent }: { label: string; value: string; icon: any; accent: string }) {
  return (
    <View style={styles.statCard}>
      <View style={[styles.statAccent, { backgroundColor: accent }]} />
      <View style={[styles.statIconWrap, { backgroundColor: `${accent}18` }]}>
        <Ionicons name={icon} size={18} color={accent} />
      </View>
      <Text style={[styles.statValue, { color: accent }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function JobStat({ value, label }: { value: string | number; label: string }) {
  return (
    <View style={styles.jobStat}>
      <Text style={styles.jobStatValue}>{value}</Text>
      <Text style={styles.jobStatLabel}>{label}</Text>
    </View>
  );
}

function ContactRow({ contact }: { contact: any }) {
  const initial = (contact.name ?? contact.email ?? '?').charAt(0).toUpperCase();
  return (
    <View style={styles.contactCard}>
      <View style={styles.contactAvatar}>
        <Text style={styles.contactAvatarText}>{initial}</Text>
      </View>
      <View style={styles.contactInfo}>
        {contact.name ? <Text style={styles.contactName}>{contact.name}</Text> : null}
        {contact.email ? <Text style={styles.contactEmail}>{contact.email}</Text> : null}
        {contact.phone ? <Text style={styles.contactPhone}>{contact.phone}</Text> : null}
        {contact.company ? <Text style={styles.contactCompany}>{contact.company}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 120 },
  hero: {
    margin: 16,
    marginBottom: 8,
    backgroundColor: T.heroBg,
    borderRadius: 20,
    padding: 22,
    overflow: 'hidden',
    gap: 6,
  },
  heroOrb: {
    position: 'absolute',
    right: -20,
    top: -20,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(228,160,76,0.2)',
  },
  heroEyebrow: {
    fontSize: 10,
    fontWeight: '800',
    color: T.heroAccent,
    textTransform: 'uppercase',
    letterSpacing: 1.6,
  },
  heroTitle: { fontSize: 24, fontWeight: '900', color: '#F5F3EF', letterSpacing: -0.3 },
  heroSub: { fontSize: 13, color: '#C4BDB3', lineHeight: 19, maxWidth: 280 },
  heroPills: { flexDirection: 'row', gap: 8, marginTop: 8 },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  pillText: { fontSize: 11, fontWeight: '700', color: '#F5F3EF' },
  statsRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 10, marginBottom: 8 },
  statCard: {
    flex: 1,
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
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
  },
  statIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  statValue: { fontSize: 17, fontWeight: '900' },
  statLabel: { fontSize: 10, fontWeight: '700', color: T.muted, textTransform: 'uppercase' },
  startingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    backgroundColor: T.copperLight,
    borderRadius: 12,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(196,92,26,0.15)',
  },
  startingText: { fontSize: 13, fontWeight: '600', color: T.copperDark },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: T.muted,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 10,
  },
  jobCard: {
    backgroundColor: T.surface,
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 14,
    padding: 14,
    gap: 10,
    borderWidth: 1,
    borderColor: T.border,
    borderLeftWidth: 4,
    shadowColor: '#1A1612',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 2,
  },
  jobCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  jobDate: { fontSize: 11, color: T.muted },
  jobStats: { flexDirection: 'row', gap: 6 },
  jobStat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    backgroundColor: T.bg,
    borderRadius: 10,
    paddingVertical: 8,
  },
  jobStatValue: { fontSize: 14, fontWeight: '800', color: T.ink },
  jobStatLabel: { fontSize: 9, fontWeight: '700', color: T.muted, textTransform: 'uppercase' },
  viewResults: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  viewResultsText: { fontSize: 13, fontWeight: '700', color: T.copper },
  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    backgroundColor: T.surface,
    borderBottomWidth: 1,
    borderBottomColor: T.border,
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  subHeaderTitle: { fontSize: 17, fontWeight: '800', color: T.ink },
  subHeaderSub: { fontSize: 12, color: T.muted, marginTop: 1 },
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: T.surface,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: T.border,
  },
  contactAvatar: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: T.copperLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactAvatarText: { fontSize: 16, fontWeight: '800', color: T.copper },
  contactInfo: { flex: 1, gap: 2 },
  contactName: { fontSize: 14, fontWeight: '700', color: T.ink },
  contactEmail: { fontSize: 13, color: T.inkSoft },
  contactPhone: { fontSize: 12, color: T.muted },
  contactCompany: { fontSize: 12, color: T.muted },
});
