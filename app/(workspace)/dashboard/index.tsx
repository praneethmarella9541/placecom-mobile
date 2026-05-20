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
import { Colors } from '../../../constants/colors';

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  completed: { bg: '#D1FAE5', text: '#065F46' },
  running: { bg: '#DBEAFE', text: '#1E40AF' },
  pending: { bg: '#FEF3C7', text: '#92400E' },
  failed: { bg: '#FEE2E2', text: '#991B1B' },
};

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
          <TouchableOpacity onPress={() => setSelectedJob(null)}>
            <Ionicons name="arrow-back" size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.subHeaderTitle}>Extracted Contacts</Text>
          <Text style={styles.subHeaderCount}>{contacts.length}</Text>
        </View>
        {loadingContacts ? (
          <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>
        ) : (
          <FlatList
            data={contacts}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <ContactRow contact={item} />}
            ListEmptyComponent={<EmptyState icon="person-outline" title="No contacts extracted" />}
            contentContainerStyle={contacts.length === 0 ? { flex: 1 } : { padding: 12, gap: 8 }}
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
        title="Dashboard"
        onMenuPress={openDrawer}
        rightAction={{ icon: 'play-circle-outline', onPress: startExtraction }}
      />
      <ScrollView>
        <View style={styles.statsRow}>
          <StatCard label="Total Jobs" value={String(jobs.length)} icon="briefcase-outline" />
          <StatCard label="Contacts Extracted" value={String(totalExtracted)} icon="people-outline" />
          <StatCard label="Total Cost" value={`$${totalCost.toFixed(4)}`} icon="cash-outline" />
        </View>

        {starting && (
          <View style={styles.startingBanner}>
            <ActivityIndicator size="small" color={Colors.primary} />
            <Text style={styles.startingText}>Starting extraction job...</Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>Extraction Jobs</Text>

        {loading ? (
          <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>
        ) : jobs.length === 0 ? (
          <EmptyState
            icon="analytics-outline"
            title="No extraction jobs yet"
            subtitle="Tap the play button to start extracting contacts from your Gmail"
          />
        ) : (
          jobs.map((job) => {
            const sc = STATUS_COLORS[job.status] ?? { bg: Colors.border, text: Colors.textSecondary };
            return (
              <TouchableOpacity key={job.id} style={styles.jobCard} onPress={() => viewResults(job)}>
                <View style={styles.jobCardHeader}>
                  <Badge label={job.status} bgColor={sc.bg} color={sc.text} size="md" />
                  <Text style={styles.jobDate}>
                    {job.created_at ? format(new Date(job.created_at), 'MMM d, h:mm a') : ''}
                  </Text>
                </View>
                <View style={styles.jobStats}>
                  <View style={styles.jobStat}>
                    <Text style={styles.jobStatValue}>{job.email_count ?? 0}</Text>
                    <Text style={styles.jobStatLabel}>Emails</Text>
                  </View>
                  <View style={styles.jobStat}>
                    <Text style={styles.jobStatValue}>{job.extracted_count ?? 0}</Text>
                    <Text style={styles.jobStatLabel}>Extracted</Text>
                  </View>
                  <View style={styles.jobStat}>
                    <Text style={styles.jobStatValue}>{(job.total_tokens ?? 0).toLocaleString()}</Text>
                    <Text style={styles.jobStatLabel}>Tokens</Text>
                  </View>
                  <View style={styles.jobStat}>
                    <Text style={styles.jobStatValue}>${(job.estimated_cost ?? 0).toFixed(4)}</Text>
                    <Text style={styles.jobStatLabel}>Cost</Text>
                  </View>
                </View>
                {job.status === 'completed' && (
                  <View style={styles.viewResults}>
                    <Text style={styles.viewResultsText}>View Contacts</Text>
                    <Ionicons name="chevron-forward" size={14} color={Colors.primary} />
                  </View>
                )}
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: any }) {
  return (
    <View style={styles.statCard}>
      <Ionicons name={icon} size={22} color={Colors.primary} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ContactRow({ contact }: { contact: any }) {
  return (
    <View style={styles.contactCard}>
      <View style={styles.contactAvatar}>
        <Text style={styles.contactAvatarText}>
          {(contact.name ?? contact.email ?? '?').charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={styles.contactInfo}>
        {contact.name && <Text style={styles.contactName}>{contact.name}</Text>}
        {contact.email && <Text style={styles.contactEmail}>{contact.email}</Text>}
        {contact.phone && <Text style={styles.contactPhone}>{contact.phone}</Text>}
        {contact.company && <Text style={styles.contactCompany}>{contact.company}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 120 },
  statsRow: { flexDirection: 'row', padding: 12, gap: 10 },
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center',
    gap: 4,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 2,
  },
  statValue: { fontSize: 18, fontWeight: '800', color: Colors.text },
  statLabel: { fontSize: 11, color: Colors.textSecondary, textAlign: 'center' },
  startingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    margin: 12,
    padding: 12,
    backgroundColor: Colors.primaryLight,
    borderRadius: 8,
    justifyContent: 'center',
  },
  startingText: { fontSize: 13, color: Colors.primary },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.text, padding: 16, paddingBottom: 8 },
  jobCard: {
    backgroundColor: Colors.surface,
    marginHorizontal: 12,
    marginBottom: 10,
    borderRadius: 12,
    padding: 14,
    gap: 10,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 2,
  },
  jobCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  jobDate: { fontSize: 12, color: Colors.textMuted },
  jobStats: { flexDirection: 'row', gap: 8 },
  jobStat: { flex: 1, alignItems: 'center', gap: 2 },
  jobStatValue: { fontSize: 15, fontWeight: '700', color: Colors.text },
  jobStatLabel: { fontSize: 10, color: Colors.textMuted, textAlign: 'center' },
  viewResults: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
  viewResultsText: { fontSize: 13, color: Colors.primary, fontWeight: '600' },
  subHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  subHeaderTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: Colors.text },
  subHeaderCount: { fontSize: 14, color: Colors.textSecondary },
  contactCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 12,
  },
  contactAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  contactAvatarText: { fontSize: 16, fontWeight: '700', color: Colors.primary },
  contactInfo: { flex: 1, gap: 2 },
  contactName: { fontSize: 14, fontWeight: '600', color: Colors.text },
  contactEmail: { fontSize: 13, color: Colors.textSecondary },
  contactPhone: { fontSize: 12, color: Colors.textMuted },
  contactCompany: { fontSize: 12, color: Colors.textMuted },
});
