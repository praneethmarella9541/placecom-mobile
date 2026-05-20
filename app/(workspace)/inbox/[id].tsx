import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { gmailApi } from '../../../lib/api';
import { Colors } from '../../../constants/colors';

export default function ThreadDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [thread, setThread] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [replyBody, setReplyBody] = useState('');
  const [sending, setSending] = useState(false);
  const [replyOpen, setReplyOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    gmailApi.getThread(id).then((data) => {
      setThread(data);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  async function sendReply() {
    if (!replyBody.trim() || !thread) return;
    setSending(true);
    try {
      const lastMsg = thread.messages?.[thread.messages.length - 1];
      await gmailApi.send({
        to: lastMsg?.from ?? '',
        subject: `Re: ${thread.subject ?? ''}`,
        body: replyBody,
        replyToMessageId: lastMsg?.id,
      });
      Alert.alert('Sent', 'Reply sent successfully.');
      setReplyBody('');
      setReplyOpen(false);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Failed to send reply');
    } finally {
      setSending(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={Colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="arrow-back" size={24} color={Colors.text} />
          </TouchableOpacity>
          <Text style={styles.subject} numberOfLines={2}>{thread?.subject ?? 'No Subject'}</Text>
          <TouchableOpacity onPress={() => setReplyOpen(!replyOpen)}>
            <Ionicons name="arrow-undo-outline" size={22} color={Colors.primary} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.messages} contentContainerStyle={{ padding: 16, gap: 16 }}>
          {(thread?.messages ?? []).map((msg: any, idx: number) => (
            <View key={msg.id ?? idx} style={styles.messageBubble}>
              <View style={styles.msgHeader}>
                <Text style={styles.msgFrom}>{msg.from}</Text>
                <Text style={styles.msgDate}>
                  {msg.date ? format(new Date(msg.date), 'MMM d, h:mm a') : ''}
                </Text>
              </View>
              <Text style={styles.msgTo}>To: {msg.to}</Text>
              <Text style={styles.msgBody}>{msg.body ?? msg.snippet}</Text>
              {(msg.attachments ?? []).length > 0 && (
                <View style={styles.attachments}>
                  {msg.attachments.map((att: any) => (
                    <View key={att.attachmentId} style={styles.attachmentChip}>
                      <Ionicons name="attach-outline" size={14} color={Colors.primary} />
                      <Text style={styles.attachmentName} numberOfLines={1}>{att.filename}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          ))}
        </ScrollView>

        {replyOpen && (
          <View style={[styles.replyBox, { paddingBottom: insets.bottom + 8 }]}>
            <TextInput
              style={styles.replyInput}
              value={replyBody}
              onChangeText={setReplyBody}
              placeholder="Write a reply..."
              placeholderTextColor={Colors.textMuted}
              multiline
              numberOfLines={3}
            />
            <TouchableOpacity style={styles.sendBtn} onPress={sendReply} disabled={sending}>
              {sending ? (
                <ActivityIndicator size="small" color={Colors.surface} />
              ) : (
                <Ionicons name="send" size={18} color={Colors.surface} />
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    backgroundColor: Colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  subject: { flex: 1, fontSize: 15, fontWeight: '700', color: Colors.text },
  messages: { flex: 1 },
  messageBubble: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    gap: 6,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 2,
  },
  msgHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  msgFrom: { fontSize: 13, fontWeight: '700', color: Colors.text, flex: 1 },
  msgDate: { fontSize: 11, color: Colors.textMuted },
  msgTo: { fontSize: 12, color: Colors.textSecondary },
  msgBody: { fontSize: 14, color: Colors.text, lineHeight: 20, marginTop: 6 },
  attachments: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: Colors.primaryLight,
    borderRadius: 999,
  },
  attachmentName: { fontSize: 12, color: Colors.primary, maxWidth: 120 },
  replyBox: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    padding: 12,
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  replyInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 10,
    fontSize: 14,
    color: Colors.text,
    minHeight: 44,
    maxHeight: 120,
  },
  sendBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
