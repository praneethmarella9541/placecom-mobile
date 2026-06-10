import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { WhatsAppMessage } from '../../lib/whatsapp-types';
import { replyAuthorLabel, replyPreviewText } from '../../lib/whatsapp-reply-preview';
import { Colors } from '../../constants/colors';

type Props = {
  message: WhatsAppMessage;
  peerName: string;
  onCancel: () => void;
};

export function WhatsAppReplyBar({ message, peerName, onCancel }: Props) {
  const preview = replyPreviewText(message);
  const author = replyAuthorLabel(message, 'You', peerName);

  return (
    <View style={styles.wrap}>
      <View style={styles.accent} />
      <View style={styles.body}>
        <Text style={styles.label}>Replying to {author}</Text>
        <Text style={styles.preview} numberOfLines={2}>
          {preview}
        </Text>
      </View>
      <TouchableOpacity onPress={onCancel} hitSlop={8} style={styles.close}>
        <Ionicons name="close" size={22} color={Colors.textMuted} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F0F2F5',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 10,
  },
  accent: { width: 4, alignSelf: 'stretch', borderRadius: 2, backgroundColor: '#25D366' },
  body: { flex: 1, minWidth: 0 },
  label: { fontSize: 12, fontWeight: '700', color: '#075E54', marginBottom: 2 },
  preview: { fontSize: 14, color: Colors.textSecondary },
  close: { padding: 4 },
});
