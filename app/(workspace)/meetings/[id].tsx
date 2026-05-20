import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert, TextInput, Modal,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { meetingsApi } from '../../../lib/api';
import { Colors } from '../../../constants/colors';

export default function MeetingDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [meeting, setMeeting] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'summary' | 'transcript'>('summary');
  const [showSend, setShowSend] = useState(false);
  const [sendEmail, setSendEmail] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!id) return;
    meetingsApi.list().then((d) => {
      const m = d.meetings?.find((m: any) => m.id === id);
      setMeeting(m);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [id]);

  async function sendSummary() {
    if (!sendEmail || !id) return;
    setSending(true);
    try {
      await meetingsApi.sendSummary(id, sendEmail);
      Alert.alert('Sent', 'Meeting summary emailed successfully.');
      setShowSend(false);
      setSendEmail('');
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSending(false);
    }
  }

  if (loading) return <View style={styles.center}><ActivityIndicator color={Colors.primary} /></View>;
  if (!meeting) return <View style={styles.center}><Text>Meeting not found</Text></View>;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Meeting Details</Text>
        {meeting.summary && (
          <TouchableOpacity onPress={() => setShowSend(true)}>
            <Ionicons name="mail-outline" size={22} color={Colors.primary} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Ionicons name="videocam" size={28} color={Colors.primary} />
        </View>
        <Text style={styles.heroTitle}>
          {meeting.meeting_url ?? `Meeting ${meeting.id.slice(0, 8)}`}
        </Text>
        <Text style={styles.heroDate}>
          {meeting.created_at ? format(new Date(meeting.created_at), 'MMM d, yyyy h:mm a') : ''}
        </Text>
      </View>

      <View style={styles.tabs}>
        {(['summary', 'transcript'] as const).map((t) => (
          <TouchableOpacity key={t} style={[styles.tab, tab === t && styles.tabActive]} onPress={() => setTab(t)}>
            <Text style={[styles.tabText, tab === t && styles.tabTextActive]}>
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView style={styles.content} contentContainerStyle={{ padding: 16 }}>
        {tab === 'summary' ? (
          meeting.summary ? (
            <Text style={styles.bodyText}>{meeting.summary}</Text>
          ) : (
            <Text style={styles.emptyText}>No summary available. Meeting may still be processing.</Text>
          )
        ) : (
          meeting.transcript ? (
            <Text style={styles.bodyText}>{meeting.transcript}</Text>
          ) : (
            <Text style={styles.emptyText}>No transcript available for this meeting.</Text>
          )
        )}
      </ScrollView>

      <Modal visible={showSend} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Email Meeting Summary</Text>
            <TextInput
              style={styles.emailInput}
              value={sendEmail}
              onChangeText={setSendEmail}
              placeholder="Recipient email address"
              placeholderTextColor={Colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowSend(false)}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.sendBtn} onPress={sendSummary} disabled={sending}>
                {sending ? <ActivityIndicator size="small" color={Colors.surface} /> : <Text style={styles.sendText}>Send</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16, backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  headerTitle: { flex: 1, fontSize: 16, fontWeight: '700', color: Colors.text, marginHorizontal: 12 },
  hero: { alignItems: 'center', padding: 24, backgroundColor: Colors.surface, gap: 6, borderBottomWidth: 1, borderBottomColor: Colors.border },
  heroIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: Colors.primaryLight, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: 16, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  heroDate: { fontSize: 13, color: Colors.textMuted },
  tabs: { flexDirection: 'row', backgroundColor: Colors.surface, borderBottomWidth: 1, borderBottomColor: Colors.border },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: Colors.primary },
  tabText: { fontSize: 14, color: Colors.textSecondary },
  tabTextActive: { color: Colors.primary, fontWeight: '700' },
  content: { flex: 1 },
  bodyText: { fontSize: 14, color: Colors.text, lineHeight: 22 },
  emptyText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center', marginTop: 24 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: Colors.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 16 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.text },
  emailInput: { borderWidth: 1, borderColor: Colors.border, borderRadius: 10, padding: 12, fontSize: 14, color: Colors.text },
  modalActions: { flexDirection: 'row', gap: 12 },
  cancelBtn: { flex: 1, padding: 13, borderRadius: 10, borderWidth: 1, borderColor: Colors.border, alignItems: 'center' },
  cancelText: { fontSize: 15, fontWeight: '600', color: Colors.textSecondary },
  sendBtn: { flex: 1, padding: 13, borderRadius: 10, backgroundColor: Colors.primary, alignItems: 'center' },
  sendText: { fontSize: 15, fontWeight: '700', color: Colors.surface },
});
