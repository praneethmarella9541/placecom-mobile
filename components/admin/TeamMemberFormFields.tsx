import React, { useEffect, useMemo } from 'react';
import { View, Text, TextInput, StyleSheet } from 'react-native';
import { AdminSelectField } from './AdminSelectField';
import type { AdminTeamGroup } from '../../lib/admin-team';
import { phoneMatches } from '../../lib/phone';
import { Colors } from '../../constants/colors';

export type TeamMemberFormValues = {
  email: string;
  password: string;
  displayName: string;
  jobTitle: string;
  groupId: string;
  tokenLimit: string;
  mobilePhone: string;
  exotelNumber: string;
};

type Props = {
  mode: 'create' | 'edit';
  values: TeamMemberFormValues;
  onChange: (patch: Partial<TeamMemberFormValues>) => void;
  groups: AdminTeamGroup[];
  exotelNumbers: string[];
  tokensUsed?: number;
};

export function TeamMemberFormFields({
  mode,
  values,
  onChange,
  groups,
  exotelNumbers,
  tokensUsed,
}: Props) {
  const groupOptions = [
    { value: '', label: 'Full access (no group)' },
    ...groups.map((g) => ({ value: g.id, label: g.name })),
  ];

  const exotelOptions = useMemo(() => {
    if (exotelNumbers.length === 0) return [];
    return [
      { value: '', label: 'Not assigned' },
      ...exotelNumbers.map((n) => ({ value: n, label: n })),
    ];
  }, [exotelNumbers]);

  useEffect(() => {
    if (!values.exotelNumber) return;
    const stillAvailable = exotelNumbers.some((n) => phoneMatches(n, values.exotelNumber));
    if (!stillAvailable) onChange({ exotelNumber: '' });
  }, [exotelNumbers, values.exotelNumber, onChange]);

  return (
    <View style={styles.form}>
      {mode === 'create' ? (
        <Field label="Work email">
          <TextInput
            style={styles.input}
            value={values.email}
            onChangeText={(email) => onChange({ email })}
            placeholder="colleague@company.com"
            placeholderTextColor={Colors.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Field>
      ) : (
        <Field label="Email">
          <TextInput
            style={styles.input}
            value={values.email}
            onChangeText={(email) => onChange({ email })}
            placeholder="team@company.com"
            placeholderTextColor={Colors.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Field>
      )}

      <Field label={mode === 'create' ? 'Initial password (min. 8 characters)' : 'Set new password (optional)'}>
        <TextInput
          style={styles.input}
          value={values.password}
          onChangeText={(password) => onChange({ password })}
          placeholder={mode === 'create' ? '••••••••' : '••••••••'}
          placeholderTextColor={Colors.textMuted}
          secureTextEntry
          autoCapitalize="none"
        />
        {mode === 'edit' ? (
          <Text style={styles.hint}>
            Leave blank to keep their current password. If you enter one and save, it replaces the old password.
          </Text>
        ) : null}
      </Field>

      <Field label="Display name">
        <TextInput
          style={styles.input}
          value={values.displayName}
          onChangeText={(displayName) => onChange({ displayName })}
          placeholder="Optional — defaults from email"
          placeholderTextColor={Colors.textMuted}
        />
      </Field>

      <Field label="Job title">
        <TextInput
          style={styles.input}
          value={values.jobTitle}
          onChangeText={(jobTitle) => onChange({ jobTitle })}
          placeholder="Optional"
          placeholderTextColor={Colors.textMuted}
        />
      </Field>

      <AdminSelectField
        label="Access group"
        value={values.groupId}
        options={groupOptions}
        onChange={(groupId) => onChange({ groupId })}
        placeholder="Full access (no group)"
      />

      <Field label="OpenAI token limit">
        <TextInput
          style={styles.input}
          value={values.tokenLimit}
          onChangeText={(tokenLimit) => onChange({ tokenLimit })}
          placeholder="Leave empty for unlimited"
          placeholderTextColor={Colors.textMuted}
          keyboardType="number-pad"
        />
        <Text style={styles.hint}>
          Total input + output tokens allowed for email extraction. User is blocked once exceeded.
        </Text>
        {mode === 'edit' && tokensUsed != null ? (
          <Text style={styles.hint}>
            Used: {tokensUsed.toLocaleString()}
            {values.tokenLimit.trim() ? ` / ${Number(values.tokenLimit).toLocaleString()}` : ''}
          </Text>
        ) : null}
      </Field>

      <Field label="Personal mobile (for incoming call transfer)">
        <TextInput
          style={styles.input}
          value={values.mobilePhone}
          onChangeText={(mobilePhone) => onChange({ mobilePhone })}
          placeholder="+91 98765 43210"
          placeholderTextColor={Colors.textMuted}
          keyboardType="phone-pad"
        />
      </Field>

      <Field label="Assigned Exotel number">
        {exotelOptions.length > 0 ? (
          <>
            <AdminSelectField
              label=""
              value={values.exotelNumber}
              options={exotelOptions}
              onChange={(exotelNumber) => onChange({ exotelNumber })}
              placeholder="Not assigned"
            />
            {exotelOptions.length === 1 ? (
              <Text style={styles.hint}>All Exotel numbers are already assigned to team members.</Text>
            ) : null}
          </>
        ) : (
          <>
            <TextInput
              style={styles.input}
              value={values.exotelNumber}
              onChangeText={(exotelNumber) => onChange({ exotelNumber })}
              placeholder="+91… (loads from your Exotel account)"
              placeholderTextColor={Colors.textMuted}
              keyboardType="phone-pad"
            />
            {exotelNumbers.length === 0 && values.exotelNumber === '' ? (
              <Text style={styles.hint}>All Exotel numbers are already assigned to team members.</Text>
            ) : null}
          </>
        )}
        <Text style={styles.hint}>
          Inbound calls to this Exotel line ring their mobile. Outbound calls dial this Exotel number from the app.
        </Text>
      </Field>
    </View>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  if (!label) return <View style={styles.fieldGroup}>{children}</View>;
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: 16 },
  fieldGroup: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  input: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    color: Colors.text,
    backgroundColor: Colors.surface,
  },
  hint: { fontSize: 12, color: Colors.textMuted, lineHeight: 17 },
});
