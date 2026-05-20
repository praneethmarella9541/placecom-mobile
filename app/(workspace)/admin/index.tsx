import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Alert, Modal, TextInput, Switch, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../components/ScreenHeader';
import EmptyState from '../../../components/EmptyState';
import Badge from '../../../components/Badge';
import { useDrawer } from '../_layout';
import { adminApi } from '../../../lib/api';
import { useAuth } from '../../../hooks/useAuth';
import { Colors } from '../../../constants/colors';

const FEATURES = [
  'inbox', 'drive', 'forms', 'broadcasting', 'dashboard',
  'crm', 'calendar', 'calls', 'meetings', 'sms', 'whatsapp',
];

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  admin: { bg: '#EDE9FE', text: Colors.primary },
  staff: { bg: '#D1FAE5', text: '#065F46' },
  committee: { bg: '#FEF3C7', text: '#92400E' },
};

export default function AdminScreen() {
  const { openDrawer } = useDrawer();
  const { profile } = useAuth();
  const [members, setMembers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editMember, setEditMember] = useState<any | null>(null);

  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'staff' | 'committee'>('staff');
  const [newPassword, setNewPassword] = useState('');
  const [restrictedFeatures, setRestrictedFeatures] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  const loadMembers = useCallback(async () => {
    try {
      const data = await adminApi.listTeam();
      setMembers(data.members ?? []);
    } catch {
      setMembers([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  if (profile?.role !== 'admin') {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Team" onMenuPress={openDrawer} />
        <EmptyState icon="lock-closed-outline" title="Admin Access Required" subtitle="Only admins can manage team members." />
      </View>
    );
  }

  function openAdd() {
    setNewEmail('');
    setNewName('');
    setNewRole('staff');
    setNewPassword('');
    setRestrictedFeatures([]);
    setEditMember(null);
    setShowAdd(true);
  }

  function openEdit(member: any) {
    setNewEmail(member.email ?? '');
    setNewName(member.display_name ?? '');
    setNewRole(member.role ?? 'staff');
    setNewPassword('');
    setRestrictedFeatures(member.restricted_features ?? []);
    setEditMember(member);
    setShowAdd(true);
  }

  async function save() {
    setSaving(true);
    try {
      if (editMember) {
        await adminApi.updateMember(editMember.id, {
          display_name: newName,
          role: newRole,
          restricted_features: restrictedFeatures,
          ...(newPassword ? { password: newPassword } : {}),
        });
      } else {
        await adminApi.createMember({
          email: newEmail,
          display_name: newName,
          role: newRole,
          password: newPassword,
          restricted_features: restrictedFeatures,
        });
      }
      setShowAdd(false);
      await loadMembers();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteMember(id: string, name: string) {
    Alert.alert('Delete Member', `Remove ${name} from the team?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          try {
            await adminApi.deleteMember(id);
            await loadMembers();
          } catch (e: any) {
            Alert.alert('Error', e.message);
          }
        },
      },
    ]);
  }

  function toggleFeature(feature: string) {
    setRestrictedFeatures((prev) =>
      prev.includes(feature) ? prev.filter((f) => f !== feature) : [...prev, feature]
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Team"
        onMenuPress={openDrawer}
        rightAction={{ icon: 'person-add-outline', onPress: openAdd }}
      />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>
      ) : (
        <FlatList
          data={members}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <MemberRow
              member={item}
              onEdit={() => openEdit(item)}
              onDelete={() => deleteMember(item.id, item.display_name ?? item.email)}
            />
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadMembers(); }} tintColor={Colors.primary} />}
          ListEmptyComponent={<EmptyState icon="people-outline" title="No team members" subtitle="Add your first team member" />}
          contentContainerStyle={members.length === 0 ? { flex: 1 } : { padding: 12, gap: 10 }}
        />
      )}

      <Modal visible={showAdd} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <ScrollView>
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>{editMember ? 'Edit Member' : 'Add Team Member'}</Text>

              {!editMember && (
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Email *</Text>
                  <TextInput
                    style={styles.input}
                    value={newEmail}
                    onChangeText={setNewEmail}
                    placeholder="team@company.com"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                </View>
              )}

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Name</Text>
                <TextInput style={styles.input} value={newName} onChangeText={setNewName} placeholder="Full name" placeholderTextColor={Colors.textMuted} />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Role</Text>
                <View style={styles.roleRow}>
                  {(['admin', 'staff', 'committee'] as const).map((r) => (
                    <TouchableOpacity
                      key={r}
                      style={[styles.roleBtn, newRole === r && styles.roleBtnActive]}
                      onPress={() => setNewRole(r)}
                    >
                      <Text style={[styles.roleBtnText, newRole === r && styles.roleBtnTextActive]}>
                        {r.charAt(0).toUpperCase() + r.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>{editMember ? 'New Password (optional)' : 'Password *'}</Text>
                <TextInput style={styles.input} value={newPassword} onChangeText={setNewPassword} placeholder="Password" placeholderTextColor={Colors.textMuted} secureTextEntry />
              </View>

              {newRole === 'committee' && (
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Restricted Features</Text>
                  <Text style={styles.sublabel}>Toggle features to RESTRICT access for this committee member</Text>
                  {FEATURES.map((feature) => (
                    <View key={feature} style={styles.featureRow}>
                      <Text style={styles.featureLabel}>{feature.charAt(0).toUpperCase() + feature.slice(1)}</Text>
                      <Switch
                        value={restrictedFeatures.includes(feature)}
                        onValueChange={() => toggleFeature(feature)}
                        trackColor={{ true: Colors.error, false: Colors.border }}
                        thumbColor={Colors.surface}
                      />
                    </View>
                  ))}
                </View>
              )}

              <View style={styles.modalActions}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowAdd(false)}>
                  <Text style={styles.cancelText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving}>
                  {saving ? <ActivityIndicator size="small" color={Colors.surface} /> : <Text style={styles.saveText}>{editMember ? 'Save' : 'Add'}</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

function MemberRow({ member, onEdit, onDelete }: { member: any; onEdit: () => void; onDelete: () => void }) {
  const rc = ROLE_COLORS[member.role] ?? { bg: Colors.border, text: Colors.textSecondary };
  return (
    <View style={styles.memberCard}>
      <View style={styles.memberAvatar}>
        <Text style={styles.memberAvatarText}>
          {(member.display_name ?? member.email ?? '?').charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={styles.memberInfo}>
        <Text style={styles.memberName}>{member.display_name ?? 'No name'}</Text>
        <Text style={styles.memberEmail}>{member.email}</Text>
        <Badge label={member.role} bgColor={rc.bg} color={rc.text} />
      </View>
      <View style={styles.memberActions}>
        <TouchableOpacity onPress={onEdit} style={styles.actionBtn}>
          <Ionicons name="pencil-outline" size={18} color={Colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={onDelete} style={styles.actionBtn}>
          <Ionicons name="trash-outline" size={18} color={Colors.error} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  memberCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 2,
  },
  memberAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarText: { fontSize: 18, fontWeight: '700', color: Colors.primary },
  memberInfo: { flex: 1, gap: 3 },
  memberName: { fontSize: 14, fontWeight: '700', color: Colors.text },
  memberEmail: { fontSize: 12, color: Colors.textSecondary },
  memberActions: { flexDirection: 'row', gap: 4 },
  actionBtn: { padding: 6 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 24,
    gap: 16,
    paddingBottom: 40,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  fieldGroup: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  sublabel: { fontSize: 12, color: Colors.textMuted },
  input: { borderWidth: 1, borderColor: Colors.border, borderRadius: 10, padding: 12, fontSize: 14, color: Colors.text },
  roleRow: { flexDirection: 'row', gap: 8 },
  roleBtn: {
    flex: 1,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    backgroundColor: Colors.background,
  },
  roleBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  roleBtnText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  roleBtnTextActive: { color: Colors.surface },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  featureLabel: { fontSize: 14, color: Colors.text, textTransform: 'capitalize' },
  modalActions: { flexDirection: 'row', gap: 12 },
  cancelBtn: { flex: 1, padding: 13, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  cancelText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  saveBtn: { flex: 1, padding: 13, borderRadius: 10, backgroundColor: Colors.primary, alignItems: 'center' },
  saveText: { fontSize: 15, fontWeight: '700', color: Colors.surface },
});
