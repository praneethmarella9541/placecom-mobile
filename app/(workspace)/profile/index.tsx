import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import ScreenHeader from '../../../components/ScreenHeader';
import { useDrawer } from '../_layout';
import { Colors } from '../../../constants/colors';
import { profileApi, type MeProfile } from '../../../lib/api';

export default function ProfileScreen() {
  const { openDrawer } = useDrawer();
  const [profile, setProfile] = useState<MeProfile | null>(null);
  const [loading, setLoading] = useState(true);

  const [displayUsername, setDisplayUsername] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [bio, setBio] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await profileApi.getProfile();
      setProfile(data);
      setDisplayUsername(data.displayUsername ?? '');
      setJobTitle(data.jobTitle ?? '');
      setBio(data.bio ?? '');
    } catch (e: unknown) {
      Alert.alert('Could not load profile', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleSaveProfile() {
    setSavingProfile(true);
    try {
      await profileApi.updateProfile({ displayUsername, jobTitle, bio });
      Alert.alert('Saved', 'Your profile has been updated.');
    } catch (e: unknown) {
      Alert.alert('Could not save', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleChangePassword() {
    if (newPassword.length < 8) {
      Alert.alert('Password too short', 'New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Passwords do not match', 'Confirm the new password again.');
      return;
    }
    setSavingPassword(true);
    try {
      const res = await profileApi.changePassword({ currentPassword, newPassword });
      if (res.error) throw new Error(res.error);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      Alert.alert('Password updated');
    } catch (e: unknown) {
      Alert.alert('Could not change password', e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setSavingPassword(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Profile" onMenuPress={openDrawer} />
        <View style={styles.center}>
          <ActivityIndicator color={Colors.copper} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Profile" onMenuPress={openDrawer} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Account</Text>
          <InfoRow label="Email" value={profile?.sessionEmail} />
          {profile?.mailboxEmail ? <InfoRow label="Mailbox" value={profile.mailboxEmail} /> : null}
          {profile?.exotelVirtualNumber ? <InfoRow label="Virtual number" value={profile.exotelVirtualNumber} /> : null}
          {profile?.groupName ? <InfoRow label="Group" value={profile.groupName} /> : null}
          {typeof profile?.tokensUsed === 'number' && typeof profile?.tokenLimit === 'number' ? (
            <InfoRow label="AI usage" value={`${profile.tokensUsed} / ${profile.tokenLimit} tokens`} />
          ) : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Profile</Text>
          <Text style={styles.fieldLabel}>Display name</Text>
          <TextInput
            style={styles.input}
            value={displayUsername}
            onChangeText={setDisplayUsername}
            placeholder="Display name"
            placeholderTextColor={Colors.textMuted}
          />
          <Text style={styles.fieldLabel}>Job title</Text>
          <TextInput
            style={styles.input}
            value={jobTitle}
            onChangeText={setJobTitle}
            placeholder="Job title"
            placeholderTextColor={Colors.textMuted}
          />
          <Text style={styles.fieldLabel}>Bio</Text>
          <TextInput
            style={[styles.input, styles.multiline]}
            value={bio}
            onChangeText={setBio}
            placeholder="Bio"
            placeholderTextColor={Colors.textMuted}
            multiline
          />
          <TouchableOpacity style={styles.saveBtn} onPress={handleSaveProfile} disabled={savingProfile}>
            {savingProfile ? (
              <ActivityIndicator color={Colors.surface} size="small" />
            ) : (
              <Text style={styles.saveBtnText}>Save profile</Text>
            )}
          </TouchableOpacity>
        </View>

        {profile?.canChangePassword ? (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Change password</Text>
            <Text style={styles.fieldLabel}>Current password</Text>
            <TextInput
              style={styles.input}
              value={currentPassword}
              onChangeText={setCurrentPassword}
              placeholder="Current password"
              placeholderTextColor={Colors.textMuted}
              secureTextEntry
            />
            <Text style={styles.fieldLabel}>New password</Text>
            <TextInput
              style={styles.input}
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="At least 8 characters"
              placeholderTextColor={Colors.textMuted}
              secureTextEntry
            />
            <Text style={styles.fieldLabel}>Confirm new password</Text>
            <TextInput
              style={styles.input}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Confirm new password"
              placeholderTextColor={Colors.textMuted}
              secureTextEntry
            />
            <TouchableOpacity style={styles.saveBtn} onPress={handleChangePassword} disabled={savingPassword}>
              {savingPassword ? (
                <ActivityIndicator color={Colors.surface} size="small" />
              ) : (
                <Text style={styles.saveBtnText}>Update password</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 16, paddingBottom: 40 },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 10,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 4,
  },
  infoLabel: { fontSize: 13, color: Colors.textMuted },
  infoValue: { fontSize: 13, color: Colors.text, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
  fieldLabel: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: Colors.text,
    backgroundColor: Colors.background,
  },
  multiline: { minHeight: 80, textAlignVertical: 'top' },
  saveBtn: {
    marginTop: 8,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  saveBtnText: { color: Colors.surface, fontSize: 15, fontWeight: '600' },
});
