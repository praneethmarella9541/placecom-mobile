import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, ScrollView, TouchableOpacity, Text, StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import BackScreenHeader from '../../../../components/BackScreenHeader';
import EmptyState from '../../../../components/EmptyState';
import { TeamMemberFormFields, type TeamMemberFormValues } from '../../../../components/admin/TeamMemberFormFields';
import { adminApi } from '../../../../lib/api';
import {
  teamMemberLabel,
  type AdminTeamGroup,
  type AdminTeamMember,
} from '../../../../lib/admin-team';
import { isAdminUser } from '../../../../lib/user-role';
import { useAuth } from '../../../../hooks/useAuth';
import { Colors } from '../../../../constants/colors';

export default function EditTeamMemberScreen() {
  const router = useRouter();
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const { profile } = useAuth();
  const [member, setMember] = useState<AdminTeamMember | null>(null);
  const [values, setValues] = useState<TeamMemberFormValues | null>(null);
  const [groups, setGroups] = useState<AdminTeamGroup[]>([]);
  const [exotelNumbers, setExotelNumbers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const [teamData, groupsData, exotelData] = await Promise.all([
        adminApi.listTeam(),
        adminApi.listGroups().catch(() => ({ groups: [] as AdminTeamGroup[] })),
        adminApi.listAvailableExotelNumbers(userId).catch(() => ({ numbers: [] as string[] })),
      ]);
      const found = (teamData.members ?? []).find((m) => m.id === userId) ?? null;
      setMember(found);
      setGroups(groupsData.groups ?? []);
      setExotelNumbers(exotelData.numbers ?? []);
      if (found) {
        setValues({
          email: found.email ?? '',
          password: '',
          displayName: found.displayUsername ?? '',
          jobTitle: found.jobTitle ?? '',
          groupId: found.groupId ?? '',
          tokenLimit: found.openaiTokenLimit != null ? String(found.openaiTokenLimit) : '',
          mobilePhone: found.mobilePhone ?? '',
          exotelNumber: found.exotelVirtualNumber ?? '',
        });
      }
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Could not load member');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);

  const title = useMemo(() => (member ? teamMemberLabel(member) : 'Edit member'), [member]);

  function patchForm(patch: Partial<TeamMemberFormValues>) {
    setValues((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function saveMember() {
    if (!userId || !values) return;
    setSaving(true);
    try {
      await adminApi.updateMember(userId, {
        email: values.email.trim().toLowerCase(),
        displayUsername: values.displayName.trim() || null,
        jobTitle: values.jobTitle.trim() || null,
        groupId: values.groupId || null,
        openaiTokenLimit: values.tokenLimit.trim()
          ? Math.max(0, Math.floor(Number(values.tokenLimit) || 0))
          : null,
        mobilePhone: values.mobilePhone.trim() || null,
        exotelVirtualNumber: values.exotelNumber.trim() || null,
        ...(values.password ? { password: values.password } : {}),
      });
      Alert.alert('Saved', 'Member updated.', [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Request failed');
    } finally {
      setSaving(false);
    }
  }

  function removeMember() {
    if (!member) return;
    const label = member.email ?? member.displayUsername ?? member.id;
    Alert.alert(
      'Remove from team',
      `Remove ${label} from your team? Their account will be deleted permanently and they will lose access.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            try {
              await adminApi.deleteMember(member.id);
              router.back();
            } catch (e: unknown) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Could not remove member');
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  }

  if (!isAdminUser(profile?.role)) {
    return (
      <View style={styles.container}>
        <BackScreenHeader title="Edit member" onBack={() => router.back()} />
        <EmptyState icon="lock-closed-outline" title="Admin Access Required" subtitle="Only admins can manage team members." />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <BackScreenHeader title={title} subtitle="Edit member" onBack={() => router.back()} />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>
      ) : !member || !values ? (
        <EmptyState icon="person-outline" title="Member not found" subtitle="This team member may have been removed." />
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <TeamMemberFormFields
              mode="edit"
              values={values}
              onChange={patchForm}
              groups={groups}
              exotelNumbers={exotelNumbers}
              tokensUsed={member.tokensUsed}
            />

            <TouchableOpacity
              style={styles.analyticsBtn}
              onPress={() => router.push(`/(workspace)/admin/analytics/${member.id}` as any)}
            >
              <Text style={styles.analyticsBtnText}>View analytics →</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.btnDisabled]}
              onPress={() => void saveMember()}
              disabled={saving || deleting}
            >
              {saving ? <ActivityIndicator size="small" color={Colors.surface} /> : (
                <Text style={styles.saveBtnText}>Save changes</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.deleteBtn, deleting && styles.btnDisabled]}
              onPress={removeMember}
              disabled={saving || deleting}
            >
              {deleting ? <ActivityIndicator size="small" color={Colors.error} /> : (
                <Text style={styles.deleteBtnText}>Remove from team</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, gap: 14, paddingBottom: 40 },
  analyticsBtn: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: Colors.surface,
  },
  analyticsBtnText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  deleteBtn: {
    borderWidth: 1,
    borderColor: Colors.error,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: Colors.surface,
  },
  btnDisabled: { opacity: 0.5 },
  saveBtnText: { color: Colors.surface, fontWeight: '700', fontSize: 15 },
  deleteBtnText: { color: Colors.error, fontWeight: '700', fontSize: 15 },
});
