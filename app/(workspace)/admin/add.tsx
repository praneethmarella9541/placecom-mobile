import React, { useCallback, useEffect, useState } from 'react';
import {
  View, ScrollView, TouchableOpacity, Text, StyleSheet, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import BackScreenHeader from '../../../components/BackScreenHeader';
import EmptyState from '../../../components/EmptyState';
import { TeamMemberFormFields, type TeamMemberFormValues } from '../../../components/admin/TeamMemberFormFields';
import { adminApi } from '../../../lib/api';
import type { AdminTeamGroup } from '../../../lib/admin-team';
import { isAdminUser } from '../../../lib/user-role';
import { useAuth } from '../../../hooks/useAuth';
import { Colors } from '../../../constants/colors';

const EMPTY_FORM: TeamMemberFormValues = {
  email: '',
  password: '',
  displayName: '',
  jobTitle: '',
  groupId: '',
  tokenLimit: '',
  mobilePhone: '',
  exotelNumber: '',
};

export default function AddTeamMemberScreen() {
  const router = useRouter();
  const { profile } = useAuth();
  const [values, setValues] = useState<TeamMemberFormValues>(EMPTY_FORM);
  const [groups, setGroups] = useState<AdminTeamGroup[]>([]);
  const [exotelNumbers, setExotelNumbers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const loadOptions = useCallback(async () => {
    try {
      const [groupsData, exotelData] = await Promise.all([
        adminApi.listGroups().catch(() => ({ groups: [] as AdminTeamGroup[] })),
        adminApi.listAvailableExotelNumbers().catch(() => ({ numbers: [] as string[] })),
      ]);
      setGroups(groupsData.groups ?? []);
      setExotelNumbers(exotelData.numbers ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadOptions(); }, [loadOptions]);

  function patchForm(patch: Partial<TeamMemberFormValues>) {
    setValues((prev) => ({ ...prev, ...patch }));
  }

  async function createStaff() {
    if (!values.email.trim() || values.password.length < 8) {
      Alert.alert('Validation', 'Work email and password (min 8 characters) are required.');
      return;
    }
    setSaving(true);
    try {
      const result = await adminApi.createMember({
        email: values.email.trim().toLowerCase(),
        password: values.password,
        displayUsername: values.displayName.trim() || undefined,
        jobTitle: values.jobTitle.trim() || null,
        groupId: values.groupId || null,
        openaiTokenLimit: values.tokenLimit.trim() ? Number(values.tokenLimit) : null,
        mobilePhone: values.mobilePhone.trim() || null,
        exotelVirtualNumber: values.exotelNumber.trim() || null,
      });
      Alert.alert(
        'Account created',
        `Account created for ${(result as { email?: string }).email ?? values.email.trim()}. They can sign in with this email and password.`,
        [{ text: 'OK', onPress: () => router.back() }],
      );
    } catch (e: unknown) {
      Alert.alert('Error', e instanceof Error ? e.message : 'Request failed');
    } finally {
      setSaving(false);
    }
  }

  if (!isAdminUser(profile?.role)) {
    return (
      <View style={styles.container}>
        <BackScreenHeader title="Add staff member" onBack={() => router.back()} />
        <EmptyState icon="lock-closed-outline" title="Admin Access Required" subtitle="Only admins can manage team members." />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <BackScreenHeader title="Add staff member" onBack={() => router.back()} />
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>
      ) : (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
            contentContainerStyle={styles.scroll}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <TeamMemberFormFields
              mode="create"
              values={values}
              onChange={patchForm}
              groups={groups}
              exotelNumbers={exotelNumbers}
            />
            <TouchableOpacity
              style={[styles.saveBtn, (saving || !values.email.trim() || values.password.length < 8) && styles.saveBtnDisabled]}
              onPress={() => void createStaff()}
              disabled={saving || !values.email.trim() || values.password.length < 8}
            >
              {saving ? (
                <ActivityIndicator size="small" color={Colors.surface} />
              ) : (
                <Text style={styles.saveBtnText}>Create staff account</Text>
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
  scroll: { padding: 16, gap: 20, paddingBottom: 40 },
  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.5 },
  saveBtnText: { color: Colors.surface, fontWeight: '700', fontSize: 15 },
});
