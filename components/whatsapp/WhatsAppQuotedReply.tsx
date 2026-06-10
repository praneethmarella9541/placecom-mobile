import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import type { WhatsAppMessage } from '../../lib/whatsapp-types';
import { replyAuthorLabel, replyPreviewText } from '../../lib/whatsapp-reply-preview';
import { Colors } from '../../constants/colors';

type Props = {
  quoted: WhatsAppMessage;
  peerName: string;
  outbound?: boolean;
  onPress?: () => void;
};

export function WhatsAppQuotedReply({ quoted, peerName, outbound, onPress }: Props) {
  const author = replyAuthorLabel(quoted, 'You', peerName);
  const preview = replyPreviewText(quoted);

  return (
    <Pressable
      style={[styles.wrap, outbound ? styles.wrapOut : styles.wrapIn]}
      onPress={onPress}
      disabled={!onPress}
      hitSlop={6}
    >
      <View style={styles.bar} />
      <View style={styles.body}>
        <Text style={styles.author} numberOfLines={1}>
          {author}
        </Text>
        <Text style={styles.preview} numberOfLines={2}>
          {preview}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 4,
    backgroundColor: 'rgba(0,0,0,0.05)',
  },
  wrapOut: { backgroundColor: 'rgba(0,0,0,0.06)' },
  wrapIn: { backgroundColor: 'rgba(0,0,0,0.04)' },
  bar: { width: 4, backgroundColor: '#25D366' },
  body: { flex: 1, paddingVertical: 6, paddingHorizontal: 8, minWidth: 0 },
  author: { fontSize: 12, fontWeight: '700', color: '#075E54', marginBottom: 2 },
  preview: { fontSize: 13, color: Colors.textSecondary, lineHeight: 17 },
});
