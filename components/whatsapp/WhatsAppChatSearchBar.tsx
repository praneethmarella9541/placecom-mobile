import React from 'react';
import { View, TextInput, TouchableOpacity, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';

type Props = {
  query: string;
  onChangeQuery: (q: string) => void;
  matchCount: number;
  matchIndex: number;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
};

export function WhatsAppChatSearchBar({
  query,
  onChangeQuery,
  matchCount,
  matchIndex,
  onPrev,
  onNext,
  onClose,
}: Props) {
  const label =
    matchCount === 0
      ? query.trim()
        ? 'No matches'
        : 'Search in chat'
      : `${matchIndex + 1} of ${matchCount}`;

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Ionicons name="search" size={18} color="rgba(255,255,255,0.9)" />
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={onChangeQuery}
          placeholder="Search in chat"
          placeholderTextColor="rgba(255,255,255,0.55)"
          autoFocus
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.count}>{label}</Text>
        {matchCount > 0 ? (
          <>
            <TouchableOpacity onPress={onPrev} hitSlop={8} style={styles.navBtn}>
              <Ionicons name="chevron-up" size={22} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={onNext} hitSlop={8} style={styles.navBtn}>
              <Ionicons name="chevron-down" size={22} color="#fff" />
            </TouchableOpacity>
          </>
        ) : null}
        <TouchableOpacity onPress={onClose} hitSlop={8}>
          <Ionicons name="close" size={22} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#075E54',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0,0,0,0.15)',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  input: {
    flex: 1,
    fontSize: 16,
    color: '#fff',
    paddingVertical: 6,
    minWidth: 0,
  },
  count: { fontSize: 12, color: 'rgba(255,255,255,0.85)', minWidth: 72, textAlign: 'right' },
  navBtn: { padding: 2 },
});
