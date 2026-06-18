import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import type { Contact } from '../lib/gmail-contact-suggestions';
import { Gmail } from '../constants/gmailTheme';

type Props = {
  suggestions: Contact[];
  onPick: (contact: Contact) => void;
  maxHeight?: number;
};

export function EmailContactSuggestionList({ suggestions, onPick, maxHeight = 320 }: Props) {
  if (!suggestions.length) return null;

  return (
    <ScrollView
      style={[styles.box, { maxHeight }]}
      keyboardShouldPersistTaps="always"
      nestedScrollEnabled
    >
      {suggestions.map((c) => (
        <TouchableOpacity
          key={c.email}
          style={styles.row}
          onPress={() => onPick(c)}
          activeOpacity={0.7}
        >
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {((c.displayName ?? c.email).charAt(0) || '?').toUpperCase()}
            </Text>
          </View>
          <View style={styles.text}>
            {c.displayName ? (
              <>
                <Text style={styles.name} numberOfLines={1}>{c.displayName}</Text>
                <Text style={styles.email} numberOfLines={1}>{c.email}</Text>
              </>
            ) : (
              <Text style={styles.name} numberOfLines={1}>{c.email}</Text>
            )}
          </View>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  box: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Gmail.border,
    backgroundColor: Gmail.bg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Gmail.divider,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Gmail.blueLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 14, fontWeight: '600', color: Gmail.blue },
  text: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, color: Gmail.text },
  email: { fontSize: 13, color: Gmail.textSecondary, marginTop: 1 },
});
