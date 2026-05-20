import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  TextInput, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import ScreenHeader from '../../../components/ScreenHeader';
import { useDrawer } from '../_layout';
import { broadcastApi } from '../../../lib/api';
import { Colors } from '../../../constants/colors';

type Channel = 'email' | 'sms' | 'whatsapp';

const CHANNELS: { key: Channel; label: string; icon: any; color: string }[] = [
  { key: 'email', label: 'Email', icon: 'mail-outline', color: Colors.primary },
  { key: 'sms', label: 'SMS', icon: 'chatbubble-outline', color: '#6366F1' },
  { key: 'whatsapp', label: 'WhatsApp', icon: 'logo-whatsapp', color: '#25D366' },
];

export default function BroadcastingScreen() {
  const { openDrawer } = useDrawer();
  const [channel, setChannel] = useState<Channel>('email');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [recipients, setRecipients] = useState('');
  const [sending, setSending] = useState(false);
  const [attachmentName, setAttachmentName] = useState<string | null>(null);

  async function pickAttachment() {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (!result.canceled && result.assets[0]) {
      setAttachmentName(result.assets[0].name);
    }
  }

  async function send() {
    if (!body.trim() || !recipients.trim()) {
      Alert.alert('Validation', 'Please fill in body and recipients.');
      return;
    }
    const recipientList = recipients.split(/[,\n]/).map((r) => r.trim()).filter(Boolean);
    if (recipientList.length === 0) {
      Alert.alert('Validation', 'No valid recipients found.');
      return;
    }

    setSending(true);
    try {
      if (channel === 'email') {
        await broadcastApi.sendEmail({ subject, body, recipients: recipientList });
      } else if (channel === 'sms') {
        await broadcastApi.sendSms({ body, recipients: recipientList });
      } else {
        await broadcastApi.sendWhatsApp({ body, recipients: recipientList });
      }
      Alert.alert('Sent!', `Broadcast sent to ${recipientList.length} recipient${recipientList.length !== 1 ? 's' : ''}.`);
      setSubject('');
      setBody('');
      setRecipients('');
      setAttachmentName(null);
    } catch (e: any) {
      Alert.alert('Error', e.message ?? 'Broadcast failed');
    } finally {
      setSending(false);
    }
  }

  const ch = CHANNELS.find((c) => c.key === channel)!;

  return (
    <View style={styles.container}>
      <ScreenHeader title="Broadcasting" onMenuPress={openDrawer} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.channelRow}>
          {CHANNELS.map((c) => (
            <TouchableOpacity
              key={c.key}
              style={[styles.channelBtn, channel === c.key && { backgroundColor: c.color, borderColor: c.color }]}
              onPress={() => setChannel(c.key)}
            >
              <Ionicons name={c.icon} size={18} color={channel === c.key ? Colors.surface : Colors.textSecondary} />
              <Text style={[styles.channelBtnText, channel === c.key && styles.channelBtnTextActive]}>{c.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Message</Text>

          {channel === 'email' && (
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Subject</Text>
              <TextInput
                style={styles.input}
                value={subject}
                onChangeText={setSubject}
                placeholder="Email subject line"
                placeholderTextColor={Colors.textMuted}
              />
            </View>
          )}

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Message Body</Text>
            <TextInput
              style={[styles.input, styles.bodyInput]}
              value={body}
              onChangeText={setBody}
              placeholder={channel === 'email' ? 'Email body (HTML or plain text)' : 'SMS/WhatsApp message'}
              placeholderTextColor={Colors.textMuted}
              multiline
              textAlignVertical="top"
            />
          </View>

          {channel === 'email' && (
            <TouchableOpacity style={styles.attachBtn} onPress={pickAttachment}>
              <Ionicons name="attach-outline" size={18} color={Colors.primary} />
              <Text style={styles.attachText}>
                {attachmentName ? attachmentName : 'Add Attachment'}
              </Text>
              {attachmentName && (
                <TouchableOpacity onPress={() => setAttachmentName(null)}>
                  <Ionicons name="close-circle" size={16} color={Colors.error} />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.card}>
          <View style={styles.recipientsHeader}>
            <Text style={styles.sectionTitle}>Recipients</Text>
          </View>
          <TextInput
            style={[styles.input, styles.recipientsInput]}
            value={recipients}
            onChangeText={setRecipients}
            placeholder={
              channel === 'email'
                ? 'email1@co.com, email2@co.com\n(one per line or comma-separated)'
                : '+1234567890, +0987654321\n(E.164 format, comma-separated)'
            }
            placeholderTextColor={Colors.textMuted}
            multiline
            textAlignVertical="top"
          />
          {recipients.trim() && (
            <Text style={styles.recipientCount}>
              {recipients.split(/[,\n]/).filter((r) => r.trim()).length} recipients
            </Text>
          )}
        </View>

        <TouchableOpacity style={[styles.sendBtn, { backgroundColor: ch.color }]} onPress={send} disabled={sending}>
          {sending ? (
            <ActivityIndicator color={Colors.surface} />
          ) : (
            <>
              <Ionicons name="megaphone-outline" size={20} color={Colors.surface} />
              <Text style={styles.sendBtnText}>Send {ch.label} Broadcast</Text>
            </>
          )}
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  channelRow: { flexDirection: 'row', gap: 8 },
  channelBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
  },
  channelBtnText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  channelBtnTextActive: { color: Colors.surface },
  card: {
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 16,
    gap: 14,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 1,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: Colors.text },
  fieldGroup: { gap: 6 },
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
  bodyInput: { minHeight: 120 },
  recipientsHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  recipientsInput: { minHeight: 100 },
  recipientCount: { fontSize: 12, color: Colors.primary, fontWeight: '600' },
  attachBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    borderStyle: 'dashed',
  },
  attachText: { flex: 1, fontSize: 13, color: Colors.primary },
  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 15,
    borderRadius: 12,
    minHeight: 50,
  },
  sendBtnText: { fontSize: 16, fontWeight: '700', color: Colors.surface },
});
