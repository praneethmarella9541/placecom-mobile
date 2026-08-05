import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, TextInput, ScrollView, Alert, Modal,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { formatDistanceToNow } from 'date-fns';
import ScreenHeader from '../../../components/ScreenHeader';
import EmptyState from '../../../components/EmptyState';
import Badge from '../../../components/Badge';
import { useDrawer } from '../_layout';
import { crmApi } from '../../../lib/api';
import { Colors } from '../../../constants/colors';
import type { Lead, LeadType } from '../../../lib/types';

const SCORE_COLORS = {
  Hot: { bg: '#FEE2E2', text: Colors.hot },
  Warm: { bg: '#FEF3C7', text: Colors.warning },
  Cold: { bg: '#DBEAFE', text: Colors.cold },
};

const LEAD_TYPES: LeadType[] = ['New Lead', 'Regular Recruiter'];

const STAGES: Record<LeadType, string[]> = {
  'New Lead': ['Awareness', 'Engagement', 'Conversion', 'Retention'],
  'Regular Recruiter': ['Relationship Mgt', 'JD Expected', 'JD Received', 'Drive Scheduled'],
};

export default function CrmScreen() {
  const router = useRouter();
  const { openDrawer } = useDrawer();
  const [leadType, setLeadType] = useState<LeadType>('New Lead');
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  const [filterScore, setFilterScore] = useState<string | null>(null);
  const [addingLead, setAddingLead] = useState(false);
  const [newCompany, setNewCompany] = useState('');
  const [newContact, setNewContact] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [savingLead, setSavingLead] = useState(false);

  const loadLeads = useCallback(async () => {
    try {
      const data = await crmApi.listLeads(leadType);
      setLeads(data.leads ?? []);
    } catch {
      setLeads([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [leadType]);

  useEffect(() => {
    setLoading(true);
    loadLeads();
  }, [loadLeads]);

  const filtered = leads.filter((l) => {
    const matchSearch =
      l.company_name.toLowerCase().includes(search.toLowerCase()) ||
      (l.contact_name ?? '').toLowerCase().includes(search.toLowerCase());
    const matchScore = !filterScore || l.score === filterScore;
    return matchSearch && matchScore;
  });

  const grouped = STAGES[leadType].reduce<Record<string, Lead[]>>((acc, stage) => {
    acc[stage] = filtered.filter((l) => l.stage === stage);
    return acc;
  }, {});

  function openAddLead() {
    setNewCompany('');
    setNewContact('');
    setNewEmail('');
    setNewPhone('');
    setAddingLead(true);
  }

  async function handleCreateLead() {
    const company = newCompany.trim();
    if (!company) {
      Alert.alert('Company required', 'Enter a company name.');
      return;
    }
    setSavingLead(true);
    try {
      await crmApi.createLead({
        company_name: company,
        contact_name: newContact.trim() || null,
        email: newEmail.trim() || null,
        phone: newPhone.trim() || null,
        lead_type: leadType,
        stage: STAGES[leadType][0],
      });
      setAddingLead(false);
      await loadLeads();
    } catch (e: unknown) {
      Alert.alert('Could not add lead', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSavingLead(false);
    }
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="CRM"
        onMenuPress={openDrawer}
        rightAction={{ icon: 'add-circle-outline', onPress: openAddLead }}
      />

      <View style={styles.typeBar}>
        {LEAD_TYPES.map((t) => (
          <TouchableOpacity
            key={t}
            style={[styles.typeTab, leadType === t && styles.typeTabActive]}
            onPress={() => setLeadType(t)}
          >
            <Text style={[styles.typeTabText, leadType === t && styles.typeTabTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.filterRow}>
        <View style={styles.searchBar}>
          <Ionicons name="search-outline" size={14} color={Colors.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search leads..."
            placeholderTextColor={Colors.textMuted}
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.scoreFilters}>
          {[null, 'Hot', 'Warm', 'Cold'].map((s) => (
            <TouchableOpacity
              key={s ?? 'all'}
              style={[styles.scoreBtn, filterScore === s && styles.scoreBtnActive]}
              onPress={() => setFilterScore(s)}
            >
              <Text style={[styles.scoreBtnText, filterScore === s && styles.scoreBtnTextActive]}>
                {s ?? 'All'}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={Colors.copper} /></View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {STAGES[leadType].map((stage) => (
            <StageSection
              key={stage}
              stage={stage}
              leads={grouped[stage] ?? []}
              onPress={(id) => router.push(`/(workspace)/crm/${id}` as any)}
            />
          ))}
        </ScrollView>
      )}

      <Modal visible={addingLead} transparent animationType="fade" onRequestClose={() => setAddingLead(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Add Lead</Text>
            <TextInput
              style={styles.sheetInput}
              value={newCompany}
              onChangeText={setNewCompany}
              placeholder="Company name"
              placeholderTextColor={Colors.textMuted}
              autoFocus
            />
            <TextInput
              style={styles.sheetInput}
              value={newContact}
              onChangeText={setNewContact}
              placeholder="Contact name"
              placeholderTextColor={Colors.textMuted}
            />
            <TextInput
              style={styles.sheetInput}
              value={newEmail}
              onChangeText={setNewEmail}
              placeholder="Email"
              placeholderTextColor={Colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <TextInput
              style={styles.sheetInput}
              value={newPhone}
              onChangeText={setNewPhone}
              placeholder="Phone"
              placeholderTextColor={Colors.textMuted}
              keyboardType="phone-pad"
            />
            <View style={styles.sheetActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setAddingLead(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={handleCreateLead} disabled={savingLead}>
                {savingLead ? (
                  <ActivityIndicator color={Colors.surface} size="small" />
                ) : (
                  <Text style={styles.saveBtnText}>Add</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function StageSection({ stage, leads, onPress }: { stage: string; leads: Lead[]; onPress: (id: string) => void }) {
  const [expanded, setExpanded] = useState(true);
  return (
    <View style={styles.stageSection}>
      <TouchableOpacity style={styles.stageHeader} onPress={() => setExpanded(!expanded)}>
        <View style={styles.stageTitleRow}>
          <Text style={styles.stageName}>{stage}</Text>
          <View style={styles.stageCount}>
            <Text style={styles.stageCountText}>{leads.length}</Text>
          </View>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textSecondary} />
      </TouchableOpacity>
      {expanded && leads.map((lead) => (
        <LeadCard key={lead.id} lead={lead} onPress={() => onPress(lead.id)} />
      ))}
      {expanded && leads.length === 0 && (
        <Text style={styles.emptyStage}>No leads in this stage</Text>
      )}
    </View>
  );
}

function LeadCard({ lead, onPress }: { lead: Lead; onPress: () => void }) {
  const sc = lead.score ? SCORE_COLORS[lead.score] : null;
  return (
    <TouchableOpacity style={styles.leadCard} onPress={onPress} activeOpacity={0.8}>
      <View style={styles.leadCardHeader}>
        <Text style={styles.companyName} numberOfLines={1}>{lead.company_name}</Text>
        {sc && <Badge label={lead.score!} bgColor={sc.bg} color={sc.text} />}
      </View>
      {lead.contact_name && <Text style={styles.contactName}>{lead.contact_name}</Text>}
      <View style={styles.leadMeta}>
        {lead.email && (
          <View style={styles.metaItem}>
            <Ionicons name="mail-outline" size={12} color={Colors.textMuted} />
            <Text style={styles.metaText} numberOfLines={1}>{lead.email}</Text>
          </View>
        )}
        {lead.phone && (
          <View style={styles.metaItem}>
            <Ionicons name="call-outline" size={12} color={Colors.textMuted} />
            <Text style={styles.metaText}>{lead.phone}</Text>
          </View>
        )}
        {lead.staff_name && (
          <View style={styles.metaItem}>
            <Ionicons name="person-outline" size={12} color={Colors.textMuted} />
            <Text style={styles.metaText}>{lead.staff_name}</Text>
          </View>
        )}
      </View>
      <Text style={styles.leadTime}>
        {lead.updated_at ? formatDistanceToNow(new Date(lead.updated_at), { addSuffix: true }) : ''}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  typeBar: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  typeTab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  typeTabActive: { borderBottomWidth: 2, borderBottomColor: Colors.primary },
  typeTabText: { fontSize: 13, fontWeight: '500', color: Colors.textSecondary },
  typeTabTextActive: { color: Colors.primary, fontWeight: '700' },
  filterRow: { gap: 8, padding: 12, paddingBottom: 4 },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: Colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  searchInput: { flex: 1, fontSize: 14, color: Colors.text },
  scoreFilters: { flexDirection: 'row', gap: 6, paddingVertical: 4 },
  scoreBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  scoreBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  scoreBtnText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  scoreBtnTextActive: { color: Colors.surface },
  stageSection: { marginBottom: 4 },
  stageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: Colors.background,
  },
  stageTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stageName: { fontSize: 13, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  stageCount: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  stageCountText: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary },
  emptyStage: { fontSize: 13, color: Colors.textMuted, textAlign: 'center', padding: 12 },
  leadCard: {
    backgroundColor: Colors.surface,
    marginHorizontal: 12,
    marginBottom: 8,
    borderRadius: 12,
    padding: 14,
    gap: 6,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 2,
  },
  leadCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  companyName: { fontSize: 15, fontWeight: '700', color: Colors.text, flex: 1 },
  contactName: { fontSize: 13, color: Colors.textSecondary },
  leadMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, color: Colors.textMuted, maxWidth: 150 },
  leadTime: { fontSize: 11, color: Colors.textMuted },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: 24 },
  sheet: { backgroundColor: Colors.surface, borderRadius: 14, padding: 20, gap: 12 },
  sheetTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },
  sheetInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 16,
    color: Colors.text,
  },
  sheetActions: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 12 },
  cancelText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  saveBtn: {
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    minWidth: 80,
    alignItems: 'center',
  },
  saveBtnText: { fontSize: 15, fontWeight: '600', color: Colors.surface },
});
