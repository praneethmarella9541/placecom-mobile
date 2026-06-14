import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Switch, Alert, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { adminApi } from '../lib/api';
import type { AdminTeamGroup } from '../lib/admin-team';
import { GROUP_MANAGEABLE_FEATURES, FEATURE_LABELS, type GroupManageableFeature } from '../lib/admin-features';
import { Colors } from '../constants/colors';

type Props = {
  groups: AdminTeamGroup[];
  loading?: boolean;
  onRefresh: () => Promise<void>;
};

export function AdminGroupsPanel({ groups, loading, onRefresh }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [name, setName] = useState('');
  const [blocked, setBlocked] = useState<GroupManageableFeature[]>([]);
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editBlocked, setEditBlocked] = useState<GroupManageableFeature[]>([]);

  function toggleBlocked(
    list: GroupManageableFeature[],
    feature: GroupManageableFeature,
    setter: (v: GroupManageableFeature[]) => void,
  ) {
    setter(list.includes(feature) ? list.filter((f) => f !== feature) : [...list, feature]);
  }

  async function createGroup() {
    setBusy(true);
    try {
      await adminApi.createGroup({ name: name.trim(), restrictedFeatures: blocked });
      setName('');
      setBlocked([]);
      await onRefresh();
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not create group');
    } finally {
      setBusy(false);
    }
  }

  function startEdit(group: AdminTeamGroup) {
    setEditingId(group.id);
    setEditName(group.name);
    setEditBlocked(group.restrictedFeatures.filter((f): f is GroupManageableFeature =>
      (GROUP_MANAGEABLE_FEATURES as readonly string[]).includes(f)
    ));
  }

  async function saveEdit(groupId: string) {
    setBusy(true);
    try {
      await adminApi.updateGroup({
        groupId,
        name: editName.trim(),
        restrictedFeatures: editBlocked,
      });
      setEditingId(null);
      await onRefresh();
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not update group');
    } finally {
      setBusy(false);
    }
  }

  function deleteGroup(groupId: string, groupName: string) {
    Alert.alert(
      'Delete group',
      `Delete group "${groupName}"? Members will be unassigned from this group.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            try {
              await adminApi.deleteGroup(groupId);
              await onRefresh();
            } catch (e: unknown) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Could not delete group');
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  return (
    <View style={styles.card}>
      <TouchableOpacity
        style={styles.headerRow}
        onPress={() => setExpanded((v) => !v)}
        activeOpacity={0.7}
      >
        <Text style={styles.cardTitle}>Access groups</Text>
        <View style={styles.headerMeta}>
          {!expanded && groups.length > 0 ? (
            <Text style={styles.headerCount}>{groups.length} group{groups.length === 1 ? '' : 's'}</Text>
          ) : null}
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={Colors.textSecondary}
          />
        </View>
      </TouchableOpacity>

      {expanded ? (
        <>
      <View style={styles.createBox}>
        <Text style={styles.label}>New group name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Placement Team, Interns"
          placeholderTextColor={Colors.textMuted}
        />
        <Text style={styles.hint}>Allowed features (unchecked = blocked)</Text>
        <FeatureChecklist
          blocked={blocked}
          onToggle={(f) => toggleBlocked(blocked, f, setBlocked)}
        />
        <TouchableOpacity
          style={[styles.primaryBtn, (busy || !name.trim()) && styles.btnDisabled]}
          onPress={() => void createGroup()}
          disabled={busy || !name.trim()}
        >
          {busy ? <ActivityIndicator size="small" color={Colors.surface} /> : (
            <Text style={styles.primaryBtnText}>Create group</Text>
          )}
        </TouchableOpacity>
      </View>

      {loading ? (
        <Text style={styles.muted}>Loading groups…</Text>
      ) : groups.length === 0 ? (
        <Text style={styles.muted}>
          No custom groups yet. Full access = leave group unassigned when adding members.
        </Text>
      ) : (
        <View style={styles.groupList}>
          {groups.map((g) => (
            <View key={g.id} style={styles.groupItem}>
              {editingId === g.id ? (
                <View style={styles.editBox}>
                  <TextInput
                    style={styles.input}
                    value={editName}
                    onChangeText={setEditName}
                  />
                  <FeatureChecklist
                    blocked={editBlocked}
                    onToggle={(f) => toggleBlocked(editBlocked, f, setEditBlocked)}
                  />
                  <View style={styles.row}>
                    <TouchableOpacity
                      style={[styles.primaryBtn, styles.flex, busy && styles.btnDisabled]}
                      onPress={() => void saveEdit(g.id)}
                      disabled={busy}
                    >
                      <Text style={styles.primaryBtnText}>Save</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.ghostBtn, styles.flex]} onPress={() => setEditingId(null)}>
                      <Text style={styles.ghostBtnText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : (
                <View style={styles.groupRow}>
                  <View style={styles.groupInfo}>
                    <Text style={styles.groupName}>{g.name}</Text>
                    <Text style={styles.muted}>
                      {g.restrictedFeatures.length
                        ? `${g.restrictedFeatures.length} feature(s) blocked`
                        : 'Full access'}
                    </Text>
                  </View>
                  <View style={styles.row}>
                    <TouchableOpacity style={styles.ghostBtn} onPress={() => startEdit(g)}>
                      <Text style={styles.ghostBtnText}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.ghostBtn} onPress={() => deleteGroup(g.id, g.name)}>
                      <Text style={[styles.ghostBtnText, { color: Colors.error }]}>Delete</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>
          ))}
        </View>
      )}
        </>
      ) : null}
    </View>
  );
}

function FeatureChecklist({
  blocked,
  onToggle,
}: {
  blocked: GroupManageableFeature[];
  onToggle: (feature: GroupManageableFeature) => void;
}) {
  return (
    <View style={styles.featureGrid}>
      {GROUP_MANAGEABLE_FEATURES.map((feature) => (
        <View key={feature} style={styles.featureRow}>
          <Text style={styles.featureLabel}>{FEATURE_LABELS[feature]}</Text>
          <Switch
            value={!blocked.includes(feature)}
            onValueChange={() => onToggle(feature)}
            trackColor={{ true: Colors.primary, false: Colors.border }}
            thumbColor={Colors.surface}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    gap: 14,
    marginHorizontal: 12,
    marginBottom: 12,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 2,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerCount: { fontSize: 12, color: Colors.textMuted },
  createBox: { gap: 8, borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 12 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  hint: { fontSize: 12, color: Colors.textMuted },
  muted: { fontSize: 13, color: Colors.textMuted, lineHeight: 18 },
  primaryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnText: { color: Colors.surface, fontWeight: '700', fontSize: 14 },
  btnDisabled: { opacity: 0.5 },
  ghostBtn: { paddingHorizontal: 10, paddingVertical: 8 },
  ghostBtnText: { fontSize: 13, fontWeight: '600', color: Colors.primary },
  groupList: { gap: 10 },
  groupItem: { borderWidth: 1, borderColor: Colors.border, borderRadius: 12, padding: 12 },
  groupRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  groupInfo: { flex: 1, gap: 2 },
  groupName: { fontSize: 14, fontWeight: '600', color: Colors.text },
  editBox: { gap: 10 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  flex: { flex: 1 },
  featureGrid: { gap: 4 },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  featureLabel: { fontSize: 13, color: Colors.text },
});
