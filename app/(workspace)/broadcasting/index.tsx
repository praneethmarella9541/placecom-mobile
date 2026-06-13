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
import { MailMergePanel } from '../../../components/MailMergePanel';
import { WhatsAppBroadcastPanel } from '../../../components/WhatsAppBroadcastPanel';
import { Colors } from '../../../constants/colors';

type Channel = 'mail' | 'whatsapp';

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

type EmailSubView = 'broadcast' | 'merge';

const EMAIL_COLOR = Colors.primary;

export default function BroadcastingScreen() {
  const { openDrawer } = useDrawer();
  const [channel, setChannel] = useState<Channel>('mail');
  const [emailSubView, setEmailSubView] = useState<EmailSubView>('broadcast');
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
    if (!subject.trim()) {
      Alert.alert('Validation', 'Subject is required for email broadcasts.');
      return;
    }
    if (hasPreparing) {
      Alert.alert('Please wait', 'Attachments are still being prepared.');
      return;
    }
    if (overLimit) {
      Alert.alert(
        'Attachments too large',
        `Total ${(totalAttachBytes / 1024 / 1024).toFixed(1)} MB exceeds the 3 MB broadcast limit. Remove some files or use the Mail compose screen for large attachments.`
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

  return (
    <View style={styles.container}>
      <ScreenHeader title="Broadcasting" onMenuPress={openDrawer} />
      <ScrollView contentContainerStyle={styles.content}>

        {/* Mail / WhatsApp channel tabs */}
        <View style={styles.channelRow}>
          {([
            { key: 'mail' as const, label: 'Mail', icon: 'mail-outline' as const },
            { key: 'whatsapp' as const, label: 'WhatsApp', icon: 'logo-whatsapp' as const },
          ]).map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.channelBtn, channel === t.key && styles.channelBtnActive]}
              onPress={() => setChannel(t.key)}
            >
              <Ionicons
                name={t.icon}
                size={16}
                color={channel === t.key ? (t.key === 'whatsapp' ? '#25D366' : Colors.primary) : Colors.textSecondary}
              />
              <Text style={[styles.channelBtnText, channel === t.key && styles.channelBtnTextActive]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {channel === 'whatsapp' ? (
          <WhatsAppBroadcastPanel />
        ) : (
        <>
        {/* Broadcast / Mail merge sub-tabs */}
        <View style={styles.subTabRow}>
          {([
            { key: 'broadcast' as const, label: 'Broadcast' },
            { key: 'merge' as const, label: 'Mail merge' },
          ]).map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.subTabBtn, emailSubView === t.key && styles.subTabBtnActive]}
              onPress={() => setEmailSubView(t.key)}
            >
              <Text style={[styles.subTabBtnText, emailSubView === t.key && styles.subTabBtnTextActive]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {emailSubView === 'merge' ? (
          <MailMergePanel />
        ) : (
        <>
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Message</Text>

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

          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Message Body</Text>
            <TextInput
              style={[styles.input, styles.bodyInput]}
              value={body}
              onChangeText={setBody}
              placeholder="Email body (HTML or plain text)"
              placeholderTextColor={Colors.textMuted}
              multiline
              textAlignVertical="top"
            />
          </View>

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
        </View>

        <View style={styles.card}>
          <View style={styles.recipientsHeader}>
            <Text style={styles.sectionTitle}>Recipients</Text>
          </View>
          <TextInput
            style={[styles.input, styles.recipientsInput]}
            value={recipients}
            onChangeText={setRecipients}
            placeholder="email1@co.com, email2@co.com&#10;(one per line or comma-separated)"
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
            { backgroundColor: EMAIL_COLOR },
            (sending || hasPreparing || overLimit) && { opacity: 0.6 },
          ]}
          onPress={send}
          disabled={sending || hasPreparing || overLimit}
        >
          {sending ? (
            <ActivityIndicator color={Colors.surface} />
          ) : (
            <>
              <Ionicons name="megaphone-outline" size={20} color={Colors.surface} />
              <Text style={styles.sendBtnText}>Send Email Broadcast</Text>
            </>
          )}
        </TouchableOpacity>
        </>
        )}
        </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, gap: 16, paddingBottom: 32 },
  channelRow: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 4,
    gap: 4,
  },
  channelBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 8,
  },
  channelBtnActive: { backgroundColor: Colors.primaryLight },
  channelBtnText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  channelBtnTextActive: { color: Colors.primary, fontWeight: '700' },
  subTabRow: {
    flexDirection: 'row',
    backgroundColor: Colors.surface,
    borderRadius: 10,
    padding: 4,
    gap: 4,
  },
  subTabBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },
  subTabBtnActive: { backgroundColor: Colors.primaryLight },
  subTabBtnText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  subTabBtnTextActive: { color: Colors.primary, fontWeight: '700' },
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
