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
import { readFileAsBase64 } from '../../../lib/gmail-send-direct';
import { Colors } from '../../../constants/colors';

// Vercel's JSON body limit is ~4.5 MB. Cap the total attachment payload
// (base64-encoded, so multiply raw bytes by ~1.37) so we stay safely under.
const MAX_TOTAL_ATTACH_BYTES = 3 * 1024 * 1024; // 3 MB raw → ~4 MB base64

type PickedAttachment = {
  name: string;
  mimeType: string;
  size: number;
  uri: string;
  base64Data?: string;
  status: 'preparing' | 'ready' | 'error';
  errorMsg?: string;
};

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
  const [attachments, setAttachments] = useState<PickedAttachment[]>([]);

  const totalAttachBytes = attachments.reduce((n, a) => n + a.size, 0);
  const overLimit = totalAttachBytes > MAX_TOTAL_ATTACH_BYTES;
  const hasPreparing = attachments.some((a) => a.status === 'preparing');

  async function pickAttachment() {
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: true,
      multiple: true,
    });
    if (result.canceled) return;
    for (const a of result.assets) {
      const file: PickedAttachment = {
        name: a.name,
        mimeType: a.mimeType ?? 'application/octet-stream',
        size: a.size ?? 0,
        uri: a.uri,
        status: 'preparing',
      };
      setAttachments((prev) => [...prev, file]);
      // Read base64 in background so send is instant
      readFileAsBase64(a.uri)
        .then((base64Data) => {
          setAttachments((prev) =>
            prev.map((p) => (p.uri === a.uri ? { ...p, status: 'ready', base64Data } : p))
          );
        })
        .catch((e) => {
          setAttachments((prev) =>
            prev.map((p) => (p.uri === a.uri ? { ...p, status: 'error', errorMsg: e?.message ?? 'Read failed' } : p))
          );
        });
    }
  }

  function removeAttachment(uri: string) {
    setAttachments((prev) => prev.filter((a) => a.uri !== uri));
  }

  async function send() {
    if (!body.trim() || !recipients.trim()) {
      Alert.alert('Validation', 'Please fill in body and recipients.');
      return;
    }
    if (channel === 'email' && !subject.trim()) {
      Alert.alert('Validation', 'Subject is required for email broadcasts.');
      return;
    }
    if (channel === 'email' && hasPreparing) {
      Alert.alert('Please wait', 'Attachments are still being prepared.');
      return;
    }
    if (channel === 'email' && overLimit) {
      Alert.alert(
        'Attachments too large',
        `Total ${(totalAttachBytes / 1024 / 1024).toFixed(1)} MB exceeds the 3 MB broadcast limit. Remove some files or use the Inbox compose screen for large attachments.`
      );
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
        const readyAttachments = attachments
          .filter((a): a is PickedAttachment & { base64Data: string } => a.status === 'ready' && !!a.base64Data)
          .map((a) => ({ filename: a.name, mimeType: a.mimeType, base64Data: a.base64Data }));
        const res = await broadcastApi.sendEmail({
          subject: subject.trim(),
          textBody: body,
          recipients: recipientList,
          attachments: readyAttachments.length > 0 ? readyAttachments : undefined,
        });
        const failedCount = res.failed?.length ?? 0;
        if (failedCount > 0) {
          const sample = res.failed.slice(0, 3).map((f) => `• ${f.email}: ${f.error}`).join('\n');
          const more = failedCount > 3 ? `\n…and ${failedCount - 3} more` : '';
          Alert.alert(
            `Sent ${res.sent}/${res.recipients}`,
            `${failedCount} failed:\n${sample}${more}`
          );
        } else {
          Alert.alert('Sent!', `Email sent to ${res.sent} recipient${res.sent !== 1 ? 's' : ''}.`);
        }
      } else if (channel === 'sms') {
        const res = await broadcastApi.sendSms({ text: body, recipients: recipientList });
        const failedCount = res.failed?.length ?? 0;
        if (failedCount > 0) {
          Alert.alert(`Sent ${res.sent}/${recipientList.length}`, `${failedCount} failed.`);
        } else {
          Alert.alert('Sent!', `SMS sent to ${res.sent} recipient${res.sent !== 1 ? 's' : ''}.`);
        }
      } else {
        const res = await broadcastApi.sendWhatsApp({ text: body, recipients: recipientList });
        const failedCount = res.failed?.length ?? 0;
        if (failedCount > 0) {
          Alert.alert(`Sent ${res.sent}/${recipientList.length}`, `${failedCount} failed.`);
        } else {
          Alert.alert('Sent!', `WhatsApp sent to ${res.sent} recipient${res.sent !== 1 ? 's' : ''}.`);
        }
      }
      setSubject('');
      setBody('');
      setRecipients('');
      setAttachments([]);
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
            <>
              <TouchableOpacity style={styles.attachBtn} onPress={pickAttachment}>
                <Ionicons name="attach-outline" size={18} color={Colors.primary} />
                <Text style={styles.attachText}>Add attachment</Text>
              </TouchableOpacity>
              {attachments.length > 0 && (
                <View style={{ gap: 6 }}>
                  {attachments.map((a) => (
                    <View key={a.uri} style={styles.attachChip}>
                      {a.status === 'preparing' ? (
                        <ActivityIndicator size="small" color={Colors.primary} />
                      ) : a.status === 'error' ? (
                        <Ionicons name="warning-outline" size={14} color={Colors.error} />
                      ) : (
                        <Ionicons name="document-outline" size={14} color={Colors.primary} />
                      )}
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.attachChipName} numberOfLines={1}>{a.name}</Text>
                        <Text style={styles.attachChipSize}>
                          {a.status === 'preparing'
                            ? 'Preparing…'
                            : a.status === 'error'
                            ? a.errorMsg ?? 'Failed'
                            : `${(a.size / 1024).toFixed(1)} KB`}
                        </Text>
                      </View>
                      <TouchableOpacity onPress={() => removeAttachment(a.uri)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                        <Ionicons name="close-circle" size={16} color={Colors.textMuted} />
                      </TouchableOpacity>
                    </View>
                  ))}
                  {overLimit && (
                    <Text style={styles.warnText}>
                      Total {(totalAttachBytes / 1024 / 1024).toFixed(1)} MB — over the 3 MB broadcast limit.
                    </Text>
                  )}
                </View>
              )}
            </>
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

        <TouchableOpacity
          style={[
            styles.sendBtn,
            { backgroundColor: ch.color },
            (sending || (channel === 'email' && (hasPreparing || overLimit))) && { opacity: 0.6 },
          ]}
          onPress={send}
          disabled={sending || (channel === 'email' && (hasPreparing || overLimit))}
        >
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
  attachChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: Colors.primaryLight,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  attachChipName: { fontSize: 13, color: Colors.text, fontWeight: '500' },
  attachChipSize: { fontSize: 11, color: Colors.textMuted, marginTop: 1 },
  warnText: { fontSize: 12, color: Colors.error, fontWeight: '500' },
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
