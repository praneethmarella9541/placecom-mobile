import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, ActivityIndicator, Alert, Modal, TextInput, ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ScreenHeader from '../../../components/ScreenHeader';
import EmptyState from '../../../components/EmptyState';
import { useDrawer } from '../_layout';
import { adminApi, type TeamGroup } from '../../../lib/api';
import { useAuth } from '../../../hooks/useAuth';
import { Colors } from '../../../constants/colors';
import { filterAvailableExotelNumbers, exotelNumbersForSelect } from '../../../lib/admin-exotel-select';
import { GROUP_MANAGEABLE_FEATURES, FEATURE_LABELS, type FeatureKey } from '../../../lib/feature-access';

export default function AdminScreen() {
  const router = useRouter();
  const { openDrawer } = useDrawer();
  const { profile } = useAuth();
  const [members, setMembers] = useState<any[]>([]);
  const [groups, setGroups] = useState<TeamGroup[]>([]);
  const [configuredExotelNumbers, setConfiguredExotelNumbers] = useState<string[]>([]);
  const [assignedExotelNumbers, setAssignedExotelNumbers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editMember, setEditMember] = useState<any | null>(null);

  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newJobTitle, setNewJobTitle] = useState('');
  const [newGroupId, setNewGroupId] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [mobilePhone, setMobilePhone] = useState('');
  const [exotelNumber, setExotelNumber] = useState('');
  const [saving, setSaving] = useState(false);

  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const [exotelPickerOpen, setExotelPickerOpen] = useState(false);

  const [groupsPanelOpen, setGroupsPanelOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupBlocked, setNewGroupBlocked] = useState<FeatureKey[]>([]);
  const [groupBusy, setGroupBusy] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState('');
  const [editGroupBlocked, setEditGroupBlocked] = useState<FeatureKey[]>([]);

  const loadMembers = useCallback(async () => {
    try {
      const data = await adminApi.listTeam();
      setMembers(
        (data.members ?? []).filter((m) => m.role === 'staff' || m.role === 'committee')
      );
      setAssignedExotelNumbers(data.assignedExotelNumbers ?? []);
    } catch {
      setMembers([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  const loadGroups = useCallback(() => {
    return adminApi.listGroups().then((d) => setGroups(d.groups ?? [])).catch(() => setGroups([]));
  }, []);

  useEffect(() => {
    adminApi.listExotelNumbers()
      // Only one Exotel line is actually active right now (ends in 15) — hide the rest until more are provisioned.
      .then((d) => setConfiguredExotelNumbers((d.numbers ?? []).filter((n) => n.endsWith('15'))))
      .catch(() => setConfiguredExotelNumbers([]));
    loadGroups();
  }, [loadGroups]);

  const currentExotel = editMember
    ? (editMember.exotelVirtualNumber ?? editMember.exotel_virtual_number ?? null)
    : null;
  const availableExotelNumbers = useMemo(
    () => filterAvailableExotelNumbers(configuredExotelNumbers, assignedExotelNumbers, currentExotel),
    [configuredExotelNumbers, assignedExotelNumbers, currentExotel]
  );
  const exotelOptions = useMemo(
    () => exotelNumbersForSelect(availableExotelNumbers, currentExotel),
    [availableExotelNumbers, currentExotel]
  );

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
    setNewJobTitle('');
    setNewGroupId('');
    setNewPassword('');
    setMobilePhone('');
    setExotelNumber('');
    setGroupPickerOpen(false);
    setExotelPickerOpen(false);
    setEditMember(null);
    setShowAdd(true);
  }

  function openEdit(member: any) {
    setNewEmail(member.email ?? '');
    setNewName(member.displayUsername ?? member.display_name ?? '');
    setNewJobTitle(member.jobTitle ?? '');
    setNewGroupId(member.groupId ?? '');
    setNewPassword('');
    setMobilePhone(member.mobilePhone ?? member.mobile_phone ?? '');
    setExotelNumber(member.exotelVirtualNumber ?? member.exotel_virtual_number ?? '');
    setGroupPickerOpen(false);
    setExotelPickerOpen(false);
    setEditMember(member);
    setShowAdd(true);
  }

  async function save() {
    setSaving(true);
    try {
      const payload = {
        displayUsername: newName.trim() || null,
        jobTitle: newJobTitle.trim() || null,
        groupId: newGroupId || null,
        mobilePhone: mobilePhone.trim() || null,
        exotelVirtualNumber: exotelNumber.trim() || null,
      };
      if (editMember) {
        await adminApi.updateMember(editMember.id, {
          email: newEmail.trim().toLowerCase(),
          ...payload,
          ...(newPassword ? { password: newPassword } : {}),
        });
      } else {
        await adminApi.createMember({
          email: newEmail.trim().toLowerCase(),
          password: newPassword,
          ...payload,
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

  function toggleBlocked(list: FeatureKey[], feature: FeatureKey, setter: (v: FeatureKey[]) => void) {
    setter(list.includes(feature) ? list.filter((f) => f !== feature) : [...list, feature]);
  }

  async function createGroup() {
    setGroupBusy(true);
    try {
      await adminApi.createGroup({ name: newGroupName.trim(), restrictedFeatures: newGroupBlocked });
      setNewGroupName('');
      setNewGroupBlocked([]);
      await loadGroups();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setGroupBusy(false);
    }
  }

  function startEditGroup(group: TeamGroup) {
    setEditingGroupId(group.id);
    setEditGroupName(group.name);
    setEditGroupBlocked([...(group.restrictedFeatures as FeatureKey[])]);
  }

  async function saveGroupEdit(groupId: string) {
    setGroupBusy(true);
    try {
      await adminApi.updateGroup(groupId, { name: editGroupName.trim(), restrictedFeatures: editGroupBlocked });
      setEditingGroupId(null);
      await loadGroups();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setGroupBusy(false);
    }
  }

  function deleteGroup(groupId: string, groupName: string) {
    Alert.alert('Delete Group', `Delete "${groupName}"? Members will be unassigned from this group.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          setGroupBusy(true);
          try {
            await adminApi.deleteGroup(groupId);
            await loadGroups();
          } catch (e: any) {
            Alert.alert('Error', e.message);
          } finally {
            setGroupBusy(false);
          }
        },
      },
    ]);
  }

  const groupOptions = [{ value: '', label: 'Full access (no group)' }, ...groups.map((g) => ({ value: g.id, label: g.name }))];
  const exotelSelectOptions = [
    { value: '', label: 'Not assigned' },
    ...exotelOptions.map((n) => ({ value: n, label: n })),
  ];

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Team"
        onMenuPress={openDrawer}
        rightAction={{ icon: 'stats-chart-outline', onPress: () => router.push('/(workspace)/admin/analytics' as any) }}
      />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={Colors.copper} /></View>
      ) : (
        <FlatList
          data={members}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <MemberRow
              member={item}
              onEdit={() => openEdit(item)}
              onDelete={() => deleteMember(item.id, item.displayUsername ?? item.display_name ?? item.email)}
            />
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadMembers(); }} tintColor={Colors.copper} />}
          ListHeaderComponent={
            <View style={styles.listHeader}>
              <TouchableOpacity style={styles.toolbarBtn} onPress={openAdd}>
                <Ionicons name="person-add-outline" size={16} color={Colors.copper} />
                <Text style={styles.toolbarBtnText}>Add member</Text>
              </TouchableOpacity>
              <GroupsPanel
                groups={groups}
                open={groupsPanelOpen}
                onToggle={() => setGroupsPanelOpen((v) => !v)}
                busy={groupBusy}
                newGroupName={newGroupName}
                onNewGroupNameChange={setNewGroupName}
                newGroupBlocked={newGroupBlocked}
                onToggleNewBlocked={(f) => toggleBlocked(newGroupBlocked, f, setNewGroupBlocked)}
                onCreateGroup={createGroup}
                editingGroupId={editingGroupId}
                editGroupName={editGroupName}
                onEditGroupNameChange={setEditGroupName}
                editGroupBlocked={editGroupBlocked}
                onToggleEditBlocked={(f) => toggleBlocked(editGroupBlocked, f, setEditGroupBlocked)}
                onStartEdit={startEditGroup}
                onCancelEdit={() => setEditingGroupId(null)}
                onSaveEdit={saveGroupEdit}
                onDeleteGroup={deleteGroup}
              />
            </View>
          }
          ListEmptyComponent={<EmptyState icon="people-outline" title="No team members" subtitle="Add your first team member" />}
          contentContainerStyle={members.length === 0 ? { flex: 1 } : { padding: 12, gap: 10 }}
        />
      )}

      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <View style={styles.modalOverlay}>
          <ScrollView style={styles.modalScroll} keyboardShouldPersistTaps="handled">
            <View style={styles.modalCard}>
              <Text style={styles.modalTitle}>{editMember ? 'Edit Member' : 'Add Team Member'}</Text>

              {!editMember && (
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Work email *</Text>
                  <TextInput
                    style={styles.input}
                    value={newEmail}
                    onChangeText={setNewEmail}
                    placeholder="colleague@company.com"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                </View>
              )}

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>{editMember ? 'New password (optional)' : 'Initial password (min. 8 characters) *'}</Text>
                <TextInput
                  style={styles.input}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="••••••••"
                  placeholderTextColor={Colors.textMuted}
                  secureTextEntry
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Display name</Text>
                <TextInput style={styles.input} value={newName} onChangeText={setNewName} placeholder="Optional — defaults from email" placeholderTextColor={Colors.textMuted} />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Job title</Text>
                <TextInput style={styles.input} value={newJobTitle} onChangeText={setNewJobTitle} placeholder="Optional" placeholderTextColor={Colors.textMuted} />
              </View>

              <FieldDropdown
                label="Access group"
                value={newGroupId}
                options={groupOptions}
                open={groupPickerOpen}
                onToggle={() => setGroupPickerOpen((v) => !v)}
                onSelect={(v) => { setNewGroupId(v); setGroupPickerOpen(false); }}
              />

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Personal mobile</Text>
                <Text style={styles.sublabel}>Incoming Exotel calls transfer to this number</Text>
                <TextInput
                  style={styles.input}
                  value={mobilePhone}
                  onChangeText={setMobilePhone}
                  placeholder="+919876543210"
                  placeholderTextColor={Colors.textMuted}
                  keyboardType="phone-pad"
                />
              </View>

              {exotelSelectOptions.length > 1 ? (
                <FieldDropdown
                  label="Exotel number"
                  sublabel="Which virtual line this member uses for calls"
                  value={exotelNumber}
                  options={exotelSelectOptions}
                  open={exotelPickerOpen}
                  onToggle={() => setExotelPickerOpen((v) => !v)}
                  onSelect={(v) => { setExotelNumber(v); setExotelPickerOpen(false); }}
                />
              ) : (
                <View style={styles.fieldGroup}>
                  <Text style={styles.label}>Exotel number</Text>
                  <Text style={styles.sublabel}>Loads from your Exotel account</Text>
                  <TextInput
                    style={styles.input}
                    value={exotelNumber}
                    onChangeText={setExotelNumber}
                    placeholder="+91…"
                    placeholderTextColor={Colors.textMuted}
                    keyboardType="phone-pad"
                  />
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

function FieldDropdown({
  label,
  sublabel,
  value,
  options,
  open,
  onToggle,
  onSelect,
}: {
  label: string;
  sublabel?: string;
  value: string;
  options: { value: string; label: string }[];
  open: boolean;
  onToggle: () => void;
  onSelect: (v: string) => void;
}) {
  const selectedLabel = options.find((o) => o.value === value)?.label ?? options[0]?.label ?? '';
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      {sublabel ? <Text style={styles.sublabel}>{sublabel}</Text> : null}
      <TouchableOpacity style={styles.selectBtn} onPress={onToggle} activeOpacity={0.7}>
        <Text style={styles.selectBtnText} numberOfLines={1}>{selectedLabel}</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={Colors.textSecondary} />
      </TouchableOpacity>
      {open && (
        <View style={styles.selectMenu}>
          {options.map((opt) => (
            <TouchableOpacity
              key={opt.value || '__none'}
              style={styles.selectOption}
              onPress={() => onSelect(opt.value)}
            >
              <Text style={[styles.selectOptionText, opt.value === value && styles.selectOptionActive]} numberOfLines={1}>
                {opt.label}
              </Text>
              {opt.value === value && <Ionicons name="checkmark" size={16} color={Colors.copper} />}
            </TouchableOpacity>
          ))}
        </View>
      )}
    </View>
  );
}

function FeatureChecklist({
  blocked,
  onToggle,
}: {
  blocked: FeatureKey[];
  onToggle: (feature: FeatureKey) => void;
}) {
  return (
    <View style={styles.checklist}>
      {GROUP_MANAGEABLE_FEATURES.map((feature) => {
        const allowed = !blocked.includes(feature);
        return (
          <TouchableOpacity
            key={feature}
            style={styles.checklistItem}
            onPress={() => onToggle(feature)}
            activeOpacity={0.7}
          >
            <Ionicons
              name={allowed ? 'checkbox' : 'square-outline'}
              size={18}
              color={allowed ? Colors.copper : Colors.textMuted}
            />
            <Text style={styles.checklistLabel}>{FEATURE_LABELS[feature]}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function GroupsPanel({
  groups,
  open,
  onToggle,
  busy,
  newGroupName,
  onNewGroupNameChange,
  newGroupBlocked,
  onToggleNewBlocked,
  onCreateGroup,
  editingGroupId,
  editGroupName,
  onEditGroupNameChange,
  editGroupBlocked,
  onToggleEditBlocked,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDeleteGroup,
}: {
  groups: TeamGroup[];
  open: boolean;
  onToggle: () => void;
  busy: boolean;
  newGroupName: string;
  onNewGroupNameChange: (v: string) => void;
  newGroupBlocked: FeatureKey[];
  onToggleNewBlocked: (f: FeatureKey) => void;
  onCreateGroup: () => void;
  editingGroupId: string | null;
  editGroupName: string;
  onEditGroupNameChange: (v: string) => void;
  editGroupBlocked: FeatureKey[];
  onToggleEditBlocked: (f: FeatureKey) => void;
  onStartEdit: (group: TeamGroup) => void;
  onCancelEdit: () => void;
  onSaveEdit: (groupId: string) => void;
  onDeleteGroup: (groupId: string, groupName: string) => void;
}) {
  return (
    <View style={styles.groupsCard}>
      <TouchableOpacity style={styles.groupsHeader} onPress={onToggle} activeOpacity={0.7}>
        <Text style={styles.groupsTitle}>Access groups</Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={Colors.textSecondary} />
      </TouchableOpacity>

      {open && (
        <View style={styles.groupsBody}>
          <View style={styles.groupsNewForm}>
            <Text style={styles.label}>New group name</Text>
            <TextInput
              style={styles.input}
              value={newGroupName}
              onChangeText={onNewGroupNameChange}
              placeholder="e.g. Placement Team, Interns"
              placeholderTextColor={Colors.textMuted}
            />
            <Text style={styles.sublabel}>Allowed features (unchecked = blocked)</Text>
            <FeatureChecklist blocked={newGroupBlocked} onToggle={onToggleNewBlocked} />
            <TouchableOpacity
              style={[styles.groupCreateBtn, (busy || !newGroupName.trim()) && styles.btnDisabled]}
              onPress={onCreateGroup}
              disabled={busy || !newGroupName.trim()}
            >
              {busy ? <ActivityIndicator size="small" color={Colors.surface} /> : <Text style={styles.groupCreateBtnText}>Create group</Text>}
            </TouchableOpacity>
          </View>

          {groups.length === 0 ? (
            <Text style={styles.sublabel}>No custom groups yet. Full access = leave group unassigned when adding members.</Text>
          ) : (
            groups.map((g) => (
              <View key={g.id} style={styles.groupRow}>
                {editingGroupId === g.id ? (
                  <View style={{ gap: 8 }}>
                    <TextInput style={styles.input} value={editGroupName} onChangeText={onEditGroupNameChange} placeholderTextColor={Colors.textMuted} />
                    <FeatureChecklist blocked={editGroupBlocked} onToggle={onToggleEditBlocked} />
                    <View style={styles.modalActions}>
                      <TouchableOpacity style={styles.cancelBtn} onPress={onCancelEdit}>
                        <Text style={styles.cancelText}>Cancel</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.saveBtn} onPress={() => onSaveEdit(g.id)} disabled={busy}>
                        {busy ? <ActivityIndicator size="small" color={Colors.surface} /> : <Text style={styles.saveText}>Save</Text>}
                      </TouchableOpacity>
                    </View>
                  </View>
                ) : (
                  <View style={styles.groupRowContent}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.groupName}>{g.name}</Text>
                      <Text style={styles.groupMeta}>
                        {g.restrictedFeatures.length ? `${g.restrictedFeatures.length} feature(s) blocked` : 'Full access'}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => onStartEdit(g)} style={styles.actionBtn}>
                      <Text style={styles.groupActionText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => onDeleteGroup(g.id, g.name)} style={styles.actionBtn}>
                      <Text style={[styles.groupActionText, { color: Colors.error }]}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ))
          )}
        </View>
      )}
    </View>
  );
}

function MemberRow({ member, onEdit, onDelete }: { member: any; onEdit: () => void; onDelete: () => void }) {
  const name = member.displayUsername ?? member.display_name ?? 'No name';
  const groupLabel = member.groupName ?? 'Full access';
  const exotel = member.exotelVirtualNumber ?? member.exotel_virtual_number;
  return (
    <View style={styles.memberCard}>
      <View style={styles.memberAvatar}>
        <Text style={styles.memberAvatarText}>{(name ?? member.email ?? '?').charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.memberInfo}>
        <Text style={styles.memberName}>{name}</Text>
        <Text style={styles.memberEmail} numberOfLines={1}>
          {member.email} · {groupLabel}
        </Text>
        {exotel ? <Text style={styles.memberMeta}>Exotel: {exotel}</Text> : null}
      </View>
      <View style={styles.memberActions}>
        <TouchableOpacity onPress={onEdit} style={styles.actionBtn}>
          <Ionicons name="pencil-outline" size={18} color={Colors.copper} />
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
  listHeader: {
    gap: 10,
  },
  toolbarBtn: {
    flexDirection: 'row',
    alignSelf: 'flex-end',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: Colors.copperTint,
  },
  toolbarBtnText: { fontSize: 13, fontWeight: '600', color: Colors.copper, lineHeight: 16, textAlignVertical: 'center' },
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
    backgroundColor: Colors.copperTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberAvatarText: { fontSize: 18, fontWeight: '700', color: Colors.copper },
  memberInfo: { flex: 1, gap: 3 },
  memberName: { fontSize: 14, fontWeight: '700', color: Colors.text },
  memberEmail: { fontSize: 12, color: Colors.textSecondary },
  memberMeta: { fontSize: 11, color: Colors.textMuted },
  memberActions: { flexDirection: 'row', gap: 4 },
  actionBtn: { padding: 6 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalScroll: { maxHeight: '88%' },
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
  selectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
  },
  selectBtnText: { fontSize: 14, color: Colors.text, flex: 1 },
  selectMenu: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    overflow: 'hidden',
  },
  selectOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: Colors.borderLight,
    gap: 8,
  },
  selectOptionText: { fontSize: 14, color: Colors.text, flex: 1 },
  selectOptionActive: { color: Colors.copper, fontWeight: '600' },
  modalActions: { flexDirection: 'row', gap: 12 },
  cancelBtn: { flex: 1, padding: 13, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  cancelText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  saveBtn: { flex: 1, padding: 13, borderRadius: 10, backgroundColor: Colors.copper, alignItems: 'center' },
  saveText: { fontSize: 15, fontWeight: '700', color: Colors.surface },
  groupsCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  groupsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  groupsTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  groupsBody: { padding: 16, paddingTop: 0, gap: 14 },
  groupsNewForm: {
    gap: 8,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  groupCreateBtn: {
    marginTop: 4,
    padding: 12,
    borderRadius: 10,
    backgroundColor: Colors.copper,
    alignItems: 'center',
  },
  groupCreateBtnText: { fontSize: 14, fontWeight: '700', color: Colors.surface },
  btnDisabled: { opacity: 0.5 },
  groupRow: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  groupRowContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupName: { fontSize: 14, fontWeight: '600', color: Colors.text },
  groupMeta: { fontSize: 11, color: Colors.textMuted, marginTop: 2 },
  groupActionText: { fontSize: 13, fontWeight: '600', color: Colors.copper },
  checklist: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  checklistItem: { flexDirection: 'row', alignItems: 'center', gap: 6, width: '46%' },
  checklistLabel: { fontSize: 13, color: Colors.textSecondary },
});
