import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, TextInput, Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { crmApi } from '../../../lib/api';
import { Colors } from '../../../constants/colors';
import Badge from '../../../components/Badge';
import type { Lead, LeadInteraction } from '../../../lib/types';

const SCORE_COLORS = {
  Hot: { bg: '#FEE2E2', text: Colors.hot },
  Warm: { bg: '#FEF3C7', text: Colors.warning },
  Cold: { bg: '#DBEAFE', text: Colors.cold },
};

const INTERACTION_ICONS = {
  Call: 'call-outline',
  Email: 'mail-outline',
  Meeting: 'videocam-outline',
  Note: 'document-text-outline',
} as const;

export default function LeadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [lead, setLead] = useState<Lead | null>(null);
  const [interactions, setInteractions] = useState<LeadInteraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'info' | 'interactions'>('info');
  const [showAddInteraction, setShowAddInteraction] = useState(false);
  const [intType, setIntType] = useState<'Call' | 'Email' | 'Meeting' | 'Note'>('Note');
  const [intNotes, setIntNotes] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    crmApi.getLead(id).then((data) => {
      setLead(data.lead ?? data);
      setInteractions(data.interactions ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  async function addInteraction() {
    if (!id) return;
    setSaving(true);
    try {
      await crmApi.addInteraction(id, { type: intType, notes: intNotes });
      const data = await crmApi.getLead(id);
      setInteractions(data.interactions ?? []);
      setIntNotes('');
      setShowAddInteraction(false);
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color={Colors.copper} /></View>;
  if (!lead) return <View style={styles.center}><Text>Lead not found</Text></View>;

  const sc = lead.score ? SCORE_COLORS[lead.score] : null;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{lead.company_name}</Text>
        <TouchableOpacity onPress={() => Alert.alert('Edit', 'Edit functionality coming soon')}>
          <Ionicons name="pencil-outline" size={22} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.leadHero}>
        <View style={styles.heroAvatar}>
          <Text style={styles.heroAvatarText}>{lead.company_name.charAt(0).toUpperCase()}</Text>
        </View>
        <Text style={styles.heroCompany}>{lead.company_name}</Text>
        {lead.contact_name && <Text style={styles.heroContact}>{lead.contact_name}</Text>}
        <View style={styles.heroBadges}>
          <Badge label={lead.stage} bgColor={Colors.primaryLight} color={Colors.primary} size="md" />
          {sc && <Badge label={lead.score!} bgColor={sc.bg} color={sc.text} size="md" />}
          <Badge label={lead.lead_type} bgColor={Colors.border} color={Colors.textSecondary} size="md" />
        </View>
      </View>

      <View style={styles.tabs}>
        {(['info', 'interactions'] as const).map((t) => (
          <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t === 'info' ? 'Info' : `Interactions (${interactions.length})`}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{ padding: 16, gap: 12 }}>
        {tab === 'info' ? (
          <>
            {lead.email && <InfoRow icon="mail-outline" label="Email" value={lead.email} />}
            {lead.phone && <InfoRow icon="call-outline" label="Phone" value={lead.phone} />}
            {lead.staff_name && <InfoRow icon="person-outline" label="Assigned To" value={lead.staff_name} />}
            <InfoRow icon="layers-outline" label="JD Count" value={String(lead.jd_count)} />
            <InfoRow icon="calendar-outline" label="Created" value={format(new Date(lead.created_at), 'MMM d, yyyy')} />
            <InfoRow icon="refresh-outline" label="Updated" value={format(new Date(lead.updated_at), 'MMM d, yyyy h:mm a')} />
          </>
        ) : (
          <>
            <TouchableOpacity style={styles.addInteractionBtn} onPress={() => setShowAddInteraction(true)}>
              <Ionicons name="add-circle-outline" size={18} color={Colors.primary} />
              <Text style={styles.addInteractionText}>Add Interaction</Text>
            </TouchableOpacity>
            {interactions.length === 0 && (
              <Text style={styles.emptyText}>No interactions yet. Log a call, email, or note.</Text>
            )}
            {interactions.map((int) => (
              <View key={int.id} style={styles.interactionCard}>
                <View style={styles.intHeader}>
                  <View style={styles.intIconBox}>
                    <Ionicons name={INTERACTION_ICONS[int.type]} size={16} color={Colors.primary} />
                  </View>
                  <Text style={styles.intType}>{int.type}</Text>
                  <Text style={styles.intDate}>{format(new Date(int.created_at), 'MMM d, h:mm a')}</Text>
                </View>
                {int.notes && <Text style={styles.intNotes}>{int.notes}</Text>}
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <Modal visible={showAddInteraction} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Add Interaction</Text>
            <View style={styles.intTypeRow}>
              {(['Call', 'Email', 'Meeting', 'Note'] as const).map((t) => (
                <TouchableOpacity
                  key={t}
                  style={[styles.intTypeBtn, intType === t && styles.intTypeBtnActive]}
                  onPress={() => setIntType(t)}
                >
                  <Ionicons name={INTERACTION_ICONS[t]} size={16} color={intType === t ? Colors.surface : Colors.textSecondary} />
                  <Text style={[styles.intTypeBtnText, intType === t && styles.intTypeBtnTextActive]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={styles.notesInput}
              value={intNotes}
              onChangeText={setIntNotes}
              placeholder="Add notes..."
              placeholderTextColor={Colors.textMuted}
              multiline
              numberOfLines={4}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAddInteraction(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.saveBtn} onPress={addInteraction} disabled={saving}>
                {saving ? <ActivityIndicator size="small" color={Colors.surface} /> : <Text style={styles.saveText}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function InfoRow({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={16} color={Colors.primary} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: Colors.text, marginHorizontal: 12 },
  leadHero: {
    alignItems: 'center',
    padding: 24,
    backgroundColor: Colors.surface,
    gap: 6,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  heroAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  heroAvatarText: { fontSize: 24, fontWeight: '800', color: Colors.primary },
  heroCompany: { fontSize: 18, fontWeight: '700', color: Colors.text },
  heroContact: { fontSize: 14, color: Colors.textSecondary },
  heroBadges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', justifyContent: 'center', marginTop: 4 },
  tabs: { flexDirection: 'row', backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: Colors.primary },
  tabText: { fontSize: 13, color: Colors.textSecondary },
  tabTextActive: { color: Colors.primary, fontWeight: '700' },
  content: { flex: 1 },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.surface,
    padding: 12,
    borderRadius: 10,
  },
  infoLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, flex: 1 },
  infoValue: { fontSize: 13, color: Colors.text },
  addInteractionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    backgroundColor: Colors.primaryLight,
    borderRadius: 10,
    justifyContent: 'center',
  },
  addInteractionText: { fontSize: 14, fontWeight: '600', color: Colors.primary },
  emptyText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center', padding: 16 },
  interactionCard: {
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  intHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  intIconBox: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  intType: { fontSize: 13, fontWeight: '700', color: Colors.text, flex: 1 },
  intDate: { fontSize: 11, color: Colors.textMuted },
  intNotes: { fontSize: 13, color: Colors.textSecondary, lineHeight: 18 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    gap: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  intTypeRow: { flexDirection: 'row', gap: 8 },
  intTypeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  intTypeBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  intTypeBtnText: { fontSize: 11, fontWeight: '600', color: Colors.textSecondary },
  intTypeBtnTextActive: { color: Colors.surface },
  notesInput: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: Colors.text,
    minHeight: 80,
    textAlignVertical: 'top',
  },
  modalActions: { flexDirection: 'row', gap: 12 },
  cancelBtn: { flex: 1, padding: 13, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  cancelText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  saveBtn: { flex: 1, padding: 13, borderRadius: 10, backgroundColor: Colors.primary, alignItems: 'center' },
  saveText: { fontSize: 15, fontWeight: '700', color: Colors.surface },
});
